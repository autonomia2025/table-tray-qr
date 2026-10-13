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
      .from("backoffice_invitations")
      .select("id, role, zone, expires_at, used_at")
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

    // 2. Reservar la invitación de forma atómica (fase 1.8): si dos personas usan el mismo enlace
    //    a la vez, solo una gana. Se libera si algo falla después.
    const ahora = new Date().toISOString();
    const { data: reservada } = await supabaseAdmin
      .from("backoffice_invitations")
      .update({ used_at: ahora })
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
      supabaseAdmin.from("backoffice_invitations").update({ used_at: null }).eq("id", invitation.id);

    // 3. Crear la cuenta
    const correo = String(email).trim().toLowerCase();
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: correo,
      password,
      email_confirm: true,
    });

    if (authError || !authData.user) {
      await liberar();
      const yaExiste = /already been registered|already registered|exists/i.test(authError?.message ?? "");
      return new Response(
        JSON.stringify({ error: yaExiste ? "Este correo ya está registrado." : "No se pudo crear la cuenta. Intenta de nuevo." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = authData.user.id;

    // 4. Ficha del miembro: si el superadmin ya la había creado con este correo (sin cuenta), se vincula;
    //    si no, se crea. Así no quedan miembros duplicados.
    const { data: existente } = await supabaseAdmin
      .from("backoffice_members")
      .select("id")
      .ilike("email", correo)
      .is("user_id", null)
      .eq("role", invitation.role)
      .limit(1)
      .maybeSingle();

    const { data: member, error: memberError } = existente
      ? await supabaseAdmin
          .from("backoffice_members")
          .update({ user_id: userId, name: name.trim(), is_active: true, zone: invitation.zone })
          .eq("id", existente.id)
          .select("id")
          .single()
      : await supabaseAdmin
          .from("backoffice_members")
          .insert({
            name: name.trim(),
            email: correo,
            role: invitation.role,
            zone: invitation.zone,
            is_active: true,
            user_id: userId,
          })
          .select("id")
          .single();

    if (memberError || !member) {
      await supabaseAdmin.auth.admin.deleteUser(userId);
      await liberar();
      return new Response(
        JSON.stringify({ error: "Error al crear el perfil" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5. Dejar anotado quién usó la invitación
    await supabaseAdmin
      .from("backoffice_invitations")
      .update({ used_by_member_id: member.id })
      .eq("id", invitation.id);

    return new Response(
      JSON.stringify({ success: true, user_id: userId }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("register-seller error:", e);
    return new Response(
      JSON.stringify({ error: "Ocurrió un error. Intenta de nuevo." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
