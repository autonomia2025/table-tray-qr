import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json, UUID_RE } from "../_shared/http.ts";
import * as transbank from "../_shared/pasarelas/transbank.ts";

/**
 * Revisa los pagos que salieron a la pasarela y no volvieron (fase 4.4): el cliente pagó o abandonó
 * en Webpay y cerró el celular. Se intenta confirmar con la pasarela: si Transbank ya lo anuló (no
 * se confirmó a tiempo), el intento queda rechazado y no hay cobro; si se pudo confirmar, se registra
 * igual que si el cliente hubiera vuelto. Lo llama el reloj de la base (cada 5 minutos) con su clave,
 * o el local desde la caja ("revisar ahora") para su sucursal.
 *
 * También reintenta los cobros que la app tenía que devolver y la pasarela no devolvió (fase 4.6): antes
 * de devolver pregunta a Transbank cómo está el cobro, para no devolver dos veces.
 */

interface Intento { id: string; token: string | null; conexion_id: string | null; propina: number; proveedor: string | null }
interface Devolucion { id: string; token: string; conexion_id: string | null; monto: number }
type Conexion = { ambiente: transbank.Ambiente; credenciales: transbank.CredTransbank | null } | null;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    // ¿Quién llama? El reloj (con la clave de la bóveda) o alguien del local con acceso a la plata
    let sucursal: string | null = null;
    const claveReloj = req.headers.get("x-tablio-cron");
    const { data: esReloj } = claveReloj ? await admin.rpc("_verificar_cron", { _clave: claveReloj }) : { data: false };
    if (!esReloj) {
      const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
      const { data: quien } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null } };
      if (!quien?.user || quien.user.is_anonymous) return json({ error: "No autorizado" }, 401);
      const body = await req.json().catch(() => ({}));
      sucursal = typeof body?.branch_id === "string" && UUID_RE.test(body.branch_id) ? body.branch_id : null;
      if (!sucursal) return json({ error: "Sucursal inválida" }, 400);
      const { data: puede } = await admin.rpc("_puede_ver_plata", { _user_id: quien.user.id, _branch_id: sucursal });
      if (!puede) return json({ error: "Solo dueño, administrador, encargado o caja revisan los pagos" }, 403);
    }

    const { data } = await admin.rpc("_intentos_por_revisar", { _branch_id: sucursal });
    const intentos = (data ?? []) as Intento[];
    const resumen = { revisados: 0, confirmados: 0, cerrados: 0, pendientes: 0, devueltos: 0, sin_devolver: 0 };

    for (const it of intentos) {
      resumen.revisados++;
      const cerrar = async (motivo: string) => {
        await admin.rpc("confirmar_pago", {
          _intento_id: it.id, _aprobado: false, _monto_cobrado: 0, _proveedor: it.proveedor ?? "transbank",
          _referencia: null, _payload: { revision: motivo },
        });
        resumen.cerrados++;
      };
      try {
        if (!it.token) { await cerrar("no alcanzó a salir a la pasarela"); continue; }
        if (it.proveedor !== "transbank") { resumen.pendientes++; continue; }
        const { data: c } = await admin.rpc("_credenciales_conexion", { _conexion_id: it.conexion_id });
        const conexion = c as { ambiente: transbank.Ambiente; credenciales: transbank.CredTransbank | null } | null;
        if (!conexion?.credenciales) { resumen.pendientes++; continue; }

        let r: transbank.ResultadoTransbank | null = null;
        try {
          r = (await transbank.confirmar(conexion.ambiente, conexion.credenciales, it.token));
        } catch (e) {
          // Transbank ya no la deja confirmar (la anuló por falta de confirmación): no hubo cobro
          if (e instanceof transbank.ErrorTransbank && (e.status === 422 || e.status === 404)) {
            await cerrar("la pasarela la anuló: nadie la confirmó a tiempo");
            continue;
          }
          throw e;
        }
        if (transbank.aprobado(r)) {
          const cobrado = r.amount ?? 0;
          const { data: conf } = await admin.rpc("confirmar_pago", {
            _intento_id: it.id, _aprobado: true, _monto_cobrado: cobrado - it.propina, _proveedor: "transbank",
            _referencia: r.authorization_code ? `TBK-${r.authorization_code}` : `TBK-${it.id.slice(0, 8)}`,
            _payload: { conexion_id: it.conexion_id, token: it.token, ambiente: conexion.ambiente, autorizacion: r.authorization_code ?? null,
              tarjeta: r.card_detail?.card_number ?? null, tipo_pago: r.payment_type_code ?? null, revision: "confirmado al revisar" },
          });
          const confirmacion = conf as { estado: string; reembolsar?: number } | null;
          if (confirmacion?.estado === "reembolsado" && (confirmacion.reembolsar ?? 0) > 0) {
            const devuelto = await transbank.devolver(conexion.ambiente, conexion.credenciales, it.token, cobrado);
            await admin.rpc("_anotar_devolucion_intento", { _intento_id: it.id, _ok: devuelto.ok, _referencia: devuelto.referencia });
          }
          resumen.confirmados++;
        } else {
          await cerrar(`la pasarela no la aprobó (${r.status ?? "sin estado"})`);
        }
      } catch (e) {
        console.error("revisar-pagos", it.id, e instanceof Error ? e.message : e);
        resumen.pendientes++;
      }
    }
    // Devoluciones pendientes: se pregunta el estado del cobro y solo se devuelve lo que sigue cobrado
    const { data: porDevolver } = await admin.rpc("_devoluciones_por_reintentar", { _branch_id: sucursal });
    const conexiones = new Map<string, Conexion>();
    for (const d of (porDevolver ?? []) as Devolucion[]) {
      try {
        if (!d.conexion_id) { resumen.sin_devolver++; continue; }
        if (!conexiones.has(d.conexion_id)) {
          const { data: c } = await admin.rpc("_credenciales_conexion", { _conexion_id: d.conexion_id });
          conexiones.set(d.conexion_id, c as Conexion);
        }
        const conexion = conexiones.get(d.conexion_id);
        if (!conexion?.credenciales) {
          await admin.rpc("_anotar_devolucion_intento", { _intento_id: d.id, _ok: false, _referencia: null });
          resumen.sin_devolver++;
          continue;
        }
        const r = await transbank.estado(conexion.ambiente, conexion.credenciales, d.token) as transbank.ResultadoTransbank & { balance?: number };
        const yaDevuelto = r.status === "REVERSED" || r.status === "NULLIFIED" || (r.status === "PARTIALLY_NULLIFIED" && (r.balance ?? 0) === 0);
        if (yaDevuelto || r.status !== "AUTHORIZED" && r.status !== "PARTIALLY_NULLIFIED") {
          // Ya estaba devuelto, o nunca quedó cobrado: no hay nada que devolver
          await admin.rpc("_anotar_devolucion_intento", { _intento_id: d.id, _ok: true, _referencia: `TBK-${r.status ?? "SIN-COBRO"}` });
          resumen.devueltos++;
          continue;
        }
        const monto = r.status === "PARTIALLY_NULLIFIED" ? Math.min(d.monto, r.balance ?? d.monto) : d.monto;
        const devuelto = await transbank.devolver(conexion.ambiente, conexion.credenciales, d.token, monto);
        await admin.rpc("_anotar_devolucion_intento", { _intento_id: d.id, _ok: devuelto.ok, _referencia: devuelto.referencia });
        if (devuelto.ok) resumen.devueltos++; else resumen.sin_devolver++;
      } catch (e) {
        console.error("revisar-pagos devolución", d.id, e instanceof Error ? e.message : e);
        await admin.rpc("_anotar_devolucion_intento", { _intento_id: d.id, _ok: false, _referencia: null });
        resumen.sin_devolver++;
      }
    }

    return json(resumen);
  } catch (e) {
    console.error("revisar-pagos", e instanceof Error ? e.message : e);
    return json({ error: "No se pudo revisar los pagos" }, 500);
  }
});
