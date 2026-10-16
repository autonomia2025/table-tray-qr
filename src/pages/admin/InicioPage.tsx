import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowRight, BarChart3, Loader2, Megaphone, Sparkles, Users, Wallet } from "lucide-react";
import { useAdmin } from "@/contexts/AdminContext";
import { formatCLP } from "@/lib/format";
import { historiaDelLocal, nombreDia, variacion, type Historia } from "@/lib/reportes";
import { fechaLarga, propinasPorPagar, type PropinasPorPagar } from "@/lib/propinasEquipo";
import { excepcionesCaja } from "@/lib/excepciones";
import PrimerosPasos from "@/components/admin/PrimerosPasos";
import { alcanceCampana, campanasDelLocal } from "@/lib/campanas";
import { tiene, useModulos } from "@/lib/modulos";
import { usePermiso } from "@/hooks/usePermiso";

// Inicio del dueño (fase 3.6, brief 5.5): cuenta en palabras simples cómo le fue al local, en vez de
// mostrar veinte gráficos. Los datos los calcula la base (historia_del_local).

function Comparacion({ actual, antes, contra }: { actual: number; antes: number; contra: string }) {
  const v = variacion(actual, antes);
  if (v === null) return null;
  if (v === 0) return <> Igual que {contra}.</>;
  return (
    <>
      {" "}Es <strong className={v > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}>{Math.abs(v)}% {v > 0 ? "más" : "menos"}</strong> que {contra} ({formatCLP(antes)}).
    </>
  );
}

