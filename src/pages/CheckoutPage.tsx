import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Loader2,
  CreditCard,
  ShieldCheck,
  AlertTriangle,
  Apple,
  Plus,
  CheckCircle2,
} from "lucide-react";
import BloqueSellos from "@/components/comensal/BloqueSellos";
import TarjetaSellos from "@/components/comensal/TarjetaSellos";
import { useSesion } from "@/contexts/SesionContext";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { mensajeAmigable, pedirSinPagar } from "@/lib/pedidos";
import { pideCodigoMesa } from "@/lib/mesa";
import CodigoMesa from "@/components/comensal/CodigoMesa";
import { formatCLP } from "@/lib/format";
import { useCartStore } from "@/store/cartStore";
import { useTableSession } from "@/hooks/useTableSession";
import { esperarResultado, irAPasarela, pasarelaDeMesa, type Redireccion } from "@/lib/pagos";
import { detectWallets, requestWalletPayment, type WalletKind } from "@/lib/walletPayment";
import SelectorPropina from "@/components/comensal/SelectorPropina";
import { PROPINA_SUGERIDA, montoPropina, type Propina } from "@/lib/propina";


interface PaidResult {
  amount: number;
  tip: number;
  reference: string;
  orderNumber: number | null;
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
  const [propina, setPropina] = useState<Propina>(PROPINA_SUGERIDA);
  const { perfil } = useSesion();
  const [paying, setPaying] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [paid, setPaid] = useState<PaidResult | null>(null);
  // Pedido enviado sin pagar en la app ("Pagar al mozo" o "Agregar a mi cuenta", fase 2.B)
  const [sinPagar, setSinPagar] = useState<{ numero: number; total: number; forma: "mozo" | "cuenta"; aCocina: boolean } | null>(null);
  const idemRef = useRef(crypto.randomUUID());

  const wallets = useMemo(() => detectWallets(), []);

  /* ---------- cómo cobra este local (fase 4.1): su pasarela, simulado (demo) o nada ---------- */
  const { data: pasarela } = useQuery({
    queryKey: ["pasarela-mesa", token, perfil?.user_id],
    queryFn: () => pasarelaDeMesa(token!),
    enabled: !!token && !!perfil,
    staleTime: 60_000,
  });
  const proveedor = pasarela?.proveedor ?? null;

