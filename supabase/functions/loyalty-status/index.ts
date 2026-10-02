import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json, UUID_RE } from "../_shared/http.ts";

/**
 * Progreso de lealtad del cliente conectado en un local.
 * Solo para clientes registrados con correo verificado, y solo sus propios sellos:
 * antes cualquiera podía consultar los premios de cualquier correo (DIAGNOSTICO N4).
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
    const { data: quien } = token ? await admin.auth.getUser(token) : { data: { user: null } };
    const cliente = quien?.user;
    if (!cliente || cliente.is_anonymous || !cliente.email || !cliente.email_confirmed_at) {
      return json({ error: "Guarda tu cuenta para ver tus sellos." }, 401);
    }
    const email = cliente.email.toLowerCase();

    const body = await req.json().catch(() => ({}));
    const tenantId = typeof body?.tenant_id === "string" ? body.tenant_id : "";
    const branchId = typeof body?.branch_id === "string" ? body.branch_id : "";

    if (!UUID_RE.test(tenantId)) return json({ error: "Local inválido" }, 400);

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
      .eq("email", email)
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
