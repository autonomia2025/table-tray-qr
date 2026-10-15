import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json, UUID_RE } from "../_shared/http.ts";

/**
 * Entrar con PIN en una tablet compartida (fase 6.1). La tablet tiene su token (lo recibió al activarla el
 * dueño o el encargado); el mozo elige su nombre y escribe su PIN. Si todo calza, se le entrega a la tablet
 * una sesión de ESE mozo: lo que haga queda a su nombre, como si usara su teléfono. Nadie conoce su
 * contraseña. 5 PIN equivocados bloquean 10 minutos.
 */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const body = await req.json().catch(() => ({}));
    const token = typeof body?.equipo === "string" && /^[0-9a-f]{64}$/.test(body.equipo) ? body.equipo : "";
    const staffId = typeof body?.persona === "string" && UUID_RE.test(body.persona) ? body.persona : "";
    const pin = typeof body?.pin === "string" && /^[0-9]{4}$/.test(body.pin) ? body.pin : "";
    if (!token || !staffId || !pin) return json({ error: "Elige tu nombre y escribe tu PIN de 4 números" }, 400);

    const { data: r, error } = await admin.rpc("_verificar_pin", { _token: token, _staff_id: staffId, _pin: pin });
    if (error) {
      console.error("entrar-con-pin verificar", error.message);
      return json({ error: "No se pudo revisar el PIN. Intenta de nuevo." }, 503);
    }
    const v = r as { ok: boolean; motivo?: string; correo?: string; nombre?: string };
    if (!v.ok || !v.correo) return json({ error: v.motivo ?? "PIN incorrecto." }, 403);

    // Sesión para esa persona: un enlace de un solo uso que se canjea aquí mismo (nunca sale del servidor)
    const { data: enlace, error: errEnlace } = await admin.auth.admin.generateLink({ type: "magiclink", email: v.correo });
    if (errEnlace || !enlace?.properties?.hashed_token) {
      console.error("entrar-con-pin enlace", errEnlace?.message);
      return json({ error: "No se pudo abrir tu sesión. Intenta de nuevo." }, 503);
    }
    const publico = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: sesion, error: errSesion } = await publico.auth.verifyOtp({ token_hash: enlace.properties.hashed_token, type: "magiclink" });
    if (errSesion || !sesion.session) {
      console.error("entrar-con-pin sesión", errSesion?.message);
      return json({ error: "No se pudo abrir tu sesión. Intenta de nuevo." }, 503);
    }
    return json({ nombre: v.nombre, access_token: sesion.session.access_token, refresh_token: sesion.session.refresh_token });
  } catch (e) {
    console.error("entrar-con-pin", e instanceof Error ? e.message : e);
    return json({ error: "Ocurrió un error. Intenta de nuevo." }, 500);
  }
});
