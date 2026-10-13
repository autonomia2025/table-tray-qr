import { useNavigate } from 'react-router-dom';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useWaiters } from '@/contexts/WaitersContext';
import { cambiarEstadoPedido } from '@/lib/pedidos';
import { supabase } from '@/integrations/supabase/client';
import { atenderLlamado, cerrarMesa, tomarMesa, transferirMesa } from "@/lib/mesa";
import { formatCLP } from '@/lib/format';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Clock, Receipt } from 'lucide-react';

interface TableData {
  id: string;
  number: number;
  name: string | null;
  status: string | null;
  capacity: number | null;
  assigned_waiter_id: string | null;
  hasNewOrder: boolean;
  hasReadyFood: boolean;
  hasBillRequest: boolean;
  hasWaiterCall: boolean;
  readyOrdersCount: number;
  sessionTotal: number;
  sessionOpenedAt: string | null;
  activeOrdersCount: number;
  /** Pedidos sin cobrar que en prepago esperan el pago para pasar a cocina. */
  porCobrar: number;
  /** Momentos clave de la mesa (ISO), para los cronómetros. */
  pedidoDesde: string | null;
  pagadoDesde: string | null;
  porCobrarDesde: string | null;
  listoDesde: string | null;
  llamadaDesde: string | null;
  cuentaDesde: string | null;
  tipAmount: number;
  tipPercentage: number;
}

interface OrderWithItems {
  id: string;
  order_number: number;
  status: string;
  total_amount: number;
  items: { menu_item_name: string; quantity: number }[];
}

/**
 * Estado de cada mesa para el mozo: un color, una etiqueta y un cronómetro.
 * En prepago y autoservicio lo principal es llevar a la mesa lo que la cocina dejó listo.
 */
type EstadoMesa = 'llamando' | 'listo' | 'cuenta' | 'por_cobrar' | 'cocina' | 'ocupada' | 'libre';

const ESTADOS: Record<EstadoMesa, {
  orden: number;
  etiqueta: string;
  cronometro: string;
  /** Minutos para pasar a amarillo y a rojo (null = sin alerta). */
  umbral: [number, number] | null;
  tarjeta: string;
  chip: string;
}> = {
  llamando: { orden: 1, etiqueta: '🔔 Llamando', cronometro: 'llamó hace', umbral: [2, 5],
    tarjeta: 'bg-red-50 dark:bg-red-950/40 border-l-4 border-red-500', chip: 'bg-red-600 text-white' },
  listo: { orden: 2, etiqueta: '✅ Listo para llevar', cronometro: 'listo hace', umbral: [3, 7],
    tarjeta: 'bg-emerald-50 dark:bg-emerald-950/40 border-l-4 border-emerald-500', chip: 'bg-emerald-600 text-white' },
  cuenta: { orden: 3, etiqueta: '🧾 Pide la cuenta', cronometro: 'pidió hace', umbral: [3, 8],
    tarjeta: 'bg-violet-50 dark:bg-violet-950/40 border-l-4 border-violet-500', chip: 'bg-violet-600 text-white' },
  por_cobrar: { orden: 4, etiqueta: '💳 Por cobrar', cronometro: 'esperando pago hace', umbral: [5, 10],
    tarjeta: 'bg-amber-50 dark:bg-amber-950/40 border-l-4 border-amber-500', chip: 'bg-amber-500 text-white' },
  cocina: { orden: 5, etiqueta: '🍳 En cocina', cronometro: 'pagado hace', umbral: [15, 25],
    tarjeta: 'bg-sky-50 dark:bg-sky-950/40 border-l-4 border-sky-500', chip: 'bg-sky-600 text-white' },
  ocupada: { orden: 6, etiqueta: 'Sentados', cronometro: 'hace', umbral: null,
    tarjeta: 'bg-card border border-border', chip: 'bg-muted text-muted-foreground' },
  libre: { orden: 7, etiqueta: 'Libre', cronometro: '', umbral: null,
    tarjeta: 'bg-card border border-dashed border-border opacity-70', chip: 'bg-muted text-muted-foreground' },
};

