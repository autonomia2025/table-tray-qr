import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { email, password, name, token } = await req.json();

    if (!email || !password || !name || !token) {
      return new Response(
        JSON.stringify({ error: "Todos los campos son obligatorios" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (password.length < 6) {
      return new Response(
        JSON.stringify({ error: "La contraseña debe tener al menos 6 caracteres" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. Validate invitation token
    const { data: invitation, error: invError } = await supabaseAdmin
      .from("staff_invitations")
      .select("id, tenant_id, branch_id, role, expires_at, used_at")
      .eq("token", token)
      .maybeSingle();

    if (invError || !invitation) {
      return new Response(
        JSON.stringify({ error: "Invitación no válida" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (invitation.used_at) {
      return new Response(
        JSON.stringify({ error: "Esta invitación ya fue utilizada" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (new Date(invitation.expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ error: "Esta invitación ha expirado" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Reservar la invitación de forma atómica (fase 1.10): dos personas no usan el mismo enlace.
    const { data: reservada } = await supabaseAdmin
      .from("staff_invitations")
      .update({ used_at: new Date().toISOString() })
      .eq("id", invitation.id)
      .is("used_at", null)
      .select("id")
      .maybeSingle();
    if (!reservada) {
      return new Response(
        JSON.stringify({ error: "Esta invitación ya fue utilizada" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const liberar = () =>
      supabaseAdmin.from("staff_invitations").update({ used_at: null }).eq("id", invitation.id);

    // 3. Crear la cuenta
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: String(email).trim().toLowerCase(),
      password,
      email_confirm: true,
    });

    if (authError || !authData.user) {
      await liberar();
      const yaExiste = /already been registered|already registered|exists/i.test(authError?.message ?? "");
      return new Response(
        JSON.stringify({ error: yaExiste ? "Este email ya está registrado. Intenta con otro o inicia sesión." : "No se pudo crear la cuenta. Intenta de nuevo." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = authData.user.id;

    // 4. Acceso real al local (tenant_members) y ficha del equipo. Si algo falla, no queda nada a medias.
    const { error: memberError } = await supabaseAdmin
      .from("tenant_members")
      .insert({
        user_id: userId,
        tenant_id: invitation.tenant_id,
        branch_id: invitation.branch_id,
        role: invitation.role,
        is_active: true,
      });
    const { error: staffError } = memberError
      ? { error: memberError }
      : await supabaseAdmin.from("staff_users").insert({
          name: String(name).trim().slice(0, 60),
          role: invitation.role,
          branch_id: invitation.branch_id,
          tenant_id: invitation.tenant_id,
          is_active: true,
          auth_user_id: userId,
        });

    if (memberError || staffError) {
      console.error("register-waiter alta error:", memberError ?? staffError);
      await supabaseAdmin.from("tenant_members").delete().eq("user_id", userId);
      await supabaseAdmin.auth.admin.deleteUser(userId);
      await liberar();
      return new Response(
        JSON.stringify({ error: "Error al crear el perfil del mozo" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, user_id: userId }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("register-waiter error:", e);
    return new Response(
      JSON.stringify({ error: "Ocurrió un error. Intenta de nuevo." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
