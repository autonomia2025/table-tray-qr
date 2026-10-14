import { useState } from "react";
import { CheckCircle2, AlertTriangle, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCLP } from "@/lib/format";
import { conciliarPasarela, type Conciliacion } from "@/lib/pagos";

/**
 * "Verificar con Transbank" al cerrar la caja (fase 4.4): cada pago con Webpay del día se compara con
 * lo que dice la pasarela (monto y devoluciones). Así se cierra con la certeza de que todo calza.
 */
export default function ConciliacionPasarela({ branchId, dia }: { branchId: string; dia: string }) {
  const [res, setRes] = useState<Conciliacion | null>(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);

  const verificar = async () => {
    setCargando(true);
    setError("");
    const r = await conciliarPasarela(branchId, dia);
    setCargando(false);
    if (r.ok === false) { setError(r.error); return; }
    setRes(r.dato);
  };

  return (
    <div className="mb-4 rounded-2xl border bg-card p-4" data-testid="conciliacion-pasarela">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 font-semibold text-foreground"><ShieldCheck className="h-4 w-4 text-primary" /> Pagos con Webpay del día</p>
          <p className="text-xs text-muted-foreground">Compara cada pago con lo que dice Transbank: monto y devoluciones.</p>
        </div>
        <Button size="sm" variant="outline" onClick={verificar} disabled={cargando}>
          {cargando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verificar con Transbank"}
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      {res && (
        res.pagos === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No hubo pagos con Webpay este día.</p>
        ) : res.diferencias === 0 ? (
          <p className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4" /> {res.pagos} {res.pagos === 1 ? "pago verificado" : "pagos verificados"} con Transbank: todo calza.
          </p>
        ) : (
          <div className="mt-3 space-y-1.5">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
              <AlertTriangle className="h-4 w-4" /> {res.diferencias} de {res.pagos} no calzan: revísalos antes de cerrar.
            </p>
            <ul className="space-y-1 text-xs">
              {res.detalle.filter((d) => !d.calza).map((d) => (
                <li key={d.pago_id} className="flex justify-between gap-2 rounded-lg bg-destructive/5 px-2 py-1.5">
                  <span className="text-foreground">{d.referencia ?? "Pago"} · {d.detalle}</span>
                  <span className="shrink-0 tabular-nums">{formatCLP(d.monto)}</span>
                </li>
              ))}
            </ul>
          </div>
        )
      )}
    </div>
  );
}
