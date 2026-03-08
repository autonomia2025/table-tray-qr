import { useEffect, useState, useRef } from 'react';
import { useWaiters } from '@/contexts/WaitersContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Bell, Receipt, ChefHat, Loader2 } from 'lucide-react';
import { formatCLP } from '@/lib/format';
import { motion, AnimatePresence } from 'framer-motion';

interface Notification {
  id: string;
  type: 'call' | 'bill' | 'order';
  tableNumber: number;
  createdAt: string;
  reason?: string;
  totalAmount?: number;
  tipAmount?: number;
  items?: { menu_item_name: string; quantity: number }[];
  orderNumber?: number;
}

function minutesAgo(d: string) {
  return Math.floor((Date.now() - new Date(d).getTime()) / 60000);
}

function playSound() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(660, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
  } catch {}
}

export default function MozoNotificacionesPage() {
  const { branchId } = useWaiters();
  const { toast } = useToast();
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const soundEnabled = useRef(false);

  const fetchAll = async () => {
    // Waiter calls
    const { data: calls } = await supabase
      .from('waiter_calls')
      .select('id, table_id, created_at, reason, status')
      .eq('branch_id', branchId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    // Bill requests
    const { data: bills } = await supabase
      .from('bill_requests')
      .select('id, table_id, requested_at, total_amount, tip_amount, status')
      .eq('branch_id', branchId)
      .eq('status', 'pending')
      .order('requested_at', { ascending: false });

    // Confirmed orders
    const { data: ordersData } = await supabase
      .from('orders')
      .select('id, table_id, confirmed_at, order_number, status')
      .eq('branch_id', branchId)
      .eq('status', 'confirmed')
      .order('confirmed_at', { ascending: false });

    // Get all table IDs to fetch numbers
    const allTableIds = new Set<string>();
    calls?.forEach(c => allTableIds.add(c.table_id));
    bills?.forEach(b => allTableIds.add(b.table_id));
    ordersData?.forEach(o => allTableIds.add(o.table_id));

    let tableMap: Record<string, number> = {};
    if (allTableIds.size > 0) {
      const { data: tables } = await supabase
        .from('tables')
        .select('id, number')
        .in('id', Array.from(allTableIds));
      tables?.forEach(t => { tableMap[t.id] = t.number; });
    }

    // Get order items for confirmed orders
    let orderItemsMap: Record<string, { menu_item_name: string; quantity: number }[]> = {};
    if (ordersData && ordersData.length > 0) {
      const { data: items } = await supabase
        .from('order_items')
        .select('order_id, menu_item_name, quantity')
        .in('order_id', ordersData.map(o => o.id));
      items?.forEach(i => {
        if (!orderItemsMap[i.order_id]) orderItemsMap[i.order_id] = [];
        orderItemsMap[i.order_id].push(i);
      });
    }

    const result: Notification[] = [
      ...(calls ?? []).map(c => ({
        id: c.id,
        type: 'call' as const,
        tableNumber: tableMap[c.table_id] ?? 0,
        createdAt: c.created_at ?? '',
        reason: c.reason ?? 'help',
      })),
      ...(bills ?? []).map(b => ({
        id: b.id,
        type: 'bill' as const,
        tableNumber: tableMap[b.table_id] ?? 0,
        createdAt: b.requested_at ?? '',
        totalAmount: b.total_amount,
        tipAmount: b.tip_amount ?? 0,
      })),
      ...(ordersData ?? []).map(o => ({
        id: o.id,
        type: 'order' as const,
        tableNumber: tableMap[o.table_id] ?? 0,
        createdAt: o.confirmed_at ?? '',
        orderNumber: o.order_number,
        items: orderItemsMap[o.id] ?? [],
      })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    setNotifs(result);
    setLoading(false);
  };

  useEffect(() => {
    fetchAll();

    const channel = supabase
      .channel('mozo-notifs')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'waiter_calls', filter: `branch_id=eq.${branchId}` }, () => { fetchAll(); if (soundEnabled.current) { playSound(); navigator.vibrate?.(200); } })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bill_requests', filter: `branch_id=eq.${branchId}` }, () => { fetchAll(); if (soundEnabled.current) { playSound(); navigator.vibrate?.(200); } })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders', filter: `branch_id=eq.${branchId}` }, () => { fetchAll(); if (soundEnabled.current) { playSound(); navigator.vibrate?.(200); } })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'waiter_calls', filter: `branch_id=eq.${branchId}` }, () => fetchAll())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bill_requests', filter: `branch_id=eq.${branchId}` }, () => fetchAll())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `branch_id=eq.${branchId}` }, () => fetchAll())
      .subscribe();

    // Enable sound on first user interaction
    const enableSound = () => { soundEnabled.current = true; };
    document.addEventListener('click', enableSound, { once: true });

    return () => {
      supabase.removeChannel(channel);
      document.removeEventListener('click', enableSound);
    };
  }, [branchId]);

  const handleAction = async (n: Notification) => {
    setActionLoading(n.id);
    try {
      if (n.type === 'call') {
        await supabase.from('waiter_calls').update({ status: 'attended' }).eq('id', n.id);
      } else if (n.type === 'bill') {
        await supabase.from('bill_requests').update({ status: 'attending', attended_at: new Date().toISOString() }).eq('id', n.id);
      } else if (n.type === 'order') {
        await supabase.from('orders').update({ status: 'in_kitchen', kitchen_accepted_at: new Date().toISOString() }).eq('id', n.id);
      }
      toast({ title: 'Atendido' });
      fetchAll();
    } finally {
      setActionLoading(null);
    }
  };

  const REASON_MAP: Record<string, string> = { help: 'Necesita ayuda', problem: 'Problema', change: 'Cambio' };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="p-4">
      <h2 className="text-lg font-bold text-foreground mb-4">Notificaciones</h2>
      {notifs.length === 0 ? (
        <div className="text-center py-16">
          <Bell className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-muted-foreground text-sm">Sin notificaciones pendientes</p>
        </div>
      ) : (
        <AnimatePresence mode="popLayout">
          <div className="space-y-3">
            {notifs.map(n => (
              <motion.div
                key={`${n.type}-${n.id}`}
                layout
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: 100 }}
                className="bg-card border border-border rounded-xl p-4"
              >
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                    n.type === 'call' ? 'bg-amber-100 text-amber-700'
                    : n.type === 'bill' ? 'bg-red-100 text-red-700'
                    : 'bg-blue-100 text-blue-700'
                  }`}>
                    {n.type === 'call' ? <Bell className="w-5 h-5" /> : n.type === 'bill' ? <Receipt className="w-5 h-5" /> : <ChefHat className="w-5 h-5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-foreground text-sm">
                      {n.type === 'call' ? `🛎 Mesa ${n.tableNumber} te llama`
                       : n.type === 'bill' ? `🧾 Mesa ${n.tableNumber} pide la cuenta`
                       : `🍳 Nuevo pedido - Mesa ${n.tableNumber}`}
                    </p>
                    {n.type === 'call' && n.reason && (
                      <p className="text-xs text-muted-foreground">{REASON_MAP[n.reason] ?? n.reason}</p>
                    )}
                    {n.type === 'bill' && (
                      <p className="text-xs text-muted-foreground">
                        Total: {formatCLP(n.totalAmount ?? 0)}
                        {(n.tipAmount ?? 0) > 0 && ` · Propina: ${formatCLP(n.tipAmount!)}`}
                      </p>
                    )}
                    {n.type === 'order' && n.items && n.items.length > 0 && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {n.items.slice(0, 3).map((it, i) => (
                          <span key={i}>{it.quantity}× {it.menu_item_name}{i < Math.min(n.items!.length, 3) - 1 ? ', ' : ''}</span>
                        ))}
                        {n.items.length > 3 && <span> +{n.items.length - 3} más</span>}
                      </div>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-1">
                      hace {minutesAgo(n.createdAt)} min
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  className="w-full mt-3 h-10"
                  disabled={actionLoading === n.id}
                  onClick={() => handleAction(n)}
                >
                  {actionLoading === n.id ? <Loader2 className="w-4 h-4 animate-spin" /> :
                    n.type === 'call' ? 'Atender' : n.type === 'bill' ? 'En camino' : 'Llevar a cocina'}
                </Button>
              </motion.div>
            ))}
          </div>
        </AnimatePresence>
      )}
    </div>
  );
}
