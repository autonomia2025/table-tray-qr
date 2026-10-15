import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as transbank from "../_shared/pasarelas/transbank.ts";
import { appPermitida, decodificarApp } from "../_shared/urls.ts";

/**
 * Regreso desde la pasarela (fase 4.1). Webpay devuelve al cliente aquí (POST o GET) con:
 *  - token_ws: pagó (o rechazó la tarjeta) → se confirma con Transbank y se registra en la base;
 *  - TBK_TOKEN: anuló en la página de Webpay → el intento queda rechazado;
 *  - solo TBK_ORDEN_COMPRA: se le acabó el tiempo → igual.
 * Después se le manda de vuelta a su pantalla de la app, que muestra cómo terminó.
 * La confirmación en la base es idempotente: recargar esta página no cobra ni registra dos veces.
 */

interface Intento {
  id: string; estado: string; monto: number; propina: number; conexion_id: string | null;
  token: string | null; slug: string; qr: string;
}

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const url = new URL(req.url);
  const campos = new URLSearchParams(url.search);
  if (req.method === "POST") {
    const form = new URLSearchParams(await req.text());
    form.forEach((v, k) => campos.set(k, v));
  }
  const app = decodificarApp(campos.get("a")) ?? appPermitida(campos.get("app")) ?? appPermitida(Deno.env.get("URL_APP"))
    ?? "https://table-tray-qr.vercel.app";
  const volverA = campos.get("v") === "pay" ? "pay" : "checkout";
  const tokenPago = campos.get("token_ws");
  const tokenAnulado = campos.get("TBK_TOKEN");
  const orden = campos.get("TBK_ORDEN_COMPRA");

  const { data } = await admin.rpc("_intento_de_retorno", { _token: tokenPago ?? tokenAnulado ?? null, _orden: orden });
  const it = data as Intento | null;
  if (!it) return Response.redirect(`${app}/?pago=desconocido`, 303);
  const destino = `${app}/${it.slug}/${volverA}?t=${encodeURIComponent(it.qr)}&intento=${it.id}`;

  try {
    if (it.estado === "reservado") {
      const { data: c } = await admin.rpc("_credenciales_conexion", { _conexion_id: it.conexion_id });
      const conexion = c as { ambiente: transbank.Ambiente; credenciales: transbank.CredTransbank } | null;
      if (!conexion?.credenciales) throw new Error("conexión sin credenciales");

      if (!tokenPago) {
        // Anuló o se le acabó el tiempo en Webpay: no se cobró nada
        await admin.rpc("confirmar_pago", {
          _intento_id: it.id, _aprobado: false, _monto_cobrado: 0, _proveedor: "transbank", _referencia: null,
          _payload: { anulado: true },
        });
      } else {
        const r = await transbank.confirmar(conexion.ambiente, conexion.credenciales, tokenPago);
        const ok = transbank.aprobado(r);
        const cobrado = ok ? (r.amount ?? 0) : 0;
        const { data: conf } = await admin.rpc("confirmar_pago", {
          _intento_id: it.id,
          _aprobado: ok,
          // La base compara el consumo: lo cobrado menos la propina
          _monto_cobrado: ok ? cobrado - it.propina : 0,
          _proveedor: "transbank",
          _referencia: r.authorization_code ? `TBK-${r.authorization_code}` : `TBK-${r.buy_order ?? it.id.slice(0, 8)}`,
          _payload: {
            conexion_id: it.conexion_id, token: tokenPago, ambiente: conexion.ambiente,
            autorizacion: r.authorization_code ?? null, tarjeta: r.card_detail?.card_number ?? null,
            tipo_pago: r.payment_type_code ?? null, cuotas: r.installments_number ?? 0, estado: r.status ?? null,
          },
        });
        const confirmacion = conf as { estado: string; reembolsar?: number } | null;
        // Monto que no calza o algo que ya pagó otra persona: se devuelve solo
        if (ok && confirmacion?.estado === "reembolsado" && (confirmacion.reembolsar ?? 0) > 0) {
          const devuelto = await transbank.devolver(conexion.ambiente, conexion.credenciales, tokenPago, cobrado);
          // Queda anotado si resultó (fase 4.6): si falló, la revisión automática lo reintenta
          await admin.rpc("_anotar_devolucion_intento", { _intento_id: it.id, _ok: devuelto.ok, _referencia: devuelto.referencia });
        }
      }
    }
  } catch (e) {
    // Si algo falla aquí, el intento queda "reservado": la auditoría lo muestra y se puede reintentar
    console.error("pago-retorno", e instanceof Error ? e.message : e);
  }
  return Response.redirect(destino, 303);
});
