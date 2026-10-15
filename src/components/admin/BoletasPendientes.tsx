import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { formatCLP } from "@/lib/format";
import { boletasPendientes, marcarBoleta, MEDIO_COBRO, type BoletaPendiente } from "@/lib/boletas";

/**
 * Boletas por entregar (fase 4.3, etapa 1): lo cobrado en efectivo o transferencia en los últimos 7 días sin
 * boleta marcada. La boleta la emite el local con su sistema; aquí solo se anota que se entregó (y su número,
 * si se quiere). Con la app o con POS no hace falta: el comprobante de la pasarela vale como boleta.
 */
export default function BoletasPendientes({ branchId, alCambiar }: { branchId: string; alCambiar?: () => void }) {
  const { toast } = useToast();
  const [lista, setLista] = useState<BoletaPendiente[] | null>(null);
  const [folios, setFolios] = useState<Record<string, string>>({});
  const [marcando, setMarcando] = useState<string | null>(null);

  const cargar = useCallback(() => { boletasPendientes(branchId).then(setLista); }, [branchId]);
  useEffect(() => { cargar(); }, [cargar]);

  const marcar = async (b: BoletaPendiente) => {
    setMarcando(b.id);
    const r = await marcarBoleta(b.id, folios[b.id]);
    setMarcando(null);
    if (r.ok === false) {
      toast({ title: "No se pudo marcar la boleta", description: r.error, variant: "destructive" });
      return;
    }
    toast({ title: "Boleta marcada como entregada" });
    cargar();
    alCambiar?.();
  };

  if (lista === null) return null;
  return (
    <div className="mb-4 rounded-2xl border bg-card p-4" data-testid="boletas-pendientes">
      <p className="flex items-center gap-1.5 font-semibold text-foreground">
        <Receipt className="h-4 w-4 text-primary" /> Boletas por entregar
      </p>
      <p className="text-xs text-muted-foreground">
        Cobros en efectivo o transferencia sin boleta marcada (últimos 7 días). La boleta sale de tu sistema de siempre, a nombre del local.
      </p>
      {lista.length === 0 ? (
        <p className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-4 w-4" /> Todas las boletas están entregadas.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {lista.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">
                  {b.mesa !== null ? `Mesa ${b.mesa}` : "Cobro"} · <span className="tabular-nums">{formatCLP(b.monto)}</span> · {MEDIO_COBRO[b.metodo]}
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(b.creado_at).toLocaleString("es-CL", { timeZone: "America/Santiago", weekday: "short", hour: "2-digit", minute: "2-digit" })}
                  {b.cobrado_por ? ` · cobró ${b.cobrado_por}` : ""}
                </p>
              </div>
              <Input
                aria-label={`Número de boleta de la mesa ${b.mesa ?? ""}`}
                placeholder="N° (opcional)"
                maxLength={40}
                value={folios[b.id] ?? ""}
                onChange={(e) => setFolios({ ...folios, [b.id]: e.target.value })}
                className="h-9 w-32"
              />
              <Button size="sm" variant="outline" className="h-9" disabled={marcando === b.id} onClick={() => marcar(b)}>
                {marcando === b.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Entregada"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
