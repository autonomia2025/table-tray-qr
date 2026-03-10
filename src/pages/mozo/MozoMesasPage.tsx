import { useEffect, useState } from 'react';
import { useWaiters } from '@/contexts/WaitersContext';
import { supabase } from '@/integrations/supabase/client';
import { formatCLP } from '@/lib/format';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2, PlusCircle, UserCheck, UserX, ChefHat, CheckCircle2, Truck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

function playBeep() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.5);
  } catch { }
}

interface TableData {
  id: string;
  number: number;
  name: string | null;
  status: string | null;
  capacity: number | null;
  assigned_waiter_id: string | null;
  sessionTotal?: number;
  sessionOpenedAt?: string;
  activeOrders?: number;
}

interface OrderWithItems {
  id: string;
  order_number: number;
  status: string;
  total_amount: number;
  items: { menu_item_name: string; quantity: number }[];
}

const STATUS_COLORS: Record<string, string> = {
  free: 'bg-green-100 border-green-300 text-green-800',
  occupied: 'bg-orange-100 border-orange-300 text-orange-800',
  waiting_bill: 'bg-red-100 border-red-300 text-red-800',
  reserved: 'bg-muted border-border text-muted-foreground',
};

const STATUS_LABELS: Record<string, string> = {
  free: 'Libre',
  occupied: 'Ocupada',
  waiting_bill: 'Cuenta pedida',
  reserved: 'Reservada',
};

const ORDER_STATUS_LABELS: Record<string, string> = {
  confirmed: 'Nuevo',
  in_kitchen: 'En cocina',
  ready: 'Listo',
};

function minutesAgo(dateStr: string) {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
}

