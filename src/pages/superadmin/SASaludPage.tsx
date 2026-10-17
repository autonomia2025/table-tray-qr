import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { historialSalud, saludPlataforma, type EstadoSalud, type Salud } from "@/lib/salud";

/**
 * Salud de la plataforma (fase 5.4): relojes automáticos, plata en movimiento, excepciones de caja,
 * auditorías y locales. La base se revisa sola cada hora; aquí se ve en vivo y su historia.
 */

const ESTADO: Record<EstadoSalud, { texto: string; clase: string; icono: typeof CheckCircle2 }> = {
  ok: { texto: "Todo en orden", clase: "border-emerald-500/40 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300", icono: CheckCircle2 },
  atencion: { texto: "Hay cosas para revisar", clase: "border-amber-400/60 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300", icono: AlertTriangle },
  problema: { texto: "Hay un problema", clase: "border-destructive/50 bg-destructive/10 text-destructive", icono: XCircle },
};
const PUNTO: Record<EstadoSalud, string> = { ok: "bg-emerald-500", atencion: "bg-amber-400", problema: "bg-destructive" };

const NOMBRE_RELOJ: Record<string, string> = {
  "revisar-pagos": "Revisar pagos que no vuelven",
  "revisar-salud": "Revisar la salud",
  "purgar-invitados": "Borrar invitados de más de 90 días",
  "purgar-claves-pasarela": "Borrar claves de pasarelas desconectadas",
  "generar-cobros": "Generar los cobros de la mensualidad",
};

