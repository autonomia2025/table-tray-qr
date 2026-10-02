import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json, UUID_RE, EMAIL_RE } from "../_shared/http.ts";

/**
 * Crea un usuario (o reutiliza uno existente) y, si se indica un local, lo agrega como personal.
 *
 * Quién puede llamarla (fase 1.1, DIAGNOSTICO problema 5):
 *  - con tenant_id: superadmin, o dueño/administrador activo de ESE local;
 *  - sin tenant_id: solo superadmin (alta de dueños desde el panel de superadmin).
 *
 * Qué rol puede asignar cada uno (fase 1.2):
 *  - superadmin: cualquiera;  dueño: admin, manager, cashier, waiter, kitchen;
 *  - administrador: manager, cashier, waiter, kitchen.
 */
const ROLES = ["owner", "admin", "manager", "cashier", "waiter", "kitchen"] as const;
const ASIGNABLES: Record<string, string[]> = {
  owner: ["admin", "manager", "cashier", "waiter", "kitchen"],
  admin: ["manager", "cashier", "waiter", "kitchen"],
};
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // --- Quién llama ---
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
    if (!token) return json({ error: "Tienes que iniciar sesión." }, 401);
    const { data: caller, error: callerErr } = await admin.auth.getUser(token);
    if (callerErr || !caller.user) return json({ error: "Tienes que iniciar sesión." }, 401);
    const callerId = caller.user.id;

    const body = await req.json().catch(() => ({}));
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const tenantId = typeof body?.tenant_id === "string" && body.tenant_id ? body.tenant_id : null;
    const branchId = typeof body?.branch_id === "string" && body.branch_id ? body.branch_id : null;
    const rol = typeof body?.role === "string" && body.role ? body.role : "waiter";
    if (!(ROLES as readonly string[]).includes(rol)) return json({ error: "Rol inválido." }, 400);

    if (tenantId && !UUID_RE.test(tenantId)) return json({ error: "Local inválido." }, 400);
    if (branchId && !UUID_RE.test(branchId)) return json({ error: "Sucursal inválida." }, 400);

    // --- Autorización ---
    const { data: platformAdmin } = await admin
      .from("platform_admins")
      .select("id")
      .eq("user_id", callerId)
      .maybeSingle();

    let allowed = !!platformAdmin;
    if (!allowed && tenantId) {
      const { data: member } = await admin
        .from("tenant_members")
        .select("role")
        .eq("user_id", callerId)
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .maybeSingle();
      allowed = !!member && ["owner", "admin"].includes(member.role);
      if (allowed && !ASIGNABLES[member!.role].includes(rol)) {
        return json({ error: "No puedes asignar ese rol." }, 403);
      }
    }
    if (!allowed) return json({ error: "No tienes permiso para crear usuarios en este local." }, 403);

    // --- Validación ---
    if (!EMAIL_RE.test(email)) return json({ error: "El email no es válido." }, 400);
    if (password.length < 6) return json({ error: "La contraseña debe tener al menos 6 caracteres." }, 400);
    if (branchId && tenantId) {
      const { data: branch } = await admin
        .from("branches")
        .select("id")
        .eq("id", branchId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (!branch) return json({ error: "La sucursal no pertenece a este local." }, 400);
    }

    // --- Crear o reutilizar el usuario ---
    let userId: string;
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (created?.user) {
      userId = created.user.id;
    } else {
      const existing = await buscarPorEmail(admin, email);
      if (!existing) {
        console.error("create-tenant-user createUser error:", createErr?.message);
        return json({ error: "No se pudo crear el usuario. Intenta de nuevo." }, 400);
      }
      userId = existing;
    }

    // --- Agregar al local ---
    if (tenantId) {
      const { data: already } = await admin
        .from("tenant_members")
        .select("id")
        .eq("user_id", userId)
        .eq("tenant_id", tenantId)
        .maybeSingle();

      if (!already) {
        const { error: memberErr } = await admin.from("tenant_members").insert({
          user_id: userId,
          tenant_id: tenantId,
          branch_id: branchId,
          role: rol,
          is_active: true,
        });
        if (memberErr) {
          console.error("create-tenant-user member insert error:", memberErr.message);
          return json({ error: "Se creó el usuario, pero no se pudo agregar al local." }, 500);
        }
      }
    }

    return json({ user_id: userId });
  } catch (e) {
    console.error("create-tenant-user error:", e);
    return json({ error: "Ocurrió un error. Intenta de nuevo." }, 500);
  }
});

/** Busca un usuario por email recorriendo todas las páginas (antes fallaba con más de 50). */
async function buscarPorEmail(
  admin: ReturnType<typeof createClient>,
  email: string,
): Promise<string | null> {
  const porPagina = 1000;
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: porPagina });
    if (error) {
      console.error("create-tenant-user listUsers error:", error.message);
      return null;
    }
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < porPagina) return null;
  }
  return null;
}