export default function MozoMesasPage() {
  const { branchId, staffId } = useWaiters();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [tables, setTables] = useState<TableData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTable, setSelectedTable] = useState<TableData | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [orders, setOrders] = useState<OrderWithItems[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchTables = async () => {
    const { data: tablesData } = await supabase
      .from('tables')
      .select('id, number, name, status, capacity, assigned_waiter_id')
      .eq('branch_id', branchId)
      .order('number');

    if (!tablesData) return;

    const occupiedIds = tablesData.filter(t => t.status === 'occupied' || t.status === 'waiting_bill').map(t => t.id);
    let sessionsMap: Record<string, { total: number; opened: string }> = {};

    if (occupiedIds.length > 0) {
      const [{ data: sessions }, { data: orderCounts }] = await Promise.all([
        supabase
          .from('table_sessions')
          .select('table_id, total_amount, opened_at')
          .in('table_id', occupiedIds)
          .eq('is_active', true),
        supabase
          .from('orders')
          .select('table_id')
          .in('table_id', occupiedIds)
          .in('status', ['confirmed', 'in_kitchen', 'ready']),
      ]);

      sessions?.forEach(s => {
        sessionsMap[s.table_id] = { total: s.total_amount ?? 0, opened: s.opened_at ?? '' };
      });

      // Count active orders per table
      const orderCountMap: Record<string, number> = {};
      orderCounts?.forEach(o => {
        orderCountMap[o.table_id] = (orderCountMap[o.table_id] ?? 0) + 1;
      });

      setTables(tablesData.map(t => ({
        ...t,
        sessionTotal: sessionsMap[t.id]?.total,
        sessionOpenedAt: sessionsMap[t.id]?.opened,
        activeOrders: orderCountMap[t.id] ?? 0,
      })));
    } else {
      setTables(tablesData.map(t => ({ ...t })));
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchTables();

    const channel = supabase
      .channel('mozo-tables-all')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tables', filter: `branch_id=eq.${branchId}` }, () => fetchTables())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `branch_id=eq.${branchId}` }, () => fetchTables())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bill_requests', filter: `branch_id=eq.${branchId}` }, (payload) => {
        fetchTables();
        const tableId = payload.new.table_id;
        const table = tables.find(t => t.id === tableId);
        const tableNum = table ? table.number : '?';

        toast({
          title: "🧾 ¡Piden la cuenta!",
          description: `Mesa ${tableNum} está esperando pagar`,
          duration: 8000,
        });
        playBeep();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [branchId, tables]);

  const toggleAssignment = async (table: TableData, e: React.MouseEvent) => {
    e.stopPropagation();
    const isMyTable = table.assigned_waiter_id === staffId;
    const { error } = await supabase
      .from('tables')
      .update({ assigned_waiter_id: isMyTable ? null : staffId })
      .eq('id', table.id);
    if (error) {
      toast({ title: 'Error al actualizar mesa', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: isMyTable ? 'Mesa liberada' : `Mesa ${table.number} tomada` });
    }
    fetchTables();
  };

  const openSheet = async (table: TableData) => {
    setSelectedTable(table);
    setSheetOpen(true);
    setOrdersLoading(true);

    const { data: session } = await supabase
      .from('table_sessions')
      .select('id')
      .eq('table_id', table.id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (!session) { setOrders([]); setOrdersLoading(false); return; }

    const { data: ordersData } = await supabase
      .from('orders')
      .select('id, order_number, status, total_amount')
      .eq('session_id', session.id)
      .in('status', ['confirmed', 'in_kitchen', 'ready'])
      .order('confirmed_at', { ascending: true });

    if (!ordersData || ordersData.length === 0) { setOrders([]); setOrdersLoading(false); return; }

    const { data: items } = await supabase
      .from('order_items')
      .select('order_id, menu_item_name, quantity')
      .in('order_id', ordersData.map(o => o.id));

    setOrders(ordersData.map(o => ({
      ...o,
      status: o.status ?? 'confirmed',
      items: (items ?? []).filter(i => i.order_id === o.id),
    })));
    setOrdersLoading(false);
  };

  const handleOrderAction = async (order: OrderWithItems) => {
    setActionLoading(order.id);
    const now = new Date().toISOString();
    if (order.status === 'confirmed') {
      await supabase.from('orders').update({ status: 'in_kitchen', kitchen_accepted_at: now }).eq('id', order.id);
      toast({ title: `Pedido #${order.order_number} → cocina` });
    } else if (order.status === 'in_kitchen') {
      await supabase.from('orders').update({ status: 'ready', ready_at: now }).eq('id', order.id);
      toast({ title: `Pedido #${order.order_number} → listo` });
    } else if (order.status === 'ready') {
      await supabase.from('orders').update({ status: 'delivered', delivered_at: now }).eq('id', order.id);
      toast({ title: `Pedido #${order.order_number} → entregado` });
    }
    if (selectedTable) openSheet(selectedTable);
    setActionLoading(null);
  };

  const closeTable = async () => {
    if (!selectedTable) return;
    setActionLoading('close');

    try {
      // 1. Update table status and unassign waiter
      await supabase
        .from('tables')
        .update({ status: 'free', assigned_waiter_id: null })
        .eq('id', selectedTable.id);

      // 2. Close active session
      await supabase
        .from('table_sessions')
        .update({
          is_active: false,
          closed_at: new Date().toISOString()
        })
        .eq('table_id', selectedTable.id)
        .eq('is_active', true);

      // 3. Mark bill requests as paid
      await supabase
        .from('bill_requests')
        .update({
          status: 'paid',
          paid_at: new Date().toISOString()
        })
        .eq('table_id', selectedTable.id)
        .eq('status', 'pending');

      toast({ title: `✅ Mesa ${selectedTable.number} liberada y lista` });
      setSheetOpen(false);
      fetchTables();
    } catch (err) {
      console.error(err);
      toast({ title: 'Error al cerrar mesa', variant: 'destructive' });
    } finally {
      setActionLoading(null);
    }
  };

  const getActionLabel = (status: string) => {
    switch (status) {
      case 'confirmed': return 'Enviar a cocina';
      case 'in_kitchen': return 'Marcar listo';
      case 'ready': return 'Entregado';
      default: return '';
    }
  };

  const getActionIcon = (status: string) => {
    switch (status) {
      case 'confirmed': return <ChefHat className="w-4 h-4" />;
      case 'in_kitchen': return <CheckCircle2 className="w-4 h-4" />;
      case 'ready': return <Truck className="w-4 h-4" />;
      default: return null;
    }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="p-4">
      <h2 className="text-lg font-bold text-foreground mb-4">Mesas</h2>
      <div className="grid grid-cols-2 gap-3">
        {tables.map(t => {
          const st = t.status ?? 'free';
          const colors = STATUS_COLORS[st] ?? STATUS_COLORS.free;
          const isActive = st === 'occupied' || st === 'waiting_bill';
          const isMine = t.assigned_waiter_id === staffId;
          const isAssigned = !!t.assigned_waiter_id;
          const assignedToOther = isAssigned && !isMine;

          return (
            <button
              key={t.id}
              onClick={() => isActive ? openSheet(t) : undefined}
              disabled={!isActive}
              className={`rounded-xl border-2 p-4 text-left transition-all relative ${colors} ${isActive ? 'active:scale-95' : 'opacity-80'} ${isMine ? 'ring-2 ring-primary ring-offset-1' : ''}`}
            >
              {st === 'waiting_bill' && (
                <div className="absolute inset-0 rounded-xl overflow-hidden pointer-events-none">
                  <div className="absolute inset-0 border-2 border-red-500 animate-pulse-ring rounded-xl" />
                </div>
              )}
              <div className="flex items-start justify-between">
                <span className="text-2xl font-bold">{t.number}</span>
                <div className="flex items-center gap-1">
                  {st === 'waiting_bill' && <span className="text-base">🧾</span>}
                  <button
                    onClick={(e) => toggleAssignment(t, e)}
                    className={`p-1 rounded-full transition-colors ${isMine
                        ? 'bg-primary/20 text-primary'
                        : assignedToOther
                          ? 'bg-muted text-muted-foreground cursor-not-allowed'
                          : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                      }`}
                    disabled={assignedToOther}
                    title={isMine ? 'Soltar mesa' : assignedToOther ? 'Asignada a otro mozo' : 'Tomar mesa'}
                  >
                    {isMine ? <UserCheck className="w-4 h-4" /> : <UserX className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              {t.name && <p className="text-xs mt-0.5 truncate opacity-70">{t.name}</p>}
              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                <Badge variant="outline" className="text-[10px] border-current">
                  {STATUS_LABELS[st] ?? st}
                </Badge>
                {isMine && (
                  <Badge variant="default" className="text-[10px]">Mía</Badge>
                )}
                {assignedToOther && (
                  <Badge variant="secondary" className="text-[10px]">Otro mozo</Badge>
                )}
                {isActive && (t.activeOrders ?? 0) > 0 && (
                  <Badge variant="destructive" className="text-[10px]">
                    {t.activeOrders} pedido{(t.activeOrders ?? 0) > 1 ? 's' : ''}
                  </Badge>
                )}
              </div>
              {isActive && t.sessionTotal !== undefined && (
                <p className="text-sm font-semibold mt-1">{formatCLP(t.sessionTotal)}</p>
              )}
              {isActive && t.sessionOpenedAt && (
                <p className="text-xs opacity-60 mt-0.5">{minutesAgo(t.sessionOpenedAt)} min</p>
              )}
            </button>
          );
        })}
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="max-h-[85vh] rounded-t-2xl px-4 pb-8">
          <SheetHeader className="mb-4">
            <SheetTitle>
              Mesa {selectedTable?.number}{selectedTable?.name ? ` · ${selectedTable.name}` : ''}
            </SheetTitle>
            {selectedTable?.status === 'waiting_bill' && (
              <div className="mt-2 bg-red-100 border border-red-200 rounded-lg p-3 flex items-center gap-3">
                <span className="text-2xl">🧾</span>
                <div>
                  <p className="text-sm font-bold text-red-800">Este cliente pidió la cuenta</p>
                  <p className="text-xs text-red-600">Verifica el pago antes de liberar la mesa</p>
                </div>
              </div>
            )}
          </SheetHeader>

          {ordersLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : orders.length === 0 ? (
            <p className="text-muted-foreground text-center py-8 text-sm">Sin pedidos activos</p>
          ) : (
            <div className="space-y-3 mb-6 max-h-[45vh] overflow-auto">
              {orders.map(o => (
                <div key={o.id} className="bg-muted/50 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-semibold">Pedido #{o.order_number}</span>
                    <Badge variant={o.status === 'confirmed' ? 'destructive' : o.status === 'ready' ? 'default' : 'secondary'} className="text-[10px]">
                      {ORDER_STATUS_LABELS[o.status] ?? o.status}
                    </Badge>
                  </div>
                  {o.items.map((it, idx) => (
                    <p key={idx} className="text-sm text-foreground">{it.quantity}× {it.menu_item_name}</p>
                  ))}
                  <Button
                    size="sm"
                    className="w-full mt-2 h-9 gap-1.5"
                    disabled={actionLoading === o.id}
                    onClick={() => handleOrderAction(o)}
                  >
                    {actionLoading === o.id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <>
                        {getActionIcon(o.status)}
                        {getActionLabel(o.status)}
                      </>
                    )}
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2">
            {selectedTable && (
              <Button
                variant="outline"
                className="w-full h-12"
                onClick={() => { setSheetOpen(false); navigate(`/mozo/pedido-manual/${selectedTable.id}`); }}
              >
                <PlusCircle className="h-4 w-4 mr-2" />
                Pedir por cliente
              </Button>
            )}
            {(selectedTable?.status === 'occupied' || selectedTable?.status === 'waiting_bill') && (
              <Button
                variant={selectedTable?.status === 'waiting_bill' ? 'default' : 'destructive'}
                className={`w-full h-12 mt-2 ${selectedTable?.status === 'waiting_bill' ? 'bg-green-600 hover:bg-green-700' : ''}`}
                disabled={actionLoading === 'close'}
                onClick={closeTable}
              >
                {selectedTable?.status === 'waiting_bill' ? 'Confirmar Pago y Liberar' : 'Cerrar mesa'}
              </Button>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
