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
import { Download, RefreshCw, Undo2, Loader2 } from "lucide-react";
import { formatCLP } from "@/lib/format";
import { exportToCSV } from "@/lib/export-utils";

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
  expected_amount: number;
  settled_amount: number;
  difference: number;
  payments_count: number;
  status: string;
  notes: string | null;
}

const METHOD_LABELS: Record<string, string> = {
  apple_pay: "Apple Pay",
  google_pay: "Google Pay",
  card: "Tarjeta",
  cash: "Efectivo",
};

const STATUS_LABELS: Record<string, string> = {
  approved: "Aprobado",
  pending: "Pendiente",
  failed: "Rechazado",
  refunded: "Reembolsado",
  partially_refunded: "Reemb. parcial",
};

const today = () => new Date().toISOString().slice(0, 10);

export default function CajaPage() {
  const { tenantId, branchId } = useAdmin();
  const { toast } = useToast();

  const [date, setDate] = useState(today());
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [refunds, setRefunds] = useState<RefundRow[]>([]);
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [tableMap, setTableMap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [reconciling, setReconciling] = useState(false);
  const [notes, setNotes] = useState("");

  const [refundTarget, setRefundTarget] = useState<PaymentRow | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [refunding, setRefunding] = useState(false);

  const load = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    const from = `${date}T00:00:00.000Z`;
    const to = `${date}T23:59:59.999Z`;

    const [{ data: pays }, { data: setts }, { data: tabs }] = await Promise.all([
      supabase
        .from("payments")
        .select("id, created_at, amount, tip_amount, refunded_amount, method, status, external_reference, customer_email, table_id, settlement_id")
        .eq("branch_id", branchId)
        .gte("created_at", from)
        .lte("created_at", to)
        .order("created_at", { ascending: false }),
      supabase
        .from("payment_settlements")
        .select("id, settlement_date, expected_amount, settled_amount, difference, payments_count, status, notes")
        .eq("branch_id", branchId)
        .order("settlement_date", { ascending: false })
        .limit(30),
      supabase.from("tables").select("id, number").eq("branch_id", branchId),
    ]);

    const paymentRows = (pays ?? []) as PaymentRow[];
    setPayments(paymentRows);
    setSettlements((setts ?? []) as SettlementRow[]);
    setTableMap(Object.fromEntries((tabs ?? []).map((t) => [t.id, t.number])));

    const ids = paymentRows.map((p) => p.id);
    if (ids.length) {
      const { data: refs } = await supabase
        .from("refunds")
        .select("id, created_at, amount, reason, authorized_by_name, payment_id")
        .in("payment_id", ids)
        .order("created_at", { ascending: false });
      setRefunds((refs ?? []) as RefundRow[]);
    } else {
      setRefunds([]);
    }
    setLoading(false);
  }, [branchId, date]);

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

  const runReconciliation = async (close: boolean) => {
    setReconciling(true);
    const { data, error } = await supabase.functions.invoke("reconcile-payments", {
      body: { branch_id: branchId, date, close, notes: notes || null },
    });
    setReconciling(false);
    if (error || data?.error) {
      toast({ title: "No se pudo generar la conciliación", description: data?.error, variant: "destructive" });
      return;
    }
    toast({ title: close ? "Caja cerrada" : "Conciliación actualizada" });
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
      `caja-${date}`,
    );
  };

  if (!tenantId) return null;

  return (
    <div className="max-w-5xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Caja</h2>
          <p className="text-sm text-muted-foreground">Ingresos pagados, conciliación y reembolsos</p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <Label className="text-xs">Día</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 w-40" />
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <Tabs defaultValue="ingresos">
        <TabsList className="mb-4">
          <TabsTrigger value="ingresos">Ingresos</TabsTrigger>
          <TabsTrigger value="conciliacion">Conciliación</TabsTrigger>
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

        {/* ---------- CONCILIACIÓN ---------- */}
        <TabsContent value="conciliacion">
          <Card className="mb-4">
            <CardHeader className="pb-2"><CardTitle className="text-base">Cierre del {date}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Compara lo cobrado en la app contra lo liquidado por el proveedor de pagos. Las diferencias quedan marcadas para revisión.
              </p>
              <div>
                <Label className="text-xs">Notas del cierre (opcional)</Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} rows={2} />
              </div>
              <div className="flex gap-2">
                <Button onClick={() => runReconciliation(false)} disabled={reconciling}>
                  {reconciling ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null} Generar conciliación
                </Button>
                <Button variant="outline" onClick={() => runReconciliation(true)} disabled={reconciling}>
                  Cerrar caja del día
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="mb-2 flex justify-end">
            <Button
              variant="outline"
              size="sm"
              disabled={!settlements.length}
              onClick={() => exportToCSV(settlements.map((s) => ({
                Fecha: s.settlement_date,
                Esperado: s.expected_amount,
                Liquidado: s.settled_amount,
                Diferencia: s.difference,
                Pagos: s.payments_count,
                Estado: s.status === "closed" ? "Cerrado" : "Abierto",
                Notas: s.notes ?? "",
              })), "conciliacion")}
            >
              <Download className="mr-1 h-4 w-4" /> Exportar CSV
            </Button>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead className="text-right">Esperado</TableHead>
                <TableHead className="text-right">Liquidado</TableHead>
                <TableHead className="text-right">Diferencia</TableHead>
                <TableHead className="text-right">Pagos</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {settlements.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>{s.settlement_date}</TableCell>
                  <TableCell className="text-right">{formatCLP(s.expected_amount)}</TableCell>
                  <TableCell className="text-right">{formatCLP(s.settled_amount)}</TableCell>
                  <TableCell className="text-right">
                    <span className={s.difference !== 0 ? "font-bold text-destructive" : ""}>{formatCLP(s.difference)}</span>
                  </TableCell>
                  <TableCell className="text-right">{s.payments_count}</TableCell>
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