function estadoMesa(t: TableData): EstadoMesa {
  if (t.hasWaiterCall) return 'llamando';
  if (t.hasReadyFood) return 'listo';
  if (t.hasBillRequest) return 'cuenta';
  if (t.porCobrar > 0) return 'por_cobrar';
  if (t.activeOrdersCount > 0) return 'cocina';
  if (t.status === 'occupied' || t.status === 'waiting_bill') return 'ocupada';
  return 'libre';
}

/** Desde cuándo corre el cronómetro principal de la mesa. */
function inicioCronometro(t: TableData, e: EstadoMesa): string | null {
  switch (e) {
    case 'llamando': return t.llamadaDesde;
    case 'listo': return t.listoDesde;
    case 'cuenta': return t.cuentaDesde;
    case 'por_cobrar': return t.porCobrarDesde;
    case 'cocina': return t.pagadoDesde ?? t.pedidoDesde;
    case 'ocupada': return t.sessionOpenedAt;
    default: return null;
  }
}

function minutosDesde(fecha: string | null, ahora: number): number | null {
  if (!fecha) return null;
  return Math.max(0, Math.floor((ahora - new Date(fecha).getTime()) / 60000));
}

function textoMinutos(min: number): string {
  if (min < 1) return 'menos de 1 min';
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
}

/** Amarillo y luego rojo cuando una mesa espera demasiado. */
function colorCronometro(e: EstadoMesa, min: number | null): string {
  const u = ESTADOS[e].umbral;
  if (!u || min === null) return 'text-muted-foreground';
  if (min >= u[1]) return 'text-red-600 dark:text-red-400 font-bold';
  if (min >= u[0]) return 'text-amber-600 dark:text-amber-400 font-semibold';
  return 'text-muted-foreground';
}

function minutesAgo(dateStr: string) {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
}

function playAlert() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.setValueAtTime(880, ctx.currentTime);
    o.frequency.setValueAtTime(1100, ctx.currentTime + 0.1);
    g.gain.setValueAtTime(0.2, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    o.start(); o.stop(ctx.currentTime + 0.35);
  } catch { /* ignore */ }
}

