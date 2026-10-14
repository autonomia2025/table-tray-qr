import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAdmin } from "@/contexts/AdminContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle, CheckCircle2, Download, Lock, RefreshCw, Undo2, Loader2 } from "lucide-react";
import { formatCLP } from "@/lib/format";
import { exportToCSV } from "@/lib/export-utils";
import { cerrarCaja, resumenCaja, type ResumenCaja } from "@/lib/caja";

interface PaymentRow {
  id: string;
  created_at: string;
  amount: number;
  tip_amount: number;
  refunded_amount: number;
  method: string;
  status: string;
  external_reference: string | null;
  customer_email: string | null;
  table_id: string | null;
  settlement_id: string | null;
}

interface RefundRow {
  id: string;
  created_at: string;
  amount: number;
  reason: string;
  authorized_by_name: string | null;
  payment_id: string;
}

interface SettlementRow {
  id: string;
  settlement_date: string;
  total_neto: number;
  diferencia_efectivo: number | null;
  diferencia_pos: number | null;
  payments_count: number;
  status: string;
  notes: string | null;
  closed_by_name: string | null;
}

const METHOD_LABELS: Record<string, string> = {
  apple_pay: "Apple Pay",
  google_pay: "Google Pay",
  card: "Tarjeta",
  cash: "Efectivo",
  pos: "POS",
};

const STATUS_LABELS: Record<string, string> = {
  approved: "Aprobado",
  pending: "Pendiente",
  failed: "Rechazado",
  refunded: "Reembolsado",
  partially_refunded: "Reemb. parcial",
};

// Monto escrito por la caja (solo dígitos; vacío = no anotado).
const leerMonto = (texto: string) => (texto.trim() === "" ? null : parseInt(texto.replace(/\D/g, ""), 10) || 0);

function Diferencia({ valor }: { valor: number | null }) {
  if (valor === null) return <span className="text-muted-foreground">—</span>;
  if (valor === 0) {
    return (
      <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="h-4 w-4" /> Cuadra
      </span>
    );
  }
  return (
    <span className="font-bold text-destructive">
      {valor > 0 ? "Sobran " : "Faltan "}{formatCLP(Math.abs(valor))}
    </span>
  );
}

// Lo que conviene revisar antes de cerrar (no impide cerrar).
function AvisosCierre({ resumen }: { resumen: ResumenCaja }) {
  const { avisos } = resumen;
  const lista: string[] = [];
  if (avisos.por_cobrar.cantidad) {
    lista.push(`${avisos.por_cobrar.cantidad} ${avisos.por_cobrar.cantidad === 1 ? "pedido" : "pedidos"} sin cobrar (${formatCLP(avisos.por_cobrar.monto)}): cóbralos o anúlalos antes de cerrar.`);
  }
  if (avisos.sin_confirmar.cantidad) {
    lista.push(`${avisos.sin_confirmar.cantidad} ${avisos.sin_confirmar.cantidad === 1 ? "pago quedó" : "pagos quedaron"} sin confirmar por la pasarela (${formatCLP(avisos.sin_confirmar.monto)}).`);
  }
  if (avisos.con_alerta) {
    lista.push(`${avisos.con_alerta} ${avisos.con_alerta === 1 ? "pedido pagado tiene" : "pedidos pagados tienen"} un aviso (por ejemplo, un producto agotado).`);
  }
  if (avisos.mesas_abiertas) {
    lista.push(`${avisos.mesas_abiertas} ${avisos.mesas_abiertas === 1 ? "mesa sigue abierta" : "mesas siguen abiertas"}.`);
  }
  if (!lista.length) return null;
  return (
    <div className="mb-4 rounded-2xl border border-amber-400/60 bg-amber-50 p-4 dark:bg-amber-950/40">
      <p className="mb-1 flex items-center gap-2 text-sm font-bold text-foreground">
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" /> Antes de cerrar, revisa
      </p>
      <ul className="list-disc space-y-0.5 pl-6 text-sm text-foreground">
        {lista.map((t) => <li key={t}>{t}</li>)}
      </ul>
    </div>
  );
}

