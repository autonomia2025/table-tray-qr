import { useNavigate } from 'react-router-dom';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useWaiters } from '@/contexts/WaitersContext';
import { cambiarEstadoPedido, registrarCobroMozo, type MetodoCobroLocal } from '@/lib/pedidos';
import { marcarBoleta, misBoletasPendientes, MEDIO_COBRO, type BoletaPendiente } from '@/lib/boletas';
import { supabase } from '@/integrations/supabase/client';
import { atenderLlamado, cerrarMesa, separarMesa, tomarMesa, transferirMesa, unirMesas } from "@/lib/mesa";
import { formatCLP } from '@/lib/format';
import { abrirTurno, duracion, useMiTurno } from '@/lib/turnos';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import PremiosMesa from '@/components/mozo/PremiosMesa';
import { textoPedido } from '@/lib/estados';
import { PORCENTAJES_PROPINA, montoPropina } from '@/lib/propina';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Clock, Receipt } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { usePermiso } from '@/hooks/usePermiso';

interface TableData {
  id: string;
  number: number;
  name: string | null;
  status: string | null;
  capacity: number | null;
  assigned_waiter_id: string | null;
  /** Si está unida a otra mesa (grupo grande), la principal (fase 3.5). */
  unida_a: string | null;
  hasNewOrder: boolean;
  hasReadyFood: boolean;
  hasBillRequest: boolean;
  hasWaiterCall: boolean;
  readyOrdersCount: number;
  /** Estaciones que ya dejaron algo listo (la barra no espera a la cocina) y si falta algo más. */
  estacionesListas: string[];
  listoParcial: boolean;
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
  payment_status: string | null;
  /** 'dividido' (fase 7.4b): cada persona paga su parte con la app; el mozo no lo cobra. */
  forma_pago?: string | null;
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

/** Tiempos objetivo del local (fase 3.3): Sucursal → Tiempos objetivo. */
interface Objetivos { llamado: number; retiro: number; pedido: number }
const OBJETIVOS_POR_DEFECTO: Objetivos = { llamado: 2, retiro: 5, pedido: 20 };

/** Semáforo: ámbar al pasar el objetivo del local, rojo al doble. */
function umbral(e: EstadoMesa, o: Objetivos): [number, number] | null {
  if (e === 'llamando') return [o.llamado, o.llamado * 2];
  if (e === 'listo') return [o.retiro, o.retiro * 2];
  if (e === 'cocina') return [o.pedido, Math.round(o.pedido * 1.5)];
  return ESTADOS[e].umbral;
}

/** Amarillo y luego rojo cuando una mesa espera demasiado. */
function colorCronometro(e: EstadoMesa, min: number | null, o: Objetivos): string {
  const u = umbral(e, o);
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
  const { branchId, staffId, tenantId } = useWaiters();
  const puede = usePermiso(tenantId);
  const { turno, cargando: cargandoTurno, recargar: recargarTurno } = useMiTurno(branchId);
  const [abriendoTurno, setAbriendoTurno] = useState(false);
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
  const [codigos, setCodigos] = useState<Record<string, string>>({});
  const [unirOpen, setUnirOpen] = useState(false);
  const [confirmBillTable, setConfirmBillTable] = useState<TableData | null>(null);
  // Cobro en la mesa (fase 2.B): efectivo, POS o transferencia; en efectivo y transferencia, la boleta (fase 4.3)
  const [cobro, setCobro] = useState<{ metodo: MetodoCobroLocal; propina: string; recibido: string; boleta: boolean; folio: string } | null>(null);
  const [cobroLocal, setCobroLocal] = useState<{ recordarBoleta: boolean; datosTransferencia: string | null }>({ recordarBoleta: true, datosTransferencia: null });
  const [boletas, setBoletas] = useState<BoletaPendiente[]>([]);
  const cargarBoletas = useCallback(() => { misBoletasPendientes().then(setBoletas); }, []);
  const prevUrgentRef = useRef(0);
  const [objetivos, setObjetivos] = useState<Objetivos>(OBJETIVOS_POR_DEFECTO);
  const prevOlvidadasRef = useRef(0);
  useEffect(() => {
    if (!branchId) return;
    supabase.from('branches').select('objetivo_llamado_min, objetivo_retiro_min, objetivo_pedido_min, recordar_boleta, datos_transferencia').eq('id', branchId).maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        setObjetivos({ llamado: data.objetivo_llamado_min, retiro: data.objetivo_retiro_min, pedido: data.objetivo_pedido_min });
        setCobroLocal({ recordarBoleta: data.recordar_boleta, datosTransferencia: data.datos_transferencia });
      });
    cargarBoletas();
  }, [branchId, cargarBoletas]);

  const fetchTables = useCallback(async () => {
    const { data: tablesData } = await supabase
      .from('tables')
      .select('id, number, name, status, capacity, assigned_waiter_id, unida_a')
      .eq('branch_id', branchId)
      .order('number');

    if (!tablesData) return;
    // Código de presencia de cada mesa (el mozo se lo dice al cliente que no lo encuentra)
    const { data: cods } = await supabase.from('codigos_mesa').select('table_id, codigo').eq('branch_id', branchId);
    setCodigos(Object.fromEntries((cods ?? []).map(c => [c.table_id, c.codigo])));
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
    // Productos listos por mesa (fase 3.2): cada estación avanza por su cuenta
    const listosPorMesa: Record<string, { cantidad: number; desde: string | null; estaciones: Set<string>; parcial: boolean }> = {};

    if (occupiedIds.length > 0) {
      const [{ data: sessions }, { data: activeOrders }, { data: billReqs }, { data: waiterCalls }] = await Promise.all([
        supabase
          .from('table_sessions')
          .select('table_id, total_amount, opened_at')
          .in('table_id', occupiedIds)
          .eq('is_active', true),
        supabase
          .from('orders')
          .select('id, table_id, status, payment_status, confirmed_at, ready_at, paid_at, forma_pago')
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
        // La hora de pago la escribe el servidor (orders.paid_at); el mozo no ve los pagos (datos del cliente).
        if (pagado) m.pagadoDesde = masAntiguo(m.pagadoDesde, o.paid_at ?? o.confirmed_at);
        if (o.status === 'ready') m.listoDesde = masAntiguo(m.listoDesde, o.ready_at);
        if (prepago && o.status === 'confirmed' && !pagado && o.forma_pago !== 'dividido') {
          m.porCobrar++;
          m.porCobrarDesde = masAntiguo(m.porCobrarDesde, o.confirmed_at);
        }
        if (o.status === 'confirmed') ordersMap[o.table_id].confirmed++;
        else if (o.status === 'ready') ordersMap[o.table_id].ready++;
        else if (o.status === 'in_kitchen') ordersMap[o.table_id].inKitchen++;
      });
      const idsActivos = (activeOrders ?? []).map(o => o.id);
      if (idsActivos.length > 0) {
        const [{ data: itemsListos }, { data: estaciones }] = await Promise.all([
          supabase.from('order_items').select('order_id, status, ready_at, station_id').in('order_id', idsActivos).in('status', ['confirmed', 'in_kitchen', 'ready']),
          supabase.from('stations').select('id, name').eq('branch_id', branchId).eq('is_active', true),
        ]);
        const nombre = new Map((estaciones ?? []).map(e => [e.id, e.name]));
        const mesaDe = new Map((activeOrders ?? []).map(o => [o.id, o.table_id]));
        for (const it of itemsListos ?? []) {
          const mesa = mesaDe.get(it.order_id)!;
          const l = listosPorMesa[mesa] ??= { cantidad: 0, desde: null, estaciones: new Set(), parcial: false };
          if (it.status === 'ready') {
            l.cantidad++;
            l.desde = masAntiguo(l.desde, it.ready_at);
            if ((estaciones ?? []).length > 1 && it.station_id && nombre.get(it.station_id)) l.estaciones.add(nombre.get(it.station_id)!);
          } else {
            l.parcial = true;
          }
        }
      }
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
        hasReadyFood: om.ready > 0 || (listosPorMesa[t.id]?.cantidad ?? 0) > 0,
        hasBillRequest: (billMap[t.id] ?? 0) > 0,
        hasWaiterCall: (callMap[t.id] ?? 0) > 0,
        readyOrdersCount: om.ready,
        estacionesListas: [...(listosPorMesa[t.id]?.estaciones ?? [])],
        listoParcial: (listosPorMesa[t.id]?.cantidad ?? 0) > 0 && !!listosPorMesa[t.id]?.parcial,
        sessionTotal: sessionsMap[t.id]?.total ?? 0,
        sessionOpenedAt: sessionsMap[t.id]?.opened ?? null,
        activeOrdersCount: om.confirmed + om.ready + om.inKitchen,
        porCobrar: om.porCobrar,
        pedidoDesde: om.pedidoDesde,
        pagadoDesde: om.pagadoDesde,
        porCobrarDesde: om.porCobrarDesde,
        listoDesde: masAntiguo(om.listoDesde, listosPorMesa[t.id]?.desde),
        llamadaDesde: llamadaDesde[t.id] || null,
        cuentaDesde: cuentaDesde[t.id] || null,
        tipAmount: tipMap[t.id]?.amount ?? 0,
        tipPercentage: tipMap[t.id]?.percentage ?? 0,
      };
    }));
    setLoading(false);
    recargarTurno(); // un pago nuevo en una de mis mesas suma a mis propinas
  }, [branchId, recargarTurno]);

  useEffect(() => {
    fetchTables();
    // Con mucho movimiento llegan varios avisos por segundo: se juntan en una sola recarga (fase 5.3)
    let espera: ReturnType<typeof setTimeout> | null = null;
    const pronto = () => {
      if (espera) return;
      espera = setTimeout(() => { espera = null; fetchTables(); }, 800);
    };
    const channel = supabase
      .channel('mozo-mesas-full')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tables', filter: `branch_id=eq.${branchId}` }, pronto)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `branch_id=eq.${branchId}` }, pronto)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bill_requests', filter: `branch_id=eq.${branchId}` }, pronto)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'waiter_calls', filter: `branch_id=eq.${branchId}` }, pronto)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_sessions', filter: `branch_id=eq.${branchId}` }, pronto)
      .subscribe();
    // Si un aviso en vivo se pierde (corte de red o un peak), la pantalla se pone al día sola
    const respaldo = setInterval(() => { if (document.visibilityState === 'visible') pronto(); }, 20_000);
    const alMirar = () => { if (document.visibilityState === 'visible') pronto(); };
    document.addEventListener('visibilitychange', alMirar);
    window.addEventListener('online', pronto);
    return () => {
      supabase.removeChannel(channel);
      if (espera) clearTimeout(espera);
      clearInterval(respaldo);
      document.removeEventListener('visibilitychange', alMirar);
      window.removeEventListener('online', pronto);
    };
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

  // Suena otra vez cuando algo listo pasa el tiempo objetivo sin que nadie lo lleve (fase 3.3)
  useEffect(() => {
    const n = tables.filter(t => estadoMesa(t) === 'listo'
      && (!t.assigned_waiter_id || t.assigned_waiter_id === staffId)
      && (minutosDesde(inicioCronometro(t, 'listo'), ahora) ?? -1) >= objetivos.retiro).length;
    if (n > prevOlvidadasRef.current) playAlert();
    prevOlvidadasRef.current = n;
  }, [tables, ahora, objetivos, staffId]);

  // --- Action handlers ---
  const handleTakeTable = async (tableId: string) => {
    setActionLoading(tableId);
    const r = await tomarMesa(tableId);
    fetchTables(); // también refresca el turno: tomar una mesa sin turno lo abre solo
    if (r.ok === false) toast({ title: 'No se pudo tomar la mesa', description: r.error, variant: 'destructive' });
    else toast({ title: 'Mesa tomada' });
    setActionLoading(null);
  };

  const handleMarkDelivered = async (tableId: string) => {
    setActionLoading(tableId);
    // Entrega por el servidor los pedidos listos de la mesa (fase 1.4).
    // (con estaciones, un pedido puede tener la cerveza lista y la comida en cocina: el mozo lleva lo listo)
    const { data: activos } = await supabase.from('orders').select('id').eq('table_id', tableId).in('status', ['confirmed', 'in_kitchen', 'ready']);
    const { data: conListos } = await supabase.from('order_items').select('order_id').in('order_id', (activos ?? []).map((o) => o.id)).eq('status', 'ready');
    const listos = [...new Set((conListos ?? []).map((i) => i.order_id))];
    const resultados = await Promise.all(listos.map((id) => cambiarEstadoPedido(id, 'delivered')));
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
      .select('id, order_number, status, total_amount, payment_status, forma_pago')
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
  // Alerta de abandono: algo listo de mis mesas (o sin mozo) que nadie lleva hace más del objetivo
  const olvidadas = conEstado.filter(x => x.e === 'listo' && x.min !== null && x.min >= objetivos.retiro
    && (!x.t.assigned_waiter_id || x.t.assigned_waiter_id === staffId));
  const estadoSeleccionado = selectedTable ? estadoMesa(selectedTable) : 'libre';
  const puedoCerrar = (t: TableData) => !t.assigned_waiter_id || t.assigned_waiter_id === staffId;

  const empezarTurno = async () => {
    setAbriendoTurno(true);
    const r = await abrirTurno(branchId);
    setAbriendoTurno(false);
    if (r.ok === false) { toast({ title: 'No se pudo empezar el turno', description: r.error, variant: 'destructive' }); return; }
    toast({ title: '¡Turno empezado!', description: 'Las propinas de tus mesas se anotan a tu nombre.' });
    recargarTurno();
  };

  return (
    <div className="p-4 pb-24">
      {/* Turno: la propina es del mozo que tomó la mesa */}
      {!cargandoTurno && (turno ? (
        <button
          type="button"
          onClick={() => navigate('/mozo/perfil')}
          className="mb-3 flex w-full items-center justify-between gap-2 rounded-2xl border border-emerald-500/40 bg-emerald-50 px-3.5 py-2.5 text-left dark:bg-emerald-950/40"
        >
          <span className="flex min-w-0 items-center gap-2 text-sm text-foreground">
            <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden />
            <span className="truncate">
              <span className="font-bold">En turno</span> desde {new Date(turno.inicio).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })} · {duracion(turno.minutos)}
            </span>
          </span>
          <span className="shrink-0 text-sm font-bold text-foreground">Propinas {formatCLP(turno.propinas)}</span>
        </button>
      ) : (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border bg-card p-3.5">
          <div className="min-w-0">
            <p className="text-sm font-bold text-foreground">No has empezado tu turno</p>
            <p className="text-xs text-muted-foreground">Las propinas de las mesas que tomes se anotan a tu nombre.</p>
          </div>
          <Button size="sm" className="h-10 shrink-0" onClick={empezarTurno} disabled={abriendoTurno}>
            {abriendoTurno ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Empezar turno'}
          </Button>
        </div>
      ))}

      {/* Alerta de abandono: lo listo no puede esperar */}
      {olvidadas.length > 0 && (
        <div role="alert" className="mb-3 rounded-2xl border border-destructive/50 bg-destructive/10 p-3">
          <p className="text-sm font-bold text-destructive">⚠ Hay pedidos listos esperando</p>
          {olvidadas.slice(0, 3).map(({ t, min }) => (
            <p key={t.id} className="text-sm text-foreground">Mesa {t.number}: listo hace {textoMinutos(min)} (objetivo {objetivos.retiro} min)</p>
          ))}
        </div>
      )}

      {/* Boletas por entregar: lo cobrado en efectivo o transferencia sin boleta marcada (fase 4.3) */}
      {boletas.length > 0 && (
        <div className="mb-3 rounded-2xl border border-amber-400/60 bg-amber-50 p-3 dark:bg-amber-950/40" aria-labelledby="boletas-pendientes">
          <p id="boletas-pendientes" className="flex items-center gap-1.5 text-sm font-bold text-foreground">
            <Receipt className="h-4 w-4" aria-hidden /> Boletas por entregar · {boletas.length}
          </p>
          <ul className="mt-2 space-y-1.5">
            {boletas.slice(0, 4).map(b => (
              <li key={b.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate text-foreground">
                  {b.mesa !== null ? `Mesa ${b.mesa}` : 'Cobro'} · {formatCLP(b.monto)} · <span className="text-muted-foreground">{MEDIO_COBRO[b.metodo]}</span>
                </span>
                <Button size="sm" variant="outline" className="h-9 shrink-0" disabled={actionLoading === `boleta-${b.id}`}
                  onClick={async () => {
                    setActionLoading(`boleta-${b.id}`);
                    const r = await marcarBoleta(b.id);
                    setActionLoading(null);
                    if (r.ok === false) { toast({ title: 'No se pudo marcar', description: r.error, variant: 'destructive' }); return; }
                    cargarBoletas();
                  }}>
                  {actionLoading === `boleta-${b.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Ya la entregué'}
                </Button>
              </li>
            ))}
          </ul>
          {boletas.length > 4 && <p className="mt-1 text-xs text-muted-foreground">y {boletas.length - 4} más</p>}
        </div>
      )}

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
              className={`rounded-xl p-3.5 transition-all relative min-h-[140px] flex flex-col cursor-pointer active:scale-[0.97] ${est.tarjeta} ${olvidadas.some(x => x.t.id === t.id) ? 'ring-2 ring-destructive' : ''}`}
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
                {e === 'listo' && (t.estacionesListas.length > 0 || t.listoParcial) && (
                  <p className="text-xs text-foreground">
                    {t.estacionesListas.length > 0 ? `Listo en ${t.estacionesListas.join(' y ')}` : 'Una parte está lista'}
                    {t.listoParcial ? ' · lo demás sigue en preparación' : ''}
                  </p>
                )}
                {t.unida_a && (
                  <p className="text-xs font-semibold text-muted-foreground">🔗 Unida a la mesa {tables.find(x => x.id === t.unida_a)?.number}</p>
                )}
                {tables.some(x => x.unida_a === t.id) && (
                  <p className="text-xs font-semibold text-foreground">🔗 Con mesa {tables.filter(x => x.unida_a === t.id).map(x => x.number).join(' y ')}</p>
                )}
                {min !== null && est.cronometro && (
                  <p className={`text-xs tabular-nums ${colorCronometro(e, min, objetivos)}`}>⏱ {est.cronometro} {textoMinutos(min)}</p>
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
                {e === 'por_cobrar' && puedoCerrar(t) && puede('cobrar') && (
                  <Button
                    size="sm"
                    className="w-full h-8 text-xs bg-amber-500 hover:bg-amber-600 text-white"
                    onClick={(ev) => { ev.stopPropagation(); openSheet(t); }}
                  >
                    Cobrar
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
              {selectedTable && codigos[selectedTable.id] && (
                <span className="ml-auto rounded-lg bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground" title="Código de presencia: el cliente lo ingresa para pedir sin pagar">
                  Código {codigos[selectedTable.id]}
                </span>
              )}
            </SheetTitle>
          </SheetHeader>

          {/* Premios de lealtad de los clientes de la mesa (fase 3.7) */}
          {selectedTable && sheetOpen && <PremiosMesa key={selectedTable.id} mesaId={selectedTable.id} />}

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
                      {['ready', 'delivered'].includes(o.status) ? `✓ ${textoPedido(o.status)}` : textoPedido(o.status)}
                    </Badge>
                  </div>
                  {o.items.map((it, idx) => (
                    <p key={idx} className="text-sm text-foreground">{it.quantity}× {it.menu_item_name}</p>
                  ))}
                  <p className="text-xs font-semibold mt-1">{formatCLP(o.total_amount)}</p>
                  {o.forma_pago === 'dividido' && o.payment_status !== 'paid' && (
                    <p className="mt-1 text-xs text-muted-foreground">🍽️ Plato dividido: cada uno paga su parte con la app. Pasa a cocina cuando esté todo pagado.</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Por cobrar: pedidos que se pagan al mozo (efectivo, POS o transferencia) */}
          {(() => {
            const pendientes = orders.filter(o => o.payment_status !== 'paid' && o.payment_status !== 'refunded' && o.status !== 'cancelled' && o.forma_pago !== 'dividido');
            if (!selectedTable || pendientes.length === 0) return null;
            const totalPendiente = pendientes.reduce((acc, o) => acc + o.total_amount, 0);
            return (
              <div className="mb-4 rounded-xl border border-amber-400/60 bg-amber-50 p-3 dark:bg-amber-950/40">
                <p className="text-sm font-bold text-foreground">💳 Por cobrar: {formatCLP(totalPendiente)}</p>
                <p className="mb-2 text-xs text-muted-foreground">
                  {pendientes.length} pedido{pendientes.length > 1 ? 's' : ''} · en prepago pasan a cocina al registrar el cobro
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {([['cash', '💵 Efectivo'], ['pos', '💳 POS'], ['transfer', '📲 Transferencia']] as const).map(([metodo, texto]) => (
                    <Button key={metodo} className="h-11 bg-amber-500 px-1 text-xs text-white hover:bg-amber-600 sm:text-sm"
                      onClick={() => setCobro({ metodo, propina: '', recibido: '', boleta: false, folio: '' })}>
                      {texto}
                    </Button>
                  ))}
                </div>
              </div>
            );
          })()}

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

            {/* Grupos grandes: unir mesas o separarlas (fase 3.5) */}
            {selectedTable && selectedTable.unida_a && (
              <button
                onClick={async () => {
                  const r = await separarMesa(selectedTable.id);
                  fetchTables();
                  if (r.ok === false) toast({ title: 'No se pudo separar', description: r.error, variant: 'destructive' });
                  else { setSheetOpen(false); toast({ title: `Mesa ${selectedTable.number} separada` }); }
                }}
                className="w-full py-3 rounded-xl text-sm font-semibold border border-border text-foreground"
              >
                ✂️ Separar de la mesa {tables.find(x => x.id === selectedTable.unida_a)?.number}
              </button>
            )}
            {selectedTable && !selectedTable.unida_a && puedoCerrar(selectedTable) && (
              <button
                onClick={() => setUnirOpen(true)}
                className="w-full py-3 rounded-xl text-sm font-semibold border border-border text-foreground"
              >
                🔗 Unir con otra mesa
              </button>
            )}

            {/* Respaldo: para quien prefiere pedir "a la antigua" (lo principal es que pidan y paguen con el QR) */}
            {selectedTable && puedoCerrar(selectedTable) && puede('tomar_pedidos') && (
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

      {/* Registrar un cobro en efectivo, POS o transferencia */}
      <Dialog open={!!cobro} onOpenChange={(o) => { if (!o) setCobro(null); }}>
        <DialogContent className="rounded-2xl">
          {(() => {
            if (!cobro || !selectedTable) return null;
            const pendientes = orders.filter(o => o.payment_status !== 'paid' && o.payment_status !== 'refunded' && o.status !== 'cancelled' && o.forma_pago !== 'dividido');
            const totalPendiente = pendientes.reduce((acc, o) => acc + o.total_amount, 0);
            const propina = Math.max(0, Math.round(Number(cobro.propina) || 0));
            const recibido = cobro.recibido ? Math.round(Number(cobro.recibido) || 0) : null;
            const vuelto = recibido !== null ? recibido - totalPendiente - propina : null;
            const pideBoleta = cobroLocal.recordarBoleta && cobro.metodo !== 'pos';
            const registrar = async () => {
              setActionLoading('cobro');
              const r = await registrarCobroMozo(pendientes.map(o => o.id), cobro.metodo, propina, cobro.metodo === 'cash' ? recibido : null,
                pideBoleta ? { entregada: cobro.boleta, folio: cobro.folio } : undefined);
              setActionLoading(null);
              if (r.ok === false) {
                toast({ title: 'No se pudo registrar el cobro', description: r.error, variant: 'destructive' });
                return;
              }
              toast({
                title: `✅ Cobrado ${formatCLP(r.total + propina)}`,
                description: r.boleta === 'pendiente'
                  ? 'Recuerda entregar la boleta: queda en "Boletas por entregar".'
                  : r.vuelto !== null && r.vuelto > 0 ? `Vuelto: ${formatCLP(r.vuelto)}` : 'Los pedidos pasan a cocina.',
              });
              setCobro(null);
              cargarBoletas();
              openSheet(selectedTable);
              fetchTables();
            };
            return (
              <>
                <DialogHeader>
                  <DialogTitle>{cobro.metodo === 'cash' ? '💵 Cobro en efectivo' : cobro.metodo === 'pos' ? '💳 Cobro con POS' : '📲 Cobro por transferencia'} · Mesa {selectedTable.number}</DialogTitle>
                  <DialogDescription>Total de los pedidos: {formatCLP(totalPendiente)}</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-muted-foreground" htmlFor="cobro-propina">Propina (la ley pide sugerir al menos 10%; el cliente decide)</label>
                    <div className="mb-1.5 mt-1 flex gap-1.5">
                      {PORCENTAJES_PROPINA.map((pct) => {
                        const monto = montoPropina({ tipo: 'pct', pct }, totalPendiente);
                        return (
                          <button key={pct} type="button" onClick={() => setCobro({ ...cobro, propina: String(monto) })}
                            className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-semibold ${Number(cobro.propina) === monto ? 'border-primary bg-accent text-foreground' : 'border-border text-muted-foreground'}`}>
                            {pct}% · {formatCLP(monto)}
                          </button>
                        );
                      })}
                    </div>
                    <Input id="cobro-propina" type="number" inputMode="numeric" placeholder="$0 (sin propina)" value={cobro.propina}
                      onChange={(e) => setCobro({ ...cobro, propina: e.target.value })} />
                  </div>
                  {cobro.metodo === 'cash' && (
                    <div>
                      <label className="text-xs text-muted-foreground" htmlFor="cobro-recibido">Recibido en efectivo (opcional)</label>
                      <Input id="cobro-recibido" type="number" inputMode="numeric" placeholder={String(totalPendiente + propina)} value={cobro.recibido}
                        onChange={(e) => setCobro({ ...cobro, recibido: e.target.value })} />
                      {vuelto !== null && (
                        <p className={`mt-1 text-sm font-semibold ${vuelto < 0 ? 'text-destructive' : 'text-foreground'}`}>
                          {vuelto < 0 ? `Faltan ${formatCLP(-vuelto)}` : `Vuelto: ${formatCLP(vuelto)}`}
                        </p>
                      )}
                    </div>
                  )}
                  {cobro.metodo === 'transfer' && (
                    <div className="rounded-xl border bg-muted/40 p-3 text-sm">
                      <p className="font-semibold text-foreground">Datos para transferir</p>
                      {cobroLocal.datosTransferencia
                        ? <p className="mt-1 whitespace-pre-line text-foreground">{cobroLocal.datosTransferencia}</p>
                        : <p className="mt-1 text-muted-foreground">El local no ha anotado sus datos. Pídeselos al encargado.</p>}
                      <p className="mt-2 text-xs text-muted-foreground">Registra el cobro cuando veas que la transferencia llegó.</p>
                    </div>
                  )}
                  <p className="text-base font-bold">Total a cobrar: {formatCLP(totalPendiente + propina)}</p>
                  {pideBoleta && (
                    <div className="rounded-xl border p-3">
                      <label htmlFor="cobro-boleta" className="flex items-center justify-between gap-3">
                        <span>
                          <span className="block text-sm font-semibold text-foreground">Entregué la boleta</span>
                          <span className="block text-xs text-muted-foreground">La del sistema del local, por {formatCLP(totalPendiente)} (la propina no va en la boleta)</span>
                        </span>
                        <Switch id="cobro-boleta" checked={cobro.boleta} onCheckedChange={(v) => setCobro({ ...cobro, boleta: v })} />
                      </label>
                      {cobro.boleta && (
                        <Input className="mt-2" aria-label="Número de boleta (opcional)" placeholder="N° de boleta (opcional)" maxLength={40}
                          value={cobro.folio} onChange={(e) => setCobro({ ...cobro, folio: e.target.value })} />
                      )}
                      {!cobro.boleta && <p className="mt-2 text-xs text-muted-foreground">Si aún no la entregas, te la recordamos arriba en tus mesas.</p>}
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button className="h-12 w-full" disabled={actionLoading === 'cobro' || (vuelto !== null && vuelto < 0)} onClick={registrar}>
                    {actionLoading === 'cobro' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Registrar cobro
                  </Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

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

      {/* Unir mesas: la elegida se suma a esta (sus clientes, pedidos y pagos pasan a esta mesa) */}
      <Dialog open={unirOpen} onOpenChange={setUnirOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unir con la mesa {selectedTable?.number}</DialogTitle>
            <DialogDescription>Para grupos grandes. La mesa que elijas pasa a ser parte de la {selectedTable?.number}: quien escanee su QR entra a esta mesa. Cada persona sigue pagando lo suyo.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-4 gap-2 mt-2">
            {selectedTable && tables
              .filter(x => x.id !== selectedTable.id && !x.unida_a && !tables.some(y => y.unida_a === x.id)
                && (!x.assigned_waiter_id || x.assigned_waiter_id === staffId))
              .map(x => (
                <button
                  key={x.id}
                  onClick={async () => {
                    const r = await unirMesas(selectedTable.id, x.id);
                    setUnirOpen(false);
                    fetchTables();
                    if (r.ok === false) toast({ title: 'No se pudo unir', description: r.error, variant: 'destructive' });
                    else { setSheetOpen(false); toast({ title: `Mesas ${r.datos.principal} y ${r.datos.secundaria} unidas` }); }
                  }}
                  aria-label={`Unir la mesa ${x.number}`}
                  className="rounded-xl border border-border py-3 text-lg font-bold text-foreground hover:bg-accent"
                >
                  {x.number}
                </button>
              ))}
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
