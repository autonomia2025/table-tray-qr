import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json, UUID_RE } from "../_shared/http.ts";
import { enviarAviso } from "../_shared/webpush.ts";

// Fase 7.1 — Manda una campaña como aviso al celular. Primero reserva el envío con la sesión de quien la
// manda (enviar_campana revisa su permiso, el horario, el límite y a quién le llega); después, con la llave
// del servidor, manda los avisos pendientes. Las direcciones de los celulares nunca pasan por el navegador.
// Llamarla de nuevo no repite avisos: solo manda los que siguen pendientes.

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
    if (!token) return json({ error: "No autorizado" }, 401);

    const body = await req.json().catch(() => ({}));
    const campanaId = typeof body?.campana_id === "string" ? body.campana_id : "";
    if (!UUID_RE.test(campanaId)) return json({ error: "Campaña inválida" }, 400);

    // Con la sesión de quien la manda: la base revisa permiso, horario y límite
    const comoUsuario = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const { data: reserva, error: errReserva } = await comoUsuario.rpc("enviar_campana", { _campana_id: campanaId });
    if (errReserva) {
      const permiso = errReserva.code === "42501";
      return json({ error: errReserva.message, codigo: errReserva.code }, permiso ? 403 : 409);
    }

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: campana } = await admin.from("campanas").select("titulo, mensaje, tenant_id").eq("id", campanaId).single();
    const { data: local } = await admin.from("tenants").select("name, slug").eq("id", campana!.tenant_id).single();

    const publica = Deno.env.get("VAPID_PUBLIC_KEY");
    const privada = Deno.env.get("VAPID_PRIVATE_KEY");
    if (!publica || !privada) return json({ ...reserva, entregados: 0, configurado: false });
    const vapid = { publica, privada, sujeto: Deno.env.get("VAPID_SUBJECT") ?? "https://table-tray-qr.vercel.app" };

    const { data: avisos } = await admin.rpc("_avisos_por_mandar", { _campana_id: campanaId });
    const lista = (avisos ?? []) as { envio_id: string; token: string; suscripcion_id: string; endpoint: string; p256dh: string; auth: string }[];

    let entregados = 0;
    let fallidos = 0;
    // De a 20 a la vez: un local grande no satura el servicio de avisos
    for (let i = 0; i < lista.length; i += 20) {
      await Promise.all(lista.slice(i, i + 20).map(async (a) => {
        const aviso = JSON.stringify({
          titulo: `${local?.name ?? "Tu local"}: ${campana!.titulo}`,
          cuerpo: campana!.mensaje,
          url: `/${local?.slug}/promo/${a.token}`,
          tag: `campana-${campanaId}`,
        });
        let llego = false;
        try {
          const codigo = await enviarAviso({ endpoint: a.endpoint, p256dh: a.p256dh, auth: a.auth }, aviso, vapid, { ttl: 86400, urgencia: "low" });
          llego = codigo >= 200 && codigo < 300;
          // El celular ya no acepta avisos (desinstaló o revocó el permiso): se olvida esa dirección
          if (codigo === 404 || codigo === 410) await admin.from("suscripciones_push").delete().eq("id", a.suscripcion_id);
          else if (!llego) console.error("enviar-campana: el servicio de avisos respondió", codigo);
        } catch (e) {
          console.error("enviar-campana: envío fallido", (e as Error).message);
        }
        if (llego) entregados++; else fallidos++;
        await admin.rpc("_anotar_aviso_campana", { _envio_id: a.envio_id, _llego: llego });
      }));
    }
    return json({ ...reserva, entregados, fallidos });
  } catch (err) {
    console.error("enviar-campana error", err);
    return json({ error: "No se pudo enviar la campaña" }, 500);
  }
});
