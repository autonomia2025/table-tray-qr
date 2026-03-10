import { useEffect, useState, useMemo } from "react";
import { useAdmin } from "@/contexts/AdminContext";
import { supabase } from "@/integrations/supabase/client";
import { formatCLP } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Clock, ChefHat, Check, Truck, XCircle, AlertTriangle, CheckCircle2 } from "lucide-react";

interface OrderRow {
  id: string;
  order_number: number;
  status: string | null;
  total_amount: number;
  notes: string | null;
  source: string | null;
  confirmed_at: string | null;
  kitchen_accepted_at: string | null;
  ready_at: string | null;
  delivered_at: string | null;
  cancelled_reason: string | null;
  table_id: string;
}

interface OrderItem {
  id: string;
  order_id: string;
  menu_item_name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  item_notes: string | null;
  selected_modifiers: any;
}

interface TableMap {
  [id: string]: number;
}

const COLUMNS = [
  { key: "confirmed", label: "Nuevos", icon: AlertTriangle, color: "text-amber-600 bg-amber-50 border-amber-200" },
  { key: "in_kitchen", label: "En cocina", icon: ChefHat, color: "text-blue-600 bg-blue-50 border-blue-200" },
  { key: "ready", label: "Listos", icon: Check, color: "text-green-600 bg-green-50 border-green-200" },
  { key: "delivered", label: "Entregados", icon: Truck, color: "text-muted-foreground bg-muted/50 border-border" },
  { key: "cancelled", label: "Cancelados", icon: XCircle, color: "text-red-600 bg-red-50 border-red-200" },
];

