import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json, UUID_RE } from "../_shared/http.ts";
import * as transbank from "../_shared/pasarelas/transbank.ts";

/**
 * Conciliación con la pasarela al cerrar la caja (fase 4.4; decisión del fundador del 13 de octubre):
 * cada pago con Webpay del día se compara con lo que dice Transbank. Calza si Transbank lo tiene
 * autorizado por el mismo monto (consumo + propina) y, si se devolvió, también anulado por lo devuelto.
 * Queda en la auditoría. Webpay responde por cada pago hasta 7 días después.
 */

interface PagoDia {
  id: string; monto: number; propina: number; reembolsado: number; estado: string; token: string | null;
  conexion_id: string | null; referencia: string | null; created_at: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
    const { data: quien } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null } };
    if (!quien?.user || quien.user.is_anonymous) return json({ error: "No autorizado" }, 401);
    const body = await req.json().catch(() => ({}));
    const sucursal = typeof body?.branch_id === "string" && UUID_RE.test(body.branch_id) ? body.branch_id : "";
    const dia = typeof body?.dia === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.dia) ? body.dia : "";
    if (!sucursal || !dia) return json({ error: "Faltan la sucursal o el día" }, 400);
    const { data: puede } = await admin.rpc("_puede_ver_plata", { _user_id: quien.user.id, _branch_id: sucursal });
    if (!puede) return json({ error: "Solo dueño, administrador, encargado o caja concilian la caja" }, 403);

    const { data } = await admin.rpc("_pagos_pasarela_dia", { _branch_id: sucursal, _dia: dia });
    const pagos = (data ?? []) as PagoDia[];
    const credenciales = new Map<string, { ambiente: transbank.Ambiente; credenciales: transbank.CredTransbank | null } | null>();
    // "transitorio": Transbank no respondió; no es una diferencia, se vuelve a intentar
    const resultado: { pago_id: string; referencia: string | null; monto: number; calza: boolean; detalle: string; transitorio?: boolean }[] = [];

    for (const p of pagos) {
      const total = p.monto + p.propina;
      if (!p.token || !p.conexion_id) {
        resultado.push({ pago_id: p.id, referencia: p.referencia, monto: total, calza: false, detalle: "Sin número de Webpay: revísalo en el portal de Transbank" });
        continue;
      }
      if (!credenciales.has(p.conexion_id)) {
        const { data: c } = await admin.rpc("_credenciales_conexion", { _conexion_id: p.conexion_id });
        credenciales.set(p.conexion_id, c as { ambiente: transbank.Ambiente; credenciales: transbank.CredTransbank | null } | null);
      }
      const conexion = credenciales.get(p.conexion_id);
      if (!conexion?.credenciales) {
        resultado.push({ pago_id: p.id, referencia: p.referencia, monto: total, calza: false, detalle: "La pasarela se desconectó: revísalo en el portal de Transbank" });
        continue;
      }
      try {
        const r = await transbank.estado(conexion.ambiente, conexion.credenciales, p.token) as transbank.ResultadoTransbank & { balance?: number };
        const anulado = r.status === "REVERSED" || r.status === "NULLIFIED";
        let calza = false;
        let detalle = "";
        if (p.reembolsado >= total) {
          calza = anulado || r.status === "PARTIALLY_NULLIFIED" && (r.balance ?? 0) === 0;
          detalle = calza ? "Devuelto completo, igual que en Transbank" : `Tablio lo tiene devuelto y Transbank dice ${r.status}`;
        } else if (p.reembolsado > 0) {
          calza = r.status === "PARTIALLY_NULLIFIED" || r.status === "AUTHORIZED";
          detalle = calza ? "Devuelto en parte" : `Tablio lo tiene devuelto en parte y Transbank dice ${r.status}`;
        } else {
          calza = r.status === "AUTHORIZED" && r.amount === total;
          detalle = calza ? "Autorizado por el mismo monto" : `Transbank dice ${r.status} por ${r.amount ?? "?"} y Tablio cobró ${total}`;
        }
        resultado.push({ pago_id: p.id, referencia: p.referencia, monto: total, calza, detalle });
      } catch (e) {
        resultado.push({ pago_id: p.id, referencia: p.referencia, monto: total, calza: false, detalle: "Transbank no respondió: vuelve a intentar en un momento", transitorio: true });
        console.error("conciliar", p.id, e instanceof Error ? e.message : e);
      }
    }

    const diferencias = resultado.filter((x) => !x.calza).length;
    // Lo que no calza queda en las excepciones de la caja hasta que alguien lo revise (fase 4.6)
    await admin.rpc("_anotar_conciliacion", { _branch_id: sucursal, _dia: dia, _resultados: resultado });
    const { data: b } = await admin.from("branches").select("tenant_id").eq("id", sucursal).single();
    await admin.from("audit_logs").insert({
      tenant_id: b?.tenant_id, user_id: quien.user.id, action: "conciliacion_pasarela", entity_type: "branch", entity_id: sucursal,
      metadata: { dia, pagos: resultado.length, diferencias },
    });
    return json({ dia, pagos: resultado.length, diferencias, detalle: resultado });
  } catch (e) {
    console.error("conciliar-pasarela", e instanceof Error ? e.message : e);
    return json({ error: "No se pudo conciliar con la pasarela" }, 500);
  }
});
