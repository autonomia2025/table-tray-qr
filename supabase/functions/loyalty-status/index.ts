import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json, EMAIL_RE, UUID_RE } from "../_shared/http.ts";

/**
 * Consulta pública del progreso de lealtad de un comensal en un local.
 * Solo devuelve datos del email exacto entregado y del tenant indicado.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const tenantId = typeof body?.tenant_id === "string" ? body.tenant_id : "";
    const branchId = typeof body?.branch_id === "string" ? body.branch_id : "";
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";

    if (!UUID_RE.test(tenantId)) return json({ error: "Local inválido" }, 400);
    if (!EMAIL_RE.test(email)) return json({ error: "Email inválido" }, 400);

    const { data: programs } = await admin
      .from("loyalty_programs")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("is_active", true);

    const program =
      (programs ?? []).find((p) => UUID_RE.test(branchId) && p.branch_id === branchId) ??
      (programs ?? []).find((p) => p.branch_id === null) ??
      null;

    if (!program) return json({ program: null, customer: null, rewards: [] });

    const { data: customer } = await admin
      .from("loyalty_customers")
      .select("id, email, visits, points, total_spent, last_visit_at")
      .eq("tenant_id", tenantId)
      .ilike("email", email)
      .maybeSingle();

    let rewards: unknown[] = [];
    if (customer) {
      const { data } = await admin
        .from("loyalty_rewards")
        .select("id, description, status, earned_at")
        .eq("customer_id", customer.id)
        .eq("status", "earned")
        .order("earned_at", { ascending: true });
      rewards = data ?? [];
    }

    return json({
      program: {
        type: program.type,
        goal_visits: program.goal_visits,
        points_goal: program.points_goal,
        points_per_thousand: program.points_per_thousand,
        reward_description: program.reward_description,
      },
      customer: customer ?? null,
      rewards,
    });
  } catch (err) {
    console.error("loyalty-status error", err);
    return json({ error: "Error consultando lealtad" }, 500);
  }
});
