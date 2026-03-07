import { useState, useEffect, useMemo, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { motion, AnimatePresence } from "framer-motion";
import { ShoppingBag, Receipt, Bell, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";
import { formatCLP } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { Json } from "@/integrations/supabase/types";

/* ---------- types ---------- */
interface OrderItem {
  id: string;
  menu_item_name: string;
  quantity: number;
  subtotal: number;
  selected_modifiers: Json;
  item_notes: string | null;
}

interface Order {
  id: string;
  order_number: number;
  status: string;
  total_amount: number;
  confirmed_at: string | null;
  notes: string | null;
  items: OrderItem[];
}

const STATUS_MAP: Record<string, { label: string; color: string; step: number }> = {
  confirmed: { label: "Recibido ✓", color: "text-muted-foreground", step: 0 },
  in_kitchen: { label: "En cocina 🍳", color: "text-orange-500", step: 1 },
  ready: { label: "¡Listo! 🔔", color: "text-green-500", step: 2 },
  delivered: { label: "Entregado ✓", color: "text-green-700", step: 3 },
  cancelled: { label: "Cancelado", color: "text-destructive", step: -1 },
};

const STEPS = ["Recibido", "En cocina", "Listo", "Entregado"];

const WAITER_REASONS = [
  { key: "help", label: "Necesito ayuda" },
  { key: "problem", label: "Problema con el pedido" },
  { key: "change", label: "Quiero cambiar algo" },
];

/* ---------- helpers ---------- */
function groupOrderItems(
  rawOrders: Array<{
    id: string;
    order_number: number;
    status: string;
    total_amount: number;
    confirmed_at: string | null;
    notes: string | null;
    item_id: string | null;
    menu_item_name: string | null;
    quantity: number | null;
    subtotal: number | null;
    selected_modifiers: Json | null;
    item_notes: string | null;
  }>
): Order[] {
  const map = new Map<string, Order>();
  for (const row of rawOrders) {
    if (!map.has(row.id)) {
      map.set(row.id, {
        id: row.id,
        order_number: row.order_number,
        status: row.status || "confirmed",
        total_amount: row.total_amount,
        confirmed_at: row.confirmed_at,
        notes: row.notes,
        items: [],
      });
    }
    if (row.item_id) {
      map.get(row.id)!.items.push({
        id: row.item_id,
        menu_item_name: row.menu_item_name || "",
        quantity: row.quantity || 1,
        subtotal: row.subtotal || 0,
        selected_modifiers: row.selected_modifiers || [],
        item_notes: row.item_notes,
      });
    }
  }
  return Array.from(map.values());
}

function formatTime(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
}

/* ---------- confetti ---------- */
function spawnConfetti(primaryColor: string) {
  const container = document.createElement("div");
  container.style.cssText = "position:fixed;inset:0;z-index:999;pointer-events:none;overflow:hidden";
  document.body.appendChild(container);
  const colors = [primaryColor, "#22c55e", "#eab308", "#3b82f6", "#f97316"];
  for (let i = 0; i < 40; i++) {
    const p = document.createElement("div");
    const size = 6 + Math.random() * 6;
    const x = Math.random() * 100;
    const delay = Math.random() * 0.5;
    const dur = 1.5 + Math.random();
    p.style.cssText = `position:absolute;top:-10px;left:${x}%;width:${size}px;height:${size}px;border-radius:${Math.random() > 0.5 ? "50%" : "2px"};background:${colors[i % colors.length]};animation:confetti-fall ${dur}s ${delay}s ease-in forwards`;
    container.appendChild(p);
  }
  if (!document.getElementById("confetti-style")) {
    const style = document.createElement("style");
    style.id = "confetti-style";
    style.textContent = `@keyframes confetti-fall{0%{transform:translateY(0) rotate(0deg);opacity:1}100%{transform:translateY(100vh) rotate(720deg);opacity:0}}`;
    document.head.appendChild(style);
  }
  setTimeout(() => container.remove(), 3000);
}

/* ---------- component ---------- */
export default function TrackingPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tableToken = searchParams.get("t");
  const orderIdParam = searchParams.get("order");
  const { toast } = useToast();

  const [orders, setOrders] = useState<Order[]>([]);
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
  const [waiterModalOpen, setWaiterModalOpen] = useState(false);
  const [waiterSending, setWaiterSending] = useState(false);
  const [readyFired, setReadyFired] = useState(false);

  // Tenant
  const { data: tenant } = useQuery({
    queryKey: ["tenant-tracking", slug],
    queryFn: async () => {
      const { data } = await supabase
        .from("tenants")
        .select("id, name, logo_url, primary_color")
        .eq("slug", slug!)
        .maybeSingle();
      return data;
    },
    enabled: !!slug,
    staleTime: Infinity,
  });

  const primaryColor = tenant?.primary_color || "#E8531D";

  // Table
  const { data: tableData } = useQuery({
    queryKey: ["table-tracking", tableToken],
    queryFn: async () => {
      const { data } = await supabase
        .from("tables")
        .select("id, number, name, tenant_id, branch_id")
        .eq("qr_token", tableToken!)
        .maybeSingle();
      return data;
    },
    enabled: !!tableToken,
    staleTime: Infinity,
  });

  // Session
  const { data: session } = useQuery({
    queryKey: ["session-tracking", tableData?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("table_sessions")
        .select("id, total_amount")
        .eq("table_id", tableData!.id)
        .eq("is_active", true)
        .maybeSingle();
      return data;
    },
    enabled: !!tableData?.id,
    staleTime: 10_000,
  });

  // Orders
  const { data: rawOrders, isLoading, isError } = useQuery({
    queryKey: ["orders-tracking", session?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("orders")
        .select("id, order_number, status, total_amount, confirmed_at, notes")
        .eq("session_id", session!.id)
        .order("confirmed_at", { ascending: true });

      if (!data || data.length === 0) return [];

      // fetch items for all orders
      const orderIds = data.map((o) => o.id);
      const { data: items } = await supabase
        .from("order_items")
        .select("id, order_id, menu_item_name, quantity, subtotal, selected_modifiers, item_notes")
        .in("order_id", orderIds);

      const itemsByOrder = new Map<string, OrderItem[]>();
      for (const it of items || []) {
        const arr = itemsByOrder.get(it.order_id) || [];
        arr.push({
          id: it.id,
          menu_item_name: it.menu_item_name,
          quantity: it.quantity,
          subtotal: it.subtotal,
          selected_modifiers: it.selected_modifiers,
          item_notes: it.item_notes,
        });
        itemsByOrder.set(it.order_id, arr);
      }

      return data.map((o) => ({
        id: o.id,
        order_number: o.order_number,
        status: o.status || "confirmed",
        total_amount: o.total_amount,
        confirmed_at: o.confirmed_at,
        notes: o.notes,
        items: itemsByOrder.get(o.id) || [],
      }));
    },
    enabled: !!session?.id,
    staleTime: 5_000,
  });

  // Sync raw to local state
  useEffect(() => {
    if (rawOrders) setOrders(rawOrders);
  }, [rawOrders]);

  // Realtime subscription
  useEffect(() => {
    if (!session?.id) return;
    const channel = supabase
      .channel(`order-tracking-${session.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "orders",
          filter: `session_id=eq.${session.id}`,
        },
        (payload) => {
          const updated = payload.new as { id: string; status: string };
          setOrders((prev) =>
            prev.map((o) => (o.id === updated.id ? { ...o, status: updated.status } : o))
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.id]);

  // Current order
  const currentOrder = useMemo(() => {
    if (!orders.length) return null;
    if (orderIdParam) {
      const found = orders.find((o) => o.id === orderIdParam);
      if (found) return found;
    }
    return orders[orders.length - 1];
  }, [orders, orderIdParam]);

  // Ready effect: vibrate + confetti
  useEffect(() => {
    if (currentOrder?.status === "ready" && !readyFired) {
      setReadyFired(true);
      try {
        navigator.vibrate?.([200, 100, 200]);
      } catch {}
      spawnConfetti(primaryColor);
    }
    if (currentOrder?.status !== "ready") {
      setReadyFired(false);
    }
  }, [currentOrder?.status, readyFired, primaryColor]);

  const currentStep = currentOrder ? STATUS_MAP[currentOrder.status]?.step ?? 0 : 0;
  const isCancelled = currentOrder?.status === "cancelled";

  const hasDelivered = orders.some((o) => o.status === "delivered");

  const sessionTotal = useMemo(
    () => orders.reduce((s, o) => s + (o.status !== "cancelled" ? o.total_amount : 0), 0),
    [orders]
  );

  const qs = tableToken ? `?t=${tableToken}` : "";

  const toggleExpand = (id: string) => {
    setExpandedOrders((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Waiter call
  const callWaiter = useCallback(
    async (reason: string) => {
      if (!tableData || !session) return;
      setWaiterSending(true);
      try {
        await supabase.from("waiter_calls").insert({
          tenant_id: tableData.tenant_id,
          table_id: tableData.id,
          branch_id: tableData.branch_id,
          session_id: session.id,
          reason,
          status: "pending",
        });
        toast({ title: "El mozo fue notificado 👍" });
      } catch {
        toast({ title: "Error al llamar al mozo", variant: "destructive" });
      } finally {
        setWaiterSending(false);
        setWaiterModalOpen(false);
      }
    },
    [tableData, session, toast]
  );

  /* ---------- LOADING ---------- */
  if (isLoading || !tenant) {
    return (
      <div className="min-h-screen bg-background">
        <header className="sticky top-0 z-40 flex h-14 items-center justify-center border-b border-border bg-background px-4">
          <Skeleton className="h-5 w-32" />
        </header>
        <div className="p-4 space-y-4">
          <Skeleton className="h-10 w-40 mx-auto" />
          <Skeleton className="h-5 w-24 mx-auto" />
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  /* ---------- ERROR ---------- */
  if (isError || (!isLoading && session && orders.length === 0) || (!isLoading && !session && tableData)) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 text-center">
        <AlertTriangle className="h-16 w-16 text-muted-foreground mb-4" />
        <h2 className="text-lg font-bold text-foreground mb-2">No encontramos tu pedido</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Escanea el QR de tu mesa nuevamente.
        </p>
        <button
          onClick={() => navigate(`/${slug}/menu${qs}`)}
          className="rounded-2xl px-6 py-3 text-sm font-semibold text-primary-foreground"
          style={{ backgroundColor: primaryColor }}
        >
          Volver al menú
        </button>
      </div>
    );
  }

  if (!currentOrder) return null;

  const modifiersLabel = (mods: Json) => {
    if (!Array.isArray(mods) || mods.length === 0) return null;
    return (mods as Array<{ modifierName: string }>).map((m) => m.modifierName).join(", ");
  };

  /* ---------- RENDER ---------- */
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen bg-background pb-8"
    >
      {/* Header */}
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-background px-4">
        {tenant.logo_url ? (
          <img src={tenant.logo_url} alt={tenant.name} className="h-8 w-8 rounded-full object-cover" />
        ) : (
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-primary-foreground"
            style={{ backgroundColor: primaryColor }}
          >
            {tenant.name.charAt(0)}
          </div>
        )}
        <span className="text-sm font-bold text-foreground">{tenant.name}</span>
        <div className="w-8" />
      </header>

      <div className="px-4 pt-5">
        {/* ── CURRENT ORDER ── */}
        <div className="text-center mb-6">
          <motion.div
            key={currentOrder.order_number}
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="text-3xl font-bold mb-1"
            style={{ color: primaryColor }}
          >
            #{String(currentOrder.order_number).padStart(3, "0")}
          </motion.div>
          <p className="text-sm text-muted-foreground">
            Mesa {tableData?.number || "?"}{tableData?.name ? ` · ${tableData.name}` : ""}
          </p>
        </div>

        {/* Progress bar */}
        {!isCancelled ? (
          <div className="mb-6">
            <div className="flex items-center justify-between relative">
              {/* Connection line */}
              <div className="absolute top-4 left-[12%] right-[12%] h-0.5 bg-border" />
              <div
                className="absolute top-4 left-[12%] h-0.5 transition-all duration-700"
                style={{
                  backgroundColor: primaryColor,
                  width: `${Math.max(0, currentStep) * (76 / 3)}%`,
                }}
              />

              {STEPS.map((label, i) => {
                const done = i <= currentStep;
                const isCurrent = i === currentStep;
                return (
                  <div key={label} className="relative z-10 flex flex-col items-center" style={{ width: "25%" }}>
                    <motion.div
                      animate={
                        isCurrent
                          ? { scale: [1, 1.15, 1] }
                          : { scale: 1 }
                      }
                      transition={
                        isCurrent
                          ? { duration: 1.5, repeat: Infinity, ease: "easeInOut" }
                          : {}
                      }
                      className="flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-bold transition-colors duration-500"
                      style={{
                        borderColor: done ? primaryColor : "hsl(var(--border))",
                        backgroundColor: done ? primaryColor : "hsl(var(--background))",
                        color: done ? "white" : "hsl(var(--muted-foreground))",
                      }}
                    >
                      {done && i < currentStep ? "✓" : i + 1}
                    </motion.div>
                    <span
                      className="mt-1.5 text-[10px] font-medium text-center leading-tight"
                      style={{ color: done ? primaryColor : "hsl(var(--muted-foreground))" }}
                    >
                      {label}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Ready message */}
            <AnimatePresence>
              {currentOrder.status === "ready" && (
                <motion.p
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="mt-4 text-center text-sm font-semibold"
                  style={{ color: primaryColor }}
                >
                  ¡Tu pedido está listo! El mozo viene en camino 🚀
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        ) : (
          <div className="mb-6 text-center">
            <span className="inline-block rounded-full bg-destructive/10 px-4 py-2 text-sm font-semibold text-destructive">
              Pedido cancelado
            </span>
          </div>
        )}

        {/* Current order items */}
        <div className="rounded-xl border border-border bg-card p-4 mb-4">
          {currentOrder.items.map((item) => (
            <div key={item.id} className="py-1.5">
              <div className="flex items-center justify-between">
                <span className="text-sm text-card-foreground">
                  {item.quantity}× {item.menu_item_name}
                </span>
                <span className="text-sm text-muted-foreground">{formatCLP(item.subtotal)}</span>
              </div>
              {modifiersLabel(item.selected_modifiers) && (
                <p className="text-xs text-muted-foreground ml-4">{modifiersLabel(item.selected_modifiers)}</p>
              )}
              {item.item_notes && (
                <p className="text-xs text-muted-foreground ml-4 italic">Nota: {item.item_notes}</p>
              )}
            </div>
          ))}
          <hr className="my-2 border-border" />
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-card-foreground">Total</span>
            <span className="text-base font-bold" style={{ color: primaryColor }}>
              {formatCLP(currentOrder.total_amount)}
            </span>
          </div>
        </div>

        {/* ── ACTION BUTTONS ── */}
        {!isCancelled && (
          <div className="space-y-3 mb-6">
            <hr className="border-border" />

            <button
              onClick={() => navigate(`/${slug}/menu${qs}`)}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-border bg-card py-3.5 text-sm font-semibold text-foreground transition-colors active:bg-accent"
            >
              <ShoppingBag className="h-4 w-4" />
              Agregar más 🍽
            </button>

            <button
              onClick={() => {
                if (hasDelivered) {
                  navigate(`/${slug}/bill${qs}`);
                } else {
                  toast({ title: "Disponible cuando tu pedido sea entregado" });
                }
              }}
              disabled={!hasDelivered}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-border bg-card py-3.5 text-sm font-semibold transition-colors active:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ color: hasDelivered ? primaryColor : undefined }}
            >
              <Receipt className="h-4 w-4" />
              Pedir la cuenta 🧾
            </button>

            <button
              onClick={() => setWaiterModalOpen(true)}
              className="flex w-full items-center justify-center gap-2 py-2.5 text-xs font-medium text-muted-foreground transition-colors active:text-foreground"
            >
              <Bell className="h-3.5 w-3.5" />
              Llamar al mozo 🛎
            </button>
          </div>
        )}

        {/* ── SESSION HISTORY ── */}
        {orders.length > 1 && (
          <>
            <hr className="border-border mb-4" />
            <h3 className="text-sm font-bold text-muted-foreground mb-3">Tu visita completa</h3>

            <div className="space-y-2 mb-4">
              {orders.map((order) => {
                const statusInfo = STATUS_MAP[order.status] || STATUS_MAP.confirmed;
                const isExpanded = expandedOrders.has(order.id);
                const isCurrentHighlight = order.id === currentOrder.id;

                return (
                  <div
                    key={order.id}
                    className={`rounded-xl border bg-card p-3 transition-colors ${
                      isCurrentHighlight ? "border-primary/30" : "border-border"
                    }`}
                  >
                    <button
                      onClick={() => toggleExpand(order.id)}
                      className="flex w-full items-center justify-between"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-card-foreground">
                          #{String(order.order_number).padStart(3, "0")}
                        </span>
                        <span className="text-xs text-muted-foreground">{formatTime(order.confirmed_at)}</span>
                        <span className={`text-xs font-medium ${statusInfo.color}`}>{statusInfo.label}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-card-foreground">
                          {formatCLP(order.total_amount)}
                        </span>
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                    </button>

                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <div className="mt-2 pt-2 border-t border-border">
                            {order.items.map((item) => (
                              <div key={item.id} className="flex justify-between py-1">
                                <span className="text-xs text-muted-foreground">
                                  {item.quantity}× {item.menu_item_name}
                                </span>
                                <span className="text-xs text-muted-foreground">{formatCLP(item.subtotal)}</span>
                              </div>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>

            <div className="rounded-xl border border-border bg-card p-4 mb-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-foreground">Total de tu visita</span>
                <span className="text-lg font-bold" style={{ color: primaryColor }}>
                  {formatCLP(sessionTotal)}
                </span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Waiter call modal */}
      <Dialog open={waiterModalOpen} onOpenChange={setWaiterModalOpen}>
        <DialogContent className="max-w-[340px] rounded-2xl">
          <DialogHeader>
            <DialogTitle>Llamar al mozo 🛎</DialogTitle>
            <DialogDescription>¿Para qué necesitas al mozo?</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 pt-2">
            {WAITER_REASONS.map((r) => (
              <button
                key={r.key}
                disabled={waiterSending}
                onClick={() => callWaiter(r.key)}
                className="flex w-full items-center rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground transition-colors active:bg-accent disabled:opacity-50"
              >
                {r.label}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