const hora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("es-CL", { timeZone: "America/Santiago", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

function Dato({ etiqueta, valor, malo }: { etiqueta: string; valor: number; malo?: boolean }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className={`text-2xl font-bold tabular-nums ${malo && valor > 0 ? "text-destructive" : "text-foreground"}`}>{valor < 0 ? "—" : valor}</p>
      <p className="text-xs text-muted-foreground">{etiqueta}</p>
    </div>
  );
}

export default function SASaludPage() {
  const [salud, setSalud] = useState<Salud | null>(null);
  const [historia, setHistoria] = useState<{ id: number; estado: EstadoSalud; created_at: string }[]>([]);
  const [cargando, setCargando] = useState(true);

  const revisar = useCallback(async () => {
    setCargando(true);
    const [s, h] = await Promise.all([saludPlataforma(), historialSalud()]);
    setSalud(s);
    setHistoria(h);
    setCargando(false);
  }, []);
  useEffect(() => { revisar(); }, [revisar]);

  if (!salud) {
    return <div className="flex h-64 items-center justify-center">{cargando ? <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /> : <p className="text-sm text-muted-foreground">No se pudo revisar la salud.</p>}</div>;
  }
  const e = ESTADO[salud.estado];
  const Icono = e.icono;

  return (
    <div className="space-y-5 p-6" data-testid="salud-plataforma">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Salud de la plataforma</h1>
          <p className="text-sm text-muted-foreground">La base se revisa sola cada hora. Revisado: {hora(salud.revisado_at)}</p>
        </div>
        <Button variant="outline" size="sm" onClick={revisar} disabled={cargando}>
          {cargando ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />} Revisar ahora
        </Button>
      </div>

      <div className={`rounded-2xl border p-4 ${e.clase}`}>
        <p className="flex items-center gap-2 text-lg font-bold"><Icono className="h-5 w-5" /> {e.texto}</p>
        {[...salud.problemas, ...salud.avisos].length > 0 && (
          <ul className="mt-2 list-disc space-y-0.5 pl-6 text-sm">
            {salud.problemas.map((p) => <li key={p} className="font-semibold">{p}</li>)}
            {salud.avisos.map((a) => <li key={a}>{a}</li>)}
          </ul>
        )}
      </div>

      {historia.length > 0 && (
        <section aria-labelledby="historia-salud">
          <h2 id="historia-salud" className="mb-2 text-sm font-semibold text-muted-foreground">{historia.length === 1 ? "Primera revisión" : `Últimas ${historia.length} revisiones`} (una por hora)</h2>
          <div className="flex flex-wrap gap-1">
            {historia.map((h) => (
              <span key={h.id} title={`${hora(h.created_at)}: ${ESTADO[h.estado].texto}`} className={`h-5 w-2.5 rounded-sm ${PUNTO[h.estado]}`} />
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="plata" className="space-y-2">
        <h2 id="plata" className="text-sm font-semibold text-muted-foreground">Plata en movimiento</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Dato etiqueta="Pagos con pasarela sin confirmar (más de 1 hora)" valor={salud.pagos.sin_confirmar} malo />
          <Dato etiqueta="Cobros por devolver que la pasarela no devolvió" valor={salud.pagos.devoluciones_pendientes} malo />
          <Dato etiqueta="Reembolsos rechazados sin revisar" valor={salud.pagos.reembolsos_rechazados} malo />
        </div>
      </section>

      <section aria-labelledby="auditorias" className="space-y-2">
        <h2 id="auditorias" className="text-sm font-semibold text-muted-foreground">Auditorías automáticas (hallazgos)</h2>
        <div className="grid grid-cols-3 gap-3">
          <Dato etiqueta="Seguridad" valor={salud.auditorias.auditoria_seguridad ?? -1} malo />
          <Dato etiqueta="Plata" valor={salud.auditorias.auditoria_plata ?? -1} malo />
          <Dato etiqueta="Operación" valor={salud.auditorias.auditoria_operacion ?? -1} malo />
        </div>
      </section>

      <section aria-labelledby="locales" className="space-y-2">
        <h2 id="locales" className="text-sm font-semibold text-muted-foreground">Locales</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Dato etiqueta="Locales activos" valor={salud.locales.activos} />
          <Dato etiqueta="Con pedidos en 24 horas" valor={salud.locales.con_pedidos_hoy} />
          <Dato etiqueta="Pedidos en 24 horas" valor={salud.locales.pedidos_24h} />
          <Dato etiqueta="Activaciones vencidas" valor={salud.locales.activaciones_vencidas} />
          <Dato etiqueta="Con excepciones de caja" valor={salud.excepciones.locales_con_excepciones} />
          <Dato etiqueta="Diferencias con la pasarela abiertas" valor={salud.excepciones.diferencias_pasarela} />
          <Dato etiqueta="Boletas atrasadas" valor={salud.excepciones.boletas_atrasadas} />
        </div>
      </section>

      <section aria-labelledby="relojes" className="space-y-2">
        <h2 id="relojes" className="text-sm font-semibold text-muted-foreground">Relojes automáticos</h2>
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr><th className="px-3 py-2">Qué hace</th><th className="px-3 py-2">Última vez</th><th className="px-3 py-2">Resultado</th><th className="px-3 py-2 text-right">Fallas 24 h</th></tr>
            </thead>
            <tbody className="divide-y">
              {salud.relojes.map((r) => (
                <tr key={r.nombre}>
                  <td className="px-3 py-2 text-foreground">{NOMBRE_RELOJ[r.nombre] ?? r.nombre}{!r.activo && <span className="ml-1 text-xs text-destructive">(apagado)</span>}</td>
                  <td className="px-3 py-2 text-muted-foreground">{hora(r.ultima_vez)}</td>
                  <td className="px-3 py-2">{r.resultado === "succeeded" ? <span className="text-emerald-700 dark:text-emerald-400">Bien</span> : r.resultado ? <span className="text-destructive" title={r.detalle ?? ""}>Falló</span> : <span className="text-muted-foreground">Aún no corre</span>}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${r.fallas_24h > 0 ? "font-bold text-destructive" : ""}`}>{r.fallas_24h}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          Llamadas del reloj a las funciones en 24 horas: {salud.llamadas.total_24h}{salud.llamadas.fallidas_24h > 0 ? `, ${salud.llamadas.fallidas_24h} sin respuesta correcta (última ${hora(salud.llamadas.ultima_falla)})` : ", todas bien"}.
        </p>
      </section>
    </div>
  );
}
