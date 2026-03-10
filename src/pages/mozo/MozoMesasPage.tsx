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
import { confirmPaymentAndRelease } from '@/lib/waiter-actions';

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
  const [showMyTables, setShowMyTables] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

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

  const toggleAssignment = async (table: TableData, e?: React.MouseEvent) => {
    e?.stopPropagation();
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
    setConfirmClose(false);

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

    if (selectedTable.status === 'waiting_bill' && !confirmClose) {
      setConfirmClose(true);
      setTimeout(() => setConfirmClose(false), 3000);
      return;
    }

    setActionLoading('close');

    try {
      const { data: session } = await supabase
        .from('table_sessions')
        .select('id')
        .eq('table_id', selectedTable.id)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();

      const { data: billRequest } = await supabase
        .from('bill_requests')
        .select('id')
        .eq('table_id', selectedTable.id)
        .eq('status', 'pending')
        .limit(1)
        .maybeSingle();

      if (billRequest) {
        await confirmPaymentAndRelease(
          selectedTable.id,
          session?.id ?? null,
          billRequest.id,
          branchId
        );
      } else {
        await supabase
          .from('tables')
          .update({ status: 'free', assigned_waiter_id: null })
          .eq('id', selectedTable.id);

        await supabase
          .from('table_sessions')
          .update({
            is_active: false,
            closed_at: new Date().toISOString()
          })
          .eq('table_id', selectedTable.id)
          .eq('is_active', true);
      }

      toast({ title: `✅ Mesa ${selectedTable.number} liberada` });
      setSheetOpen(false);
      fetchTables();
    } catch (err) {
      console.error(err);
      toast({ title: 'Error al cerrar mesa', variant: 'destructive' });
    } finally {
      setActionLoading(null);
      setConfirmClose(false);
    }
  };

  const getOrderActionLabel = (status: string) => {
    switch (status) {
      case 'confirmed': return '→ Enviar a Cocina';
      case 'in_kitchen': return '→ Marcar Listo';
      case 'ready': return '✓ Entregado';
      default: return '';
    }
  };

  const getOrderActionStyle = (status: string) => {
    switch (status) {
      case 'confirmed': return 'bg-amber-500 hover:bg-amber-600 text-white';
      case 'in_kitchen': return 'bg-blue-500 hover:bg-blue-600 text-white';
      case 'ready': return 'bg-green-500 hover:bg-green-600 text-white';
      default: return '';
    }
  };

  const getOrderBorderColor = (status: string) => {
    switch (status) {
      case 'confirmed': return 'border-l-amber-400';
      case 'in_kitchen': return 'border-l-blue-400';
      case 'ready': return 'border-l-green-400';
      default: return 'border-l-gray-400';
    }
  };

  const filteredTables = showMyTables 
    ? tables.filter(t => t.assigned_waiter_id === staffId)
    : tables;

  const freeCount = filteredTables.filter(t => t.status === 'free').length;
  const occupiedCount = filteredTables.filter(t => t.status === 'occupied' || t.status === 'waiting_bill').length;
  const myCount = filteredTables.filter(t => t.assigned_waiter_id === staffId).length;

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="p-4">
      {/* Summary bar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500"></span>
            <span className="text-sm font-medium">{freeCount} libres</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-orange-500"></span>
            <span className="text-sm font-medium">{occupiedCount} ocupadas</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-primary"></span>
            <span className="text-sm font-medium">{myCount} mías</span>
          </div>
        </div>
        <Button
          variant={showMyTables ? "default" : "outline"}
          size="sm"
          onClick={() => setShowMyTables(!showMyTables)}
        >
          {showMyTables ? "Mis mesas" : "Todas"}
        </Button>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-2 gap-3">
        {filteredTables.map(t => {
          const st = t.status ?? 'free';
          const isActive = st === 'occupied' || st === 'waiting_bill';
          const isMine = t.assigned_waiter_id === staffId;
          const isAssigned = !!t.assigned_waiter_id;
          const assignedToOther = isAssigned && !isMine;

          return (
            <button
              key={t.id}
              onClick={() => {
                if (isActive) openSheet(t);
              }}
              disabled={!isActive}
              className={`min-h-[140px] rounded-xl p-3 text-left transition-all relative flex flex-col justify-between ${!isActive ? 'cursor-default' : ''} ${
                st === 'free' ? 'bg-white border-l-4 border-green-400' : ''
              } ${
                st === 'occupied' && isMine ? 'bg-white border-l-4 border-primary' : ''
              } ${
                st === 'occupied' && assignedToOther ? 'bg-white border-l-4 border-orange-400 opacity-80' : ''
              } ${
                st === 'waiting_bill' ? 'bg-red-50 border-l-4 border-red-500' : ''
              }`}
            >
              {st === 'waiting_bill' && (
                <div className="absolute inset-0 rounded-xl overflow-hidden pointer-events-none">
                  <div className="absolute inset-0 border-2 border-red-500 animate-pulse-ring rounded-xl" />
                </div>
              )}

              {/* Top row: Table number + status emoji */}
              <div className="flex items-start justify-between">
                <span className="text-4xl font-black text-gray-800">{t.number}</span>
                <div className="flex items-center gap-1">
                  {st === 'waiting_bill' && <span className="text-xl">🧾</span>}
                  {st === 'occupied' && !isMine && <span className="w-2 h-2 rounded-full bg-orange-400"></span>}
                  {isMine && <span className="bg-primary text-white text-[10px] px-1.5 py-0.5 rounded font-bold">YO</span>}
                </div>
              </div>

              {/* Middle: Status pill */}
              <div>
                {st === 'free' && (
                  <span className="inline-block bg-green-100 text-green-700 text-xs font-semibold px-2 py-1 rounded-full">
                    Libre
                  </span>
                )}
                {st === 'occupied' && t.sessionOpenedAt && (
                  <span className="inline-block bg-orange-100 text-orange-700 text-xs font-semibold px-2 py-1 rounded-full">
                    Ocupada · {minutesAgo(t.sessionOpenedAt)}min
                  </span>
                )}
                {st === 'waiting_bill' && (
                  <span className="inline-block bg-red-100 text-red-700 text-xs font-semibold px-2 py-1 rounded-full">
                    🧾 Pide la cuenta
                  </span>
                )}
              </div>

              {/* Bottom row */}
              {isActive ? (
                <div className="flex items-end justify-between mt-2">
                  <span className="text-lg font-bold text-gray-800">
                    {t.sessionTotal !== undefined ? formatCLP(t.sessionTotal) : ''}
                  </span>
                  {(t.activeOrders ?? 0) > 0 && (
                    <span className="bg-amber-100 text-amber-700 text-[10px] font-semibold px-2 py-0.5 rounded">
                      {t.activeOrders} pedido{t.activeOrders! > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              ) : (
                <button
                  onClick={(e) => toggleAssignment(t, e)}
                  className={`w-full mt-2 py-2 rounded-lg text-sm font-semibold transition-colors ${
                    isMine 
                      ? 'bg-green-500 text-white' 
                      : 'bg-green-100 text-green-700 hover:bg-green-200'
                  }`}
                >
                  {isMine ? '✓ Asignada a mí' : 'Tomar mesa →'}
                </button>
              )}
            </button>
          );
        })}
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="max-h-[85vh] rounded-t-2xl px-4 pb-8">
          {selectedTable && (
            <>
              <SheetHeader className="mb-4">
                {/* Horizontal info strip */}
                <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
                  <span className="font-bold text-foreground text-lg">Mesa {selectedTable.number}</span>
                  <span>·</span>
                  {selectedTable.sessionOpenedAt && (
                    <>
                      <span>{minutesAgo(selectedTable.sessionOpenedAt)}min abierta</span>
                      <span>·</span>
                    </>
                  )}
                  {selectedTable.sessionTotal !== undefined && (
                    <>
                      <span className="font-semibold text-foreground">{formatCLP(selectedTable.sessionTotal)}</span>
                      <span>·</span>
                    </>
                  )}
                  <span>{selectedTable.activeOrders} pedidos activos</span>
                </div>

                {selectedTable.status === 'waiting_bill' && (
                  <div className="mt-3 bg-red-100 border border-red-200 rounded-lg p-3 flex items-center gap-3">
                    <span className="text-2xl">🧾</span>
                    <div>
                      <p className="text-sm font-bold text-red-800">Pidió la cuenta — verifica el pago</p>
                    </div>
                  </div>
                )}

                {selectedTable.assigned_waiter_id && selectedTable.assigned_waiter_id !== staffId && (
                  <div className="mt-3 bg-orange-50 border border-orange-200 rounded-lg p-3 flex items-center gap-3">
                    <span className="text-xl">⚠️</span>
                    <div>
                      <p className="text-sm font-bold text-orange-800">Esta mesa está asignada a otro mozo</p>
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
                    <div key={o.id} className={`bg-muted/30 rounded-lg p-3 border-l-4 ${getOrderBorderColor(o.status)}`}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-sm font-semibold">Pedido #{o.order_number}</span>
                        <Badge variant="outline" className="text-[10px]">
                          {o.status === 'confirmed' ? 'Nuevo' : o.status === 'in_kitchen' ? 'En cocina' : 'Listo'}
                        </Badge>
                      </div>
                      {o.items.map((it, idx) => (
                        <p key={idx} className="text-sm text-foreground">{it.quantity}× {it.menu_item_name}</p>
                      ))}
                      <Button
                        size="sm"
                        className={`w-full mt-2 h-9 gap-1.5 ${getOrderActionStyle(o.status)}`}
                        disabled={actionLoading === o.id}
                        onClick={() => handleOrderAction(o)}
                      >
                        {actionLoading === o.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          getOrderActionLabel(o.status)
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-2">
                <Button
                  variant="outline"
                  className="w-full h-12"
                  onClick={() => { setSheetOpen(false); navigate(`/mozo/pedido-manual/${selectedTable.id}`); }}
                >
                  <PlusCircle className="h-4 w-4 mr-2" />
                  Pedir por cliente
                </Button>
                {(selectedTable.status === 'occupied' || selectedTable.status === 'waiting_bill') && (
                  <Button
                    variant={selectedTable.status === 'waiting_bill' ? 'default' : 'destructive'}
                    className={`w-full h-12 mt-2 ${selectedTable.status === 'waiting_bill' ? 'bg-green-600 hover:bg-green-700' : ''}`}
                    disabled={actionLoading === 'close'}
                    onClick={closeTable}
                  >
                    {confirmClose 
                      ? '¿Confirmar cierre?' 
                      : selectedTable.status === 'waiting_bill' 
                        ? 'Confirmar Pago y Liberar' 
                        : 'Cerrar mesa'
                    }
                  </Button>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
