import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Receipt } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { formatCLP } from "@/lib/format";
import { mensajeError } from "@/lib/errores";
import { TEXTO_ESTADO, estadoMalo, fechaDia, nombreMes, type Mensualidad } from "@/lib/mensualidad";

interface Fila { tenant_id: string; local: string; estado: Mensualidad }
interface Plan { id: string; display_name: string; precio_mensual: number | null }
interface Cobro { id: string; tenant_id: string; periodo: string; monto: number; vence_el: string; estado: string; pagado_at: string | null; medio: string | null }

/**
 * Mensualidades (fase 8.1): la suscripción de cada local con Tablio, los cobros de cada mes y su pago.
 * Los ingresos de Tablio salen de aquí. Todo pasa por funciones de la base, con registro.
 */
export default function FinanzasMensualidadesPage() {
  const [filas, setFilas] = useState<Fila[]>([]);
  const [planes, setPlanes] = useState<Plan[]>([]);
  const [cobros, setCobros] = useState<Cobro[]>([]);
  const [cargando, setCargando] = useState(true);
  const [editando, setEditando] = useState<Fila | null>(null);
  const [form, setForm] = useState({ plan: "", precio: "", dia: "5", prueba: "", notas: "" });
  const [pagando, setPagando] = useState<Cobro | null>(null);
  const [pago, setPago] = useState({ medio: "transferencia", referencia: "", folio: "" });

  const cargar = useCallback(async () => {
    const [{ data: f }, { data: p }, { data: c }] = await Promise.all([
      supabase.rpc("mensualidades_locales"),
      supabase.from("plans").select("id, display_name, precio_mensual").order("max_tables"),
      supabase.from("cobros_mensualidad").select("id, tenant_id, periodo, monto, vence_el, estado, pagado_at, medio").neq("estado", "anulado").order("periodo", { ascending: false }).limit(500),
    ]);
    setFilas(((f ?? []) as unknown as Fila[]));
    setPlanes((p ?? []) as Plan[]);
    setCobros((c ?? []) as Cobro[]);
    setCargando(false);
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const nombre = useMemo(() => Object.fromEntries(filas.map((f) => [f.tenant_id, f.local])), [filas]);
  const pendientes = cobros.filter((c) => c.estado === "pendiente");
  const totalPendiente = pendientes.reduce((t, c) => t + c.monto, 0);
  const atrasados = filas.filter((f) => estadoMalo(f.estado.estado)).length;

  const abrir = (f: Fila) => {
    setEditando(f);
    setForm({ plan: f.estado.plan_id ?? "", precio: String(f.estado.precio_mensual ?? ""), dia: String(f.estado.dia_cobro ?? 5), prueba: f.estado.prueba_hasta ?? "", notas: "" });
  };

  const guardar = async () => {
    if (!editando) return;
    const { error } = await supabase.rpc("guardar_suscripcion", {
      _tenant_id: editando.tenant_id, _plan_id: form.plan || null, _precio_mensual: parseInt(form.precio) || 0,
      _dia_cobro: parseInt(form.dia) || 5, _prueba_hasta: form.prueba || null, _notas: form.notas || null,
    });
    if (error) return toast.error(mensajeError(error, "No se pudo guardar la suscripción"));
    toast.success("Suscripción guardada");
    setEditando(null);
    cargar();
  };

  const generar = async () => {
    const { data, error } = await supabase.rpc("generar_cobros_mes");
    if (error) return toast.error(mensajeError(error));
    toast.success(data ? `${data} cobros nuevos` : "No había cobros nuevos por generar");
    cargar();
  };

  const registrar = async () => {
    if (!pagando) return;
    const { error } = await supabase.rpc("registrar_pago_mensualidad", {
      _cobro_id: pagando.id, _medio: pago.medio, _referencia: pago.referencia || null, _folio: pago.folio || null,
    });
    if (error) return toast.error(mensajeError(error, "No se pudo registrar el pago"));
    toast.success("Pago registrado");
    setPagando(null);
    cargar();
  };

  if (cargando) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-foreground"><Receipt className="h-5 w-5 text-primary" /> Mensualidades</h1>
          <p className="text-sm text-muted-foreground">Lo que cada local le paga a Tablio. Los cobros del mes se generan solos en su día de cobro.</p>
        </div>
        <Button variant="outline" onClick={generar}>Generar cobros del mes</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Por cobrar</p><p className="text-2xl font-bold tabular-nums text-foreground" data-testid="por-cobrar">{formatCLP(totalPendiente)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Cobros pendientes</p><p className="text-2xl font-bold tabular-nums text-foreground">{pendientes.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Locales atrasados</p><p className={`text-2xl font-bold tabular-nums ${atrasados ? "text-destructive" : "text-foreground"}`}>{atrasados}</p></CardContent></Card>
      </div>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm" data-testid="tabla-mensualidades">
            <thead><tr className="border-b border-border text-left">
              <th className="px-4 py-2 font-semibold text-foreground">Local</th>
              <th className="px-3 py-2 font-semibold text-foreground">Plan</th>
              <th className="px-3 py-2 text-right font-semibold text-foreground">Mensualidad</th>
              <th className="px-3 py-2 font-semibold text-foreground">Estado</th>
              <th className="px-3 py-2" />
            </tr></thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.tenant_id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium text-foreground">{f.local}</td>
                  <td className="px-3 py-3 text-muted-foreground">{f.estado.plan ?? "—"}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-foreground">{f.estado.precio_mensual != null ? formatCLP(f.estado.precio_mensual) : "—"}</td>
                  <td className="px-3 py-3">
                    <Badge variant={estadoMalo(f.estado.estado) ? "destructive" : f.estado.estado === "sin_suscripcion" ? "outline" : "secondary"}>{TEXTO_ESTADO[f.estado.estado]}</Badge>
                    {!!f.estado.dias_atraso && <span className="ml-2 text-xs text-muted-foreground">{f.estado.dias_atraso} días</span>}
                  </td>
                  <td className="px-3 py-3 text-right"><Button size="sm" variant="ghost" onClick={() => abrir(f)}>{f.estado.estado === "sin_suscripcion" ? "Crear suscripción" : "Editar"}</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-2 text-base font-bold text-foreground">Cobros</h2>
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm" data-testid="tabla-cobros">
              <thead><tr className="border-b border-border text-left">
                <th className="px-4 py-2 font-semibold text-foreground">Local</th>
                <th className="px-3 py-2 font-semibold text-foreground">Mes</th>
                <th className="px-3 py-2 text-right font-semibold text-foreground">Monto</th>
                <th className="px-3 py-2 font-semibold text-foreground">Vence</th>
                <th className="px-3 py-2 font-semibold text-foreground">Estado</th>
                <th className="px-3 py-2" />
              </tr></thead>
              <tbody>
                {cobros.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">Todavía no hay cobros.</td></tr>}
                {cobros.map((c) => (
                  <tr key={c.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 text-foreground">{nombre[c.tenant_id] ?? "—"}</td>
                    <td className="px-3 py-3 text-muted-foreground">{nombreMes(c.periodo)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-foreground">{formatCLP(c.monto)}</td>
                    <td className="px-3 py-3 text-muted-foreground">{fechaDia(c.vence_el)}</td>
                    <td className="px-3 py-3"><Badge variant={c.estado === "pagado" ? "default" : "secondary"}>{c.estado === "pagado" ? "Pagado" : "Pendiente"}</Badge></td>
                    <td className="px-3 py-3 text-right">{c.estado === "pendiente" && <Button size="sm" onClick={() => { setPagando(c); setPago({ medio: "transferencia", referencia: "", folio: "" }); }}>Registrar pago</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!editando} onOpenChange={(v) => !v && setEditando(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Suscripción de {editando?.local}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Plan</Label>
              <Select value={form.plan} onValueChange={(v) => {
                const p = planes.find((x) => x.id === v);
                setForm((f) => ({ ...f, plan: v, precio: p?.precio_mensual != null && !f.precio ? String(p.precio_mensual) : f.precio }));
              }}>
                <SelectTrigger aria-label="Plan"><SelectValue placeholder="Elige el plan" /></SelectTrigger>
                <SelectContent>{planes.map((p) => <SelectItem key={p.id} value={p.id}>{p.display_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="precio-mensual">Mensualidad (pesos)</Label><Input id="precio-mensual" type="number" min={0} step={1000} value={form.precio} onChange={(e) => setForm((f) => ({ ...f, precio: e.target.value }))} /></div>
              <div><Label htmlFor="dia-cobro">Día de cobro</Label><Input id="dia-cobro" type="number" min={1} max={28} value={form.dia} onChange={(e) => setForm((f) => ({ ...f, dia: e.target.value }))} /></div>
            </div>
            <div><Label htmlFor="prueba-hasta">En prueba hasta (opcional)</Label><Input id="prueba-hasta" type="date" value={form.prueba} onChange={(e) => setForm((f) => ({ ...f, prueba: e.target.value }))} /></div>
            <div><Label htmlFor="notas-suscripcion">Notas (opcional)</Label><Input id="notas-suscripcion" maxLength={500} value={form.notas} onChange={(e) => setForm((f) => ({ ...f, notas: e.target.value }))} /></div>
          </div>
          <DialogFooter><Button onClick={guardar}>Guardar suscripción</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pagando} onOpenChange={(v) => !v && setPagando(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Pago de {pagando ? nombre[pagando.tenant_id] : ""} · {pagando ? nombreMes(pagando.periodo) : ""}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Monto: <strong className="text-foreground">{pagando ? formatCLP(pagando.monto) : ""}</strong></p>
            <div>
              <Label>Cómo pagó</Label>
              <Select value={pago.medio} onValueChange={(v) => setPago((p) => ({ ...p, medio: v }))}>
                <SelectTrigger aria-label="Cómo pagó"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="transferencia">Transferencia</SelectItem>
                  <SelectItem value="tarjeta">Tarjeta</SelectItem>
                  <SelectItem value="efectivo">Efectivo</SelectItem>
                  <SelectItem value="otro">Otro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label htmlFor="referencia-pago">Referencia (opcional)</Label><Input id="referencia-pago" maxLength={120} value={pago.referencia} onChange={(e) => setPago((p) => ({ ...p, referencia: e.target.value }))} /></div>
            <div><Label htmlFor="folio-factura">Folio de la factura (opcional)</Label><Input id="folio-factura" maxLength={40} value={pago.folio} onChange={(e) => setPago((p) => ({ ...p, folio: e.target.value }))} /></div>
          </div>
          <DialogFooter><Button onClick={registrar}>Registrar pago</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