function timeAgo(dateStr: string | null) {
  if (!dateStr) return "";
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export default function PedidosPage() {
  const { branchId, tenantId } = useAdmin();
  const { toast } = useToast();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [tableMap, setTableMap] = useState<TableMap>({});
  const [itemsMap, setItemsMap] = useState<Record<string, OrderItem[]>>({});
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [filterTable, setFilterTable] = useState<string>("all");
  const [activeTab, setActiveTab] = useState<"active" | "history">("active");
  const [mobileTab, setMobileTab] = useState("confirmed");
  const [currentTime, setCurrentTime] = useState(Date.now());

  // Update current time every second for countdowns
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Detail dialog
  const [selectedOrder, setSelectedOrder] = useState<OrderRow | null>(null);
  const [detailItems, setDetailItems] = useState<OrderItem[]>([]);

  // Cancel dialog
  const [cancelOrder, setCancelOrder] = useState<OrderRow | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const fetchData = async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [ordersRes, tablesRes] = await Promise.all([
      supabase
        .from("orders")
        .select("id, order_number, status, total_amount, notes, source, confirmed_at, kitchen_accepted_at, ready_at, delivered_at, cancelled_reason, table_id")
        .eq("branch_id", branchId)
        .gte("confirmed_at", today.toISOString())
        .order("confirmed_at", { ascending: false }),
      supabase
        .from("tables")
        .select("id, number")
        .eq("branch_id", branchId),
    ]);

    const ordersData = ordersRes.data ?? [];
    const tablesData = tablesRes.data ?? [];

    const tMap: TableMap = {};
    tablesData.forEach(t => { tMap[t.id] = t.number; });
    setTableMap(tMap);

    if (ordersData.length > 0) {
      const { data: items } = await supabase
        .from("order_items")
        .select("id, order_id, menu_item_name, quantity, unit_price, subtotal, item_notes, selected_modifiers")
        .in("order_id", ordersData.map(o => o.id));

      const map: Record<string, OrderItem[]> = {};
      (items ?? []).forEach(i => {
        if (!map[i.order_id]) map[i.order_id] = [];
        map[i.order_id].push(i);
      });
      setItemsMap(map);
    }

    setOrders(ordersData);
    setLoading(false);
  };

  useEffect(() => {
    if (!branchId) return;
    fetchData();

    const channel = supabase
      .channel("admin-pedidos-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter: `branch_id=eq.${branchId}`,
        },
        async (payload) => {
          if (payload.eventType === "INSERT") {
            const newOrder = payload.new as OrderRow;
            // Fetch items for new order
            const { data: items } = await supabase
              .from("order_items")
              .select("id, order_id, menu_item_name, quantity, unit_price, subtotal, item_notes, selected_modifiers")
              .eq("order_id", newOrder.id);

            setItemsMap(prev => ({ ...prev, [newOrder.id]: items || [] }));
            setOrders(prev => [newOrder, ...prev]);
          } else if (payload.eventType === "UPDATE") {
            const updatedOrder = payload.new as OrderRow;
            setOrders(prev => prev.map(o => o.id === updatedOrder.id ? updatedOrder : o));
          } else if (payload.eventType === "DELETE") {
            setOrders(prev => prev.filter(o => o.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [branchId]);

  const filteredOrders = useMemo(() => {
    let list = orders;
    if (filterTable !== "all") {
      list = list.filter((o) => o.table_id === filterTable);
    }

    if (activeTab === "active") {
      // "Ready" orders stay in active list for 2 mins (120000ms) after delivery
      return list.filter((o) => {
        if (["confirmed", "in_kitchen", "ready"].includes(o.status || "")) return true;
        if (o.status === "delivered" && o.delivered_at) {
          const deliveredAt = new Date(o.delivered_at).getTime();
          return currentTime - deliveredAt < 120000;
        }
        return false;
      });
    } else {
      return list.filter((o) => ["delivered", "cancelled"].includes(o.status || ""));
    }
  }, [orders, filterTable, activeTab, currentTime]);

  const columnOrders = (status: string) => filteredOrders.filter(o => o.status === status);

  const activeColumns = COLUMNS.filter(c => ["confirmed", "in_kitchen", "ready", "delivered"].includes(c.key));
  const historyColumns = COLUMNS.filter(c => ["delivered", "cancelled"].includes(c.key));

  const uniqueTables = useMemo(() => {
    const ids = [...new Set(orders.map(o => o.table_id))];
    return ids.map(id => ({ id, number: tableMap[id] ?? 0 })).sort((a, b) => a.number - b.number);
  }, [orders, tableMap]);

  const advanceStatus = async (order: OrderRow) => {
    setActionLoading(true);
    const next: Record<string, { status: string; field?: string }> = {
      confirmed: { status: "in_kitchen", field: "kitchen_accepted_at" },
      in_kitchen: { status: "ready", field: "ready_at" },
      ready: { status: "delivered", field: "delivered_at" },
    };
    const n = next[order.status ?? ""];
    if (!n) return;
    const update: any = { status: n.status };
    if (n.field) update[n.field] = new Date().toISOString();
    await supabase.from("orders").update(update).eq("id", order.id);
    toast({ title: `Pedido #${order.order_number} → ${n.status}` });
    setActionLoading(false);
    setSelectedOrder(null);
  };

  const confirmCancel = async () => {
    if (!cancelOrder || !cancelReason.trim()) return;
    setActionLoading(true);
    await supabase.from("orders").update({ status: "cancelled", cancelled_reason: cancelReason.trim() }).eq("id", cancelOrder.id);
    toast({ title: `Pedido #${cancelOrder.order_number} cancelado` });
    setCancelOrder(null);
    setCancelReason("");
    setActionLoading(false);
  };

  const openDetail = (order: OrderRow) => {
    setSelectedOrder(order);
    setDetailItems(itemsMap[order.id] ?? []);
  };

  const OrderCard = ({ order }: { order: OrderRow }) => {
    const isRecentlyDelivered = order.status === "delivered" && activeTab === "active";
    let countdownText = "";

    if (isRecentlyDelivered && order.delivered_at) {
      const deliveredAt = new Date(order.delivered_at).getTime();
      const diff = 120000 - (currentTime - deliveredAt);
      if (diff > 0) {
        const secs = Math.floor(diff / 1000);
        countdownText = `Se ocultará en ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      }
    }

    return (
      <button
        onClick={() => openDetail(order)}
        className={`w-full text-left bg-card border border-border rounded-lg p-3 hover:shadow-md transition-shadow relative ${isRecentlyDelivered ? 'opacity-70' : ''}`}
      >
        <div className="flex items-center justify-between mb-1">
          <span className="font-bold text-sm">#{order.order_number}</span>
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {timeAgo(order.confirmed_at)}
          </span>
        </div>
        <div className="flex items-center gap-2 mb-2">
          <Badge variant="outline" className="text-[10px]">Mesa {tableMap[order.table_id] ?? "?"}</Badge>
          {order.source === "waiter" && <Badge variant="secondary" className="text-[10px]">Mozo</Badge>}
          {countdownText && (
            <Badge variant="secondary" className="text-[10px] bg-amber-100 text-amber-700 animate-pulse border-amber-200">
              {countdownText}
            </Badge>
          )}
        </div>
        <div className="space-y-0.5">
          {(itemsMap[order.id] ?? []).slice(0, 3).map((item, i) => (
            <p key={i} className="text-xs text-foreground truncate">{item.quantity}× {item.menu_item_name}</p>
          ))}
          {(itemsMap[order.id]?.length ?? 0) > 3 && (
            <p className="text-xs text-muted-foreground">+{(itemsMap[order.id]?.length ?? 0) - 3} más</p>
          )}
        </div>
        {order.notes && (
          <p className="text-xs text-destructive mt-1 truncate">📝 {order.notes}</p>
        )}
        <p className="text-sm font-semibold mt-2">{formatCLP(order.total_amount)}</p>
      </button>
    );
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold text-foreground">Centro de Pedidos</h1>
          <Tabs value={activeTab} onValueChange={(v: any) => setActiveTab(v)} className="w-[300px]">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="active">En curso</TabsTrigger>
              <TabsTrigger value="history">Historial</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <Select value={filterTable} onValueChange={setFilterTable}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Todas las mesas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las mesas</SelectItem>
            {uniqueTables.map(t => (
              <SelectItem key={t.id} value={t.id}>Mesa {t.number}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Desktop: horizontal columns */}
      <div className={`hidden md:grid gap-3 ${activeTab === 'active' ? 'md:grid-cols-4' : 'md:grid-cols-2 scrollbar-hide'}`}>
        {(activeTab === "active" ? activeColumns : historyColumns).map(col => {
          const colOrders = columnOrders(col.key);
          return (
            <div key={col.key} className={`rounded-xl border p-3 min-h-[400px] flex flex-col ${col.color}`}>
              <div className="flex items-center gap-2 mb-3">
                <col.icon className="h-4 w-4" />
                <span className="text-sm font-semibold">{col.label}</span>
                <Badge variant="secondary" className="text-[10px] ml-auto">{colOrders.length}</Badge>
              </div>
              <div className="space-y-2 flex-1 relative">
                {colOrders.length === 0 ? (
                  activeTab === 'active' && col.key === 'confirmed' ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-4">
                      <CheckCircle2 className="h-10 w-10 text-green-500 mb-2 opacity-40" />
                      <p className="text-xs font-medium text-muted-foreground">Todo al día 🎉</p>
                      <p className="text-[10px] text-muted-foreground/60">No hay pedidos pendientes</p>
                    </div>
                  ) : null
                ) : (
                  colOrders.map(o => <OrderCard key={o.id} order={o} />)
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Mobile: tabs */}
      <div className="md:hidden">
        <Tabs value={mobileTab} onValueChange={setMobileTab}>
          <TabsList className={`w-full grid mb-3 ${activeTab === 'active' ? 'grid-cols-4' : 'grid-cols-2'}`}>
            {(activeTab === "active" ? activeColumns : historyColumns).map(col => (
              <TabsTrigger key={col.key} value={col.key} className="text-xs px-1">
                {col.label.split(" ")[0]}
                {columnOrders(col.key).length > 0 && (
                  <span className="ml-1 text-[10px] bg-primary/20 rounded-full px-1">{columnOrders(col.key).length}</span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="space-y-2">
          {columnOrders(mobileTab).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <CheckCircle2 className="h-12 w-12 text-green-500 mb-3 opacity-30" />
              <p className="text-sm font-medium text-muted-foreground">Sin pedidos</p>
            </div>
          ) : (
            columnOrders(mobileTab).map(o => <OrderCard key={o.id} order={o} />)
          )}
        </div>
      </div>

      {/* Detail dialog */}
      <Dialog open={!!selectedOrder} onOpenChange={() => setSelectedOrder(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Pedido #{selectedOrder?.order_number}</DialogTitle>
            <DialogDescription>
              Mesa {tableMap[selectedOrder?.table_id ?? ""] ?? "?"} · {selectedOrder?.source === "waiter" ? "Mozo" : "QR"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-[40vh] overflow-auto">
            {detailItems.map(item => (
              <div key={item.id} className="flex justify-between items-start py-1 border-b border-border last:border-0">
                <div>
                  <p className="text-sm font-medium">{item.quantity}× {item.menu_item_name}</p>
                  {item.item_notes && <p className="text-xs text-muted-foreground">{item.item_notes}</p>}
                </div>
                <span className="text-sm font-medium">{formatCLP(item.subtotal)}</span>
              </div>
            ))}
          </div>
          {selectedOrder?.notes && (
            <p className="text-sm text-destructive bg-destructive/10 p-2 rounded">📝 {selectedOrder.notes}</p>
          )}
          <div className="text-xs text-muted-foreground space-y-0.5">
            {selectedOrder?.confirmed_at && <p>Confirmado: {new Date(selectedOrder.confirmed_at).toLocaleTimeString("es-CL")}</p>}
            {selectedOrder?.kitchen_accepted_at && <p>En cocina: {new Date(selectedOrder.kitchen_accepted_at).toLocaleTimeString("es-CL")}</p>}
            {selectedOrder?.ready_at && <p>Listo: {new Date(selectedOrder.ready_at).toLocaleTimeString("es-CL")}</p>}
            {selectedOrder?.delivered_at && <p>Entregado: {new Date(selectedOrder.delivered_at).toLocaleTimeString("es-CL")}</p>}
            {selectedOrder?.cancelled_reason && <p className="text-destructive">Cancelado: {selectedOrder.cancelled_reason}</p>}
          </div>
          <p className="text-lg font-bold text-right">{formatCLP(selectedOrder?.total_amount ?? 0)}</p>
          <DialogFooter className="flex gap-2">
            {selectedOrder && ["confirmed", "in_kitchen", "ready"].includes(selectedOrder.status ?? "") && (
              <>
                <Button variant="destructive" size="sm" onClick={() => { setCancelOrder(selectedOrder); setSelectedOrder(null); }}>
                  Cancelar
                </Button>
                <Button size="sm" disabled={actionLoading} onClick={() => advanceStatus(selectedOrder)}>
                  {selectedOrder.status === "confirmed" ? "Enviar a cocina" : selectedOrder.status === "in_kitchen" ? "Marcar listo" : "Marcar entregado"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel reason dialog */}
      <Dialog open={!!cancelOrder} onOpenChange={() => setCancelOrder(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Cancelar pedido #{cancelOrder?.order_number}</DialogTitle>
            <DialogDescription>Escribe el motivo de cancelación</DialogDescription>
          </DialogHeader>
          <Textarea value={cancelReason} onChange={e => setCancelReason(e.target.value)} placeholder="Motivo..." className="min-h-[80px]" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCancelOrder(null)}>Volver</Button>
            <Button variant="destructive" disabled={!cancelReason.trim() || actionLoading} onClick={confirmCancel}>
              Confirmar cancelación
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
