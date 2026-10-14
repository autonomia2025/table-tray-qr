import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { formatCLP } from "@/lib/format";
import { riesgoCuentaAbierta, type RiesgoCuentaAbierta as Riesgo } from "@/lib/mesa";

// Cuenta abierta controlada (fase 3.5, brief 4): cuánto arriesga el local ahora en pedidos sin pagar y
// cuánto perdió por mesas que se fueron sin pagar. Se muestra si hay algo que mostrar o si el local
// trabaja con cuenta abierta.
export default function RiesgoCuentaAbierta({ branchId }: { branchId: string }) {
  const [r, setR] = useState<Riesgo | null>(null);

  useEffect(() => {
    if (!branchId) return;
    const cargar = () => riesgoCuentaAbierta(branchId).then((x) => { if (x.ok) setR(x.datos); });
    cargar();
    const id = setInterval(cargar, 60_000);
    return () => clearInterval(id);
  }, [branchId]);

  if (!r || (r.modo !== "open_tab" && r.en_riesgo.monto === 0 && r.perdido_30_dias.monto === 0)) return null;
  return (
    <section className="mb-6 rounded-2xl border bg-card p-4" aria-labelledby="riesgo-titulo">
      <div className="mb-3 flex items-center gap-2">
        <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
        <h3 id="riesgo-titulo" className="font-bold text-foreground">Lo que todavía no se paga</h3>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-muted p-3">
          <p className="text-xs text-muted-foreground">Arriesgando ahora</p>
          <p className="text-2xl font-extrabold text-foreground">{formatCLP(r.en_riesgo.monto)}</p>
          <p className="text-xs text-muted-foreground">
            {r.en_riesgo.pedidos} {r.en_riesgo.pedidos === 1 ? "pedido" : "pedidos"} sin pagar en {r.en_riesgo.mesas} {r.en_riesgo.mesas === 1 ? "mesa" : "mesas"}
            {r.modo === "open_tab" && r.limite_persona > 0 && ` · límite por persona ${formatCLP(r.limite_persona)}`}
          </p>
        </div>
        <div className="rounded-xl bg-muted p-3">
          <p className="text-xs text-muted-foreground">Perdido en los últimos 30 días</p>
          <p className={`text-2xl font-extrabold ${r.perdido_30_dias.monto > 0 ? "text-destructive" : "text-foreground"}`}>{formatCLP(r.perdido_30_dias.monto)}</p>
          <p className="text-xs text-muted-foreground">
            {r.perdido_30_dias.mesas} {r.perdido_30_dias.mesas === 1 ? "mesa se fue" : "mesas se fueron"} sin pagar todo
          </p>
        </div>
      </div>
      {r.ultimas_perdidas.length > 0 && (
        <ul className="mt-3 divide-y divide-border text-sm">
          {r.ultimas_perdidas.slice(0, 5).map((p) => (
            <li key={`${p.cuando}-${p.mesa}`} className="flex items-baseline justify-between gap-3 py-1.5">
              <span className="text-foreground">
                Mesa {p.mesa} · {new Date(p.cuando).toLocaleDateString("es-CL", { day: "numeric", month: "short", timeZone: "America/Santiago" })}
                {p.motivo && <span className="text-muted-foreground"> · “{p.motivo}”</span>}
              </span>
              <span className="shrink-0 font-semibold tabular-nums text-destructive">{formatCLP(p.monto)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
