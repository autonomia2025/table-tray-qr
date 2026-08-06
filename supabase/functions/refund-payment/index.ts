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
    if (reason.length < 3 || reason.length > 500) return json({ error: "Indica un motivo (3 a 500 caracteres)" }, 400);

    const { data: payment } = await admin
      .from("payments")
      .select("*")
      .eq("id", paymentId)
      .maybeSingle();
    if (!payment) return json({ error: "Pago no encontrado" }, 404);
    if (payment.status !== "approved" && payment.status !== "partially_refunded") {
      return json({ error: "Solo se pueden reembolsar pagos aprobados" }, 400);
    }

    // Autorización: dueño/admin del tenant o platform admin
    const { data: platformAdmin } = await admin
      .from("platform_admins")
      .select("id")
      .eq("user_id", callerId)
      .maybeSingle();

    let allowed = !!platformAdmin;
    let authorizedName = "Platform admin";
    if (!allowed) {
      const { data: member } = await admin
        .from("tenant_members")
        .select("role")
        .eq("user_id", callerId)
        .eq("tenant_id", payment.tenant_id)
        .eq("is_active", true)
        .maybeSingle();
      allowed = !!member && ["owner", "admin"].includes(member.role);
      authorizedName = member?.role ?? "";
    }
    if (!allowed) return json({ error: "Solo el dueño o administrador puede reembolsar" }, 403);

    const totalCharged = (payment.amount || 0) + (payment.tip_amount || 0);
    const alreadyRefunded = payment.refunded_amount || 0;
    const maxRefundable = totalCharged - alreadyRefunded;
    const amount = amountRaw > 0 ? amountRaw : maxRefundable;
    if (amount <= 0 || amount > maxRefundable) {
      return json({ error: `Monto a reembolsar inválido (máximo ${maxRefundable})` }, 400);
    }

    const providerResult = await providerRefund(payment.external_reference, amount);
    if (!providerResult.ok) return json({ error: "El proveedor rechazó el reembolso" }, 502);

    const { data: refundRow, error: refundErr } = await admin
      .from("refunds")
      .insert({
        tenant_id: payment.tenant_id,
        payment_id: payment.id,
        amount,
        reason,
        authorized_by: callerId,
        authorized_by_name: userData.user.email ?? authorizedName,
        external_reference: providerResult.externalReference,
      })
      .select("*")
      .single();

    if (refundErr) {
      console.error("refund insert error", refundErr);
      return json({ error: "No se pudo registrar el reembolso" }, 500);
    }

    const newRefunded = alreadyRefunded + amount;
    const fullyRefunded = newRefunded >= totalCharged;

    await admin
      .from("payments")
      .update({
        refunded_amount: newRefunded,
        status: fullyRefunded ? "refunded" : "partially_refunded",
      })
      .eq("id", payment.id);

    // Revertir en la sesión y los pedidos
    if (payment.session_id) {
      const { data: session } = await admin
        .from("table_sessions")
        .select("id, paid_amount")
        .eq("id", payment.session_id)
        .maybeSingle();
      if (session) {
        const back = Math.min(session.paid_amount || 0, Math.min(amount, payment.amount || 0));
        await admin
          .from("table_sessions")
          .update({ paid_amount: (session.paid_amount || 0) - back })
          .eq("id", session.id);
      }
      if (fullyRefunded) {
        const query = admin.from("orders").update({ payment_status: "refunded" });
        if (payment.order_id) {
          await query.eq("id", payment.order_id);
        } else {
          await query.eq("session_id", payment.session_id).eq("payment_status", "paid");
        }
      }
    }

    // Revertir lealtad
    if (payment.customer_email) {
      const { data: customer } = await admin
        .from("loyalty_customers")
        .select("*")
        .eq("tenant_id", payment.tenant_id)
        .ilike("email", payment.customer_email)
        .maybeSingle();
      if (customer && fullyRefunded) {
        const { data: programs } = await admin
          .from("loyalty_programs")
          .select("*")
          .eq("tenant_id", payment.tenant_id);
        const program =
          (programs ?? []).find((p) => p.branch_id === payment.branch_id) ??
          (programs ?? []).find((p) => p.branch_id === null) ??
          null;
        const pointsBack = program
          ? Math.floor((payment.amount || 0) / 1000) * (program.points_per_thousand || 1)
          : 0;
        await admin
          .from("loyalty_customers")
          .update({
            visits: Math.max(0, (customer.visits || 0) - 1),
            points: Math.max(0, (customer.points || 0) - pointsBack),
            total_spent: Math.max(0, (customer.total_spent || 0) - (payment.amount || 0)),
          })
          .eq("id", customer.id);
      }
    }

    return json({ refund: refundRow, fully_refunded: fullyRefunded });
  } catch (err) {
    console.error("refund-payment error", err);
    return json({ error: "Error procesando el reembolso" }, 500);
  }
});
