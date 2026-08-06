import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowLeft, Loader2, CreditCard, ShieldCheck, AlertTriangle, Gift, Apple } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatCLP } from "@/lib/format";
import { useCartStore } from "@/store/cartStore";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { detectWallets, requestWalletPayment, type WalletKind } from "@/lib/walletPayment";
import { useToast } from "@/hooks/use-toast";

const TIP_OPTIONS = [0, 5, 10, 15];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

interface LoyaltyStatus {
  program: {
    type: string;
    goal_visits: number;
    points_goal: number;
    points_per_thousand: number;
    reward_description: string;
  } | null;
  customer: { id: string; visits: number; points: number } | null;
  rewards: { id: string; description: string }[];
}

interface PaidResult {
  amount: number;
  tip: number;
  method: string;
  reference: string;
  loyalty: {
    type: string;
    visits: number;
    points: number;
    goal_visits: number;
    points_goal: number;
    reward_description: string;
    reward_earned: boolean;
  } | null;
}

export default function PayPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const storeToken = useCartStore((s) => s.tableToken);
  const tableToken = searchParams.get("t") || storeToken || "";
  const { toast } = useToast();

  const [tipIdx, setTipIdx] = useState(1);
  const [email, setEmail] = useState(() => localStorage.getItem("tablio_guest_email") || "");
  const [consent, setConsent] = useState(!!localStorage.getItem("tablio_guest_email"));
  const [redeemRewardId, setRedeemRewardId] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [paid, setPaid] = useState<PaidResult | null>(null);
  const idemRef = useRef(crypto.randomUUID());

  const wallets = useMemo(() => detectWallets(), []);

  /* ---------- datos ---------- */
  const { data: tenant } = useQuery({
    queryKey: ["pay-tenant", slug],
    queryFn: async () => {
      const { data } = await supabase
        .from("tenants")
        .select("id, name, primary_color")
        .eq("slug", slug!)
        .maybeSingle();
      return data;
    },
    enabled: !!slug,
    staleTime: Infinity,
  });

  const primaryColor = tenant?.primary_color || "#E8531D";

  const { data: table } = useQuery({
    queryKey: ["pay-table", tableToken],
    queryFn: async () => {
      const { data } = await supabase
        .from("tables")
        .select("id, number, name, tenant_id, branch_id")
        .eq("qr_token", tableToken)
        .maybeSingle();
      return data;
    },
    enabled: !!tableToken,
    staleTime: Infinity,
  });

  const { data: session } = useQuery({
    queryKey: ["pay-session", table?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("table_sessions")
        .select("id, paid_amount")
        .eq("table_id", table!.id)
        .eq("is_active", true)
        .maybeSingle();
      return data;
    },
    enabled: !!table?.id,
    staleTime: 0,
  });

  const { data: pending = [], isLoading: loadingOrders, refetch } = useQuery({
    queryKey: ["pay-pending", session?.id],
    queryFn: async () => {
      const { data: orders } = await supabase
        .from("orders")
        .select("id, order_number, total_amount, payment_status")
        .eq("session_id", session!.id)
        .neq("status", "cancelled")
        .neq("payment_status", "paid")
        .order("confirmed_at", { ascending: true });

      const result = [];
      for (const o of orders ?? []) {
        const { data: items } = await supabase
          .from("order_items")
          .select("menu_item_name, quantity, subtotal")
          .eq("order_id", o.id);
        result.push({ ...o, items: items ?? [] });
      }
      return result;
    },
    enabled: !!session?.id,
    staleTime: 0,
  });

  const subtotal = pending.reduce((s, o) => s + (o.total_amount || 0), 0);
  const tipAmount = Math.round(subtotal * (TIP_OPTIONS[tipIdx] / 100));
  const total = subtotal + tipAmount;

  /* ---------- lealtad ---------- */
  const validEmail = EMAIL_RE.test(email);
  const { data: loyalty } = useQuery<LoyaltyStatus | null>({
    queryKey: ["pay-loyalty", tenant?.id, table?.branch_id, email.toLowerCase()],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("loyalty-status", {
        body: { tenant_id: tenant!.id, branch_id: table?.branch_id, email: email.trim().toLowerCase() },
      });
      if (error) return null;
      return data as LoyaltyStatus;
    },
    enabled: !!tenant?.id && validEmail && consent,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (validEmail && consent) localStorage.setItem("tablio_guest_email", email.trim().toLowerCase());
  }, [validEmail, consent, email]);

  /* ---------- pago ---------- */
  const handlePay = async (method: "card" | WalletKind) => {
    if (paying || subtotal <= 0) return;
    setErrorMsg("");
    setPaying(true);

    try {
      if (method !== "card") {
        const res = await requestWalletPayment(method, total, `${tenant?.name ?? "Mesa"} · Mesa ${table?.number ?? ""}`);
        if (res.outcome === "cancelled") {
          setPaying(false);
          return;
        }
      }

      const { data, error } = await supabase.functions.invoke("process-payment", {
        body: {
          table_token: tableToken,
          method,
          tip_amount: tipAmount,
          email: validEmail && consent ? email.trim().toLowerCase() : null,
          idempotency_key: `${idemRef.current}-${subtotal}-${tipAmount}`,
          redeem_reward_id: redeemRewardId,
        },
      });

      if (error) {
        const detail = await (error as any)?.context?.text?.().catch(() => null);
        console.error("process-payment failed:", detail || error.message);
        throw new Error("No pudimos procesar el pago. Intenta nuevamente.");
      }
      if (!data?.approved) throw new Error(data?.error || "El pago fue rechazado.");

      setPaid({
        amount: data.payment.amount,
        tip: data.payment.tip_amount,
        method: data.payment.method,
        reference: data.payment.external_reference,
        loyalty: data.loyalty ?? null,
      });
      refetch();
    } catch (err: any) {
      setErrorMsg(err.message || "Error procesando el pago");
      toast({ title: "Pago no completado", description: err.message, variant: "destructive" });
    } finally {
      setPaying(false);
    }
  };

  const qs = tableToken ? `?t=${tableToken}` : "";

  /* ========== RENDER ========== */
  if (!tableToken) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 text-center">
        <p className="text-5xl mb-4">📱</p>
        <h1 className="text-lg font-bold text-foreground">Escanea el QR de tu mesa</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Necesitamos saber en qué mesa estás para poder cobrar.
        </p>
        <button onClick={() => navigate(`/${slug}/menu`)} className="mt-6 text-sm underline text-muted-foreground">
          Volver al menú
        </button>
      </div>
    );
  }

  if (paid) {
    return (
      <div className="min-h-screen bg-background px-5 py-10">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-auto max-w-md text-center"
        >
          <div className="text-[72px] mb-2">✅</div>
          <h1 className="text-2xl font-bold text-foreground">¡Pago recibido!</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Mesa {table?.number} · {tenant?.name}
          </p>

          <div className="mt-6 rounded-2xl border border-border bg-card p-5 text-left">
            <div className="flex justify-between py-1">
              <span className="text-sm text-muted-foreground">Consumo</span>
              <span className="text-sm font-medium text-card-foreground">{formatCLP(paid.amount)}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-sm text-muted-foreground">Propina</span>
              <span className="text-sm font-medium text-card-foreground">{formatCLP(paid.tip)}</span>
            </div>
            <hr className="my-2 border-border" />
            <div className="flex justify-between">
              <span className="text-base font-bold text-card-foreground">Total pagado</span>
              <span className="text-lg font-bold" style={{ color: primaryColor }}>
                {formatCLP(paid.amount + paid.tip)}
              </span>
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">
              Comprobante {paid.reference} ·{" "}
              {paid.method === "apple_pay" ? "Apple Pay" : paid.method === "google_pay" ? "Google Pay" : "Tarjeta"}
            </p>
          </div>

          {paid.loyalty && (
            <div className="mt-4 rounded-2xl border border-border bg-card p-5 text-left">
              <div className="flex items-center gap-2 mb-2">
                <Gift className="h-4 w-4" style={{ color: primaryColor }} />
                <span className="text-sm font-bold text-card-foreground">Tu programa de lealtad</span>
              </div>
              {paid.loyalty.reward_earned ? (
                <p className="text-sm text-card-foreground">
                  🎉 ¡Desbloqueaste tu recompensa! <strong>{paid.loyalty.reward_description}</strong>. Muéstrala en tu
                  próxima visita.
                </p>
              ) : paid.loyalty.type === "stamps" ? (
                <p className="text-sm text-card-foreground">
                  {paid.loyalty.visits % paid.loyalty.goal_visits} de {paid.loyalty.goal_visits} visitas · te faltan{" "}
                  {paid.loyalty.goal_visits - (paid.loyalty.visits % paid.loyalty.goal_visits)} para{" "}
                  {paid.loyalty.reward_description}
                </p>
              ) : (
                <p className="text-sm text-card-foreground">
                  {paid.loyalty.points} de {paid.loyalty.points_goal} puntos para {paid.loyalty.reward_description}
                </p>
              )}
            </div>
          )}

          <button
            onClick={() => navigate(`/${slug}/tracking${qs}`)}
            className="mt-8 w-full rounded-2xl py-4 text-base font-semibold text-white"
            style={{ backgroundColor: primaryColor }}
          >
            Ver mi pedido
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-8">
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-background px-4">
        <button
          onClick={() => navigate(`/${slug}/tracking${qs}`)}
          className="flex h-9 w-9 items-center justify-center rounded-full text-foreground"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <span className="text-sm font-bold text-foreground">Pagar</span>
        <div className="w-9" />
      </header>

      <div className="mx-auto max-w-md px-4 pt-4">
        {loadingOrders ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : subtotal <= 0 ? (
          <div className="py-16 text-center">
            <p className="text-5xl mb-3">🎉</p>
            <p className="text-base font-bold text-foreground">No tienes nada pendiente</p>
            <p className="mt-1 text-sm text-muted-foreground">Todo lo de esta mesa ya está pagado.</p>
            <button onClick={() => navigate(`/${slug}/menu`)} className="mt-6 text-sm underline text-muted-foreground">
              Seguir pidiendo
            </button>
          </div>
        ) : (
          <>
            {/* Resumen */}
            <div className="rounded-2xl border border-border bg-card p-4 mb-4">
              <p className="text-xs font-bold text-muted-foreground mb-2">
                MESA {table?.number} · POR PAGAR
              </p>
              {pending.map((o) => (
                <div key={o.id} className="mb-2 last:mb-0">
                  <p className="text-[11px] text-muted-foreground">
                    Pedido #{String(o.order_number).padStart(3, "0")}
                  </p>
                  {o.items.map((it, i) => (
                    <div key={i} className="flex justify-between py-0.5">
                      <span className="text-sm text-card-foreground">
                        {it.quantity}× {it.menu_item_name}
                      </span>
                      <span className="text-sm text-muted-foreground">{formatCLP(it.subtotal)}</span>
                    </div>
                  ))}
                </div>
              ))}
              <hr className="my-2 border-border" />
              <div className="flex justify-between">
                <span className="text-sm font-bold text-card-foreground">Subtotal</span>
                <span className="text-sm font-bold text-card-foreground">{formatCLP(subtotal)}</span>
              </div>
            </div>

            {/* Propina */}
            <p className="text-[15px] font-bold text-foreground mb-2">Propina</p>
            <div className="grid grid-cols-4 gap-2 mb-4">
              {TIP_OPTIONS.map((pct, idx) => {
                const active = tipIdx === idx;
                return (
                  <button
                    key={pct}
                    onClick={() => setTipIdx(idx)}
                    className="flex flex-col items-center rounded-xl border-2 py-2.5 transition-colors"
                    style={{
                      borderColor: active ? primaryColor : "hsl(var(--border))",
                      backgroundColor: active ? `${primaryColor}12` : "transparent",
                    }}
                  >
                    <span
                      className="text-sm font-semibold"
                      style={{ color: active ? primaryColor : "hsl(var(--foreground))" }}
                    >
                      {pct === 0 ? "Sin" : `${pct}%`}
                    </span>
                    {pct > 0 && (
                      <span className="text-[11px] text-muted-foreground">
                        {formatCLP(Math.round(subtotal * (pct / 100)))}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Email / lealtad */}
            <div className="rounded-2xl border border-border bg-card p-4 mb-4">
              <div className="flex items-center gap-2 mb-2">
                <Gift className="h-4 w-4" style={{ color: primaryColor }} />
                <span className="text-sm font-bold text-card-foreground">Suma a tu tarjeta de lealtad</span>
              </div>
              <Input
                type="email"
                inputMode="email"
                placeholder="tu@email.com"
                value={email}
                maxLength={255}
                onChange={(e) => setEmail(e.target.value)}
                className="h-11"
              />
              <label className="mt-2 flex items-start gap-2">
                <Checkbox checked={consent} onCheckedChange={(v) => setConsent(v === true)} className="mt-0.5" />
                <span className="text-[11px] text-muted-foreground">
                  Acepto que {tenant?.name ?? "el local"} guarde mi email para reconocerme y sumar mis visitas. Solo lo
                  usa este local.
                </span>
              </label>

              {loyalty?.program && loyalty.customer && (
                <div className="mt-3 rounded-xl bg-muted/60 p-3">
                  {loyalty.program.type === "stamps" ? (
                    <>
                      <p className="text-xs font-semibold text-foreground">
                        {loyalty.customer.visits % loyalty.program.goal_visits} de {loyalty.program.goal_visits} visitas
                      </p>
                      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-border">
                        <div
                          className="h-full rounded-full"
                          style={{
                            backgroundColor: primaryColor,
                            width: `${((loyalty.customer.visits % loyalty.program.goal_visits) / loyalty.program.goal_visits) * 100}%`,
                          }}
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="text-xs font-semibold text-foreground">
                        {loyalty.customer.points} de {loyalty.program.points_goal} puntos
                      </p>
                      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-border">
                        <div
                          className="h-full rounded-full"
                          style={{
                            backgroundColor: primaryColor,
                            width: `${Math.min(100, (loyalty.customer.points / loyalty.program.points_goal) * 100)}%`,
                          }}
                        />
                      </div>
                    </>
                  )}
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    Recompensa: {loyalty.program.reward_description}
                  </p>
                </div>
              )}

              {loyalty?.rewards?.length ? (
                <div className="mt-3 space-y-2">
                  {loyalty.rewards.map((r) => (
                    <label
                      key={r.id}
                      className="flex items-center gap-2 rounded-xl border border-border p-2.5"
                    >
                      <Checkbox
                        checked={redeemRewardId === r.id}
                        onCheckedChange={(v) => setRedeemRewardId(v === true ? r.id : null)}
                      />
                      <span className="text-xs text-card-foreground">Canjear ahora: {r.description}</span>
                    </label>
                  ))}
                </div>
              ) : null}
            </div>

            {/* Total */}
            <div className="rounded-2xl border border-border bg-card p-4 mb-4">
              <div className="flex justify-between">
                <span className="text-base font-bold text-card-foreground">TOTAL</span>
                <span className="text-xl font-bold" style={{ color: primaryColor }}>
                  {formatCLP(total)}
                </span>
              </div>
            </div>

            {errorMsg && (
              <div className="mb-3 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3">
                <AlertTriangle className="h-4 w-4 text-destructive mt-0.5" />
                <p className="text-xs text-destructive">{errorMsg}</p>
              </div>
            )}

            {/* Botones de pago */}
            <div className="space-y-2.5">
              {wallets.applePay && (
                <button
                  onClick={() => handlePay("apple_pay")}
                  disabled={paying}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-foreground py-4 text-base font-semibold text-background disabled:opacity-60"
                >
                  {paying ? <Loader2 className="h-5 w-5 animate-spin" /> : <Apple className="h-5 w-5" />}
                  Pagar con Apple Pay
                </button>
              )}
              {wallets.googlePay && (
                <button
                  onClick={() => handlePay("google_pay")}
                  disabled={paying}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-foreground py-4 text-base font-semibold text-background disabled:opacity-60"
                >
                  {paying ? <Loader2 className="h-5 w-5 animate-spin" /> : <span className="text-lg font-bold">G</span>}
                  Pagar con Google Pay
                </button>
              )}
              <button
                onClick={() => handlePay("card")}
                disabled={paying}
                className="flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-base font-semibold text-white disabled:opacity-60"
                style={{ backgroundColor: primaryColor }}
              >
                {paying ? <Loader2 className="h-5 w-5 animate-spin" /> : <CreditCard className="h-5 w-5" />}
                Pagar con tarjeta
              </button>
            </div>

            <p className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" />
              Pago en ambiente de prueba · no se cobra dinero real
            </p>
          </>
        )}
      </div>
    </div>
  );
}
