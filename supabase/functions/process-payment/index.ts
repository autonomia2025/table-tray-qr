import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json, UUID_RE, EMAIL_RE } from "../_shared/http.ts";
import { charge, PROVIDER_NAME, type PaymentMethod } from "../_shared/provider.ts";

const METHODS: PaymentMethod[] = ["apple_pay", "google_pay", "card", "cash"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));

    const tableToken = typeof body?.table_token === "string" ? body.table_token.trim() : "";
    const orderId = typeof body?.order_id === "string" ? body.order_id : null;
    const method: PaymentMethod = METHODS.includes(body?.method) ? body.method : "card";
    const tipRaw = Number.isFinite(body?.tip_amount) ? Math.round(body.tip_amount) : 0;
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const idempotencyKey =
      typeof body?.idempotency_key === "string" && body.idempotency_key.length <= 100
        ? body.idempotency_key
        : null;
    const redeemRewardId = typeof body?.redeem_reward_id === "string" ? body.redeem_reward_id : null;

    if (!tableToken || tableToken.length > 200) return json({ error: "Mesa inválida" }, 400);
    if (orderId && !UUID_RE.test(orderId)) return json({ error: "Pedido inválido" }, 400);
    if (email && !EMAIL_RE.test(email)) return json({ error: "Email inválido" }, 400);
    if (tipRaw < 0 || tipRaw > 5_000_000) return json({ error: "Propina inválida" }, 400);

    /* ---------- idempotencia ---------- */
    if (idempotencyKey) {
      const { data: existing } = await admin
        .from("payments")
        .select("*")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (existing) return json({ payment: existing, duplicate: true });
    }

    /* ---------- mesa y sesión ---------- */
    const { data: table } = await admin
      .from("tables")
      .select("id, number, tenant_id, branch_id")
      .eq("qr_token", tableToken)
      .maybeSingle();
    if (!table) return json({ error: "QR de mesa no válido" }, 404);

    const { data: session } = await admin
      .from("table_sessions")
      .select("id, paid_amount, total_amount")
      .eq("table_id", table.id)
      .eq("is_active", true)
      .maybeSingle();
    if (!session) return json({ error: "No hay una sesión activa en esta mesa" }, 404);

    /* ---------- monto calculado en el servidor ---------- */
    const { data: sessionOrders } = await admin
      .from("orders")
      .select("id, total_amount, payment_status, status")
      .eq("session_id", session.id)
      .neq("status", "cancelled");

    const orders = sessionOrders ?? [];
    const targetOrders = orderId
      ? orders.filter((o) => o.id === orderId && o.payment_status !== "paid")
      : orders.filter((o) => o.payment_status !== "paid");

    const amount = targetOrders.reduce((s, o) => s + (o.total_amount || 0), 0);
    if (amount <= 0) return json({ error: "No hay saldo pendiente en esta mesa" }, 400);

    const tip = Math.min(tipRaw, amount * 2);

    /* ---------- cobro ---------- */
    const reference = crypto.randomUUID();
    const result = await charge({ amount, tip, method, reference, email });

    const { data: payment, error: payErr } = await admin
      .from("payments")
      .insert({
        tenant_id: table.tenant_id,
        branch_id: table.branch_id,
        session_id: session.id,
        table_id: table.id,
        order_id: orderId,
        amount,
        tip_amount: tip,
        method,
        wallet: method === "apple_pay" || method === "google_pay" ? method : null,
        status: result.approved ? "approved" : "failed",
        provider: PROVIDER_NAME,
        external_reference: result.externalReference,
        provider_payload: result.payload,
        customer_email: email || null,
        idempotency_key: idempotencyKey,
      })
      .select("*")
      .single();

    if (payErr || !payment) {
      console.error("payment insert error", payErr);
      return json({ error: "No se pudo registrar el pago" }, 500);
    }

    if (!result.approved) {
      return json({ payment, approved: false, error: result.declineReason ?? "Pago rechazado" }, 402);
    }

    /* ---------- marcar pedidos y sesión ---------- */
    const paidIds = targetOrders.map((o) => o.id);
    if (paidIds.length) {
      await admin.from("orders").update({ payment_status: "paid" }).in("id", paidIds);
    }

    const newPaid = (session.paid_amount || 0) + amount;
    await admin
      .from("table_sessions")
      .update({ paid_amount: newPaid, tip_amount: tip > 0 ? tip : undefined })
      .eq("id", session.id);

    /* ---------- lealtad ---------- */
    let loyalty: Record<string, unknown> | null = null;
    if (email) {
      const { data: programs } = await admin
        .from("loyalty_programs")
        .select("*")
        .eq("tenant_id", table.tenant_id)
        .eq("is_active", true);

      const program =
        (programs ?? []).find((p) => p.branch_id === table.branch_id) ??
        (programs ?? []).find((p) => p.branch_id === null) ??
        null;

      if (program) {
        const { data: existingCustomer } = await admin
          .from("loyalty_customers")
          .select("*")
          .eq("tenant_id", table.tenant_id)
          .ilike("email", email)
          .maybeSingle();

        const earnedPoints =
          Math.floor(amount / 1000) * (program.points_per_thousand || 1);

        let customer = existingCustomer;
        if (customer) {
          const { data: updated } = await admin
            .from("loyalty_customers")
            .update({
              visits: (customer.visits || 0) + 1,
              points: (customer.points || 0) + earnedPoints,
              total_spent: (customer.total_spent || 0) + amount,
              last_visit_at: new Date().toISOString(),
            })
            .eq("id", customer.id)
            .select("*")
            .single();
          customer = updated ?? customer;
        } else {
          const { data: created } = await admin
            .from("loyalty_customers")
            .insert({
              tenant_id: table.tenant_id,
              email,
              visits: 1,
              points: earnedPoints,
              total_spent: amount,
              last_visit_at: new Date().toISOString(),
            })
            .select("*")
            .single();
          customer = created ?? null;
        }

        if (customer) {
          // canje solicitado
          if (redeemRewardId && UUID_RE.test(redeemRewardId)) {
            await admin
              .from("loyalty_rewards")
              .update({
                status: "redeemed",
                redeemed_at: new Date().toISOString(),
                payment_id: payment.id,
              })
              .eq("id", redeemRewardId)
              .eq("customer_id", customer.id)
              .eq("status", "earned");
          }

          // recompensa ganada
          let rewardEarned = false;
          if (program.type === "stamps") {
            if (program.goal_visits > 0 && customer.visits % program.goal_visits === 0) {
              rewardEarned = true;
            }
          } else if (program.type === "points") {
            if (program.points_goal > 0 && customer.points >= program.points_goal) {
              rewardEarned = true;
              const { data: after } = await admin
                .from("loyalty_customers")
                .update({ points: customer.points - program.points_goal })
                .eq("id", customer.id)
                .select("*")
                .single();
              customer = after ?? customer;
            }
          }

          if (rewardEarned) {
            await admin.from("loyalty_rewards").insert({
              tenant_id: table.tenant_id,
              customer_id: customer.id,
              description: program.reward_description,
            });
          }

          loyalty = {
            type: program.type,
            visits: customer.visits,
            points: customer.points,
            goal_visits: program.goal_visits,
            points_goal: program.points_goal,
            reward_description: program.reward_description,
            reward_earned: rewardEarned,
          };
        }
      }
    }

    return json({ payment, approved: true, loyalty, table_number: table.number });
  } catch (err) {
    console.error("process-payment error", err);
    return json({ error: "Error procesando el pago" }, 500);
  }
});
