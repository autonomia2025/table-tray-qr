import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { confirmarPresencia } from "@/lib/mesa";

// Código de presencia (fase 3.5): 4 números impresos en la mesa, que prueban que el comensal está ahí
// y no en su casa con una foto del QR. Se pide solo para lo que no se paga al pedir (o siempre, si el
// local lo eligió) y una sola vez por visita.
export default function CodigoMesa({ abierto, tokenMesa, color, onListo, onCerrar }: {
  abierto: boolean;
  tokenMesa: string;
  color: string;
  onListo: () => void;
  onCerrar: () => void;
}) {
  const [codigo, setCodigo] = useState("");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [revisando, setRevisando] = useState(false);

  const enviar = async (valor = codigo) => {
    if (valor.length !== 4 || revisando) return;
    setRevisando(true);
    const r = await confirmarPresencia(tokenMesa, valor);
    setRevisando(false);
    if (r.ok === false) {
      setMensaje(r.error);
      setCodigo("");
      return;
    }
    if (r.datos.ok) {
      setCodigo("");
      setMensaje(null);
      onListo();
      return;
    }
    setMensaje(r.datos.mensaje ?? "Ese no es el código de tu mesa.");
    setCodigo("");
  };

  return (
    <Dialog open={abierto} onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent className="max-w-[340px] rounded-2xl">
        <DialogHeader>
          <DialogTitle>Código de tu mesa</DialogTitle>
          <DialogDescription>Son 4 números impresos en tu mesa, junto al QR. Así sabemos que estás aquí.</DialogDescription>
        </DialogHeader>
        <input
          value={codigo}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "").slice(0, 4);
            setCodigo(v);
            setMensaje(null);
            if (v.length === 4) enviar(v);
          }}
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-label="Código de 4 números de tu mesa"
          placeholder="• • • •"
          className="w-full rounded-xl border border-input bg-background py-3 text-center text-3xl font-extrabold tracking-[0.5em] text-foreground"
          autoFocus
        />
        {mensaje && <p className="text-center text-sm text-destructive">{mensaje}</p>}
        <button
          onClick={() => enviar()}
          disabled={codigo.length !== 4 || revisando}
          className="w-full rounded-2xl py-3 text-sm font-semibold text-white disabled:opacity-50"
          style={{ backgroundColor: color }}
        >
          {revisando ? "Revisando…" : "Confirmar"}
        </button>
        <p className="text-center text-xs text-muted-foreground">¿No lo encuentras? Pídeselo al mozo.</p>
      </DialogContent>
    </Dialog>
  );
}
