import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { CheckCircle2, Circle, Rocket } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { marcarPaso, primerosPasos, type ClavePaso, type PrimerosPasos as Pasos } from "@/lib/primerosPasos";

/**
 * Primeros pasos (fase 5.2): lo que le falta a un local nuevo para abrir, en orden y con el enlace a dónde se
 * hace. Lo calcula la base; se va marcando solo. El dueño puede ocultarlo.
 */

const TEXTOS: Record<ClavePaso, { titulo: string; detalle: string; ir: string; boton: string }> = {
  marca: { titulo: "Tu marca", detalle: "Logo, color y mensaje de bienvenida que ven tus clientes.", ir: "sucursal", boton: "Ir a Sucursal" },
  carta: { titulo: "Tu carta", detalle: "Al menos 3 platos con precio. Puedes pegarla entera de una vez.", ir: "menu", boton: "Ir al Menú" },
  equipo: { titulo: "Tu equipo", detalle: "Invita a tus mozos, caja y cocina con un enlace.", ir: "equipo", boton: "Ir a Equipo" },
  cobro: { titulo: "Cobrar con la app", detalle: "Conecta tu Webpay: la plata va directo a tu cuenta.", ir: "sucursal", boton: "Conectar" },
  qr: { titulo: "QR de las mesas", detalle: "Descarga o imprime las tarjetas con el QR y el código de cada mesa.", ir: "qr", boton: "Ir a QR" },
  prueba: { titulo: "Un pedido de prueba", detalle: "Escanea una mesa y pide algo, como lo haría un cliente.", ir: "", boton: "Abrir la carta" },
  abrir: { titulo: "Abrir el local", detalle: "Cuando todo esté listo, marca el local como abierto.", ir: "sucursal", boton: "Ir a Sucursal" },
};

export default function PrimerosPasos({ branchId, slug }: { branchId: string; slug: string }) {
  const [pasos, setPasos] = useState<Pasos | null>(null);
  const [cartaDePrueba, setCartaDePrueba] = useState<string | null>(null);

  useEffect(() => {
    primerosPasos(branchId).then(setPasos);
    supabase.from("tables").select("qr_token").eq("branch_id", branchId).not("qr_token", "is", null).order("number").limit(1).maybeSingle()
      .then(({ data }) => setCartaDePrueba(data?.qr_token ? `/${slug}/menu?t=${data.qr_token}` : null));
  }, [branchId, slug]);

  if (!pasos || pasos.ocultos || pasos.hechos === pasos.total) return null;
  const siguiente = pasos.pasos.find((p) => !p.hecho)?.clave;

  return (
    <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border bg-card p-5" aria-labelledby="primeros-pasos" data-testid="primeros-pasos">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id="primeros-pasos" className="flex items-center gap-2 font-bold text-foreground"><Rocket className="h-5 w-5 text-primary" /> Para abrir tu local</h3>
          <p className="text-sm text-muted-foreground">Llevas {pasos.hechos} de {pasos.total}. Se marcan solos a medida que avanzas.</p>
        </div>
        <Button variant="ghost" size="sm" onClick={async () => { await marcarPaso(branchId, "ocultar"); setPasos({ ...pasos, ocultos: true }); }}>Ocultar</Button>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pasos.hechos} aria-valuemin={0} aria-valuemax={pasos.total}>
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(pasos.hechos / pasos.total) * 100}%` }} />
      </div>
      <ol className="mt-4 space-y-2">
        {pasos.pasos.map((p) => {
          const t = TEXTOS[p.clave];
          const destino = p.clave === "prueba" ? cartaDePrueba : `/admin/${slug}/${t.ir}`;
          return (
            <li key={p.clave} className={`flex items-start gap-3 rounded-xl px-3 py-2.5 ${p.clave === siguiente ? "bg-accent" : ""}`}>
              {p.hecho
                ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Hecho" />
                : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-label="Pendiente" />}
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-semibold ${p.hecho ? "text-muted-foreground line-through" : "text-foreground"}`}>{t.titulo}</p>
                {!p.hecho && <p className="text-xs text-muted-foreground">{t.detalle}{p.clave === "carta" && p.platos ? ` Llevas ${p.platos}.` : ""}</p>}
              </div>
              {!p.hecho && destino && (
                p.clave === "prueba"
                  ? <Button asChild size="sm" variant={p.clave === siguiente ? "default" : "outline"} className="shrink-0"><a href={destino} target="_blank" rel="noopener noreferrer">{t.boton}</a></Button>
                  : <Button asChild size="sm" variant={p.clave === siguiente ? "default" : "outline"} className="shrink-0"><Link to={destino}>{t.boton}</Link></Button>
              )}
            </li>
          );
        })}
      </ol>
    </motion.section>
  );
}
