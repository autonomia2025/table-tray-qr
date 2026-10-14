import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json, UUID_RE } from "../_shared/http.ts";
import { enviarAviso } from "../_shared/webpush.ts";

// Fase 3.4b — Avisa al celular del comensal que algo de su pedido está listo, aunque tenga la pantalla
// bloqueada (notificaciones push del navegador, firmadas con la clave VAPID de Tablio; cifrado y firma
// en _shared/webpush.ts, sin librerías externas).
// La llama la pantalla de cocina justo después de marcar algo listo. Solo avisa lo que de verdad está
// listo y todavía no se avisó (order_items.avisado_at), así que llamarla dos veces no avisa dos veces.

const ROLES = ["owner", "admin", "manager", "kitchen"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
    if (!token) return json({ error: "No autorizado" }, 401);
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) return json({ error: "No autorizado" }, 401);

    const body = await req.json().catch(() => ({}));
    const pedidoId = typeof body?.order_id === "string" ? body.order_id : "";
    if (!UUID_RE.test(pedidoId)) return json({ error: "Pedido inválido" }, 400);

    const { data: pedido } = await admin
      .from("orders")
      .select("id, tenant_id, user_id, table_id")
      .eq("id", pedidoId)
      .maybeSingle();
    if (!pedido) return json({ error: "Pedido no encontrado" }, 404);

    // Solo la cocina (o el encargado/dueño) de ese local
    const { data: miembro } = await admin
      .from("tenant_members")
      .select("role")
      .eq("user_id", userData.user.id)
      .eq("tenant_id", pedido.tenant_id)
      .eq("is_active", true)
      .maybeSingle();
    if (!miembro || !ROLES.includes(miembro.role)) return json({ error: "No tienes permiso" }, 403);

    // Lo listo que todavía no se avisó; se marca antes de enviar para no avisar dos veces
    const { data: listos } = await admin
      .from("order_items")
      .update({ avisado_at: new Date().toISOString() })
      .eq("order_id", pedidoId)
      .eq("status", "ready")
      .is("avisado_at", null)
      .select("menu_item_name, quantity");
    if (!listos?.length || !pedido.user_id) return json({ enviados: 0, productos: listos?.length ?? 0 });

    const publica = Deno.env.get("VAPID_PUBLIC_KEY");
    const privada = Deno.env.get("VAPID_PRIVATE_KEY");
    if (!publica || !privada) return json({ enviados: 0, productos: listos.length, configurado: false });
    const vapid = { publica, privada, sujeto: Deno.env.get("VAPID_SUBJECT") ?? "https://table-tray-qr.vercel.app" };

    const { data: suscripciones } = await admin
      .from("suscripciones_push")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", pedido.user_id)
      .eq("tenant_id", pedido.tenant_id);
    if (!suscripciones?.length) return json({ enviados: 0, productos: listos.length });

    const [{ data: local }, { data: mesa }] = await Promise.all([
      admin.from("tenants").select("name, slug").eq("id", pedido.tenant_id).maybeSingle(),
      admin.from("tables").select("qr_token").eq("id", pedido.table_id).maybeSingle(),
    ]);
    const nombres = listos.map((i) => (i.quantity > 1 ? `${i.quantity}× ${i.menu_item_name}` : i.menu_item_name)).join(", ");
    const aviso = JSON.stringify({
      titulo: local?.name ?? "Tu pedido",
      cuerpo: `Ya está listo: ${nombres}. El mozo te lo trae.`,
      url: local?.slug && mesa?.qr_token ? `/${local.slug}/tracking?t=${mesa.qr_token}&order=${pedidoId}` : "/",
      tag: `pedido-${pedidoId}`,
    });

    let enviados = 0;
    let fallidos = 0;
    await Promise.all(suscripciones.map(async (s) => {
      try {
        const codigo = await enviarAviso(s, aviso, vapid, { ttl: 600, urgencia: "high" });
        if (codigo >= 200 && codigo < 300) {
          enviados++;
          await admin.from("suscripciones_push").update({ usado_at: new Date().toISOString() }).eq("id", s.id);
          return;
        }
        fallidos++;
        // El celular ya no acepta avisos (desinstaló o revocó el permiso): se olvida esa dirección
        if (codigo === 404 || codigo === 410) await admin.from("suscripciones_push").delete().eq("id", s.id);
        else console.error("avisar-listo: el servicio de avisos respondió", codigo);
      } catch (e) {
        fallidos++;
        console.error("avisar-listo: envío fallido", (e as Error).message);
      }
    }));
    return json({ enviados, fallidos, productos: listos.length });
  } catch (err) {
    console.error("avisar-listo error", err);
    return json({ error: "No se pudo enviar el aviso" }, 500);
  }
});
