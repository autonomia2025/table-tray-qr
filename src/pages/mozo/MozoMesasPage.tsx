import { useEffect, useState } from 'react';
import { useWaiters } from '@/contexts/WaitersContext';
import { supabase } from '@/integrations/supabase/client';
import { formatCLP } from '@/lib/format';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2, X, PlusCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface TableData {
  id: string;
  number: number;
  name: string | null;
  status: string | null;
  capacity: number | null;
  sessionTotal?: number;
  sessionOpenedAt?: string;
}

interface OrderWithItems {
  id: string;
  order_number: number;
  status: string | null;
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

function minutesAgo(dateStr: string) {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
}

export default function MozoMesasPage() {
  const { branchId, tenantId } = useWaiters();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [tables, setTables] = useState<TableData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTable, setSelectedTable] = useState<TableData | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [orders, setOrders] = useState<OrderWithItems[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchTables = async () => {
    const { data: tablesData } = await supabase
      .from('tables')
      .select('id, number, name, status, capacity')
      .eq('branch_id', branchId)
      .order('number');

    if (!tablesData) return;

    // Get active sessions for occupied tables
    const occupiedIds = tablesData.filter(t => t.status === 'occupied' || t.status === 'waiting_bill').map(t => t.id);
    let sessionsMap: Record<string, { total: number; opened: string }> = {};

    if (occupiedIds.length > 0) {
      const { data: sessions } = await supabase
        .from('table_sessions')
        .select('table_id, total_amount, opened_at')
        .in('table_id', occupiedIds)
        .eq('is_active', true);

      if (sessions) {
        sessions.forEach(s => {
          sessionsMap[s.table_id] = { total: s.total_amount ?? 0, opened: s.opened_at ?? '' };
        });
      }
    }

    setTables(tablesData.map(t => ({
      ...t,
      sessionTotal: sessionsMap[t.id]?.total,
      sessionOpenedAt: sessionsMap[t.id]?.opened,
    })));
    setLoading(false);
  };

  useEffect(() => {
    fetchTables();

    const channel = supabase
      .channel('mozo-tables')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tables', filter: `branch_id=eq.${branchId}` }, () => fetchTables())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [branchId]);

  const openSheet = async (table: TableData) => {
    setSelectedTable(table);
    setSheetOpen(true);
    setOrdersLoading(true);

    // Get active session
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
      items: (items ?? []).filter(i => i.order_id === o.id),
    })));
    setOrdersLoading(false);
  };

  const updateOrderStatus = async (ids: string[], newStatus: string, extra: Record<string, any> = {}) => {
    setActionLoading(true);
    for (const id of ids) {
      await supabase.from('orders').update({ status: newStatus, ...extra }).eq('id', id);
    }
    toast({ title: 'Actualizado', description: `Pedido(s) → ${newStatus}` });
    if (selectedTable) openSheet(selectedTable);
    setActionLoading(false);
  };

  const closeTable = async () => {
    if (!selectedTable) return;
    setActionLoading(true);
    await supabase.from('tables').update({ status: 'free' }).eq('id', selectedTable.id);
    await supabase.from('table_sessions').update({ is_active: false, closed_at: new Date().toISOString() }).eq('table_id', selectedTable.id).eq('is_active', true);
    toast({ title: 'Mesa cerrada' });
    setSheetOpen(false);
    setActionLoading(false);
    fetchTables();
  };

  const confirmedOrders = orders.filter(o => o.status === 'confirmed');
  const inKitchenOrders = orders.filter(o => o.status === 'in_kitchen');
  const readyOrders = orders.filter(o => o.status === 'ready');

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="p-4">
      <h2 className="text-lg font-bold text-foreground mb-4">Mesas</h2>
      <div className="grid grid-cols-2 gap-3">
        {tables.map(t => {
          const st = t.status ?? 'free';
          const colors = STATUS_COLORS[st] ?? STATUS_COLORS.free;
          const isActive = st === 'occupied' || st === 'waiting_bill';
          return (
            <button
              key={t.id}
              onClick={() => isActive ? openSheet(t) : undefined}
              disabled={!isActive}
              className={`rounded-xl border-2 p-4 text-left transition-all ${colors} ${isActive ? 'active:scale-95' : 'opacity-80'}`}
            >
              <div className="flex items-start justify-between">
                <span className="text-2xl font-bold">{t.number}</span>
                {st === 'waiting_bill' && <span className="text-base">🧾</span>}
              </div>
              {t.name && <p className="text-xs mt-0.5 truncate opacity-70">{t.name}</p>}
              <Badge variant="outline" className="mt-2 text-[10px] border-current">
                {STATUS_LABELS[st] ?? st}
              </Badge>
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
          </SheetHeader>

          {ordersLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : orders.length === 0 ? (
            <p className="text-muted-foreground text-center py-8 text-sm">Sin pedidos activos</p>
          ) : (
            <div className="space-y-3 mb-6 max-h-[40vh] overflow-auto">
              {orders.map(o => (
                <div key={o.id} className="bg-muted/50 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-semibold">Pedido #{o.order_number}</span>
                    <Badge variant={o.status === 'confirmed' ? 'destructive' : o.status === 'ready' ? 'default' : 'secondary'} className="text-[10px]">
                      {o.status === 'confirmed' ? 'Nuevo' : o.status === 'in_kitchen' ? 'Cocina' : 'Listo'}
                    </Badge>
                  </div>
                  {o.items.map((it, idx) => (
                    <p key={idx} className="text-sm text-foreground">{it.quantity}× {it.menu_item_name}</p>
                  ))}
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2">
            {confirmedOrders.length > 0 && (
              <Button
                className="w-full h-12"
                disabled={actionLoading}
                onClick={() => updateOrderStatus(confirmedOrders.map(o => o.id), 'in_kitchen', { kitchen_accepted_at: new Date().toISOString() })}
              >
                Llevar a cocina ({confirmedOrders.length})
              </Button>
            )}
            {inKitchenOrders.length > 0 && (
              <Button
                className="w-full h-12 bg-green-600 hover:bg-green-700"
                disabled={actionLoading}
                onClick={() => updateOrderStatus(inKitchenOrders.map(o => o.id), 'ready', { ready_at: new Date().toISOString() })}
              >
                Marcar como listo ({inKitchenOrders.length})
              </Button>
            )}
            {readyOrders.length > 0 && (
              <Button
                className="w-full h-12 bg-green-800 hover:bg-green-900"
                disabled={actionLoading}
                onClick={() => updateOrderStatus(readyOrders.map(o => o.id), 'delivered', { delivered_at: new Date().toISOString() })}
              >
                Entregar pedido ({readyOrders.length})
              </Button>
            )}
            {(selectedTable?.status === 'occupied' || selectedTable?.status === 'waiting_bill') && (
              <Button variant="destructive" className="w-full h-12 mt-4" disabled={actionLoading} onClick={closeTable}>
                Cerrar mesa
              </Button>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