  /* ---------- vuelta desde la pasarela: ver cómo terminó el pago ---------- */
  const [params, setParams] = useSearchParams();
  const intentoVuelta = params.get("intento");
  const [confirmando, setConfirmando] = useState(!!intentoVuelta);
  useEffect(() => {
    if (!intentoVuelta || !perfil) return;
    let vigente = true;
    esperarResultado(intentoVuelta).then((r) => {
      if (!vigente) return;
      setConfirmando(false);
      const siguientes = new URLSearchParams(params);
      siguientes.delete("intento");
      setParams(siguientes, { replace: true });
      if (r?.estado === "aprobado") {
        setPaid({ amount: r.monto, tip: r.propina, reference: r.referencia ?? "", orderNumber: r.order_number });
        clearCart();
      } else if (r?.estado === "reservado") {
        setErrorMsg("Tu pago todavía se está confirmando. Si se te cobró, no lo repitas: lo verás en tu pedido en unos minutos.");
      } else {
        setErrorMsg(r?.motivo && r.estado === "reembolsado" ? r.motivo : "El pago no se completó y no se te cobró nada. Puedes intentarlo de nuevo.");
      }
    });
    return () => { vigente = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intentoVuelta, perfil?.user_id]);

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
  const tipAmount = montoPropina(propina, subtotal);
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
      if (method !== "card" && proveedor === "simulado") {
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
        },
      });

      const payload = data as
        | {
            approved?: boolean;
            error?: string;
            payment?: { amount: number; tip_amount: number; external_reference: string };
            order?: { order_number: number } | null;
            pendiente?: boolean;
            redirigir?: Redireccion;
          }
        | null;

      // Pasarela real (Webpay): el cliente paga en su página y vuelve aquí con el resultado
      if (payload?.pendiente && payload.redirigir) {
        irAPasarela(payload.redirigir);
        return;
      }
      if (error || !payload?.approved) {
        const cuerpo = error ? await (error as { context?: Response }).context?.json?.().catch(() => null) : null;
        setErrorMsg(mensajeAmigable(payload?.error || cuerpo?.error || "No pudimos procesar el pago. Intenta de nuevo."));
        setPaying(false);
        return;
      }

      setPaid({
        amount: payload.payment?.amount ?? subtotal,
        tip: payload.payment?.tip_amount ?? tipAmount,
        reference: payload.payment?.external_reference ?? "",
        orderNumber: payload.order?.order_number ?? null,
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

  if (confirmando) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-6 text-center">
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: primaryColor }} />
        <p className="text-base font-semibold text-foreground">Confirmando tu pago…</p>
        <p className="text-sm text-muted-foreground">No cierres esta página.</p>
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
                  ? "Ya va a la cocina. El mozo pasará a cobrarte en efectivo, con tarjeta o por transferencia."
                  : "El mozo viene a cobrarte en efectivo, con tarjeta o por transferencia. Apenas pagues, tu pedido pasa a la cocina."}
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

          {/* Sellos (fase 3.7): el sello de este pago "cae" en la tarjeta */}
          <TarjetaSellos
            className="mt-4"
            tenantId={tenant?.id}
            branchId={table?.branch_id}
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

            {/* Propina: 10% sugerido (mínimo legal), 15%, 20%, otro monto o sin propina */}
            <SelectorPropina subtotal={subtotal} color={primaryColor} valor={propina} onCambiar={setPropina} />

            {/* Sellos de fidelización: solo con cuenta verificada (fase 1.3) */}
            <BloqueSellos
              tenantId={tenant?.id}
              branchId={table?.branch_id}
              monto={subtotal}
              nombreLocal={tenant?.name ?? "el local"}
              color={primaryColor}
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

            {proveedor === null && pasarela !== undefined && (
              <p className="mb-2 rounded-xl bg-muted p-3 text-center text-sm text-foreground">
                Este local todavía no recibe pagos con la app. Envía tu pedido y págale al mozo.
              </p>
            )}

            {proveedor === "transbank" && (
              <>
                <button
                  disabled={paying || !!errorCotizacion}
                  onClick={() => handlePay("card")}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-base font-semibold text-white disabled:opacity-60"
                  style={{ backgroundColor: primaryColor }}
                >
                  {paying ? <Loader2 className="h-5 w-5 animate-spin" /> : <CreditCard className="h-5 w-5" />}
                  Pagar con Webpay
                </button>
                <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
                  Débito, crédito o prepago. Te llevamos a Webpay (Transbank) y vuelves aquí.
                  {pasarela?.prueba ? " · Ambiente de pruebas: no se cobra plata real." : ""}
                </p>
              </>
            )}

            {proveedor === "simulado" && wallets.applePay && (
              <button
                disabled={paying || !!errorCotizacion}
                onClick={() => handlePay("apple_pay")}
                className="mb-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-foreground py-4 text-base font-semibold text-background disabled:opacity-60"
              >
                {paying ? <Loader2 className="h-5 w-5 animate-spin" /> : <Apple className="h-5 w-5" />}
                Pagar con Apple Pay
              </button>
            )}

            {proveedor === "simulado" && wallets.googlePay && (
              <button
                disabled={paying || !!errorCotizacion}
                onClick={() => handlePay("google_pay")}
                className="mb-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-foreground py-4 text-base font-semibold text-background disabled:opacity-60"
              >
                {paying ? <Loader2 className="h-5 w-5 animate-spin" /> : <span className="text-base">G</span>}
                Pagar con Google Pay
              </button>
            )}

            {proveedor === "simulado" && (
              <button
                disabled={paying || !!errorCotizacion}
                onClick={() => handlePay("card")}
                className="flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-base font-semibold text-white disabled:opacity-60"
                style={{ backgroundColor: primaryColor }}
              >
                {paying ? <Loader2 className="h-5 w-5 animate-spin" /> : <CreditCard className="h-5 w-5" />}
                Pagar con tarjeta
              </button>
            )}

            {/* Respaldo para quien prefiere pagar "a la antigua" (lo principal es pagar ahora) */}
            <div className="mt-3 flex flex-col items-center gap-1.5">
              <button
                disabled={paying || !!errorCotizacion}
                onClick={() => pedirSinPagarEnApp("mozo")}
                className="text-sm font-medium text-muted-foreground underline-offset-4 hover:underline disabled:opacity-50"
              >
                💵 Prefiero pagarle al mozo (efectivo, tarjeta o transferencia)
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
