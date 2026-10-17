import { useEffect, useState } from "react";
import { Receipt } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCLP } from "@/lib/format";
import { TEXTO_ESTADO, estadoMalo, fechaDia, miMensualidad, nombreMes, type Mensualidad } from "@/lib/mensualidad";

/** Tu plan con Tablio (fase 8.1): el plan, la mensualidad, lo que está por pagar y cómo pagarlo. Solo dueño y administrador. */
export default function MensualidadLocal({ tenantId }: { tenantId: string }) {
  const [m, setM] = useState<Mensualidad | null>(null);
  useEffect(() => { miMensualidad(tenantId).then(setM); }, [tenantId]);
  if (!m || m.estado === "sin_suscripcion") return null;

  return (
    <Card className="mb-6" data-testid="mensualidad-local">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Receipt className="h-5 w-5 text-primary" /> Tu plan con Tablio</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={estadoMalo(m.estado) ? "destructive" : "secondary"}>{TEXTO_ESTADO[m.estado]}</Badge>
          <span className="text-sm text-foreground">{m.plan ?? "Plan a medida"} · {formatCLP(m.precio_mensual ?? 0)} al mes, cobro el día {m.dia_cobro}</span>
        </div>
        {m.estado === "prueba" && m.prueba_hasta && (
          <p className="text-sm text-muted-foreground">Estás en prueba hasta el {fechaDia(m.prueba_hasta)}. No se cobra nada hasta entonces.</p>
        )}
        {!!m.pendiente && (
          <p className="text-sm text-foreground">
            Por pagar: <strong>{formatCLP(m.pendiente)}</strong>
            {m.vence_el && <> · vence el {fechaDia(m.vence_el)}</>}
            {!!m.dias_atraso && <span className="text-destructive"> ({m.dias_atraso} días de atraso)</span>}
          </p>
        )}
        {!!m.pendiente && m.como_pagar && <p className="whitespace-pre-line rounded-xl bg-muted/60 p-3 text-xs text-muted-foreground">{m.como_pagar}</p>}
        {!!m.cobros?.length && (
          <ul className="divide-y divide-border rounded-xl border text-sm">
            {m.cobros.map((c) => (
              <li key={c.id} className="flex items-center justify-between px-3 py-2">
                <span className="text-foreground">{nombreMes(c.periodo)}</span>
                <span className="tabular-nums text-muted-foreground">{formatCLP(c.monto)} · {c.estado === "pagado" ? "Pagado" : "Pendiente"}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">Es lo único que Tablio te cobra. La plata de tus ventas va directo a tu cuenta.</p>
      </CardContent>
    </Card>
  );
}
