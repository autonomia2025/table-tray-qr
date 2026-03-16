import { useEffect, useState } from 'react';
import { useWaiters } from '@/contexts/WaitersContext';
import { supabase } from '@/integrations/supabase/client';
import { formatCLP } from '@/lib/format';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2, PlusCircle, UserCheck, UserX, ChefHat, CheckCircle2, Truck, Receipt, Clock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

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
  callCount?: number;
}

interface OrderWithItems {
  id: string;
  order_number: number;
  status: string;
  total_amount: number;
  items: { menu_item_name: string; quantity: number }[];
}

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
  const [transferOpen, setTransferOpen] = useState(false);
  const [otherWaiters, setOtherWaiters] = useState<{ id: string; name: string }[]>([]);

  const fetchTables = async () => {
    const { data: tablesData } = await supabase
      .from('tables')
      .select('id, number, name, status, capacity, assigned_waiter_id')
      .eq('branch_id', branchId)
      .order('number');

    if (!tablesData) return;

    const occupiedIds = tablesData.filter(t => t.status === 'occupied' || t.status === 'waiting_bill').map(t => t.id);
    let sessionsMap: Record<string, { total: number; opened: string }> = {};
    const orderCountMap: Record<string, number> = {};
    let callCountMap: Record<string, number> = {};

    if (occupiedIds.length > 0) {
      const [{ data: sessions }, { data: orderCounts }, { data: waiterCallCounts }] = await Promise.all([
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
        supabase
          .from('waiter_calls')
          .select('table_id')
          .in('table_id', occupiedIds)
          .eq('status', 'pending'),
      ]);

      sessions?.forEach(s => {
        sessionsMap[s.table_id] = { total: s.total_amount ?? 0, opened: s.opened_at ?? '' };
      });
      orderCounts?.forEach(o => {
        orderCountMap[o.table_id] = (orderCountMap[o.table_id] ?? 0) + 1;
      });
      (waiterCallCounts ?? []).forEach(wc => {
        callCountMap[wc.table_id] = (callCountMap[wc.table_id] ?? 0) + 1;
      });
    }

    setTables(tablesData.map(t => ({
      ...t,
      sessionTotal: sessionsMap[t.id]?.total,
      sessionOpenedAt: sessionsMap[t.id]?.opened,
      activeOrders: orderCountMap[t.id] ?? 0,
      callCount: callCountMap[t.id] ?? 0,
    })));
    setLoading(false);
  };

  useEffect(() => {
    fetchTables();
    const channel = supabase
      .channel('mozo-tables')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tables', filter: `branch_id=eq.${branchId}` }, () => fetchTables())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `branch_id=eq.${branchId}` }, () => fetchTables())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [branchId]);

  const toggleAssignment = async (table: TableData) => {
    const isMyTable = table.assigned_waiter_id === staffId;
    setActionLoading(table.id);
    const { error } = await supabase
      .from('tables')
      .update({ assigned_waiter_id: isMyTable ? null : staffId })
      .eq('id', table.id);
    if (error) {
      toast({ title: 'Error al actualizar mesa', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: isMyTable ? 'Mesa liberada' : `Mesa ${table.number} tomada ✓` });
    }
    setActionLoading(null);
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
      .in('status', ['confirmed', 'in_kitchen', 'ready', 'delivered'])
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
    const now = new Date().toISOString();
    await supabase.from('tables').update({ status: 'free', assigned_waiter_id: null }).eq('id', selectedTable.id);
    await supabase.from('table_sessions').update({ is_active: false, closed_at: now }).eq('table_id', selectedTable.id).eq('is_active', true);
    await supabase.from('orders').update({ status: 'delivered', delivered_at: now }).eq('table_id', selectedTable.id).in('status', ['confirmed', 'in_kitchen', 'ready']);
    toast({ title: 'Mesa cerrada ✓' });
    setSheetOpen(false);
    setActionLoading(null);
    fetchTables();
  };

  const handleTransfer = async (table: TableData) => {
    setActionLoading('transfer');
    const { data } = await supabase
      .from('staff_users')
      .select('id, name')
      .eq('branch_id', branchId)
      .eq('is_active', true)
      .neq('id', staffId);
    setOtherWaiters(data ?? []);
    setActionLoading(null);
    setTransferOpen(true);
  };

  const confirmTransfer = async (newWaiterId: string) => {
    if (!selectedTable) return;
    await supabase
      .from('tables')
      .update({ assigned_waiter_id: newWaiterId })
      .eq('id', selectedTable.id);
    setTransferOpen(false);
    setSheetOpen(false);
    fetchTables();
    toast({ title: 'Mesa transferida' });
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  const myTables = tables.filter(t => t.assigned_waiter_id === staffId);
  const otherTables = tables.filter(t => t.assigned_waiter_id !== staffId);

  return (
    <div className="p-4 pb-24">
      <h2 className="text-lg font-bold text-foreground mb-1">Mis Mesas</h2>
      <p className="text-xs text-muted-foreground mb-3">Toca una mesa para ver detalles</p>

      {myTables.length === 0 ? (
        <div className="text-center py-8 mb-6 rounded-xl border-2 border-dashed border-border">
          <UserX className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No tienes mesas asignadas</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Toca "Tomar" en una mesa libre para asignártela</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 mb-6">
          {myTables.map(t => (
            <TableCard
              key={t.id}
              table={t}
              staffId={staffId}
              onTap={() => openSheet(t)}
              onToggle={() => toggleAssignment(t)}
              actionLoading={actionLoading}
            />
          ))}
        </div>
      )}

      <h2 className="text-sm font-bold text-muted-foreground mb-3 uppercase tracking-wide">Otras mesas</h2>
      <div className="grid grid-cols-2 gap-3">
        {otherTables.map(t => (
          <TableCard
            key={t.id}
            table={t}
            staffId={staffId}
            onTap={() => {
              const isActive = t.status === 'occupied' || t.status === 'waiting_bill';
              if (isActive) openSheet(t);
            }}
            onToggle={() => toggleAssignment(t)}
            actionLoading={actionLoading}
          />
        ))}
      </div>

      {/* Table detail sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="max-h-[85vh] rounded-t-2xl px-4 pb-8">
          <SheetHeader className="mb-4">
            <SheetTitle className="flex items-center gap-2">
              Mesa {selectedTable?.number}
              {selectedTable?.name && <span className="text-muted-foreground font-normal">· {selectedTable.name}</span>}
              {selectedTable?.status === 'waiting_bill' && <Badge variant="destructive" className="text-[10px]">🧾 Cuenta pedida</Badge>}
            </SheetTitle>
          </SheetHeader>

          {/* Session info */}
          {selectedTable?.sessionOpenedAt && (
            <div className="flex items-center gap-4 mb-4 p-3 rounded-lg bg-muted/50">
              <div className="flex items-center gap-1.5 text-sm">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <span className="text-muted-foreground">{minutesAgo(selectedTable.sessionOpenedAt)} min</span>
              </div>
              {selectedTable.sessionTotal !== undefined && (
                <div className="flex items-center gap-1.5 text-sm">
                  <Receipt className="w-4 h-4 text-muted-foreground" />
                  <span className="font-semibold">{formatCLP(selectedTable.sessionTotal)}</span>
                </div>
              )}
            </div>
          )}

          {ordersLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : orders.length === 0 ? (
            <p className="text-muted-foreground text-center py-8 text-sm">Sin pedidos</p>
          ) : (
            <div className="space-y-2 mb-6 max-h-[40vh] overflow-auto">
              {orders.map(o => (
                <div key={o.id} className={`rounded-lg p-3 border ${
                  o.status === 'confirmed' ? 'bg-red-50 border-red-200' :
                  o.status === 'in_kitchen' ? 'bg-amber-50 border-amber-200' :
                  o.status === 'ready' ? 'bg-green-50 border-green-200' :
                  'bg-muted/30 border-border'
                }`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-semibold">#{o.order_number}</span>
                    <Badge variant={
                      o.status === 'confirmed' ? 'destructive' :
                      o.status === 'ready' ? 'default' :
                      o.status === 'delivered' ? 'outline' :
                      'secondary'
                    } className="text-[10px]">
                      {o.status === 'delivered' ? '✓ Entregado' : ORDER_STATUS_LABELS[o.status] ?? o.status}
                    </Badge>
                  </div>
                  {o.items.map((it, idx) => (
                    <p key={idx} className="text-sm text-foreground">{it.quantity}× {it.menu_item_name}</p>
                  ))}
                  <p className="text-xs font-semibold mt-1">{formatCLP(o.total_amount)}</p>
                  {/* Actions: only for confirmed (send to kitchen) and ready (deliver) */}
                  {(o.status === 'confirmed' || o.status === 'ready') && (
                    <Button
                      size="sm"
                      className={`w-full mt-2 h-9 gap-1.5 ${
                        o.status === 'confirmed' ? '' : 'bg-green-600 hover:bg-green-700'
                      }`}
                      disabled={actionLoading === o.id}
                      onClick={() => handleOrderAction(o)}
                    >
                      {actionLoading === o.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : o.status === 'confirmed' ? (
                        <><ChefHat className="w-4 h-4" /> Enviar a cocina</>
                      ) : (
                        <><Truck className="w-4 h-4" /> Marcar entregado</>
                      )}
                    </Button>
                  )}
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
                Nuevo pedido
              </Button>
            )}
            {(selectedTable?.status === 'occupied' || selectedTable?.status === 'waiting_bill') && (
              <Button variant="destructive" className="w-full h-12" disabled={actionLoading === 'close'} onClick={closeTable}>
                {actionLoading === 'close' ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Cerrar mesa
              </Button>
            )}
            {selectedTable && selectedTable.assigned_waiter_id === staffId && (
              <button
                onClick={() => handleTransfer(selectedTable)}
                disabled={actionLoading === 'transfer'}
                className="w-full mt-2 py-3 rounded-xl text-sm font-semibold border border-border text-foreground flex items-center justify-center gap-2"
              >
                {actionLoading === 'transfer' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  '↔ Transferir a otro mozo'
                )}
              </button>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Transfer dialog */}
      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transferir Mesa {selectedTable?.number}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 mt-2">
            {otherWaiters.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No hay otros mozos disponibles</p>
            ) : (
              otherWaiters.map(w => (
                <button
                  key={w.id}
                  onClick={() => confirmTransfer(w.id)}
                  className="w-full rounded-xl border border-border p-3 text-left text-sm font-medium hover:bg-accent transition-colors"
                >
                  {w.name}
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ---- Table Card Component ---- */
function TableCard({
  table: t,
  staffId,
  onTap,
  onToggle,
  actionLoading,
}: {
  table: TableData;
  staffId: string;
  onTap: () => void;
  onToggle: () => void;
  actionLoading: string | null;
}) {
  const st = t.status ?? 'free';
  const isActive = st === 'occupied' || st === 'waiting_bill';
  const isMine = t.assigned_waiter_id === staffId;
  const assignedToOther = !!t.assigned_waiter_id && !isMine;

  const bgColor = st === 'free'
    ? 'bg-card border-border'
    : st === 'waiting_bill'
    ? 'bg-red-50 border-red-200'
    : 'bg-amber-50 border-amber-200';

  return (
    <div
      onClick={onTap}
      className={`rounded-xl border-2 p-3.5 transition-all relative cursor-pointer active:scale-[0.97] ${bgColor} ${isMine ? 'ring-2 ring-primary ring-offset-1' : ''}`}
    >
      {/* Waiter call badge */}
      {(t.callCount ?? 0) > 0 && (
        <span className="absolute top-2 left-2 bg-yellow-400 text-yellow-900 text-[10px] font-bold rounded-full px-1.5 py-0.5">
          🔔 {t.callCount}
        </span>
      )}

      <div className="flex items-start justify-between mb-1">
        <span className="text-2xl font-bold text-foreground">{t.number}</span>
        {st === 'waiting_bill' && <span className="text-lg">🧾</span>}
      </div>

      {t.name && <p className="text-xs truncate text-muted-foreground">{t.name}</p>}

      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        <Badge variant="outline" className="text-[10px] border-current">
          {STATUS_LABELS[st] ?? st}
        </Badge>
        {isActive && (t.activeOrders ?? 0) > 0 && (
          <Badge variant="destructive" className="text-[10px]">
            {t.activeOrders} pedido{(t.activeOrders ?? 0) > 1 ? 's' : ''}
          </Badge>
        )}
      </div>

      {isActive && t.sessionTotal !== undefined && (
        <p className="text-sm font-semibold mt-1.5">{formatCLP(t.sessionTotal)}</p>
      )}
      {isActive && t.sessionOpenedAt && (
        <p className="text-[11px] text-muted-foreground mt-0.5">{minutesAgo(t.sessionOpenedAt)} min</p>
      )}

      {/* Take/release button */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        disabled={assignedToOther || actionLoading === t.id}
        className={`mt-2 w-full flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-colors ${
          isMine
            ? 'bg-primary/10 text-primary border border-primary/20'
            : assignedToOther
            ? 'bg-muted text-muted-foreground cursor-not-allowed'
            : 'bg-muted/80 text-foreground hover:bg-muted border border-border'
        }`}
      >
        {actionLoading === t.id ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : isMine ? (
          <><UserCheck className="w-3.5 h-3.5" /> Mi mesa</>
        ) : assignedToOther ? (
          <><UserX className="w-3.5 h-3.5" /> Otro mozo</>
        ) : (
          <><UserCheck className="w-3.5 h-3.5" /> Tomar</>
        )}
      </button>
    </div>
  );
}
