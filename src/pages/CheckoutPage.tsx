import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Loader2,
  CreditCard,
  ShieldCheck,
  AlertTriangle,
  Gift,
  Apple,
  Plus,
  CheckCircle2,
} from "lucide-react";
import BloqueSellos from "@/components/comensal/BloqueSellos";
import CuentaComensal from "@/components/comensal/CuentaComensal";
import { useSesion } from "@/contexts/SesionContext";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { mensajeAmigable, pedirSinPagar } from "@/lib/pedidos";
import { pideCodigoMesa } from "@/lib/mesa";
import CodigoMesa from "@/components/comensal/CodigoMesa";
import { formatCLP } from "@/lib/format";
import { useCartStore } from "@/store/cartStore";
import { useTableSession } from "@/hooks/useTableSession";
import { detectWallets, requestWalletPayment, type WalletKind } from "@/lib/walletPayment";

const TIP_OPTIONS = [0, 5, 10, 15];

interface PaidResult {
  amount: number;
  tip: number;
  reference: string;
  orderNumber: number | null;
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

export default function CheckoutPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { token, table, status: tableStatus } = useTableSession();

  const items = useCartStore((s) => s.items);
  const addItem = useCartStore((s) => s.addItem);
  const clearCart = useCartStore((s) => s.clearCart);
  const subtotalCarrito = useCartStore((s) => s.getTotalPrice());

  const [orderNotes, setOrderNotes] = useState("");
  const [tipIdx, setTipIdx] = useState(1);
  const { perfil } = useSesion();
  const [cuentaAbierta, setCuentaAbierta] = useState(false);
  const [redeemRewardId, setRedeemRewardId] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [paid, setPaid] = useState<PaidResult | null>(null);
  // Pedido enviado sin pagar en la app ("Pagar al mozo" o "Agregar a mi cuenta", fase 2.B)
  const [sinPagar, setSinPagar] = useState<{ numero: number; total: number; forma: "mozo" | "cuenta"; aCocina: boolean } | null>(null);
  const idemRef = useRef(crypto.randomUUID());

  const wallets = useMemo(() => detectWallets(), []);

  /* ---------- precio congelado (fase 2.A): el servidor cotiza y lo asegura por 10 minutos ---------- */
  const lineas = useMemo(
    () =>
      items.map((i) => ({
        menu_item_id: i.menuItemId,
        quantity: i.quantity,
        modifiers: i.selectedModifiers.map((m) => ({ groupName: m.groupName, modifierName: m.modifierName })),
        notes: i.itemNotes || null,
      })),
    [items],
  );
  const [cotizacion, setCotizacion] = useState<{ id: string; subtotal: number; expira_at: string } | null>(null);
  const [errorCotizacion, setErrorCotizacion] = useState("");
  // Código de presencia (fase 3.5): si la base lo pide, se ingresa y se repite lo que se estaba haciendo
  const [pideCodigo, setPideCodigo] = useState<null | { reintentar: () => void }>(null);
  const cotizar = async () => {
    if (!token || lineas.length === 0) return null;
    const { data, error } = await supabase.rpc("cotizar", {
      _qr_token: token,
      _items: lineas as unknown as Json,
      _notas: orderNotes.trim() || null,
    });
    if (error || !data) {
      setCotizacion(null);
      if (pideCodigoMesa(error?.message ?? "")) {
        setErrorCotizacion("");
        setPideCodigo({ reintentar: () => { cotizar(); } });
        return null;
      }
      setErrorCotizacion(mensajeAmigable(error?.message ?? ""));
      return null;
    }
    const c = data as { id: string; subtotal: number; expira_at: string };
    setCotizacion(c);
    setErrorCotizacion("");
    return c;
  };
  useEffect(() => {
    if (!perfil || !token || lineas.length === 0) return;
    const t = setTimeout(() => { cotizar(); }, 400);
    return () => clearTimeout(t);
    // Se vuelve a cotizar si cambia el carrito, la nota o la sesión del comensal
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfil?.user_id, token, lineas, orderNotes]);

  // Lo que se cobra es lo cotizado por el servidor; mientras cotiza, se muestra el del carrito.
  const subtotal = cotizacion?.subtotal ?? subtotalCarrito;
  const tipAmount = Math.round(subtotal * (TIP_OPTIONS[tipIdx] / 100));
  const total = subtotal + tipAmount;

