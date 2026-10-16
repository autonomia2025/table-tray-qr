import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatCLP } from "@/lib/format";
import { dividirPlato } from "@/lib/dividir";
import type { MesaEnVivo } from "@/lib/mesaEnVivo";
import type { CartItem } from "@/store/cartStore";

/**
 * Elegir con quiénes de la mesa se divide un plato del carrito (fase 7.4b). El monto de cada parte lo calcula la
 * base; aquí se muestra una estimación. Al dividir, el plato sale del carrito y se paga la parte propia.
 */
export default function DividirPlato({ token, item, mesa, color, onCerrar, onDividido }: {
  token: string; item: CartItem | null; mesa: MesaEnVivo | null; color: string;
  onCerrar: () => void; onDividido: (miParte: string) => void;
}) {
  const otros = (mesa?.personas ?? []).filter((p) => !p.yo && p.id);
  const [elegidos, setElegidos] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setElegidos([]); setError(""); }, [item?.id]);

  const n = elegidos.length + 1;
  const cada = item ? Math.floor(item.subtotal / n) : 0;
  const alternar = (id: string) => setElegidos((e) => (e.includes(id) ? e.filter((x) => x !== id) : [...e, id]));

  const dividir = async () => {
    if (!item || elegidos.length === 0) return;
    setEnviando(true);
    setError("");
    const r = await dividirPlato(token, item, elegidos);
    setEnviando(false);
    if (r.ok === false) { setError(r.error); return; }
    onDividido(r.dato.mi_parte);
  };

  return (
    <Dialog open={!!item} onOpenChange={(v) => { if (!v) onCerrar(); }}>
      <DialogContent className="max-w-[360px] rounded-2xl">
        <DialogHeader>
          <DialogTitle>Dividir {item?.name}</DialogTitle>
          <DialogDescription>Elige con quiénes de tu mesa lo divides. Cada uno paga su parte en su celular y el plato va a la cocina cuando estén todas.</DialogDescription>
        </DialogHeader>
        {otros.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay nadie más en tu mesa. Cuando abran la carta con el QR, aparecen aquí.</p>
        ) : (
          <div className="space-y-2" data-testid="elegir-con-quien">
            {otros.map((p) => (
              <label key={p.id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-border px-3 py-2.5 text-sm">
                <input type="checkbox" checked={elegidos.includes(p.id!)} onChange={() => alternar(p.id!)} className="h-4 w-4" />
                <span className="text-card-foreground">{p.alias || "Alguien sin nombre"}</span>
              </label>
            ))}
          </div>
        )}
        {elegidos.length > 0 && item && (
          <p className="text-sm text-foreground">Entre {n}: unos <strong>{formatCLP(cada)}</strong> cada uno (de {formatCLP(item.subtotal)}).</p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <button onClick={dividir} disabled={elegidos.length === 0 || enviando}
          className="w-full rounded-2xl py-3 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: color }}>
          Dividir y pagar mi parte
        </button>
      </DialogContent>
    </Dialog>
  );
}
