import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { formatCLP } from "@/lib/format";
import { rechazarParte, tomarParte } from "@/lib/dividir";
import type { DivididoEnVivo } from "@/lib/mesaEnVivo";

/**
 * Platos divididos donde estoy (fase 7.4b): cómo va cada parte, pagar la mía, decir "no, gracias" y, si lo pedí
 * yo, pagar una parte que falta.
 */
export default function PlatosDivididos({ token, slug, platos, color, recargar }: {
  token: string; slug: string; platos: DivididoEnVivo[]; color: string; recargar: () => void;
}) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const qs = `?t=${token}`;

  const noGracias = async (parte: string) => {
    setOcupado(parte);
    const r = await rechazarParte(token, parte);
    setOcupado(null);
    if (r.ok === false) { toast({ title: "No se pudo", description: r.error, variant: "destructive" }); return; }
    recargar();
  };
  const pagoYo = async (parte: string) => {
    setOcupado(parte);
    const r = await tomarParte(token, parte);
    setOcupado(null);
    if (r.ok === false) { toast({ title: "No se pudo", description: r.error, variant: "destructive" }); return; }
    navigate(`/${slug}/parte/${parte}${qs}`);
  };

  if (!platos.length) return null;
  return (
    <div className="mb-4 space-y-3" data-testid="platos-divididos">
      {platos.map((pl) => {
        const mia = pl.partes.find((p) => p.yo && p.estado !== "pagada");
        return (
          <div key={pl.id} className="rounded-2xl border border-border bg-card p-4">
            <p className="text-sm font-bold text-card-foreground">🍽️ {pl.plato} · dividido entre {pl.partes.length}</p>
            <p className="text-xs text-muted-foreground">
              {pl.estado === "pagado" ? "Todo pagado: ya está en la cocina." : "Pasa a la cocina cuando todos paguen su parte."}
            </p>
            <ul className="mt-2 space-y-1.5 text-sm">
              {pl.partes.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2">
                  <span className="text-card-foreground">
                    {p.yo ? "Tú" : p.quien}{" "}
                    <span className="text-xs text-muted-foreground">
                      {p.estado === "pagada" ? "✓ pagó" : p.estado === "rechazada" ? "· no quiso" : "· falta"}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums text-muted-foreground">{formatCLP(p.monto)}</span>
                    {pl.soy_creador && !p.yo && p.estado !== "pagada" && pl.estado === "esperando" && (
                      <button onClick={() => pagoYo(p.id)} disabled={ocupado === p.id} className="text-xs font-semibold underline" style={{ color }}>
                        La pago yo
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {mia && pl.estado === "esperando" && (
              <div className="mt-3 flex gap-2">
                <button onClick={() => navigate(`/${slug}/parte/${mia.id}${qs}`)} className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white" style={{ backgroundColor: color }}>
                  Pagar mi parte · {formatCLP(mia.monto)}
                </button>
                {!pl.soy_creador && mia.estado === "pendiente" && (
                  <button onClick={() => noGracias(mia.id)} disabled={ocupado === mia.id} className="rounded-xl border border-border px-3 py-2.5 text-sm text-muted-foreground">
                    No, gracias
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