  const { data: tenant } = useQuery({
    queryKey: ["checkout-tenant", slug],
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

  // Cuenta abierta: permite "Agregar a mi cuenta" y pagar al final.
  const { data: modoPago } = useQuery({
    queryKey: ["checkout-modo-pago", table?.branch_id],
    queryFn: async () => {
      const { data } = await supabase.from("branches").select("payment_mode").eq("id", table!.branch_id).maybeSingle();
      return data?.payment_mode ?? "prepaid";
    },
    enabled: !!table?.branch_id,
    staleTime: Infinity,
  });

  /* ---------- upsell ---------- */
  const { data: upsells = [] } = useQuery({
    queryKey: ["checkout-upsell", table?.branch_id, items.map((i) => i.menuItemId).join(",")],
    queryFn: async () => {
      const { data: menu } = await supabase
        .from("menus")
        .select("id")
        .eq("branch_id", table!.branch_id)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      if (!menu) return [];

      const { data: cats } = await supabase
        .from("categories")
        .select("id, name")
        .eq("menu_id", menu.id)
        .eq("is_visible", true);
      if (!cats?.length) return [];

      const preferred = cats.filter((c) =>
        /bebida|trago|caf|postre|acompa|snack|cerveza|vino/i.test(c.name),
      );
      const ids = (preferred.length ? preferred : cats).map((c) => c.id);

      const { data } = await supabase
        .from("menu_items")
        .select("id, name, price, image_url, total_orders")
        .in("category_id", ids)
        .eq("status", "available")
        .order("total_orders", { ascending: false })
        .limit(8);

      const inCart = new Set(items.map((i) => i.menuItemId));
      return (data ?? []).filter((m) => !inCart.has(m.id)).slice(0, 3);
    },
    enabled: !!table?.branch_id && items.length > 0,
    staleTime: 60_000,
  });

  /* ---------- lealtad ---------- */

  /* ---------- pago ---------- */
  const handlePay = async (method: "card" | WalletKind) => {
    if (paying || subtotal <= 0 || !token) return;
    setErrorMsg("");
    setPaying(true);

    try {
      if (method !== "card") {
        const res = await requestWalletPayment(
          method,
          total,
          `${tenant?.name ?? "Mesa"} · Mesa ${table?.number ?? ""}`,
        );
        if (res.outcome === "cancelled") {
          setPaying(false);
          return;
        }
      }

      // Si el precio asegurado venció (más de 10 minutos), se cotiza de nuevo antes de cobrar.
      let cot = cotizacion;
      if (!cot || new Date(cot.expira_at).getTime() < Date.now() + 15_000) {
        cot = await cotizar();
        if (!cot) {
          setPaying(false);
          return;
        }
        if (cot.subtotal !== subtotal) {
          setErrorMsg("El precio de tu pedido se actualizó. Revisa el total y vuelve a pagar.");
          setPaying(false);
          return;
        }
      }

      const { data, error } = await supabase.functions.invoke("process-payment", {
        body: {
          table_token: token,
          cotizacion_id: cot.id,
          method,
          tip_amount: tipAmount,
          // La misma clave para el mismo pago: si se repite (doble toque, mala señal), no se cobra dos veces.
          idempotency_key: `${idemRef.current}-${cot.id}-${tipAmount}`,
          redeem_reward_id: redeemRewardId,
        },
      });

      const payload = data as
        | {
            approved?: boolean;
            error?: string;
            payment?: { amount: number; tip_amount: number; external_reference: string };
            order?: { order_number: number } | null;
            loyalty?: PaidResult["loyalty"];
          }
        | null;

      if (error || !payload?.approved) {
        setErrorMsg(payload?.error || "No pudimos procesar el pago. Intenta de nuevo.");
        setPaying(false);
        return;
      }

      setPaid({
        amount: payload.payment?.amount ?? subtotal,
        tip: payload.payment?.tip_amount ?? tipAmount,
        reference: payload.payment?.external_reference ?? "",
        orderNumber: payload.order?.order_number ?? null,
        loyalty: payload.loyalty ?? null,
      });
      clearCart();
    } catch {
      setErrorMsg("Error de conexión. Revisa tu señal e intenta otra vez.");
    } finally {
      setPaying(false);
    }
  };

  const pedirSinPagarEnApp = async (forma: "mozo" | "cuenta") => {
    if (paying || !token || lineas.length === 0) return;
    setErrorMsg("");
    setPaying(true);
    const r = await pedirSinPagar(token, lineas, forma, orderNotes.trim() || undefined);
    setPaying(false);
    if (r.ok === false) {
      if (pideCodigoMesa(r.error)) {
        setPideCodigo({ reintentar: () => { pedirSinPagarEnApp(forma); } });
        return;
      }
      setErrorMsg(r.error);
      return;
    }
    setSinPagar({ numero: r.numero, total: r.total, forma, aCocina: r.aCocina });
    clearCart();
  };

  const qs = token ? `?t=${token}` : "";

  /* ---------- estados ---------- */
  if (tableStatus === "invalid" || (!token && tableStatus !== "loading")) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
        <AlertTriangle className="h-10 w-10 text-destructive" />
        <p className="mt-4 text-base font-bold text-foreground">No identificamos tu mesa</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Escanea otra vez el QR que está sobre tu mesa para pedir y pagar.
        </p>
      </div>
    );
  }