export default function CajaPage() {
  const { tenantId, branchId } = useAdmin();
  const { toast } = useToast();

  // El día de negocio (por defecto, el de hoy según la hora de corte de la sucursal).
  const [date, setDate] = useState<string | null>(null);
  const [resumen, setResumen] = useState<ResumenCaja | null>(null);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [refunds, setRefunds] = useState<RefundRow[]>([]);
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [tableMap, setTableMap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState("");
  const [efectivoContado, setEfectivoContado] = useState("");
  const [posContado, setPosContado] = useState("");
  const [confirmarCierre, setConfirmarCierre] = useState(false);
  const [cerrando, setCerrando] = useState(false);

  const [refundTarget, setRefundTarget] = useState<PaymentRow | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [refunding, setRefunding] = useState(false);

  const load = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    const r = await resumenCaja(branchId, date);
    if (r.ok === false) {
      setLoading(false);
      toast({ title: "No se pudo cargar la caja", description: r.error, variant: "destructive" });
      return;
    }
    setResumen(r.resumen);
    const dia = r.resumen.dia;
    if (!date) setDate(dia);

    const [{ data: pays }, { data: refs }, { data: setts }, { data: tabs }] = await Promise.all([
      supabase
        .from("payments")
        .select("id, created_at, amount, tip_amount, refunded_amount, method, status, external_reference, customer_email, table_id, settlement_id")
        .eq("branch_id", branchId)
        .eq("dia_negocio", dia)
        .order("created_at", { ascending: false }),
      // Los reembolsos cuentan el día en que se devolvió la plata.
      supabase
        .from("refunds")
        .select("id, created_at, amount, reason, authorized_by_name, payment_id, payments!inner(branch_id)")
        .eq("payments.branch_id", branchId)
        .eq("dia_negocio", dia)
        .eq("status", "completed")
        .order("created_at", { ascending: false }),
      supabase
        .from("payment_settlements")
        .select("id, settlement_date, total_neto, diferencia_efectivo, diferencia_pos, payments_count, status, notes, closed_by_name")
        .eq("branch_id", branchId)
        .order("settlement_date", { ascending: false })
        .limit(30),
      supabase.from("tables").select("id, number").eq("branch_id", branchId),
    ]);

    const paymentRows = (pays ?? []) as PaymentRow[];
    setPayments(paymentRows);
    setRefunds((refs ?? []) as RefundRow[]);
    setSettlements((setts ?? []) as SettlementRow[]);
    setTableMap(Object.fromEntries((tabs ?? []).map((t) => [t.id, t.number])));
    setLoading(false);
  }, [branchId, date, toast]);

  useEffect(() => { load(); }, [load]);

  const kpis = useMemo(() => {
    const approved = payments.filter((p) => p.status === "approved" || p.status === "partially_refunded");
    const net = approved.reduce((s, p) => s + p.amount - Math.min(p.refunded_amount, p.amount), 0);
    const tips = approved.reduce((s, p) => s + p.tip_amount, 0);
    const byMethod: Record<string, number> = {};
    for (const p of approved) {
      byMethod[p.method] = (byMethod[p.method] || 0) + p.amount + p.tip_amount - p.refunded_amount;
    }
    const refunded = payments.reduce((s, p) => s + p.refunded_amount, 0);
    return {
      net,
      tips,
      count: approved.length,
      avg: approved.length ? Math.round(net / approved.length) : 0,
      byMethod,
      refunded,
    };
  }, [payments]);

  // Un día cerrado queda bloqueado: se muestra lo que quedó guardado al cerrar.
  const diaCerrado = !!resumen?.cerrado;
  const efectivo = diaCerrado ? resumen?.cierre?.efectivo_contado ?? null : leerMonto(efectivoContado);
  const pos = diaCerrado ? resumen?.cierre?.pos_contado ?? null : leerMonto(posContado);
  const difEfectivo = resumen && efectivo !== null ? efectivo - resumen.efectivo.esperado : null;
  const difPos = resumen && pos !== null ? pos - resumen.pos.esperado : null;
  const noCuadra = (difEfectivo ?? 0) !== 0 || (difPos ?? 0) !== 0;
  const faltaNota = noCuadra && notes.trim().length < 5;

  const cerrar = async () => {
    if (!resumen || efectivo === null) return;
    setCerrando(true);
    const r = await cerrarCaja(branchId, resumen.dia, efectivo, pos, notes);
    setCerrando(false);
    setConfirmarCierre(false);
    if (r.ok === false) {
      toast({ title: "No se pudo cerrar la caja", description: r.error, variant: "destructive" });
      return;
    }
    toast({ title: "Caja cerrada", description: "El cierre quedó guardado y ya no se puede cambiar." });
    setEfectivoContado("");
    setPosContado("");
    setNotes("");
    load();
  };

  const doRefund = async () => {
    if (!refundTarget) return;
    setRefunding(true);
    const { data, error } = await supabase.functions.invoke("refund-payment", {
      body: {
        payment_id: refundTarget.id,
        amount: refundAmount ? parseInt(refundAmount, 10) : undefined,
        reason: refundReason,
      },
    });
    setRefunding(false);
    if (error || data?.error) {
      toast({ title: "No se pudo reembolsar", description: data?.error ?? "Revisa el monto y el motivo", variant: "destructive" });
      return;
    }
    toast({ title: "Reembolso registrado" });
    setRefundTarget(null);
    setRefundAmount("");
    setRefundReason("");
    load();
  };

  const exportPayments = () => {
    exportToCSV(
      payments.map((p) => ({
        Fecha: new Date(p.created_at).toLocaleString("es-CL"),
        Mesa: p.table_id ? tableMap[p.table_id] ?? "" : "",
        Metodo: METHOD_LABELS[p.method] ?? p.method,
        Consumo: p.amount,
        Propina: p.tip_amount,
        Reembolsado: p.refunded_amount,
        Estado: STATUS_LABELS[p.status] ?? p.status,
        Comprobante: p.external_reference ?? "",
        Email: p.customer_email ?? "",
      })),
      `caja-${resumen?.dia ?? date}`,
    );
  };

  if (!tenantId) return null;

  return (
    <div className="max-w-5xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Caja</h2>
          <p className="text-sm text-muted-foreground">
            Ingresos, cierre del día y reembolsos
            {resumen && <> · el día parte a las {new Date(resumen.desde).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", timeZone: "America/Santiago" })} y termina a la misma hora del día siguiente</>}
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <Label htmlFor="dia-caja" className="text-xs">Día de negocio</Label>
            <Input id="dia-caja" type="date" value={date ?? ""} onChange={(e) => e.target.value && setDate(e.target.value)} className="h-9 w-40" />
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <Tabs defaultValue="ingresos">
        <TabsList className="mb-4">
          <TabsTrigger value="ingresos">Ingresos</TabsTrigger>
          <TabsTrigger value="conciliacion">Cierre de caja</TabsTrigger>
          <TabsTrigger value="reembolsos">Reembolsos</TabsTrigger>
        </TabsList>

        {/* ---------- INGRESOS ---------- */}
        <TabsContent value="ingresos">
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Ventas pagadas</p>
              <p className="text-xl font-bold text-foreground">{formatCLP(kpis.net)}</p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Propinas</p>
              <p className="text-xl font-bold text-foreground">{formatCLP(kpis.tips)}</p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Ticket promedio</p>
              <p className="text-xl font-bold text-foreground">{formatCLP(kpis.avg)}</p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Pagos</p>
              <p className="text-xl font-bold text-foreground">{kpis.count}</p>
            </CardContent></Card>
          </div>

          <Card className="mb-4">
            <CardHeader className="pb-2"><CardTitle className="text-base">Por método</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-4">
              {Object.keys(kpis.byMethod).length === 0 && (
                <p className="text-sm text-muted-foreground">Sin pagos en este día.</p>
              )}
              {Object.entries(kpis.byMethod).map(([m, v]) => (
                <div key={m}>
                  <p className="text-xs text-muted-foreground">{METHOD_LABELS[m] ?? m}</p>
                  <p className="text-base font-bold text-foreground">{formatCLP(v)}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="mb-2 flex justify-end">
            <Button variant="outline" size="sm" onClick={exportPayments} disabled={!payments.length}>
              <Download className="mr-1 h-4 w-4" /> Exportar CSV
            </Button>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Hora</TableHead>
                <TableHead>Mesa</TableHead>
                <TableHead>Método</TableHead>
                <TableHead className="text-right">Consumo</TableHead>
                <TableHead className="text-right">Propina</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{new Date(p.created_at).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}</TableCell>
                  <TableCell>{p.table_id ? tableMap[p.table_id] ?? "—" : "—"}</TableCell>
                  <TableCell>{METHOD_LABELS[p.method] ?? p.method}</TableCell>
                  <TableCell className="text-right">{formatCLP(p.amount)}</TableCell>
                  <TableCell className="text-right">{formatCLP(p.tip_amount)}</TableCell>
                  <TableCell>
                    <Badge variant={p.status === "approved" ? "default" : p.status === "failed" ? "destructive" : "secondary"}>
                      {STATUS_LABELS[p.status] ?? p.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {(p.status === "approved" || p.status === "partially_refunded") && (
                      <Button size="sm" variant="ghost" onClick={() => { setRefundTarget(p); setRefundAmount(""); setRefundReason(""); }}>
                        <Undo2 className="mr-1 h-4 w-4" /> Reembolsar
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!payments.length && !loading && (
                <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground">Sin pagos este día</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </TabsContent>

        {/* ---------- CIERRE DE CAJA ---------- */}
        <TabsContent value="conciliacion">
          {resumen && (
            <>
              {diaCerrado && resumen.cierre && (
                <div className="mb-4 flex items-start gap-3 rounded-2xl border bg-muted p-4">
                  <Lock className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                  <div className="text-sm">
                    <p className="font-bold text-foreground">Caja cerrada · no se puede cambiar</p>
                    <p className="text-muted-foreground">
                      Cerró {resumen.cierre.cerrado_por ?? "la caja"} el{" "}
                      {new Date(resumen.cierre.cerrado_at).toLocaleString("es-CL", { timeZone: "America/Santiago", dateStyle: "short", timeStyle: "short" })}
                    </p>
                    {resumen.cierre.notas && <p className="mt-1 text-foreground">“{resumen.cierre.notas}”</p>}
                  </div>
                </div>
              )}

              {!diaCerrado && (
                <AvisosCierre resumen={resumen} />
              )}

              <Card className="mb-4">
                <CardHeader className="pb-2">
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    Cuadre del {new Date(`${resumen.dia}T12:00:00`).toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long" })}
                    {diaCerrado ? <Badge variant="secondary">🔒 Cerrado</Badge> : <Badge variant="outline">Abierto</Badge>}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Tablio suma lo cobrado y resta los reembolsos. Anota lo que contaste en el cajón y en el POS: la diferencia se calcula sola.
                  </p>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Medio</TableHead>
                          <TableHead className="text-right">Cobrado</TableHead>
                          <TableHead className="text-right">Reembolsos</TableHead>
                          <TableHead className="text-right">Debería haber</TableHead>
                          <TableHead className="text-right">Contado</TableHead>
                          <TableHead className="text-right">Diferencia</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        <TableRow>
                          <TableCell className="font-medium">App (tarjeta, Apple y Google Pay)</TableCell>
                          <TableCell className="text-right tabular-nums">{formatCLP(resumen.app.cobrado)}</TableCell>
                          <TableCell className="text-right tabular-nums">{resumen.app.devuelto ? `−${formatCLP(resumen.app.devuelto)}` : "—"}</TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">{formatCLP(resumen.app.esperado)}</TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">Lo deposita la pasarela</TableCell>
                          <TableCell className="text-right"><Diferencia valor={0} /></TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium">Efectivo</TableCell>
                          <TableCell className="text-right tabular-nums">{formatCLP(resumen.efectivo.cobrado)}</TableCell>
                          <TableCell className="text-right tabular-nums">{resumen.efectivo.devuelto ? `−${formatCLP(resumen.efectivo.devuelto)}` : "—"}</TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">{formatCLP(resumen.efectivo.esperado)}</TableCell>
                          <TableCell className="text-right">
                            {diaCerrado ? (
                              <span className="tabular-nums">{efectivo !== null ? formatCLP(efectivo) : "—"}</span>
                            ) : (
                              <Input
                                inputMode="numeric"
                                aria-label="Efectivo contado"
                                placeholder="$0"
                                value={efectivoContado}
                                onChange={(e) => setEfectivoContado(e.target.value.replace(/\D/g, ""))}
                                className="ml-auto h-9 w-32 text-right tabular-nums"
                              />
                            )}
                          </TableCell>
                          <TableCell className="text-right"><Diferencia valor={difEfectivo} /></TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium">POS</TableCell>
                          <TableCell className="text-right tabular-nums">{formatCLP(resumen.pos.cobrado)}</TableCell>
                          <TableCell className="text-right tabular-nums">{resumen.pos.devuelto ? `−${formatCLP(resumen.pos.devuelto)}` : "—"}</TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">{formatCLP(resumen.pos.esperado)}</TableCell>
                          <TableCell className="text-right">
                            {diaCerrado ? (
                              <span className="tabular-nums">{pos !== null ? formatCLP(pos) : "—"}</span>
                            ) : (
                              <Input
                                inputMode="numeric"
                                aria-label="POS contado"
                                placeholder="Opcional"
                                value={posContado}
                                onChange={(e) => setPosContado(e.target.value.replace(/\D/g, ""))}
                                className="ml-auto h-9 w-32 text-right tabular-nums"
                              />
                            )}
                          </TableCell>
                          <TableCell className="text-right"><Diferencia valor={difPos} /></TableCell>
                        </TableRow>
                        <TableRow className="bg-muted/50">
                          <TableCell className="font-bold">Total del día</TableCell>
                          <TableCell className="text-right font-bold tabular-nums">{formatCLP(resumen.app.cobrado + resumen.efectivo.cobrado + resumen.pos.cobrado)}</TableCell>
                          <TableCell className="text-right font-bold tabular-nums">{resumen.reembolsos.monto ? `−${formatCLP(resumen.reembolsos.monto)}` : "—"}</TableCell>
                          <TableCell className="text-right text-base font-extrabold tabular-nums">{formatCLP(resumen.total_neto)}</TableCell>
                          <TableCell colSpan={2} className="text-right text-xs text-muted-foreground">
                            {resumen.pagos} pagos · incluye {formatCLP(resumen.propina_total)} en propinas
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>

                  {resumen.automaticos.cantidad > 0 && (
                    <p className="text-xs text-muted-foreground">
                      La app devolvió sola {resumen.automaticos.cantidad} {resumen.automaticos.cantidad === 1 ? "cobro" : "cobros"} ({formatCLP(resumen.automaticos.monto)}) que no se podían atender. No suman ni restan.
                    </p>
                  )}

                  {!diaCerrado && (
                    <>
                      <div>
                        <Label className="text-xs">
                          Notas del cierre {noCuadra ? "(obligatorio: explica la diferencia)" : "(opcional)"}
                        </Label>
                        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} rows={2} placeholder="Ej: se pagó un proveedor con efectivo de la caja" />
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <Button onClick={() => setConfirmarCierre(true)} disabled={efectivo === null || faltaNota || loading}>
                          <Lock className="mr-1 h-4 w-4" /> Cerrar caja del día
                        </Button>
                        <p className="text-xs text-muted-foreground">
                          {efectivo === null ? "Anota el efectivo contado (0 si no hubo) para cerrar." : faltaNota ? "La caja no cuadra: explica la diferencia en las notas." : "Al cerrar, el día queda bloqueado."}
                        </p>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card className="mb-4">
                <CardHeader className="pb-2"><CardTitle className="text-base">Propinas por mozo</CardTitle></CardHeader>
                <CardContent>
                  <p className="mb-2 text-xs text-muted-foreground">
                    Las propinas son de los trabajadores. Tablio solo las informa; ya descuentan lo reembolsado.
                  </p>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Mozo</TableHead>
                          <TableHead className="text-right">Pagos</TableHead>
                          <TableHead className="text-right">Ventas</TableHead>
                          <TableHead className="text-right">Propina</TableHead>
                          <TableHead className="text-right">En efectivo</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {resumen.propinas.map((m) => (
                          <TableRow key={m.staff_id ?? "sin-mozo"}>
                            <TableCell className={m.staff_id ? "font-medium" : "text-muted-foreground"}>{m.nombre}</TableCell>
                            <TableCell className="text-right tabular-nums">{m.pagos}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatCLP(m.ventas)}</TableCell>
                            <TableCell className="text-right font-semibold tabular-nums">{formatCLP(m.propina)}</TableCell>
                            <TableCell className="text-right tabular-nums">{m.propina_efectivo ? formatCLP(m.propina_efectivo) : "—"}</TableCell>
                          </TableRow>
                        ))}
                        {!resumen.propinas.length && (
                          <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground">Sin pagos este día</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-bold text-foreground">Cierres anteriores</h3>
            <Button
              variant="outline"
              size="sm"
              disabled={!settlements.length}
              onClick={() => exportToCSV(settlements.map((s) => ({
                Fecha: s.settlement_date,
                "Total neto": s.total_neto,
                "Diferencia efectivo": s.diferencia_efectivo ?? "",
                "Diferencia POS": s.diferencia_pos ?? "",
                Pagos: s.payments_count,
                "Cerrado por": s.closed_by_name ?? "",
                Estado: s.status === "closed" ? "Cerrado" : "Abierto",
                Notas: s.notes ?? "",
              })), "cierres-de-caja")}
            >
              <Download className="mr-1 h-4 w-4" /> Exportar CSV
            </Button>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Día</TableHead>
                  <TableHead className="text-right">Total neto</TableHead>
                  <TableHead className="text-right">Efectivo</TableHead>
                  <TableHead className="text-right">POS</TableHead>
                  <TableHead>Cerró</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {settlements.map((s) => (
                  <TableRow key={s.id} className="cursor-pointer" onClick={() => setDate(s.settlement_date)}>
                    <TableCell>{s.settlement_date}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCLP(s.total_neto)}</TableCell>
                    <TableCell className="text-right"><Diferencia valor={s.status === "closed" ? s.diferencia_efectivo : null} /></TableCell>
                    <TableCell className="text-right"><Diferencia valor={s.status === "closed" ? s.diferencia_pos : null} /></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{s.closed_by_name ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={s.status === "closed" ? "default" : "secondary"}>
                        {s.status === "closed" ? "Cerrado" : "Abierto"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {!settlements.length && (
                  <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground">Aún no hay cierres</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* ---------- REEMBOLSOS ---------- */}
        <TabsContent value="reembolsos">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead className="text-right">Monto</TableHead>
                <TableHead>Motivo</TableHead>
                <TableHead>Autorizado por</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {refunds.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{new Date(r.created_at).toLocaleString("es-CL")}</TableCell>
                  <TableCell className="text-right">{formatCLP(r.amount)}</TableCell>
                  <TableCell className="max-w-[280px] truncate">{r.reason}</TableCell>
                  <TableCell>{r.authorized_by_name ?? "—"}</TableCell>
                </TableRow>
              ))}
              {!refunds.length && (
                <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground">Sin reembolsos este día</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </TabsContent>
      </Tabs>

      {/* Confirmar cierre */}
      <Dialog open={confirmarCierre} onOpenChange={(o) => !o && setConfirmarCierre(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Cerrar la caja del día?</DialogTitle>
            <DialogDescription>Después de cerrar, nadie puede cambiar este cierre. Lo que llegue más tarde cuenta para el día siguiente.</DialogDescription>
          </DialogHeader>
          {resumen && (
            <div className="space-y-2 rounded-xl bg-muted p-3 text-sm">
              <div className="flex justify-between"><span>Total del día</span><span className="font-bold tabular-nums">{formatCLP(resumen.total_neto)}</span></div>
              <div className="flex justify-between"><span>Efectivo contado</span><span className="tabular-nums">{efectivo !== null ? formatCLP(efectivo) : "—"}</span></div>
              <div className="flex justify-between"><span>Diferencia en efectivo</span><Diferencia valor={difEfectivo} /></div>
              {pos !== null && <div className="flex justify-between"><span>Diferencia en POS</span><Diferencia valor={difPos} /></div>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmarCierre(false)}>Volver</Button>
            <Button onClick={cerrar} disabled={cerrando}>
              {cerrando ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Lock className="mr-1 h-4 w-4" />} Cerrar caja
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal reembolso */}
      <Dialog open={!!refundTarget} onOpenChange={(o) => !o && setRefundTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reembolsar pago</DialogTitle>
            <DialogDescription>
              {refundTarget && (
                <>Total cobrado {formatCLP(refundTarget.amount + refundTarget.tip_amount)} · ya reembolsado {formatCLP(refundTarget.refunded_amount)}</>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Monto (vacío = reembolso total)</Label>
              <Input type="number" min={1} value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} placeholder="Total" />
            </div>
            <div>
              <Label>Motivo</Label>
              <Textarea value={refundReason} onChange={(e) => setRefundReason(e.target.value)} maxLength={500} rows={3} placeholder="Ej: producto no entregado" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefundTarget(null)}>Cancelar</Button>
            <Button onClick={doRefund} disabled={refunding || refundReason.trim().length < 3}>
              {refunding ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null} Confirmar reembolso
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
