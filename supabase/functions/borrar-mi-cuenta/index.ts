import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/http.ts";

/**
 * El comensal borra su cuenta (fase 4.5, Ley 21.719). Se eliminan sus datos personales (correo,
 * sellos, premios, avisos, su lugar en las mesas) y la cuenta misma. Los registros de plata del local
 * quedan, sin su nombre: el local debe guardarlos por ley tributaria. Las cuentas del equipo de un
 * local no se borran por aquí.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
    const { data: quien } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null } };
    const user = quien?.user;
    if (!user) return json({ error: "Entra a la app para borrar tu cuenta" }, 401);
    const body = await req.json().catch(() => ({}));
    if (body?.confirmar !== true) return json({ error: "Confirma que quieres borrar tu cuenta" }, 400);

    const { error: e1 } = await admin.rpc("_borrar_datos_comensal", { _user_id: user.id });
    if (e1) {
      const propio = e1.message && !/[a-z]+_[a-z]+|violates|permission/i.test(e1.message);
      return json({ error: propio ? e1.message : "No pudimos borrar tu cuenta. Intenta de nuevo." }, propio ? 403 : 500);
    }
    const { error: e2 } = await admin.auth.admin.deleteUser(user.id);
    if (e2) {
      console.error("borrar usuario", e2.message);
      return json({ error: "Borramos tus datos, pero falta cerrar la cuenta. Intenta de nuevo." }, 500);
    }
    return json({ ok: true });
  } catch (e) {
    console.error("borrar-mi-cuenta", e instanceof Error ? e.message : e);
    return json({ error: "No pudimos borrar tu cuenta. Intenta de nuevo." }, 500);
  }
});
