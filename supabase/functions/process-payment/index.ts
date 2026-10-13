import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json, UUID_RE } from "../_shared/http.ts";
import { charge, PROVIDER_NAME, type PaymentMethod } from "../_shared/provider.ts";

const METHODS: PaymentMethod[] = ["apple_pay", "google_pay", "card", "cash"];

interface CartModifierIn {
  groupName?: string;
  modifierName?: string;
}
interface CartItemIn {
  menu_item_id?: string;
  quantity?: number;
  modifiers?: CartModifierIn[];
  notes?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Quién paga (fase 1.3): invitado o cliente, según su sesión. Sin sesión, nadie.
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
    const { data: quien } = token ? await admin.auth.getUser(token) : { data: { user: null } };
    const comensal = quien?.user ?? null;
    // Fase 1.10: todo pago queda ligado a una persona (invitado o cliente). Todo comensal tiene sesión.
    if (!comensal) return json({ error: "Abre la carta desde el QR de tu mesa para pagar." }, 401);
    // Los sellos solo se suman a clientes registrados, con el correo verificado de su cuenta.
    // Antes se aceptaba cualquier correo escrito a mano (DIAGNOSTICO N4).
    const correoVerificado =
      comensal && !comensal.is_anonymous && comensal.email && comensal.email_confirmed_at
        ? comensal.email.toLowerCase()
        : "";

    const body = await req.json().catch(() => ({}));

    const tableToken = typeof body?.table_token === "string" ? body.table_token.trim() : "";
    const orderId = typeof body?.order_id === "string" ? body.order_id : null;
    const method: PaymentMethod = METHODS.includes(body?.method) ? body.method : "card";
    const tipRaw = Number.isFinite(body?.tip_amount) ? Math.round(body.tip_amount) : 0;
    const email = correoVerificado;
    const idempotencyKey =
      typeof body?.idempotency_key === "string" && body.idempotency_key.length <= 100
        ? body.idempotency_key
        : null;
    const redeemRewardId = typeof body?.redeem_reward_id === "string" ? body.redeem_reward_id : null;
    const cartItems: CartItemIn[] = Array.isArray(body?.cart_items) ? body.cart_items.slice(0, 50) : [];
    const orderNotes =
      typeof body?.order_notes === "string" ? body.order_notes.trim().slice(0, 300) : "";
    const isCartCheckout = cartItems.length > 0;

    if (!tableToken || tableToken.length > 200) return json({ error: "Mesa inválida" }, 400);
    if (orderId && !UUID_RE.test(orderId)) return json({ error: "Pedido inválido" }, 400);
    if (tipRaw < 0 || tipRaw > 5_000_000) return json({ error: "Propina inválida" }, 400);

    /* ---------- idempotencia ---------- */
    if (idempotencyKey) {
      const { data: existing } = await admin
        .from("payments")
        .select("*")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (existing) return json({ payment: existing, duplicate: true, approved: existing.status === "approved" });
    }

    /* ---------- mesa ---------- */
    const { data: table } = await admin
      .from("tables")
      .select("id, number, tenant_id, branch_id, status")
      .eq("qr_token", tableToken)
      .maybeSingle();
    if (!table) return json({ error: "QR de mesa no válido" }, 404);

    /* ---------- sesión (se crea si hace falta en checkout) ---------- */
    let { data: session } = await admin
      .from("table_sessions")
      .select("id, paid_amount, total_amount")
      .eq("table_id", table.id)
      .eq("is_active", true)
      .maybeSingle();

    if (!session && isCartCheckout) {
      const { data: created } = await admin
        .from("table_sessions")
        .insert({
          tenant_id: table.tenant_id,
          table_id: table.id,
          branch_id: table.branch_id,
          opened_at: new Date().toISOString(),
          is_active: true,
          total_amount: 0,
        })
        .select("id, paid_amount, total_amount")
        .maybeSingle();
      // Si otro comensal la abrió en el mismo instante (una sola sesión activa por mesa), se usa esa.
      session = created ?? (await admin
        .from("table_sessions")
        .select("id, paid_amount, total_amount")
        .eq("table_id", table.id)
        .eq("is_active", true)
        .maybeSingle()).data;
      if (!session) return json({ error: "No se pudo abrir la sesión de mesa" }, 500);
    }

    if (!session) return json({ error: "No hay una sesión activa en esta mesa" }, 404);

    /* ---------- monto calculado en el servidor ---------- */
    let amount = 0;
    let pricedItems: Array<{
      menu_item_id: string;
      menu_item_name: string;
      unit_price: number;
      quantity: number;
      subtotal: number;
      selected_modifiers: unknown;
      item_notes: string | null;
    }> = [];
    let targetOrders: Array<{ id: string }> = [];

