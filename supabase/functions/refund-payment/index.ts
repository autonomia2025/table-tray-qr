import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json, UUID_RE } from "../_shared/http.ts";
import { refund as providerRefund } from "../_shared/provider.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
    if (!token) return json({ error: "No autorizado" }, 401);
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) return json({ error: "No autorizado" }, 401);
    const callerId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const paymentId = typeof body?.payment_id === "string" ? body.payment_id : "";
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    const amountRaw = Number.isFinite(body?.amount) ? Math.round(body.amount) : 0;
    if (!UUID_RE.test(paymentId)) return json({ error: "Pago inválido" }, 400);

    /* 1. Reservar en la base (fase 2.C): valida rol, motivo y monto, y bloquea el pago. */
    const { data: reserva, error: resErr } = await admin.rpc("reservar_reembolso", {
      _user_id: callerId,
      _payment_id: paymentId,
      _monto: amountRaw > 0 ? amountRaw : null,
      _motivo: reason,
    });
    if (resErr || !reserva) {
      const mensaje = resErr?.message && !/[a-z]+_[a-z]+|violates|permission|function/i.test(resErr.message)
        ? resErr.message
        : "No se pudo reembolsar. Intenta de nuevo.";
      return json({ error: mensaje }, resErr?.code === "42501" ? 403 : 409);
    }
    const r = reserva as { refund_id: string; monto: number; devolucion: string; referencia_pago: string | null };

    /* 2. Devolver la plata: por la pasarela, o en el local (efectivo o POS: lo devuelve la caja). */
    let ok = true;
    let referencia: string | null = null;
    if (r.devolucion === "pasarela") {
      const resultado = await providerRefund(r.referencia_pago, r.monto);
      ok = resultado.ok;
      referencia = resultado.externalReference;
    }

    /* 3. Confirmar: pago, pedidos, sesión y auditoría juntos. */
    const { data: conf, error: confErr } = await admin.rpc("confirmar_reembolso", {
      _refund_id: r.refund_id,
      _ok: ok,
      _referencia: referencia,
    });
    if (confErr || !conf) {
      console.error("confirmar_reembolso error", confErr);
      return json({ error: "El reembolso quedó en revisión. No lo repitas." }, 500);
    }
    const confirmacion = conf as { estado: string; completo: boolean };
    if (confirmacion.estado === "failed") return json({ error: "El medio de pago rechazó el reembolso" }, 502);

    const fullyRefunded = confirmacion.completo;
    const amount = r.monto;
    const { data: payment } = await admin.from("payments").select("*").eq("id", paymentId).single();
    const { data: refundRow } = await admin.from("refunds").select("*").eq("id", r.refund_id).single();

    // Los sellos de un pago reembolsado entero los anula la base (disparador anular_sellos, fase 3.7).

    return json({ refund: refundRow, fully_refunded: fullyRefunded, devolucion: r.devolucion, amount });
  } catch (err) {
    console.error("refund-payment error", err);
    return json({ error: "Error procesando el reembolso" }, 500);
  }
});