export default function InicioPage() {
  const { branchId, slug, tenantName, tenantId } = useAdmin();
  const puede = usePermiso(tenantId);
  const modulos = useModulos(tenantId);
  const puedeCampanas = puede("enviar_campanas") && tiene(modulos, "campanas");
  // Sugerencia de campaña (fase 7.1): clientes que no vienen hace 30 días y ninguna campaña en 14 días
  const [dormidos, setDormidos] = useState(0);
  const [h, setH] = useState<Historia | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [propinas, setPropinas] = useState<PropinasPorPagar | null>(null);
  const [excepciones, setExcepciones] = useState(0);

  useEffect(() => {
    if (!branchId) return;
    historiaDelLocal(branchId).then((r) => {
      if (r.ok === false) setError(r.error);
      else setH(r.dato);
    });
    propinasPorPagar(branchId).then(setPropinas);
    excepcionesCaja(branchId).then((l) => setExcepciones(l?.length ?? 0));
  }, [branchId]);

  useEffect(() => {
    if (!tenantId || !puedeCampanas) return;
    Promise.all([alcanceCampana(tenantId, "dormidos", null), campanasDelLocal(tenantId)]).then(([a, lista]) => {
      const reciente = lista.some((c) => c.enviada_at && Date.now() - new Date(c.enviada_at).getTime() < 14 * 86_400_000);
      setDormidos(!reciente && a ? a.total - a.descansando : 0);
    });
  }, [tenantId, puedeCampanas]);

  if (error) return <p className="text-sm text-muted-foreground">{error}</p>;
  if (!h) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  const u = h.ultimo;
  const cuando = u ? (u.es_ayer ? `Ayer (${nombreDia(u.dia)})` : `El ${nombreDia(u.dia)}`) : "";
  const frases: React.ReactNode[] = [];
  if (u) {
    frases.push(<>{cuando} vendiste <strong>{formatCLP(u.ventas)}</strong> en {u.pagos} {u.pagos === 1 ? "pago" : "pagos"}.
      {h.mismo_dia_semana_pasada && <Comparacion actual={u.ventas} antes={h.mismo_dia_semana_pasada.ventas} contra={`el ${nombreDia(h.mismo_dia_semana_pasada.dia).split(" ")[0]} pasado`} />}</>);
    if (u.mejor_plato) frases.push(<>Tu plato estrella fue <strong>{u.mejor_plato.nombre}</strong> ({u.mejor_plato.cantidad} vendidos).</>);
    if (u.mejor_zona) frases.push(<>La zona que más vendió fue <strong>{u.mejor_zona.zona}</strong> ({formatCLP(u.mejor_zona.ventas)}).</>);
    if (u.hora_pico) frases.push(<>La hora más fuerte fue de <strong>{String(u.hora_pico.hora).padStart(2, "0")}:00 a {String((u.hora_pico.hora + 1) % 24).padStart(2, "0")}:00</strong>.</>);
    if (u.mozo) frases.push(<><strong>{u.mozo.nombre}</strong> fue quien más vendió ({formatCLP(u.mozo.ventas)}).</>);
    frases.push(<>Cada cliente gastó en promedio <strong>{formatCLP(u.ticket)}</strong>{u.propinas > 0 && <> y dejaron {formatCLP(u.propinas)} en propinas para el equipo</>}.</>);
    if (u.calificacion !== null) frases.push(<>Los clientes calificaron su visita con <strong>⭐ {String(u.calificacion).replace(".", ",")}</strong>.</>);
  }
  const alertas: React.ReactNode[] = [];
  if (h.alertas?.agotados.length) alertas.push(<>Están agotados: <strong>{h.alertas.agotados.join(", ")}</strong>. Actívalos en Menú apenas vuelvan.</>);
  if (h.alertas?.plato_lento) alertas.push(<><strong>{h.alertas.plato_lento.nombre}</strong> está tardando {h.alertas.plato_lento.mediana_min} min en salir (la carta dice {h.alertas.plato_lento.objetivo_min}). Conviene revisar esa preparación.</>);
  // Propinas que el local le debe al equipo (art. 64: con tarjeta, se entregan en 7 días hábiles)
  const vencidas = propinas?.pendientes.filter((p) => p.vencida) ?? [];
  const porPagar = propinas?.pendientes.reduce((t, p) => t + p.monto, 0) ?? 0;
  if (vencidas.length) {
    alertas.push(<>Tienes propinas <strong>vencidas</strong> por pagar: {vencidas.map((p) => `${p.nombre} ${formatCLP(p.monto)}`).join(", ")}. Regístralas en <Link className="underline" to={`/admin/${slug}/caja`}>Caja → Propinas del equipo</Link>.</>);
  } else if (porPagar > 0 && propinas) {
    const proximo = [...propinas.pendientes].sort((a, b) => a.vence.localeCompare(b.vence))[0];
    alertas.push(<>Le debes <strong>{formatCLP(porPagar)}</strong> en propinas al equipo. El primer plazo vence el {fechaLarga(proximo.vence)} (<Link className="underline" to={`/admin/${slug}/caja`}>Caja → Propinas del equipo</Link>).</>);
  }
  if (excepciones > 0) alertas.push(<>Hay <strong>{excepciones} {excepciones === 1 ? "excepción" : "excepciones"} de caja</strong> esperando a alguien (por ejemplo, un cobro por devolver o una boleta sin marcar). Revísalas en <Link className="underline" to={`/admin/${slug}/caja`}>Caja → Excepciones</Link>.</>);
  if (h.alertas && h.alertas.perdido_7_dias > 0) alertas.push(<>Esta semana perdiste <strong>{formatCLP(h.alertas.perdido_7_dias)}</strong> en mesas que se fueron sin pagar.</>);

  const accesos = [
    { to: `/admin/${slug}/reportes`, texto: "Ver reportes", icono: BarChart3 },
    { to: `/admin/${slug}/caja`, texto: "Ir a la caja", icono: Wallet },
    { to: `/admin/${slug}/equipo`, texto: "Ver al equipo", icono: Users },
  ];

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Así le fue a {tenantName || "tu local"}</h2>
        <p className="text-sm text-muted-foreground">Un resumen en palabras simples. El detalle está en Reportes.</p>
      </div>

      {/* Hoy, en vivo */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Hoy llevas</p>
          <p className="text-3xl font-extrabold text-foreground">{formatCLP(h.hoy.ventas)}</p>
          <p className="text-xs text-muted-foreground">{h.hoy.pagos} {h.hoy.pagos === 1 ? "pago" : "pagos"}</p>
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Mesas con gente ahora</p>
          <p className="text-3xl font-extrabold text-foreground">{h.hoy.mesas_abiertas}</p>
          {h.semana && (
            <p className="text-xs text-muted-foreground">
              Últimos 7 días: {formatCLP(h.semana.ventas)}
              {variacion(h.semana.ventas, h.semana.anterior) !== null && ` (${variacion(h.semana.ventas, h.semana.anterior)! >= 0 ? "+" : ""}${variacion(h.semana.ventas, h.semana.anterior)}% vs la semana anterior)`}
            </p>
          )}
        </div>
      </div>

      {/* Lo que le falta a un local nuevo para abrir (fase 5.2) */}
      {branchId && <PrimerosPasos branchId={branchId} slug={slug} />}

      {/* La historia */}
      <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border bg-card p-5" aria-labelledby="historia">
        <h3 id="historia" className="mb-3 flex items-center gap-2 font-bold text-foreground">
          <Sparkles className="h-5 w-5 text-primary" /> {u ? (u.es_ayer ? "Lo de anoche" : "Tu último día con ventas") : "Tu local"}
        </h3>
        {frases.length ? (
          <ul className="space-y-2.5 text-[15px] leading-relaxed text-foreground">
            {frases.map((f, i) => <li key={i}>{f}</li>)}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Todavía no hay ventas para contarte. Cuando empiecen los pedidos, aquí verás cómo le va a tu local.</p>
        )}
      </motion.section>

      {alertas.length > 0 && (
        <section className="rounded-2xl border border-amber-400/60 bg-amber-50 p-5 dark:bg-amber-950/40" aria-labelledby="ojo">
          <h3 id="ojo" className="mb-2 flex items-center gap-2 font-bold text-foreground">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" /> Para tener en cuenta
          </h3>
          <ul className="space-y-2 text-sm text-foreground">
            {alertas.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </section>
      )}

      {dormidos >= 3 && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-5" aria-label="Sugerencia de campaña">
          <p className="flex items-start gap-2 text-sm text-foreground">
            <Megaphone className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <span><strong>{dormidos} clientes</strong> no vienen hace más de 30 días. Mándales una campaña para invitarlos de vuelta.</span>
          </p>
          <Link to={`/admin/${slug}/campanas?publico=dormidos`} className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
            Escribirles <ArrowRight className="h-4 w-4" />
          </Link>
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        {accesos.map(({ to, texto, icono: Icono }) => (
          <Link key={to} to={to} className="inline-flex items-center gap-2 rounded-xl border bg-card px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-accent">
            <Icono className="h-4 w-4 text-muted-foreground" /> {texto} <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        ))}
      </div>
    </div>
  );
}
