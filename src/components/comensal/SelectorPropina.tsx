import { useState } from "react";
import { Input } from "@/components/ui/input";
import { formatCLP } from "@/lib/format";
import { PORCENTAJES_PROPINA, SIN_PROPINA, montoPropina, type Propina } from "@/lib/propina";

/**
 * Propina en las pantallas del cliente: 10% marcado (sugerencia mínima que pide la ley), 15%, 20%,
 * otro monto y "sin propina" siempre a la vista, porque es voluntaria.
 */
interface Props {
  subtotal: number;
  color: string;
  valor: Propina;
  onCambiar: (p: Propina) => void;
  titulo?: string;
}

export default function SelectorPropina({ subtotal, color, valor, onCambiar, titulo = "Propina para el equipo" }: Props) {
  const [otro, setOtro] = useState(valor.tipo === "monto" && valor.monto > 0);
  const sinPropina = valor.tipo === "monto" && valor.monto === 0 && !otro;

  const boton = (activo: boolean) => ({
    borderColor: activo ? color : "hsl(var(--border))",
    backgroundColor: activo ? `${color}12` : "transparent",
  });

  return (
    <div className="mb-4" data-testid="selector-propina">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="text-[15px] font-bold text-foreground">{titulo}</p>
        <p className="text-[11px] text-muted-foreground">Voluntaria · va íntegra al equipo</p>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {PORCENTAJES_PROPINA.map((pct) => {
          const activo = !otro && valor.tipo === "pct" && valor.pct === pct;
          return (
            <button
              key={pct}
              type="button"
              aria-pressed={activo}
              onClick={() => { setOtro(false); onCambiar({ tipo: "pct", pct }); }}
              className="flex flex-col items-center rounded-xl border-2 py-2.5 transition-colors"
              style={boton(activo)}
            >
              <span className="text-sm font-semibold" style={{ color: activo ? color : "hsl(var(--foreground))" }}>{pct}%</span>
              <span className="text-[11px] text-muted-foreground">{formatCLP(montoPropina({ tipo: "pct", pct }, subtotal))}</span>
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={otro}
          onClick={() => { setOtro(true); onCambiar({ tipo: "monto", monto: valor.tipo === "monto" ? valor.monto : 0 }); }}
          className="flex flex-col items-center justify-center rounded-xl border-2 py-2.5 transition-colors"
          style={boton(otro)}
        >
          <span className="text-sm font-semibold" style={{ color: otro ? color : "hsl(var(--foreground))" }}>Otro</span>
          <span className="text-[11px] text-muted-foreground">monto</span>
        </button>
      </div>
      {otro && (
        <Input
          autoFocus
          type="number"
          inputMode="numeric"
          min={0}
          placeholder="$0"
          aria-label="Monto de propina"
          value={valor.tipo === "monto" && valor.monto > 0 ? String(valor.monto) : ""}
          onChange={(e) => onCambiar({ tipo: "monto", monto: Math.max(0, parseInt(e.target.value, 10) || 0) })}
          className="mt-2 h-11"
        />
      )}
      <button
        type="button"
        aria-pressed={sinPropina}
        onClick={() => { setOtro(false); onCambiar(SIN_PROPINA); }}
        className={`mt-2 text-xs underline ${sinPropina ? "font-semibold text-foreground" : "text-muted-foreground"}`}
      >
        {sinPropina ? "Sin propina ✓" : "Sin propina"}
      </button>
    </div>
  );
}
