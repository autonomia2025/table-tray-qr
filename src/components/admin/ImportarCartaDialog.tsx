import { useMemo, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { formatCLP } from "@/lib/format";
import { importarCarta, leerCartaPegada } from "@/lib/primerosPasos";

/**
 * Pegar la carta (fase 5.2): el dueño pega su carta (de un documento, una foto pasada a texto o una planilla),
 * ve cómo quedó antes de guardarla y la importa de una vez. Las fotos, opciones y estaciones se agregan después.
 */

const EJEMPLO = `Cervezas:
Kunstmann Torobayo 500cc - $4.500
Austral Calafate 500cc - $4.900

Para picar:
Papas fritas - $3.500 | Con merkén y mayo casera
Empanaditas de queso (6) - $5.900`;

export default function ImportarCartaDialog({ branchId, open, onOpenChange, onImportada }: {
  branchId: string; open: boolean; onOpenChange: (abierto: boolean) => void; onImportada: () => void;
}) {
  const { toast } = useToast();
  const [texto, setTexto] = useState("");
  const [guardando, setGuardando] = useState(false);
  const leida = useMemo(() => leerCartaPegada(texto), [texto]);
  const categorias = useMemo(() => [...new Set(leida.lineas.map((l) => l.categoria))], [leida]);

  const importar = async () => {
    setGuardando(true);
    const r = await importarCarta(branchId, leida.lineas);
    setGuardando(false);
    if (r.ok === false) { toast({ title: "No se pudo importar", description: r.error, variant: "destructive" }); return; }
    toast({
      title: `Listo: ${r.platos} ${r.platos === 1 ? "plato nuevo" : "platos nuevos"}`,
      description: r.repetidos ? `${r.repetidos} ya estaban y no se repitieron.` : "Ahora puedes agregarles fotos y opciones.",
    });
    setTexto("");
    onOpenChange(false);
    onImportada();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Pegar la carta</DialogTitle>
          <DialogDescription>
            Pega tu carta: un título por categoría terminado en dos puntos y un plato por línea con su precio al final.
            También sirven columnas copiadas de una planilla (Categoría, Plato, Precio, Descripción).
          </DialogDescription>
        </DialogHeader>
        <Textarea aria-label="Carta pegada" rows={9} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={EJEMPLO} className="font-mono text-sm" />

        {texto.trim() && (
          <div className="space-y-2" data-testid="vista-previa-carta">
            <p className="text-sm font-semibold text-foreground">
              {leida.lineas.length} {leida.lineas.length === 1 ? "plato" : "platos"} en {categorias.length} {categorias.length === 1 ? "categoría" : "categorías"}
            </p>
            {leida.errores.length > 0 && (
              <div className="rounded-xl border border-amber-400/60 bg-amber-50 p-3 text-sm dark:bg-amber-950/40">
                <p className="flex items-center gap-1.5 font-semibold text-foreground"><AlertTriangle className="h-4 w-4" /> No entendí {leida.errores.length} {leida.errores.length === 1 ? "línea" : "líneas"} (les falta el precio):</p>
                <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                  {leida.errores.slice(0, 5).map((e) => <li key={e.linea}>Línea {e.linea}: {e.texto}</li>)}
                </ul>
              </div>
            )}
            <div className="max-h-64 overflow-y-auto rounded-xl border">
              <table className="w-full text-sm">
                <tbody className="divide-y">
                  {categorias.map((c) => (
                    <FilaCategoria key={c} nombre={c} platos={leida.lineas.filter((l) => l.categoria === c)} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={importar} disabled={!leida.lineas.length || guardando}>
            {guardando ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            Importar {leida.lineas.length || ""} {leida.lineas.length === 1 ? "plato" : "platos"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FilaCategoria({ nombre, platos }: { nombre: string; platos: { nombre: string; precio: number; descripcion?: string }[] }) {
  return (
    <>
      <tr className="bg-muted/50"><td colSpan={2} className="px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">{nombre}</td></tr>
      {platos.map((p, i) => (
        <tr key={`${p.nombre}-${i}`}>
          <td className="px-3 py-1.5 text-foreground">
            {p.nombre}
            {p.descripcion && <span className="block text-xs text-muted-foreground">{p.descripcion}</span>}
          </td>
          <td className="px-3 py-1.5 text-right tabular-nums text-foreground">{formatCLP(p.precio)}</td>
        </tr>
      ))}
    </>
  );
}