  if (sinPagar) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6">
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="w-full max-w-md text-center">
          <CheckCircle2 className="mx-auto h-14 w-14" style={{ color: primaryColor }} />
          <h1 className="mt-4 text-xl font-bold text-foreground">
            {sinPagar.forma === "cuenta" ? "¡Agregado a tu cuenta!" : "¡Pedido enviado!"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pedido #{String(sinPagar.numero).padStart(3, "0")} · {formatCLP(sinPagar.total)}
          </p>
          <div className="mt-5 rounded-2xl border border-border bg-card p-5 text-left">
            <p className="text-sm text-card-foreground">
              {sinPagar.forma === "cuenta"
                ? "Ya está en preparación. Lo pagas al final, desde la app o con el mozo."
                : sinPagar.aCocina
                  ? "Ya va a la cocina. El mozo pasará a cobrarte en efectivo o con tarjeta."
                  : "El mozo viene a cobrarte en efectivo o con tarjeta. Apenas pagues, tu pedido pasa a la cocina."}
            </p>
          </div>
          <button
            onClick={() => navigate(`/${slug}/tracking${qs}`)}
            className="mt-6 w-full rounded-2xl py-4 text-base font-semibold text-white"
            style={{ backgroundColor: primaryColor }}
          >
            Ver estado de mi pedido
          </button>
          <button onClick={() => navigate(`/${slug}/menu${qs}`)} className="mt-3 text-sm text-muted-foreground underline">
            Pedir algo más
          </button>
        </motion.div>
      </div>
    );
  }

  if (paid) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6">
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="w-full max-w-md text-center">
          <CheckCircle2 className="mx-auto h-14 w-14" style={{ color: primaryColor }} />
          <h1 className="mt-4 text-xl font-bold text-foreground">¡Pago listo!</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {paid.orderNumber
              ? `Tu pedido #${String(paid.orderNumber).padStart(3, "0")} ya está en preparación.`
              : "Tu pedido ya está en preparación."}
          </p>

          <div className="mt-5 rounded-2xl border border-border bg-card p-5 text-left">
            <div className="flex justify-between py-0.5">
              <span className="text-sm text-muted-foreground">Consumo</span>
              <span className="text-sm font-bold text-card-foreground">{formatCLP(paid.amount)}</span>
            </div>
            {paid.tip > 0 && (
              <div className="flex justify-between py-0.5">
                <span className="text-sm text-muted-foreground">Propina</span>
                <span className="text-sm text-card-foreground">{formatCLP(paid.tip)}</span>
              </div>
            )}
            <hr className="my-2 border-border" />
            <div className="flex justify-between">
              <span className="text-sm font-bold text-card-foreground">Total</span>
              <span className="text-base font-bold" style={{ color: primaryColor }}>
                {formatCLP(paid.amount + paid.tip)}
              </span>
            </div>
            {paid.reference && (
              <p className="mt-2 text-[11px] text-muted-foreground">Comprobante {paid.reference}</p>
            )}
          </div>

          {paid.loyalty && (
            <div className="mt-4 rounded-2xl border border-border bg-card p-5 text-left">
              <div className="mb-2 flex items-center gap-2">
                <Gift className="h-4 w-4" style={{ color: primaryColor }} />
                <span className="text-sm font-bold text-card-foreground">Tu programa de lealtad</span>
              </div>
              {paid.loyalty.reward_earned ? (
                <p className="text-sm text-card-foreground">
                  🎉 ¡Desbloqueaste tu recompensa! <strong>{paid.loyalty.reward_description}</strong>
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

          {!paid.loyalty && perfil?.es_anonimo && (
            <button
              onClick={() => setCuentaAbierta(true)}
              className="mt-4 flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-4 text-left"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: `${primaryColor}18` }}>
                <Gift className="h-5 w-5" style={{ color: primaryColor }} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-card-foreground">Guarda tus sellos</p>
                <p className="text-[11px] text-muted-foreground">Crea tu cuenta en 10 segundos y suma premios desde tu próxima visita.</p>
              </div>
            </button>
          )}
          <CuentaComensal
            abierto={cuentaAbierta}
            onCambiar={setCuentaAbierta}
            nombreLocal={tenant?.name ?? "el local"}
            color={primaryColor}
          />

          <button
            onClick={() => navigate(`/${slug}/menu${qs}`)}
            className="mt-6 w-full rounded-2xl py-4 text-base font-semibold text-white"
            style={{ backgroundColor: primaryColor }}
          >
            Seguir pidiendo
          </button>
          <button
            onClick={() => navigate(`/${slug}/tracking${qs}`)}
            className="mt-3 w-full text-sm underline text-muted-foreground"
          >
            Ver estado de mi pedido
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-40">
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-background px-4">
        <button
          onClick={() => navigate(`/${slug}/cart`)}
          className="flex h-9 w-9 items-center justify-center rounded-full text-foreground"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <span className="text-sm font-bold text-foreground">
          Pagar {table ? `· Mesa ${table.number}` : ""}
        </span>
        <div className="w-9" />
      </header>

      <div className="mx-auto max-w-md px-4 pt-4">
        {items.length === 0 ? (
          <div className="py-16 text-center">
            <p className="mb-3 text-5xl">🧾</p>
            <p className="text-base font-bold text-foreground">Tu pedido está vacío</p>
            <button
              onClick={() => navigate(`/${slug}/menu${qs}`)}
              className="mt-6 text-sm underline text-muted-foreground"
            >
              Volver al menú
            </button>
          </div>
        ) : (
          <>
            {/* Resumen */}
            <div className="mb-4 rounded-2xl border border-border bg-card p-4">
              <p className="mb-2 text-xs font-bold text-muted-foreground">TU PEDIDO</p>
              {items.map((it) => (
                <div key={it.id} className="flex justify-between py-0.5">
                  <span className="text-sm text-card-foreground">
                    {it.quantity}× {it.name}
                  </span>
                  <span className="text-sm text-muted-foreground">{formatCLP(it.subtotal)}</span>
                </div>
              ))}
              <hr className="my-2 border-border" />
              <div className="flex justify-between">
                <span className="text-sm font-bold text-card-foreground">Subtotal</span>
                <span className="text-sm font-bold text-card-foreground">{formatCLP(subtotal)}</span>
              </div>
            </div>

            {/* Upsell */}
            {upsells.length > 0 && (
              <div className="mb-4">
                <p className="mb-2 text-[15px] font-bold text-foreground">¿Le agregas algo?</p>
                <div className="space-y-2">
                  {upsells.map((u) => (
                    <div
                      key={u.id}
                      className="flex items-center gap-3 rounded-xl border border-border bg-card p-2.5"
                    >
                      {u.image_url ? (
                        <img src={u.image_url} alt={u.name} className="h-11 w-11 rounded-lg object-cover" loading="lazy" />
                      ) : (
                        <div className="h-11 w-11 rounded-lg bg-muted" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-card-foreground">{u.name}</p>
                        <p className="text-xs text-muted-foreground">{formatCLP(u.price)}</p>
                      </div>
                      <button
                        onClick={() =>
                          addItem({
                            menuItemId: u.id,
                            name: u.name,
                            unitPrice: u.price,
                            quantity: 1,
                            selectedModifiers: [],
                            itemNotes: "",
                          })
                        }
                        className="flex h-9 w-9 items-center justify-center rounded-full text-white"
                        style={{ backgroundColor: primaryColor }}
                        aria-label={`Agregar ${u.name}`}
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Nota */}
            <div className="mb-4">
              <label className="text-[13px] font-bold text-muted-foreground">Nota para la cocina (opcional)</label>
              <textarea
                value={orderNotes}
                onChange={(e) => setOrderNotes(e.target.value.slice(0, 300))}
                rows={2}
                placeholder="Ej: sin hielo, poco picante"
                className="mt-1.5 w-full resize-none rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
              />
            </div>

            {/* Propina */}
            <p className="mb-2 text-[15px] font-bold text-foreground">Propina</p>
            <div className="mb-4 grid grid-cols-4 gap-2">
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

            {/* Sellos de fidelización: solo con cuenta verificada (fase 1.3) */}
            <BloqueSellos
              tenantId={tenant?.id}
              branchId={table?.branch_id}
              nombreLocal={tenant?.name ?? "el local"}
              color={primaryColor}
              premioElegido={redeemRewardId}
              onElegirPremio={setRedeemRewardId}
            />

            {(errorMsg || errorCotizacion) && (
              <div className="mb-4 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <p className="text-xs text-destructive">{errorMsg || errorCotizacion}</p>
              </div>
            )}

            <div className="flex items-center justify-center gap-1.5 pb-2 text-[11px] text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" />
              El cobro se confirma en el servidor antes de mandar tu pedido a la barra.
            </div>
          </>
        )}
      </div>

      {/* Footer de pago */}
      {items.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-background px-4 py-4 shadow-[0_-4px_12px_rgba(0,0,0,0.05)]">
          <div className="mx-auto max-w-md">
            <div className="mb-3 flex items-center justify-between">
              <span className="flex flex-col text-sm text-muted-foreground">
                Total con propina
                {cotizacion && !errorCotizacion && (
                  <span className="text-[11px]">🔒 Precio asegurado por 10 minutos</span>
                )}
              </span>
              <span className="text-lg font-bold" style={{ color: primaryColor }}>
                {formatCLP(total)}
              </span>
            </div>

            {wallets.applePay && (
              <button
                disabled={paying || !!errorCotizacion}
                onClick={() => handlePay("apple_pay")}
                className="mb-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-foreground py-4 text-base font-semibold text-background disabled:opacity-60"
              >
                {paying ? <Loader2 className="h-5 w-5 animate-spin" /> : <Apple className="h-5 w-5" />}
                Pagar con Apple Pay
              </button>
            )}

            {wallets.googlePay && (
              <button
                disabled={paying || !!errorCotizacion}
                onClick={() => handlePay("google_pay")}
                className="mb-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-foreground py-4 text-base font-semibold text-background disabled:opacity-60"
              >
                {paying ? <Loader2 className="h-5 w-5 animate-spin" /> : <span className="text-base">G</span>}
                Pagar con Google Pay
              </button>
            )}

            <button
              disabled={paying || !!errorCotizacion}
              onClick={() => handlePay("card")}
              className="flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-base font-semibold text-white disabled:opacity-60"
              style={{ backgroundColor: primaryColor }}
            >
              {paying ? <Loader2 className="h-5 w-5 animate-spin" /> : <CreditCard className="h-5 w-5" />}
              Pagar con tarjeta
            </button>

            {/* Respaldo para quien prefiere pagar "a la antigua" (lo principal es pagar ahora) */}
            <div className="mt-3 flex flex-col items-center gap-1.5">
              <button
                disabled={paying || !!errorCotizacion}
                onClick={() => pedirSinPagarEnApp("mozo")}
                className="text-sm font-medium text-muted-foreground underline-offset-4 hover:underline disabled:opacity-50"
              >
                💵 Prefiero pagarle al mozo (efectivo o tarjeta)
              </button>
              {modoPago === "open_tab" && (
                <button
                  disabled={paying || !!errorCotizacion}
                  onClick={() => pedirSinPagarEnApp("cuenta")}
                  className="text-sm font-medium text-muted-foreground underline-offset-4 hover:underline disabled:opacity-50"
                >
                  🧾 Agregar a mi cuenta y pagar al final
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {token && (
        <CodigoMesa
          abierto={!!pideCodigo}
          tokenMesa={token}
          color={primaryColor}
          onCerrar={() => setPideCodigo(null)}
          onListo={() => { const r = pideCodigo; setPideCodigo(null); r?.reintentar(); }}
        />
      )}
    </div>
  );
}