    if (isCartCheckout) {
      // Precios desde la base (fase 1.9): una sola función para el comensal y el mozo.
      // Valida opciones inventadas u obligatorias, agotados, horarios y que el local esté abierto.
      const { data: precios, error: precioErr } = await admin.rpc("calcular_precios", {
        _tenant_id: table.tenant_id,
        _branch_id: table.branch_id,
        _items: cartItems.slice(0, 50).map((ci) => ({
          menu_item_id: ci.menu_item_id,
          quantity: ci.quantity,
          modifiers: Array.isArray(ci.modifiers)
            ? ci.modifiers.slice(0, 20).map((m) => ({ groupName: m?.groupName, modifierName: m?.modifierName }))
            : [],
          notes: typeof ci.notes === "string" ? ci.notes : null,
        })),
      });
      if (precioErr || !precios) {
        // Los mensajes de la base vienen en español y pensados para el comensal.
        const mensaje = precioErr?.message && !/[a-z]+_[a-z]+|violates|permission|function/i.test(precioErr.message)
          ? precioErr.message
          : "No pudimos calcular tu pedido. Intenta de nuevo.";
        return json({ error: mensaje }, 409);
      }
      const resultado = precios as { total: number; items: typeof pricedItems };
      pricedItems = resultado.items;
      amount = resultado.total;
    } else {
      const { data: sessionOrders } = await admin
        .from("orders")
        .select("id, total_amount, payment_status, status")
        .eq("session_id", session.id)
        .neq("status", "cancelled");

      const orders = sessionOrders ?? [];
      const pending = orderId
        ? orders.filter((o) => o.id === orderId && o.payment_status !== "paid")
        : orders.filter((o) => o.payment_status !== "paid");

      targetOrders = pending;
      amount = pending.reduce((s, o) => s + (o.total_amount || 0), 0);
    }

    if (amount <= 0) return json({ error: "No hay saldo pendiente en esta mesa" }, 400);

    const tip = Math.min(Math.max(tipRaw, 0), amount * 2);

    /* ---------- cobro ---------- */
    const reference = crypto.randomUUID();
    const result = await charge({ amount, tip, method, reference, email });

    /* ---------- crear pedido pagado (checkout) ---------- */
    let createdOrder: { id: string; order_number: number } | null = null;
    if (isCartCheckout && result.approved) {
      // Número de pedido sin choques entre pedidos simultáneos (fase 1.9).
      const { data: numero, error: numErr } = await admin.rpc("siguiente_numero_pedido", { _branch_id: table.branch_id });
      if (numErr || !numero) {
        console.error("order number error", numErr);
        return json({ error: "No se pudo crear el pedido" }, 500);
      }

      const { data: order, error: oErr } = await admin
        .from("orders")
        .insert({
          tenant_id: table.tenant_id,
          session_id: session.id,
          table_id: table.id,
          branch_id: table.branch_id,
          order_number: numero as number,
          status: "confirmed",
          source: "customer_qr",
          total_amount: amount,
          notes: orderNotes || null,
          confirmed_at: new Date().toISOString(),
          payment_status: "paid",
          paid_at: new Date().toISOString(),
          user_id: comensal?.id ?? null,
        })
        .select("id, order_number")
        .single();

      if (oErr || !order) {
        console.error("order insert error", oErr);
        return json({ error: "No se pudo crear el pedido" }, 500);
      }
      createdOrder = order;

      const { error: iErr } = await admin.from("order_items").insert(
        pricedItems.map((p) => ({ ...p, tenant_id: table.tenant_id, order_id: order.id })),
      );
      if (iErr) console.error("order_items insert error", iErr);

      await admin.from("tables").update({ status: "occupied" }).eq("id", table.id);
      // El total de la sesión lo recalcula la base al crear el pedido (fase 1.5).

      // popularidad
      const counts = new Map<string, number>();
      for (const p of pricedItems) {
        counts.set(p.menu_item_id, (counts.get(p.menu_item_id) || 0) + p.quantity);
      }
      for (const [id, qty] of counts) {
        const { data: mi } = await admin
          .from("menu_items")
          .select("total_orders")
          .eq("id", id)
          .maybeSingle();
        if (mi) {
          await admin
            .from("menu_items")
            .update({ total_orders: (mi.total_orders || 0) + qty })
            .eq("id", id);
        }
      }
    }

    const { data: payment, error: payErr } = await admin
      .from("payments")
      .insert({
        tenant_id: table.tenant_id,
        branch_id: table.branch_id,
        session_id: session.id,
        table_id: table.id,
        order_id: createdOrder?.id ?? orderId,
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
    if (!isCartCheckout) {
      const paidIds = targetOrders.map((o) => o.id);
      if (paidIds.length) {
        await admin.from("orders").update({ payment_status: "paid", paid_at: new Date().toISOString() }).in("id", paidIds);
      }
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
        // Coincidencia exacta (antes ilike: un "%" en el correo coincidía con otros clientes).
        const { data: existingCustomer } = await admin
          .from("loyalty_customers")
          .select("*")
          .eq("tenant_id", table.tenant_id)
          .eq("email", email)
          .maybeSingle();

        const earnedPoints = Math.floor(amount / 1000) * (program.points_per_thousand || 1);

        let customer = existingCustomer;
        if (customer) {
          const { data: updated } = await admin
            .from("loyalty_customers")
            .update({
              visits: (customer.visits || 0) + 1,
              points: (customer.points || 0) + earnedPoints,
              total_spent: (customer.total_spent || 0) + amount,
              last_visit_at: new Date().toISOString(),
              user_id: comensal!.id,
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
              user_id: comensal!.id,
            })
            .select("*")
            .single();
          customer = created ?? null;
        }

        if (customer) {
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

    return json({
      payment,
      approved: true,
      loyalty,
      table_number: table.number,
      order: createdOrder,
    });
  } catch (err) {
    console.error("process-payment error", err);
    return json({ error: "Error procesando el pago" }, 500);
  }
});