export default function MozoMesasPage() {
  const navigate = useNavigate();
  const { branchId, staffId } = useWaiters();
  const { toast } = useToast();
  const [tables, setTables] = useState<TableData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTable, setSelectedTable] = useState<TableData | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [orders, setOrders] = useState<OrderWithItems[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [otherWaiters, setOtherWaiters] = useState<{ id: string; name: string }[]>([]);
  const [confirmBillTable, setConfirmBillTable] = useState<TableData | null>(null);
  const prevUrgentRef = useRef(0);

  const fetchTables = useCallback(async () => {
    const { data: tablesData } = await supabase
      .from('tables')
      .select('id, number, name, status, capacity, assigned_waiter_id')
      .eq('branch_id', branchId)
      .order('number');

    if (!tablesData) return;
    const { data: sucursal } = await supabase.from('branches').select('payment_mode').eq('id', branchId).maybeSingle();
    const prepago = sucursal?.payment_mode === 'prepaid';

    const occupiedIds = tablesData
      .filter(t => t.status === 'occupied' || t.status === 'waiting_bill')
      .map(t => t.id);

    const sessionsMap: Record<string, { total: number; opened: string }> = {};
    type Tiempos = { confirmed: number; ready: number; inKitchen: number; porCobrar: number;
      pedidoDesde: string | null; pagadoDesde: string | null; porCobrarDesde: string | null; listoDesde: string | null };
    const ordersMap: Record<string, Tiempos> = {};
    const llamadaDesde: Record<string, string> = {};
    const cuentaDesde: Record<string, string> = {};
    // El más antiguo gana: es el que lleva más rato esperando.
    const masAntiguo = (a: string | null, b: string | null | undefined) => (!b ? a : !a || b < a ? b : a);
    const billMap: Record<string, number> = {};
    const callMap: Record<string, number> = {};
    const tipMap: Record<string, { amount: number; percentage: number }> = {};

    if (occupiedIds.length > 0) {
      const [{ data: sessions }, { data: activeOrders }, { data: billReqs }, { data: waiterCalls }] = await Promise.all([
        supabase
          .from('table_sessions')
          .select('table_id, total_amount, opened_at')
          .in('table_id', occupiedIds)
          .eq('is_active', true),
        supabase
          .from('orders')
          .select('id, table_id, status, payment_status, confirmed_at, ready_at, source')
          .in('table_id', occupiedIds)
          .in('status', ['confirmed', 'in_kitchen', 'ready']),
        supabase
          .from('bill_requests')
          .select('id, table_id, status, tip_amount, tip_percentage, requested_at')
          .in('table_id', occupiedIds)
          .eq('status', 'pending'),
        supabase
          .from('waiter_calls')
          .select('id, table_id, status, created_at')
          .in('table_id', occupiedIds)
          .eq('status', 'pending'),
      ]);

      // Cuándo se pagó cada pedido (para el cronómetro "pagado hace").
      const idsPedidos = (activeOrders ?? []).map(o => o.id);
      const { data: pagos } = idsPedidos.length
        ? await supabase.from('payments').select('order_id, created_at').in('order_id', idsPedidos).eq('status', 'approved')
        : { data: [] as { order_id: string | null; created_at: string | null }[] };
      const pagadoEn: Record<string, string> = {};
      (pagos ?? []).forEach(p => { if (p.order_id && p.created_at) pagadoEn[p.order_id] = p.created_at; });

      sessions?.forEach(s => {
        sessionsMap[s.table_id] = { total: s.total_amount ?? 0, opened: s.opened_at ?? '' };
      });
      activeOrders?.forEach(o => {
        if (!ordersMap[o.table_id]) ordersMap[o.table_id] = { confirmed: 0, ready: 0, inKitchen: 0, porCobrar: 0,
          pedidoDesde: null, pagadoDesde: null, porCobrarDesde: null, listoDesde: null };
        const m = ordersMap[o.table_id];
        const pagado = o.payment_status === 'paid';
        m.pedidoDesde = masAntiguo(m.pedidoDesde, o.confirmed_at);
        // Pedido por QR en prepago: se paga en el mismo momento en que se pide.
        if (pagado) m.pagadoDesde = masAntiguo(m.pagadoDesde, pagadoEn[o.id] ?? o.confirmed_at);
        if (o.status === 'ready') m.listoDesde = masAntiguo(m.listoDesde, o.ready_at);
        if (prepago && o.status === 'confirmed' && !pagado) {
          m.porCobrar++;
          m.porCobrarDesde = masAntiguo(m.porCobrarDesde, o.confirmed_at);
        }
        if (o.status === 'confirmed') ordersMap[o.table_id].confirmed++;
        else if (o.status === 'ready') ordersMap[o.table_id].ready++;
        else if (o.status === 'in_kitchen') ordersMap[o.table_id].inKitchen++;
      });
      billReqs?.forEach(b => {
        billMap[b.table_id] = (billMap[b.table_id] ?? 0) + 1;
        tipMap[b.table_id] = { amount: b.tip_amount ?? 0, percentage: b.tip_percentage ?? 0 };
        cuentaDesde[b.table_id] = masAntiguo(cuentaDesde[b.table_id] ?? null, b.requested_at) ?? '';
      });
      waiterCalls?.forEach(wc => {
        callMap[wc.table_id] = (callMap[wc.table_id] ?? 0) + 1;
        llamadaDesde[wc.table_id] = masAntiguo(llamadaDesde[wc.table_id] ?? null, wc.created_at) ?? '';
      });
    }

    setTables(tablesData.map(t => {
      const om = ordersMap[t.id] ?? { confirmed: 0, ready: 0, inKitchen: 0, porCobrar: 0,
        pedidoDesde: null, pagadoDesde: null, porCobrarDesde: null, listoDesde: null };
      return {
        ...t,
        hasNewOrder: om.confirmed > 0 && !t.assigned_waiter_id,
        hasReadyFood: om.ready > 0,
        hasBillRequest: (billMap[t.id] ?? 0) > 0,
        hasWaiterCall: (callMap[t.id] ?? 0) > 0,
        readyOrdersCount: om.ready,
        sessionTotal: sessionsMap[t.id]?.total ?? 0,
        sessionOpenedAt: sessionsMap[t.id]?.opened ?? null,
        activeOrdersCount: om.confirmed + om.ready + om.inKitchen,
        porCobrar: om.porCobrar,
        pedidoDesde: om.pedidoDesde,
        pagadoDesde: om.pagadoDesde,
        porCobrarDesde: om.porCobrarDesde,
        listoDesde: om.listoDesde,
        llamadaDesde: llamadaDesde[t.id] || null,
        cuentaDesde: cuentaDesde[t.id] || null,
        tipAmount: tipMap[t.id]?.amount ?? 0,
        tipPercentage: tipMap[t.id]?.percentage ?? 0,
      };
    }));
    setLoading(false);
  }, [branchId]);

  useEffect(() => {
    fetchTables();
    const channel = supabase
      .channel('mozo-mesas-full')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tables', filter: `branch_id=eq.${branchId}` }, () => fetchTables())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `branch_id=eq.${branchId}` }, () => fetchTables())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bill_requests', filter: `branch_id=eq.${branchId}` }, () => fetchTables())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'waiter_calls', filter: `branch_id=eq.${branchId}` }, () => fetchTables())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_sessions', filter: `branch_id=eq.${branchId}` }, () => fetchTables())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [branchId, fetchTables]);

  // Aviso sonoro cuando aparece algo que hacer (llamado, comida lista, cuenta, cobro)
  useEffect(() => {
    const urgent = tables.filter(t => ESTADOS[estadoMesa(t)].orden <= 4).length;
    if (urgent > prevUrgentRef.current) playAlert();
    prevUrgentRef.current = urgent;
  }, [tables]);

  // Los cronómetros avanzan solos
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 20_000);
    return () => clearInterval(id);
  }, []);

  // --- Action handlers ---
  const handleTakeTable = async (tableId: string) => {
    setActionLoading(tableId);
    const r = await tomarMesa(tableId);
    fetchTables();
    if (r.ok === false) toast({ title: 'No se pudo tomar la mesa', description: r.error, variant: 'destructive' });
    else toast({ title: 'Mesa tomada' });
    setActionLoading(null);
  };

  const handleMarkDelivered = async (tableId: string) => {
    setActionLoading(tableId);
    // Entrega por el servidor los pedidos listos de la mesa (fase 1.4).
    const { data: listos } = await supabase.from('orders').select('id').eq('table_id', tableId).eq('status', 'ready');
    const resultados = await Promise.all((listos ?? []).map((o) => cambiarEstadoPedido(o.id, 'delivered')));
    fetchTables();
    const fallo = resultados.find((r) => r.ok === false);
    if (fallo && fallo.ok === false) toast({ title: 'No se pudo marcar entregado', description: fallo.error, variant: 'destructive' });
    else toast({ title: '✓ Entregado' });
    setActionLoading(null);
  };

  const handleAttendCall = async (tableId: string) => {
    setActionLoading(tableId);
    const { data: pendientes } = await supabase
      .from('waiter_calls')
      .select('id')
      .eq('table_id', tableId)
      .eq('status', 'pending');
    const resultados = await Promise.all((pendientes ?? []).map((l) => atenderLlamado(l.id)));
    fetchTables();
    const fallo = resultados.find((r) => r.ok === false);
    if (fallo && fallo.ok === false) toast({ title: 'No se pudo atender', description: fallo.error, variant: 'destructive' });
    else toast({ title: 'Llamada atendida' });
    setActionLoading(null);
  };

  const handleCloseBill = (table: TableData) => {
    setConfirmBillTable(table);
  };

  const executeCloseBill = async (table: TableData) => {
    setActionLoading(table.id);
    // El servidor cierra la sesión, entrega lo listo y libera la mesa (fase 1.5).
    const r = await cerrarMesa(table.id);
    setConfirmBillTable(null);
    fetchTables();
    if (r.ok === false) {
      toast({ title: 'No se pudo cerrar la mesa', description: r.error, variant: 'destructive' });
    } else {
      setSheetOpen(false);
      toast({ title: '✅ Mesa cerrada' });
    }
    setActionLoading(null);
  };

  // --- Sheet ---
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

  const handleTransfer = async () => {
    setActionLoading('transfer');
    const { data } = await supabase
      .from('staff_users')
      .select('id, name')
      .or(`branch_id.eq.${branchId},branch_id.is.null`)
      .in('role', ['waiter', 'manager', 'admin', 'owner'])
      .eq('is_active', true)
      .neq('id', staffId);
    setOtherWaiters(data ?? []);
    setActionLoading(null);
    setTransferOpen(true);
  };

  const confirmTransfer = async (newWaiterId: string) => {
    if (!selectedTable) return;
    const r = await transferirMesa(selectedTable.id, newWaiterId);
    setTransferOpen(false);
    fetchTables();
    if (r.ok === false) {
      toast({ title: 'No se pudo transferir', description: r.error, variant: 'destructive' });
    } else {
      setSheetOpen(false);
      toast({ title: 'Mesa transferida' });
    }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  // Primero lo más urgente; dentro de cada color, mis mesas y luego la que lleva más rato esperando.
  const conEstado = tables.map(t => {
    const e = estadoMesa(t);
    return { t, e, min: minutosDesde(inicioCronometro(t, e), ahora) };
  });
  const ordenadas = [...conEstado].sort((a, b) =>
    ESTADOS[a.e].orden - ESTADOS[b.e].orden
    || Number(b.t.assigned_waiter_id === staffId) - Number(a.t.assigned_waiter_id === staffId)
    || (b.min ?? -1) - (a.min ?? -1)
    || a.t.number - b.t.number);
  const cuenta = (e: EstadoMesa) => conEstado.filter(x => x.e === e).length;
  const estadoSeleccionado = selectedTable ? estadoMesa(selectedTable) : 'libre';
  const puedoCerrar = (t: TableData) => !t.assigned_waiter_id || t.assigned_waiter_id === staffId;

  return (
    <div className="p-4 pb-24">
      {/* Resumen por color: también sirve de leyenda */}
      <div className="flex flex-wrap gap-1.5 mb-4" aria-label="Resumen de mesas">
        {(Object.keys(ESTADOS) as EstadoMesa[]).filter(e => cuenta(e) > 0).map(e => (
          <span key={e} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${ESTADOS[e].chip}`}>
            {ESTADOS[e].etiqueta} · {cuenta(e)}
          </span>
        ))}
      </div>

      {/* Mesas */}
      <div className="grid grid-cols-2 gap-3">
        {ordenadas.map(({ t, e, min }) => {
          const est = ESTADOS[e];
          const isMine = t.assigned_waiter_id === staffId;
          const pidio = minutosDesde(t.pedidoDesde, ahora);
          const pago = minutosDesde(t.pagadoDesde, ahora);

          return (
            <div
              key={t.id}
              role="button"
              tabIndex={0}
              aria-label={`Mesa ${t.number}: ${est.etiqueta}`}
              onClick={() => openSheet(t)}
              onKeyDown={(ev) => { if (ev.key === 'Enter') openSheet(t); }}
              className={`rounded-xl p-3.5 transition-all relative min-h-[140px] flex flex-col cursor-pointer active:scale-[0.97] ${est.tarjeta}`}
            >
              {/* Número y marcas */}
              <div className="flex items-start justify-between">
                <span className="text-4xl font-black text-foreground leading-none">{t.number}</span>
                <div className="flex items-center gap-1">
                  {isMine && <Badge className="text-[9px] px-1.5 py-0 h-4 bg-primary text-primary-foreground">YO</Badge>}
                </div>
              </div>

              {/* Estado y cronómetro */}
              <div className="mt-2 flex-1 space-y-0.5">
                <p className="text-xs font-bold text-foreground">{est.etiqueta}</p>
                {e === 'listo' && t.readyOrdersCount > 1 && (
                  <p className="text-xs text-foreground">{t.readyOrdersCount} pedidos listos</p>
                )}
                {min !== null && est.cronometro && (
                  <p className={`text-xs tabular-nums ${colorCronometro(e, min)}`}>⏱ {est.cronometro} {textoMinutos(min)}</p>
                )}
                {pidio !== null && e !== 'cocina' && e !== 'por_cobrar' && (
                  <p className="text-[11px] text-muted-foreground tabular-nums">
                    Pidió hace {textoMinutos(pidio)}{pago !== null ? ` · pagó hace ${textoMinutos(pago)}` : ''}
                  </p>
                )}
                {e === 'cocina' && pidio !== null && pago !== null && pidio !== pago && (
                  <p className="text-[11px] text-muted-foreground tabular-nums">Pidió hace {textoMinutos(pidio)}</p>
                )}
              </div>

              {/* Acción principal de la tarjeta */}
              <div className="mt-auto pt-2 space-y-1.5">
                {t.sessionTotal > 0 && <p className="text-sm font-bold text-foreground">{formatCLP(t.sessionTotal)}</p>}
                {e === 'listo' && (
                  <Button
                    size="sm"
                    className="w-full h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                    disabled={actionLoading === t.id}
                    onClick={(ev) => { ev.stopPropagation(); handleMarkDelivered(t.id); }}
                  >
                    {actionLoading === t.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Entregado ✓'}
                  </Button>
                )}
                {e === 'llamando' && (
                  <Button
                    size="sm"
                    className="w-full h-8 text-xs bg-red-600 hover:bg-red-700 text-white"
                    disabled={actionLoading === t.id}
                    onClick={(ev) => { ev.stopPropagation(); handleAttendCall(t.id); }}
                  >
                    {actionLoading === t.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Voy en camino'}
                  </Button>
                )}
                {e === 'cuenta' && puedoCerrar(t) && (
                  <Button
                    size="sm"
                    className="w-full h-8 text-xs bg-violet-600 hover:bg-violet-700 text-white"
                    disabled={actionLoading === t.id}
                    onClick={(ev) => { ev.stopPropagation(); handleCloseBill(t); }}
                  >
                    {actionLoading === t.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Cobrar y cerrar mesa'}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Table detail sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="max-h-[85vh] rounded-t-2xl px-4 pb-8">
          <SheetHeader className="mb-4">
            <SheetTitle className="flex items-center gap-2">
              Mesa {selectedTable?.number}
              {selectedTable?.name && selectedTable.name !== `Mesa ${selectedTable.number}` && (
                <span className="text-muted-foreground font-normal">· {selectedTable.name}</span>
              )}
              {selectedTable?.hasBillRequest && <Badge variant="destructive" className="text-[10px]">🧾 Cuenta pedida</Badge>}
            </SheetTitle>
          </SheetHeader>

          {/* Session info */}
          {selectedTable?.sessionOpenedAt && (
            <div className="flex items-center gap-4 mb-4 p-3 rounded-lg bg-muted/50">
              <div className="flex items-center gap-1.5 text-sm">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <span className="text-muted-foreground">Sentados hace {textoMinutos(minutesAgo(selectedTable.sessionOpenedAt))}</span>
              </div>
              {selectedTable.sessionTotal > 0 && (
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
                  o.status === 'ready' ? 'bg-[#E8F5EE] dark:bg-[#1A6B45]/10 border-[#1A6B45]/20' :
                  o.status === 'in_kitchen' ? 'bg-[#FEF0E8] dark:bg-[#B87C10]/10 border-[#B87C10]/20' :
                  o.status === 'confirmed' ? 'bg-accent dark:bg-accent border-primary/20' :
                  'bg-muted/30 border-border'
                }`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-semibold">#{o.order_number}</span>
                    <Badge variant={
                      o.status === 'ready' ? 'default' :
                      o.status === 'delivered' ? 'outline' :
                      'secondary'
                    } className="text-[10px]">
                      {o.status === 'confirmed' ? 'Nuevo' :
                       o.status === 'in_kitchen' ? 'En cocina' :
                       o.status === 'ready' ? '✓ Listo' :
                       '✓ Entregado'}
                    </Badge>
                  </div>
                  {o.items.map((it, idx) => (
                    <p key={idx} className="text-sm text-foreground">{it.quantity}× {it.menu_item_name}</p>
                  ))}
                  <p className="text-xs font-semibold mt-1">{formatCLP(o.total_amount)}</p>
                </div>
              ))}
            </div>
          )}

          {/* Acciones: primero la del estado de la mesa; al final, las de respaldo */}
          <div className="space-y-2">
            {selectedTable && estadoSeleccionado === 'listo' && (
              <Button className="w-full h-12 bg-emerald-600 hover:bg-emerald-700 text-white" disabled={actionLoading === selectedTable.id} onClick={(e) => { e.stopPropagation(); handleMarkDelivered(selectedTable.id); }}>
                {actionLoading === selectedTable.id ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Entregado ✓
              </Button>
            )}
            {selectedTable && estadoSeleccionado === 'llamando' && (
              <Button className="w-full h-12 bg-red-600 hover:bg-red-700 text-white" disabled={actionLoading === selectedTable.id} onClick={(e) => { e.stopPropagation(); handleAttendCall(selectedTable.id); }}>
                {actionLoading === selectedTable.id ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Voy en camino
              </Button>
            )}
            {selectedTable && estadoSeleccionado === 'cuenta' && puedoCerrar(selectedTable) && (
              <Button className="w-full h-12 bg-violet-600 hover:bg-violet-700 text-white" disabled={actionLoading === selectedTable.id} onClick={() => handleCloseBill(selectedTable)}>
                {actionLoading === selectedTable.id ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Cobrar y cerrar mesa
              </Button>
            )}
            {selectedTable && !selectedTable.assigned_waiter_id && (
              <Button variant="outline" className="w-full h-11" disabled={actionLoading === selectedTable.id} onClick={() => handleTakeTable(selectedTable.id)}>
                Tomar mesa
              </Button>
            )}
            {/* Cerrar la mesa cuando los comensales se van (en prepago no se pide la cuenta). */}
            {selectedTable && estadoSeleccionado !== 'libre' && estadoSeleccionado !== 'cuenta' && puedoCerrar(selectedTable) && (
              <button
                onClick={() => handleCloseBill(selectedTable)}
                disabled={actionLoading === selectedTable.id}
                className="w-full py-3 rounded-xl text-sm font-semibold border border-border text-foreground flex items-center justify-center gap-2"
              >
                Cerrar mesa
              </button>
            )}
            {selectedTable && selectedTable.assigned_waiter_id === staffId && (
              <button
                onClick={() => handleTransfer()}
                disabled={actionLoading === 'transfer'}
                className="w-full py-3 rounded-xl text-sm font-semibold border border-border text-foreground flex items-center justify-center gap-2"
              >
                {actionLoading === 'transfer' ? <Loader2 className="w-4 h-4 animate-spin" /> : '↔ Transferir a otro mozo'}
              </button>
            )}

            {/* Respaldo: para quien prefiere pedir "a la antigua" (lo principal es que pidan y paguen con el QR) */}
            {selectedTable && puedoCerrar(selectedTable) && (
              <div className="pt-3 mt-1 border-t border-border">
                <button
                  onClick={() => navigate(`/mozo/pedido-manual/${selectedTable.id}`)}
                  className="w-full py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground flex flex-col items-center"
                >
                  <span>✍️ Tomar pedido a mano</span>
                  <span className="text-[11px] font-normal">Para quien prefiere pedirle al mozo</span>
                </button>
              </div>
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

      {/* Close bill confirmation dialog */}
      <Dialog open={!!confirmBillTable} onOpenChange={(open) => { if (!open) setConfirmBillTable(null); }}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>¿Cerrar mesa {confirmBillTable?.number}?</DialogTitle>
            <DialogDescription>
              Se cierra la sesión de la mesa, lo que esté listo se da por entregado y la mesa queda libre. Si hay pedidos sin pagar, no se podrá cerrar: cóbralos o pide a un encargado.
            </DialogDescription>
          </DialogHeader>

          {confirmBillTable && (
            <div className="rounded-xl bg-muted/50 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Total de la sesión</span>
                <span className="text-base font-bold text-foreground">
                  {confirmBillTable.sessionTotal !== undefined
                    ? formatCLP(confirmBillTable.sessionTotal)
                    : '—'}
                </span>
              </div>
              {confirmBillTable.tipAmount > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Propina {confirmBillTable.tipPercentage > 0 ? `(${confirmBillTable.tipPercentage}%)` : ''}
                  </span>
                  <span className="text-base font-bold text-green-600">
                    {formatCLP(confirmBillTable.tipAmount)}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Mesa</span>
                <span className="text-sm font-medium text-foreground">Mesa {confirmBillTable.number}</span>
              </div>
            </div>
          )}

          <DialogFooter className="flex-row gap-2 sm:flex-row">
            <button
              onClick={() => setConfirmBillTable(null)}
              className="flex-1 rounded-xl border border-border py-3 text-sm font-semibold text-foreground hover:bg-muted transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={() => confirmBillTable && executeCloseBill(confirmBillTable)}
              className="flex-1 rounded-xl py-3 text-sm font-bold text-white transition-colors"
              style={{ backgroundColor: '#E8531D' }}
            >
              Sí, cerrar mesa
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
