import { useState } from "react";
import { Gift, ChevronRight, Stamp } from "lucide-react";
import { useSesion } from "@/contexts/SesionContext";
import { formatCLP } from "@/lib/format";
import CuentaComensal from "@/components/comensal/CuentaComensal";
import { useTarjetaSellos } from "@/hooks/useTarjetaSellos";

/**
 * Sellos antes de pagar (fases 1.3 y 3.7). Cliente con cuenta: qué va a sumar este pago y sus premios
 * por retirar. Invitado: la invitación a guardar su cuenta. Los sellos los suma la base al pagar.
 */

interface Props {
  tenantId?: string;
  branchId?: string;
  nombreLocal: string;
  color: string;
  /** Consumo de este pago, para saber si llega al monto mínimo del programa */
  monto?: number;
}

export default function BloqueSellos({ tenantId, branchId, nombreLocal, color, monto }: Props) {
  const { perfil } = useSesion();
  const [cuentaAbierta, setCuentaAbierta] = useState(false);
  const { data: t } = useTarjetaSellos(tenantId, branchId);
  const p = t?.programa;
  if (!p) return null;

  let linea = "";
  if (t?.registrado && p.tipo === "stamps") {
    const siguiente = (t.sellos ?? 0) + 1;
    if (t.hoy_sumado) linea = "Hoy ya sumaste tu sello (uno por visita).";
    else if (monto !== undefined && monto < p.monto_minimo) linea = `Desde ${formatCLP(p.monto_minimo)} este pago suma un sello.`;
    else linea = siguiente >= p.meta ? `Con este pago completas tu tarjeta: ${p.premio}.` : `Este pago suma tu sello ${siguiente} de ${p.meta}.`;
  } else if (t?.registrado) {
    linea = `Llevas ${t.puntos ?? 0} de ${p.puntos_meta} puntos para ${p.premio}.`;
  }

  return (
    <>
      <div className="mb-4 rounded-2xl border border-border bg-card p-4">
        {t?.registrado ? (
          <>
            <div className="flex items-center gap-2">
              <Stamp className="h-4 w-4" style={{ color }} />
              <span className="text-sm font-bold text-card-foreground">{linea}</span>
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{perfil?.email}</p>
            {t.premios?.map((r) => (
              <div key={r.id} className="mt-3 flex items-center justify-between rounded-xl border-2 border-dashed px-3 py-2" style={{ borderColor: color }}>
                <span className="text-xs font-semibold text-foreground">🎁 {r.descripcion}</span>
                <span className="text-[11px] text-muted-foreground">Pídeselo al mozo · código <strong className="font-mono text-foreground">{r.codigo}</strong></span>
              </div>
            ))}
          </>
        ) : (
          <button onClick={() => setCuentaAbierta(true)} className="flex w-full items-center gap-3 text-left">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: `${color}18` }}>
              <Gift className="h-5 w-5" style={{ color }} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-card-foreground">Guarda tus sellos</p>
              <p className="text-[11px] text-muted-foreground">
                {p.tipo === "stamps" ? `${p.meta} visitas y te llevas ${p.premio}.` : `Junta puntos y llévate ${p.premio}.`} Toma 10 segundos.
              </p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>
        )}
      </div>
      <CuentaComensal abierto={cuentaAbierta} onCambiar={setCuentaAbierta} nombreLocal={nombreLocal} color={color} />
    </>
  );
}
