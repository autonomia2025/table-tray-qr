import { useState } from "react";
import { Loader2, Scissors } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { formatCLP } from "@/lib/format";
import { hacerCorteCaja, type ResumenCaja } from "@/lib/caja";

/**
 * Cortes de turno (fase 6.2): al cambio de turno se cuenta la caja del tramo (desde el último corte). Lo que
 * se cobra después cae en el tramo siguiente. El cierre del día hace el último corte y suma todos.
 */

const leer = (v: string) => (v.trim() === "" ? null : parseInt(v.replace(/\D/g, ""), 10) || 0);

function Diferencia({ valor }: { valor: number | null }) {
  if (valor === null) return <span className="text-muted-foreground">—</span>;
  if (valor === 0) return <span className="font-semibold text-emerald-700 dark:text-emerald-400">Cuadra</span>;
  return <span className="font-semibold text-destructive">{valor < 0 ? `Faltan ${formatCLP(-valor)}` : `Sobran ${formatCLP(valor)}`}</span>;
}

export default function CortesCaja({ branchId, resumen, recargar }: { branchId: string; resumen: ResumenCaja; recargar: () => void }) {
  const { toast } = useToast();
  const [abierto, setAbierto] = useState(false);
  const [efectivo, setEfectivo] = useState("");
  const [pos, setPos] = useState("");
  const [nombre, setNombre] = useState("");
  const [notas, setNotas] = useState("");
  const [guardando, setGuardando] = useState(false);
  const cortes = resumen.cortes ?? [];
  const tramo = resumen.tramo_abierto;
  const contado = leer(efectivo);
  const dif = tramo && contado !== null ? contado - tramo.efectivo : null;
  const difPos = tramo && leer(pos) !== null ? (leer(pos) as number) - tramo.pos : null;
  const faltaNota = ((dif ?? 0) !== 0 || (difPos ?? 0) !== 0) && notas.trim().length < 5;

  const cortar = async () => {
    if (contado === null) return;
    setGuardando(true);
    const r = await hacerCorteCaja(branchId, contado, leer(pos), nombre, notas);
    setGuardando(false);
    if (r.ok === false) { toast({ title: "No se pudo hacer el corte", description: r.error, variant: "destructive" }); return; }
    toast({ title: "Corte guardado", description: "Lo que se cobre desde ahora es del turno siguiente." });
    setEfectivo(""); setPos(""); setNombre(""); setNotas(""); setAbierto(false);
    recargar();
  };

  if (resumen.cerrado && cortes.length === 0) return null;
  return (
    <div className="mb-4 rounded-2xl border bg-card p-4" data-testid="cortes-caja">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 font-semibold text-foreground"><Scissors className="h-4 w-4 text-primary" /> Cortes de turno</p>
          <p className="text-xs text-muted-foreground">Cuenta la caja al cambio de turno. El cierre del día suma todos los cortes.</p>
        </div>
        {!resumen.cerrado && !abierto && <Button size="sm" variant="outline" onClick={() => setAbierto(true)}>Hacer corte de turno</Button>}
      </div>

      {cortes.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr><th className="py-1.5 pr-3">Corte</th><th className="py-1.5 pr-3">Hora</th><th className="py-1.5 pr-3 text-right">Debería haber</th><th className="py-1.5 pr-3 text-right">Contado</th><th className="py-1.5 text-right">Diferencia</th></tr>
            </thead>
            <tbody className="divide-y">
              {cortes.map((c) => (
                <tr key={c.numero}>
                  <td className="py-1.5 pr-3 text-foreground">{c.nombre}{c.hecho_por ? <span className="block text-xs text-muted-foreground">{c.hecho_por}</span> : null}</td>
                  <td className="py-1.5 pr-3 text-muted-foreground">{new Date(c.hora).toLocaleTimeString("es-CL", { timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit" })}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{formatCLP(c.efectivo_esperado)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{formatCLP(c.efectivo_contado)}</td>
                  <td className="py-1.5 text-right"><Diferencia valor={c.diferencia_efectivo} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {abierto && tramo && (
        <div className="mt-3 space-y-3 rounded-xl border bg-muted/40 p-3">
          <p className="text-sm text-foreground">
            Desde {cortes.length ? "el último corte" : "que empezó el día"} debería haber <strong className="tabular-nums">{formatCLP(tramo.efectivo)}</strong> en efectivo
            {tramo.pos ? <> y <strong className="tabular-nums">{formatCLP(tramo.pos)}</strong> en POS</> : null} ({tramo.pagos} {tramo.pagos === 1 ? "pago" : "pagos"}).
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="corte-nombre" className="text-xs text-muted-foreground">Nombre del corte</label>
              <Input id="corte-nombre" placeholder={`Turno ${tramo.numero}`} maxLength={40} value={nombre} onChange={(e) => setNombre(e.target.value)} />
            </div>
            <div>
              <label htmlFor="corte-efectivo" className="text-xs text-muted-foreground">Efectivo contado</label>
              <Input id="corte-efectivo" inputMode="numeric" placeholder="$0" value={efectivo} onChange={(e) => setEfectivo(e.target.value.replace(/\D/g, ""))} />
              <p className="mt-1 text-xs"><Diferencia valor={dif} /></p>
            </div>
            <div>
              <label htmlFor="corte-pos" className="text-xs text-muted-foreground">POS contado (opcional)</label>
              <Input id="corte-pos" inputMode="numeric" placeholder="Opcional" value={pos} onChange={(e) => setPos(e.target.value.replace(/\D/g, ""))} />
            </div>
          </div>
          <Textarea aria-label="Notas del corte" rows={2} maxLength={500} value={notas} onChange={(e) => setNotas(e.target.value)}
            placeholder={faltaNota ? "La caja no cuadra: explica la diferencia" : "Notas (opcional)"} />
          <div className="flex gap-2">
            <Button onClick={cortar} disabled={contado === null || faltaNota || guardando}>
              {guardando ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null} Guardar corte
            </Button>
            <Button variant="ghost" onClick={() => setAbierto(false)}>Cancelar</Button>
          </div>
        </div>
      )}
    </div>
  );
}
