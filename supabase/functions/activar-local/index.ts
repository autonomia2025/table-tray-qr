import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/http.ts";

/**
 * Activar el local (fase 5.1): el dueño abre el enlace que le mandó Tablio y crea su cuenta eligiendo su
 * propia contraseña (el correo es el que Tablio anotó al dar de alta el local). Si ya tiene una cuenta con
 * ese correo (por ejemplo, de otro local), entra con ella y el enlace le suma este local.
 * El enlace se reserva antes de crear la cuenta: dos personas no pueden usarlo a la vez.
 */

interface Reserva { id: string; tenant_id: string; branch_id: string; correo: string; nombre_dueno: string | null; slug: string }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let reserva: Reserva | null = null;
  const liberar = async () => { if (reserva) await admin.rpc("_liberar_activacion", { _id: reserva.id }); };
  try {
    const body = await req.json().catch(() => ({}));
    const token = typeof body?.token === "string" && /^[0-9a-f]{48}$/.test(body.token) ? body.token : "";
    if (!token) return json({ error: "El enlace no es válido" }, 400);

    // ¿Viene con una cuenta ya iniciada (dueño que ya usa Tablio)?
    const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
    const { data: quien } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null } };
    const cuenta = quien?.user && !quien.user.is_anonymous ? quien.user : null;

    const nombre = typeof body?.nombre === "string" ? body.nombre.trim().slice(0, 60) : "";
    const clave = typeof body?.password === "string" ? body.password : "";
    if (!cuenta) {
      if (nombre.length < 2) return json({ error: "Escribe tu nombre" }, 400);
      if (clave.length < 8 || clave.length > 72) return json({ error: "La contraseña debe tener entre 8 y 72 caracteres" }, 400);
    }

    const { data: r } = await admin.rpc("_reservar_activacion", { _token: token });
    reserva = ((r ?? []) as Reserva[])[0] ?? null;
    if (!reserva) return json({ error: "Este enlace ya se usó o venció. Pídele uno nuevo a Tablio." }, 409);

    let userId: string;
    if (cuenta) {
      if ((cuenta.email ?? "").toLowerCase() !== reserva.correo) {
        await liberar();
        return json({ error: "Este enlace es para otro correo. Entra con la cuenta de ese correo." }, 403);
      }
      userId = cuenta.id;
    } else {
      const { data: creada, error } = await admin.auth.admin.createUser({
        email: reserva.correo, password: clave, email_confirm: true, user_metadata: { name: nombre },
      });
      if (error || !creada.user) {
        await liberar();
        const yaExiste = /already been registered|already registered|exists/i.test(error?.message ?? "");
        return json({
          error: yaExiste
            ? "Ya tienes una cuenta con ese correo. Entra con ella y vuelve a abrir este enlace."
            : "No se pudo crear la cuenta. Intenta de nuevo.",
          ya_tiene_cuenta: yaExiste,
        }, yaExiste ? 409 : 500);
      }
      userId = creada.user.id;
    }

    const { error: errAlta } = await admin.rpc("_completar_activacion", { _id: reserva.id, _user_id: userId });
    if (errAlta) {
      console.error("activar-local alta", errAlta);
      if (!cuenta) await admin.auth.admin.deleteUser(userId);
      await liberar();
      return json({ error: "No se pudo activar el local. Intenta de nuevo." }, 500);
    }
    return json({ ok: true, slug: reserva.slug, correo: reserva.correo });
  } catch (e) {
    console.error("activar-local", e instanceof Error ? e.message : e);
    await liberar();
    return json({ error: "Ocurrió un error. Intenta de nuevo." }, 500);
  }
});
