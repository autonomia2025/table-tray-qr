import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Gift, Stamp, Sparkles } from "lucide-react";
import { useTarjetaSellos } from "@/hooks/useTarjetaSellos";
import { formatCLP } from "@/lib/format";
import { selloNuevo } from "@/lib/sellos";
import CuentaComensal from "@/components/comensal/CuentaComensal";

/**
 * Tarjeta de sellos del comensal (fase 3.7): el sello "cae" sobre la tarjeta cuando acaba de ganarlo
 * (al pagar con la app, cuando el mozo registra su cobro o al guardar su cuenta después de pagar).
 * Al completarla, el premio aparece con un código para mostrarle al mozo.
 */

// Pequeña inclinación distinta para cada sello, como uno puesto a mano
const giro = (i: number) => ((i * 37) % 17) - 8;

interface Props {
  tenantId?: string;
  branchId?: string | null;
  nombreLocal: string;
  color: string;
  /** Volver a consultar cada tanto (seguimiento: el mozo puede cobrar mientras el cliente mira) */
  vigilar?: boolean;
  className?: string;
}

export default function TarjetaSellos({ tenantId, branchId, nombreLocal, color, vigilar, className = "" }: Props) {
  const { data: t, refetch, isFetching } = useTarjetaSellos(tenantId, branchId);
  const [cuentaAbierta, setCuentaAbierta] = useState(false);
  const [animar, setAnimar] = useState(false);
  const visto = useRef<string | null>(null);

  useEffect(() => {
    if (!vigilar) return;
    const id = setInterval(() => refetch(), 20_000);
    return () => clearInterval(id);
  }, [vigilar, refetch]);

  // Se decide una vez por movimiento si el sello "cae", y solo con la respuesta fresca de la base
  useEffect(() => {
    const clave = t?.ultimo?.payment_id ?? null;
    if (!tenantId || !t || isFetching || clave === visto.current) return;
    visto.current = clave;
    if (selloNuevo(tenantId, t)) {
      setAnimar(true);
      const vibrar = setTimeout(() => navigator.vibrate?.([18, 40, 26]), 900);
      return () => clearTimeout(vibrar);
    }
  }, [t, tenantId, isFetching]);

  const p = t?.programa;
  const completo = !!(t?.registrado && t.ultimo?.premio && t.sellos === 0 && animar);
  const llenos = completo ? p?.meta ?? 0 : t?.sellos ?? 0;
  const indiceNuevo = animar && t?.ultimo?.sello ? llenos - 1 : -1;

  const texto = useMemo(() => {
    if (!p || !t) return "";
    if (!t.registrado) {
      return t.pendiente
        ? "Guarda tu cuenta y el sello de hoy es tuyo."
        : `Junta ${p.meta} visitas y llévate ${p.premio}.`;
    }
    if (p.tipo === "points") return `${t.puntos ?? 0} de ${p.puntos_meta} puntos para ${p.premio}.`;
    if (completo) return `¡Completaste tu tarjeta! Ganaste ${p.premio}.`;
    const faltan = p.meta - (t.sellos ?? 0);
    const base = `Te ${faltan === 1 ? "falta 1 visita" : `faltan ${faltan} visitas`} para ${p.premio}.`;
    if (animar && t.ultimo?.sello) return `¡Sello ${t.sellos} de ${p.meta}! ${base}`;
    if (t.hoy_sumado) return `Hoy ya sumaste tu sello. ${base}`;
    return p.monto_minimo > 0 ? `Desde ${formatCLP(p.monto_minimo)} sumas un sello por visita. ${base}` : base;
  }, [p, t, completo, animar]);

  if (!p || !t) return null;

  return (
    <div className={`relative overflow-hidden rounded-2xl border border-border bg-card p-5 text-left ${className}`} data-testid="tarjeta-sellos">
      <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-10" style={{ backgroundColor: color }} />
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Stamp className="h-4 w-4" style={{ color }} />
          <span className="text-sm font-bold text-card-foreground">Tu tarjeta en {nombreLocal}</span>
        </div>
        {t.registrado && (t.total ?? 0) > 0 && (
          <span className="text-[11px] text-muted-foreground">{t.total} {t.total === 1 ? "visita" : "visitas"}</span>
        )}
      </div>

      {p.tipo === "stamps" ? (
        <div className="mt-4 flex flex-wrap justify-center gap-2.5" aria-hidden>
          {Array.from({ length: p.meta }).map((_, i) => {
            const lleno = i < llenos;
            const ultimo = i === p.meta - 1;
            const fantasma = !t.registrado && t.pendiente && i === 0;
            return (
              <div key={i} className="relative flex h-11 w-11 items-center justify-center">
                <div
                  className="absolute inset-0 rounded-full border-2 border-dashed"
                  style={{ borderColor: fantasma ? color : "hsl(var(--border))" }}
                />
                {fantasma && (
                  <motion.div
                    className="absolute inset-0 rounded-full"
                    style={{ backgroundColor: color }}
                    animate={{ opacity: [0.08, 0.28, 0.08] }}
                    transition={{ duration: 1.8, repeat: Infinity }}
                  />
                )}
                {!lleno && ultimo && <Gift className="h-4 w-4 text-muted-foreground" />}
                {lleno && (
                  <motion.div
                    className="absolute inset-0 flex items-center justify-center rounded-full text-white shadow-sm"
                    style={{ backgroundColor: color }}
                    initial={i === indiceNuevo ? { y: -150, scale: 2.4, rotate: -30, opacity: 0 } : false}
                    animate={{ y: 0, scale: 1, rotate: giro(i), opacity: 1 }}
                    transition={i === indiceNuevo ? { delay: 0.45, type: "spring", stiffness: 240, damping: 13 } : { duration: 0 }}
                  >
                    {ultimo && completo ? <Gift className="h-5 w-5" /> : <Stamp className="h-5 w-5" />}
                  </motion.div>
                )}
                {i === indiceNuevo && (
                  <motion.span
                    className="absolute inset-0 rounded-full"
                    style={{ border: `3px solid ${color}` }}
                    initial={{ scale: 0.7, opacity: 0 }}
                    animate={{ scale: [0.7, 2.1], opacity: [0.7, 0] }}
                    transition={{ delay: 0.85, duration: 0.7 }}
                  />
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-4 h-3 overflow-hidden rounded-full bg-muted">
          <motion.div
            className="h-full rounded-full"
            style={{ backgroundColor: color }}
            initial={{ width: animar ? "0%" : `${Math.min(100, ((t.puntos ?? 0) / p.puntos_meta) * 100)}%` }}
            animate={{ width: `${Math.min(100, ((t.puntos ?? 0) / p.puntos_meta) * 100)}%` }}
            transition={{ delay: 0.3, duration: 0.9 }}
          />
        </div>
      )}

      {completo && (
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          {Array.from({ length: 14 }).map((_, i) => (
            <motion.span
              key={i}
              className="absolute left-1/2 top-1/2 h-2 w-2 rounded-full"
              style={{ backgroundColor: i % 3 === 0 ? "hsl(var(--accent-foreground))" : color }}
              initial={{ x: 0, y: 0, opacity: 0 }}
              animate={{ x: Math.cos((i / 14) * 2 * Math.PI) * 130, y: Math.sin((i / 14) * 2 * Math.PI) * 80, opacity: [0, 1, 0] }}
              transition={{ delay: 1.1, duration: 1.1 }}
            />
          ))}
        </div>
      )}

      <p className="mt-4 text-center text-sm text-card-foreground" aria-live="polite">
        {completo && <Sparkles className="mr-1 inline h-4 w-4" style={{ color }} />}
        {texto}
      </p>

      {t.registrado && t.ultimo?.retroactivo && animar && (
        <p className="mt-1 text-center text-[11px] text-muted-foreground">Te sumamos el sello de lo que pagaste antes de guardar tu cuenta.</p>
      )}

      {t.premios && t.premios.length > 0 && (
        <div className="mt-4 space-y-2">
          {t.premios.map((r) => (
            <motion.div
              key={r.id}
              initial={completo ? { opacity: 0, y: 10 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: completo ? 1.4 : 0 }}
              className="rounded-xl border-2 border-dashed p-3 text-center"
              style={{ borderColor: color }}
            >
              <p className="text-xs font-semibold text-foreground">🎁 {r.descripcion}</p>
              <p className="mt-1 font-mono text-2xl font-extrabold tracking-[0.35em] text-foreground" data-testid="codigo-premio">{r.codigo}</p>
              <p className="text-[11px] text-muted-foreground">Muéstrale este código al mozo para que te lo entregue.</p>
            </motion.div>
          ))}
        </div>
      )}

      {!t.registrado && (
        <button
          onClick={() => setCuentaAbierta(true)}
          className="mt-4 w-full rounded-xl py-3 text-sm font-semibold text-white"
          style={{ backgroundColor: color }}
        >
          {t.pendiente ? "Guardar mi cuenta y mi sello" : "Guardar mi cuenta"}
        </button>
      )}
      <CuentaComensal abierto={cuentaAbierta} onCambiar={setCuentaAbierta} nombreLocal={nombreLocal} color={color} />
    </div>
  );
}
