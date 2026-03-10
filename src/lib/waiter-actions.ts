import { supabase } from "@/integrations/supabase/client";

export async function confirmPaymentAndRelease(
  tableId: string,
  sessionId: string | null,
  billRequestId: string,
  branchId: string
): Promise<void> {
  await supabase
    .from("tables")
    .update({ status: "free", assigned_waiter_id: null })
    .eq("id", tableId);

  await supabase
    .from("table_sessions")
    .update({
      is_active: false,
      closed_at: new Date().toISOString(),
    })
    .eq("table_id", tableId)
    .eq("is_active", true);

  await supabase
    .from("bill_requests")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
    })
    .eq("id", billRequestId);
}
