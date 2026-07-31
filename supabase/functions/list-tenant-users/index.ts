import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // --- Validar el JWT del llamante ---
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return json({ error: "No autorizado" }, 401);

    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !userData.user) return json({ error: "No autorizado" }, 401);

    const callerId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const tenantId = typeof body?.tenant_id === "string" ? body.tenant_id : "";
    if (!UUID_RE.test(tenantId)) return json({ error: "tenant_id inválido" }, 400);

    // --- Autorización: platform admin o miembro activo del tenant ---
    const { data: admin } = await supabaseAdmin
      .from("platform_admins")
      .select("id")
      .eq("user_id", callerId)
      .maybeSingle();

    let allowed = !!admin;
    if (!allowed) {
      const { data: member } = await supabaseAdmin
        .from("tenant_members")
        .select("role")
        .eq("user_id", callerId)
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .maybeSingle();
      allowed = !!member && ["owner", "admin"].includes(member.role);
    }
    if (!allowed) return json({ error: "Sin permisos para este restaurante" }, 403);

    // --- Recolectar usuarios del tenant ---
    const [membersRes, staffRes] = await Promise.all([
      supabaseAdmin
        .from("tenant_members")
        .select("id, user_id, role, is_active, branch_id, created_at")
        .eq("tenant_id", tenantId),
      supabaseAdmin
        .from("staff_users")
        .select("id, auth_user_id, name, role, is_active, branch_id, created_at")
        .eq("tenant_id", tenantId),
    ]);

    const members = membersRes.data ?? [];
    const staff = staffRes.data ?? [];

    // Resolver emails desde auth (nunca contraseñas: son hashes irreversibles)
    const authIds = new Set<string>();
    members.forEach((m) => m.user_id && authIds.add(m.user_id));
    staff.forEach((s) => s.auth_user_id && authIds.add(s.auth_user_id));

    const emailById = new Map<string, { email: string | null; last_sign_in_at: string | null }>();
    await Promise.all(
      [...authIds].map(async (id) => {
        const { data } = await supabaseAdmin.auth.admin.getUserById(id);
        if (data?.user) {
          emailById.set(id, {
            email: data.user.email ?? null,
            last_sign_in_at: data.user.last_sign_in_at ?? null,
          });
        }
      })
    );

    const users = [
      ...members.map((m) => ({
        id: m.id,
        source: "tenant_member" as const,
        name: null as string | null,
        email: emailById.get(m.user_id ?? "")?.email ?? null,
        role: m.role,
        is_active: m.is_active,
        branch_id: m.branch_id,
        last_sign_in_at: emailById.get(m.user_id ?? "")?.last_sign_in_at ?? null,
        created_at: m.created_at,
      })),
      ...staff.map((s) => ({
        id: s.id,
        source: "staff_user" as const,
        name: s.name,
        email: s.auth_user_id ? emailById.get(s.auth_user_id)?.email ?? null : null,
        role: s.role,
        is_active: s.is_active,
        branch_id: s.branch_id,
        last_sign_in_at: s.auth_user_id
          ? emailById.get(s.auth_user_id)?.last_sign_in_at ?? null
          : null,
        created_at: s.created_at,
      })),
    ];

    return json({ users });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
