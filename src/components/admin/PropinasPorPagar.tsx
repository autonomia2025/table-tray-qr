import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, HandCoins, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { formatCLP } from "@/lib/format";
import {
  MEDIOS_PAGO_PROPINA, fechaLarga, pagarPropinas, propinasPorPagar, type MedioPagoPropina, type PropinasPorPagar as Datos,
} from "@/lib/propinasEquipo";

/**
 * Cuánto se le debe a cada mozo en propinas y hasta cuándo (7 días hábiles con tarjeta), y el registro de
 * cuando el local se las paga. La propina es íntegra del trabajador: no se le descuenta nada.
 */
export default function PropinasPorPagar({ branchId }: { branchId: string }) {
  const { toast } = useToast();
  const [datos, setDatos] = useState<Datos | null>(null);
  const [pagando, setPagando] = useState<Datos["pendientes"][number] | null>(null);
  const [medio, setMedio] = useState<MedioPagoPropina>("transferencia");
  const [nota, setNota] = useState("");
  const [enviando, setEnviando] = useState(false);

  const cargar = useCallback(async () => setDatos(await propinasPorPagar(branchId)), [branchId]);
  useEffect(() => { cargar(); }, [cargar]);

  const confirmar = async () => {
    if (!pagando) return;
    setEnviando(true);
    const r = await pagarPropinas(branchId, pagando.staff_id, medio, nota);
    setEnviando(false);
    if (r.ok === false) {
      toast({ title: "No se pudo registrar", description: r.error, variant: "destructive" });
      return;
    }
    toast({ title: `Pagaste ${formatCLP(r.dato.monto)} en propinas a ${r.dato.nombre}` });
    setPagando(null);
    setNota("");
    cargar();
  };

  if (!datos) return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  const total = datos.pendientes.reduce((s, p) => s + p.monto, 0);

  return (
    <div className="space-y-4" data-testid="propinas-por-pagar">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><HandCoins className="h-4 w-4 text-primary" /> Propinas por pagar al equipo</CardTitle>
          <p className="text-xs text-muted-foreground">
            La propina es del trabajador y no se le descuenta nada. Las pagadas con tarjeta o con la app se entregan a más tardar en 7 días hábiles.
          </p>
        </CardHeader>
        <CardContent>
          {datos.pendientes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay propinas pendientes. ¡Todo al día!</p>
          ) : (
            <div className="space-y-2">
              {datos.pendientes.map((p) => (
                <div key={p.staff_id} className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 ${p.vencida ? "border-destructive/40 bg-destructive/5" : "border-border"}`}>
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground">{p.nombre}</p>
                    <p className={`text-xs ${p.vencida ? "font-semibold text-destructive" : "text-muted-foreground"}`}>
                      {p.vencida && <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />}
                      {p.pagos} {p.pagos === 1 ? "propina" : "propinas"} desde el {fechaLarga(p.desde)} · {p.vencida ? "venció" : "plazo hasta"} el {fechaLarga(p.vence)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-bold tabular-nums text-foreground">{formatCLP(p.monto)}</span>
                    <Button size="sm" onClick={() => { setPagando(p); setMedio("transferencia"); }}>Registrar pago</Button>
                  </div>
                </div>
              ))}
              <p className="pt-1 text-right text-sm text-muted-foreground">Total por pagar: <strong className="text-foreground">{formatCLP(total)}</strong></p>
            </div>
          )}
        </CardContent>
      </Card>

      {datos.pagadas.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Últimos pagos al equipo</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm">
              {datos.pagadas.map((l) => (
                <li key={l.id} className="flex justify-between gap-2 py-2">
                  <span className="min-w-0 truncate text-foreground">{l.nombre} · {MEDIOS_PAGO_PROPINA[l.medio as MedioPagoPropina] ?? "Otro"}{l.nota ? ` · ${l.nota}` : ""}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {new Date(l.created_at).toLocaleDateString("es-CL")} · <strong className="text-foreground">{formatCLP(l.monto)}</strong>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!pagando} onOpenChange={(o) => !o && setPagando(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Pagar propinas a {pagando?.nombre}</DialogTitle>
            <DialogDescription>
              Se registran {formatCLP(pagando?.monto ?? 0)}: todo lo pendiente hasta ahora. Tablio no mueve la plata; solo deja constancia.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2" role="group" aria-label="Cómo le pagaste">
              {(Object.keys(MEDIOS_PAGO_PROPINA) as MedioPagoPropina[]).map((m) => (
                <button key={m} type="button" aria-pressed={medio === m} onClick={() => setMedio(m)}
                  className={`flex-1 rounded-lg border px-2 py-2 text-sm font-semibold ${medio === m ? "border-primary bg-accent text-foreground" : "border-border text-muted-foreground"}`}>
                  {MEDIOS_PAGO_PROPINA[m]}
                </button>
              ))}
            </div>
            <Input value={nota} maxLength={300} onChange={(e) => setNota(e.target.value)} placeholder="Nota (opcional): n° de transferencia, etc." aria-label="Nota" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPagando(null)}>Cancelar</Button>
            <Button onClick={confirmar} disabled={enviando}>{enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirmar pago"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
