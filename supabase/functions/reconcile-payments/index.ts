import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json, UUID_RE } from "../_shared/http.ts";
import { PROVIDER_NAME } from "../_shared/provider.ts";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
    const branchId = typeof body?.branch_id === "string" ? body.branch_id : "";
    const date = typeof body?.date === "string" ? body.date : "";
    const close = body?.close === true;
    const notes = typeof body?.notes === "string" ? body.notes.slice(0, 500) : null;

    if (!UUID_RE.test(branchId)) return json({ error: "Sucursal inválida" }, 400);
    if (!DATE_RE.test(date)) return json({ error: "Fecha inválida" }, 400);

    const { data: branch } = await admin
      .from("branches")
      .select("id, tenant_id")
      .eq("id", branchId)
      .maybeSingle();
    if (!branch) return json({ error: "Sucursal no encontrada" }, 404);

    const { data: platformAdmin } = await admin
      .from("platform_admins")
      .select("id")
      .eq("user_id", callerId)
      .maybeSingle();

    let allowed = !!platformAdmin;
    if (!allowed) {
      const { data: member } = await admin
        .from("tenant_members")
        .select("role")
        .eq("user_id", callerId)
        .eq("tenant_id", branch.tenant_id)
        .eq("is_active", true)
        .maybeSingle();
      allowed = !!member;
    }
    if (!allowed) return json({ error: "Sin permisos para esta sucursal" }, 403);

    const from = `${date}T00:00:00.000Z`;
    const to = `${date}T23:59:59.999Z`;

    const { data: payments } = await admin
      .from("payments")
      .select("id, amount, tip_amount, refunded_amount, status, method")
      .eq("branch_id", branchId)
      .gte("created_at", from)
      .lte("created_at", to);

    const rows = (payments ?? []).filter((p) => p.status !== "failed" && p.method !== "cash");
    const expected = rows.reduce(
      (s, p) => s + (p.amount || 0) + (p.tip_amount || 0) - (p.refunded_amount || 0),
      0,
    );

    // Adaptador simulado: el proveedor liquida el mismo monto registrado.
    const settled = expected;
    const difference = settled - expected;

    const { data: settlement, error: settlementErr } = await admin
      .from("payment_settlements")
      .upsert(
        {
          tenant_id: branch.tenant_id,
          branch_id: branchId,
          settlement_date: date,
          provider: PROVIDER_NAME,
          expected_amount: expected,
          settled_amount: settled,
          difference,
          payments_count: rows.length,
          status: close ? "closed" : "open",
          notes,
          closed_by: close ? callerId : null,
          closed_at: close ? new Date().toISOString() : null,
        },
        { onConflict: "branch_id,settlement_date" },
      )
      .select("*")
      .single();

    if (settlementErr) {
      console.error("settlement upsert error", settlementErr);
      return json({ error: "No se pudo generar la conciliación" }, 500);
    }

    if (rows.length) {
      await admin
        .from("payments")
        .update({ settlement_id: settlement.id })
        .in("id", rows.map((p) => p.id));
    }

    return json({ settlement });
  } catch (err) {
    console.error("reconcile-payments error", err);
    return json({ error: "Error generando la conciliación" }, 500);
  }
});
