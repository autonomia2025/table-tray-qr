import { useCallback, useEffect, useMemo, useState } from "react";
import { Banknote, ChefHat, Download, Loader2, Receipt, RefreshCw, ShoppingBag, Star, Users } from "lucide-react";
import { useAdmin } from "@/contexts/AdminContext";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ReportKPICard from "@/components/reports/ReportKPICard";
import { formatCLP } from "@/lib/format";
import { exportToCSV } from "@/lib/export-utils";
import { DIAS_SEMANA, diaNegocio, reporteLocal, variacion, type Reporte } from "@/lib/reportes";

// Reportes (fase 3.6): los calcula la base por día de negocio (hora de Chile). Ventas = lo cobrado
// por consumo menos lo reembolsado (sin propinas), igual que la caja.

const PERIODOS = [
  { id: "hoy", texto: "Hoy", dias: 0 },
  { id: "7", texto: "7 días", dias: 6 },
  { id: "30", texto: "30 días", dias: 29 },
  { id: "90", texto: "90 días", dias: 89 },
] as const;

// Las horas del día de negocio: de 06:00 a 05:00
const HORAS = [...Array.from({ length: 18 }, (_, i) => i + 6), 0, 1, 2, 3, 4, 5];

function Barra({ valor, max, etiqueta, detalle }: { valor: number; max: number; etiqueta: string; detalle: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm">
      <span className="truncate text-foreground">{etiqueta}</span>
      <div className="h-2.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${max > 0 ? Math.max(2, (valor / max) * 100) : 0}%` }} />
      </div>
      <span className="text-right tabular-nums text-muted-foreground">{detalle}</span>
    </div>
  );
}

export default function ReportesPage() {
  const { branchId } = useAdmin();
  const { toast } = useToast();
  const [periodo, setPeriodo] = useState<(typeof PERIODOS)[number]["id"]>("7");
  const [r, setR] = useState<Reporte | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    if (!branchId) return;
    setCargando(true);
    const p = PERIODOS.find((x) => x.id === periodo)!;
    const res = await reporteLocal(branchId, diaNegocio(p.dias), diaNegocio(0));
    setCargando(false);
    if (res.ok === false) { toast({ title: "No se pudo cargar el reporte", description: res.error, variant: "destructive" }); return; }
    setR(res.dato);
  }, [branchId, periodo, toast]);

  useEffect(() => { cargar(); }, [cargar]);

  const calor = useMemo(() => {
    const mapa = new Map<string, number>();
    let max = 0;
    let pico: { d: number; h: number; v: number } | null = null;
    for (const x of r?.horas ?? []) {
      mapa.set(`${x.dia_semana}-${x.hora}`, x.ventas);
      if (x.ventas > max) max = x.ventas;
      if (!pico || x.ventas > pico.v) pico = { d: x.dia_semana, h: x.hora, v: x.ventas };
    }
    return { mapa, max, pico };
  }, [r]);

  const exportar = () => {
    if (!r) return;
    exportToCSV(r.por_dia.map((d) => ({ Dia: d.dia, Ventas: d.ventas, Pagos: d.pagos })), `ventas-por-dia-${r.desde}-${r.hasta}`);
    if (r.platos.length) exportToCSV(r.platos.map((p) => ({ Plato: p.nombre, Cantidad: p.cantidad, Ventas: p.ventas })), `platos-${r.desde}-${r.hasta}`);
  };

  const maxDia = Math.max(0, ...(r?.por_dia ?? []).map((d) => d.ventas));
  const maxPlato = Math.max(0, ...(r?.platos ?? []).map((p) => p.ventas));
  const maxCat = Math.max(0, ...(r?.categorias ?? []).map((c) => c.ventas));
  const totalCanales = r ? r.canales.app + r.canales.efectivo + r.canales.pos + (r.canales.transferencia ?? 0) : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-foreground">Reportes</h1>
          <p className="text-sm text-muted-foreground">Por día de negocio (de 06:00 a 05:59). Ventas sin propinas y descontando reembolsos.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-lg bg-muted p-1" role="group" aria-label="Período">
            {PERIODOS.map((p) => (
              <button key={p.id} onClick={() => setPeriodo(p.id)} aria-pressed={periodo === p.id}
                className={`rounded-md px-3 py-1 text-sm font-semibold transition-colors ${periodo === p.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}>
                {p.texto}
              </button>
            ))}
          </div>
          <button onClick={cargar} className="rounded-lg border border-border p-2 text-foreground hover:bg-accent" aria-label="Actualizar">
            <RefreshCw className={`h-4 w-4 ${cargando ? "animate-spin" : ""}`} />
          </button>
          <button onClick={exportar} disabled={!r} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-40">
            <Download className="h-4 w-4" /> Exportar CSV
          </button>
        </div>
      </div>

      {!r ? (
        <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <Tabs defaultValue="resumen" className="space-y-4">
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value="resumen">Resumen</TabsTrigger>
            <TabsTrigger value="platos">Platos</TabsTrigger>
            <TabsTrigger value="cocina">Cocina</TabsTrigger>
            <TabsTrigger value="horas">Horas</TabsTrigger>
            <TabsTrigger value="mesas">Mesas y zonas</TabsTrigger>
            <TabsTrigger value="clientes">Clientes</TabsTrigger>
          </TabsList>

          {/* ── Resumen ── */}
          <TabsContent value="resumen" className="space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <ReportKPICard label="Ventas" value={formatCLP(r.resumen.ventas)} icon={Banknote} trend={variacion(r.resumen.ventas, r.anterior.ventas) ?? undefined} />
              <ReportKPICard label="Pagos" value={r.resumen.pagos} icon={Receipt} trend={variacion(r.resumen.pagos, r.anterior.pagos) ?? undefined} />
              <ReportKPICard label="Ticket promedio" value={formatCLP(r.resumen.ticket)} icon={ShoppingBag} trend={variacion(r.resumen.ticket, r.anterior.ticket) ?? undefined} />
              <ReportKPICard label="Pedidos" value={r.resumen.pedidos} icon={ChefHat} />
              <ReportKPICard label="Visitas (mesas cerradas)" value={r.resumen.visitas} icon={Users} />
              <ReportKPICard label="Propinas del equipo" value={formatCLP(r.resumen.propinas)} icon={Star} subtitle={r.resumen.reembolsado > 0 ? `Reembolsado: ${formatCLP(r.resumen.reembolsado)}` : undefined} />
            </div>
            <section className="rounded-2xl border bg-card p-4" aria-labelledby="por-dia">
              <h3 id="por-dia" className="mb-3 font-bold text-foreground">Ventas por día</h3>
              <div className="flex h-40 items-end gap-1 overflow-x-auto" role="img" aria-label="Ventas por día">
                {r.por_dia.map((d) => (
                  <div key={d.dia} className="flex min-w-[14px] flex-1 flex-col items-center gap-1" title={`${d.dia}: ${formatCLP(d.ventas)}`}>
                    <div className="w-full rounded-t-md bg-primary" style={{ height: `${maxDia > 0 ? Math.max(d.ventas > 0 ? 3 : 0, (d.ventas / maxDia) * 100) : 0}%` }} />
                  </div>
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                <span>{r.desde}</span><span>{r.hasta}</span>
              </div>
            </section>
            <section className="rounded-2xl border bg-card p-4" aria-labelledby="canales">
              <h3 id="canales" className="mb-3 font-bold text-foreground">Cómo te pagaron</h3>
              <div className="space-y-2">
                <Barra etiqueta="App (QR)" valor={r.canales.app} max={totalCanales} detalle={formatCLP(r.canales.app)} />
                <Barra etiqueta="Efectivo" valor={r.canales.efectivo} max={totalCanales} detalle={formatCLP(r.canales.efectivo)} />
                <Barra etiqueta="POS" valor={r.canales.pos} max={totalCanales} detalle={formatCLP(r.canales.pos)} />
                {(r.canales.transferencia ?? 0) > 0 && (
                  <Barra etiqueta="Transferencia" valor={r.canales.transferencia ?? 0} max={totalCanales} detalle={formatCLP(r.canales.transferencia ?? 0)} />
                )}
              </div>
            </section>
          </TabsContent>

          {/* ── Platos ── */}
          <TabsContent value="platos" className="space-y-4">
            <section className="rounded-2xl border bg-card p-4" aria-labelledby="top-platos">
              <h3 id="top-platos" className="mb-3 font-bold text-foreground">Lo que más vendes</h3>
              {r.platos.length ? (
                <div className="space-y-2">{r.platos.map((p) => <Barra key={p.nombre} etiqueta={p.nombre} valor={p.ventas} max={maxPlato} detalle={`${p.cantidad} · ${formatCLP(p.ventas)}`} />)}</div>
              ) : <p className="text-sm text-muted-foreground">Sin ventas en este período.</p>}
            </section>
            <section className="rounded-2xl border bg-card p-4" aria-labelledby="categorias">
              <h3 id="categorias" className="mb-3 font-bold text-foreground">Por categoría</h3>
              <div className="space-y-2">{r.categorias.map((c) => <Barra key={c.nombre} etiqueta={c.nombre} valor={c.ventas} max={maxCat} detalle={formatCLP(c.ventas)} />)}</div>
            </section>
            {r.sin_ventas.length > 0 && (
              <section className="rounded-2xl border bg-card p-4" aria-labelledby="sin-ventas">
                <h3 id="sin-ventas" className="mb-1 font-bold text-foreground">Nadie los pidió en este período</h3>
                <p className="mb-3 text-xs text-muted-foreground">Quizás convenga cambiarles la foto, el precio o sacarlos de la carta.</p>
                <div className="flex flex-wrap gap-1.5">{r.sin_ventas.map((n) => <span key={n} className="rounded-full bg-muted px-2.5 py-1 text-xs text-foreground">{n}</span>)}</div>
              </section>
            )}
          </TabsContent>

          {/* ── Cocina ── */}
          <TabsContent value="cocina">
            <section className="rounded-2xl border bg-card p-4" aria-labelledby="cocina">
              <h3 id="cocina" className="mb-1 font-bold text-foreground">Qué traba la cocina</h3>
              <p className="mb-3 text-xs text-muted-foreground">Desde que se acepta hasta que está listo. "La mitad de las veces" es la mediana; "9 de cada 10" muestra los días malos.</p>
              {r.cocina.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">Plato</th><th className="py-2 pr-3 font-medium">Estación</th>
                      <th className="py-2 pr-3 text-right font-medium">Preparados</th><th className="py-2 pr-3 text-right font-medium">La mitad de las veces</th>
                      <th className="py-2 pr-3 text-right font-medium">9 de cada 10</th><th className="py-2 text-right font-medium">Carta</th>
                    </tr></thead>
                    <tbody className="divide-y divide-border">
                      {r.cocina.map((c) => {
                        const lento = !!c.objetivo_min && c.mediana_min >= c.objetivo_min * 1.5;
                        return (
                          <tr key={`${c.nombre}-${c.estacion}`}>
                            <td className="py-2 pr-3 font-medium text-foreground">{c.nombre}</td>
                            <td className="py-2 pr-3 text-muted-foreground">{c.estacion ?? "—"}</td>
                            <td className="py-2 pr-3 text-right tabular-nums">{c.preparados}</td>
                            <td className={`py-2 pr-3 text-right tabular-nums ${lento ? "font-bold text-destructive" : ""}`}>{String(c.mediana_min).replace(".", ",")} min</td>
                            <td className="py-2 pr-3 text-right tabular-nums">{String(c.p90_min).replace(".", ",")} min</td>
                            <td className="py-2 text-right tabular-nums text-muted-foreground">{c.objetivo_min ? `${c.objetivo_min} min` : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : <p className="text-sm text-muted-foreground">Aún no hay suficientes platos preparados en este período (se necesitan al menos 3 de cada uno).</p>}
            </section>
          </TabsContent>

          {/* ── Horas (mapa de calor) ── */}
          <TabsContent value="horas">
            <section className="rounded-2xl border bg-card p-4" aria-labelledby="horas">
              <h3 id="horas" className="mb-1 font-bold text-foreground">Cuándo vendes más</h3>
              <p className="mb-3 text-sm text-muted-foreground">
                {calor.pico ? <>Tu momento más fuerte: <strong className="text-foreground">{["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"][calor.pico.d - 1]} de {String(calor.pico.h).padStart(2, "0")}:00 a {String((calor.pico.h + 1) % 24).padStart(2, "0")}:00</strong>. Úsalo para planificar cuánta gente poner en cada turno.</> : "Sin ventas en este período."}
              </p>
              <div className="overflow-x-auto">
                <table className="border-separate" style={{ borderSpacing: 3 }} aria-label="Ventas por día de la semana y hora">
                  <thead><tr><th />{HORAS.map((h) => <th key={h} className="text-[10px] font-normal text-muted-foreground">{h}</th>)}</tr></thead>
                  <tbody>
                    {DIAS_SEMANA.map((nombre, i) => (
                      <tr key={nombre}>
                        <th className="pr-1 text-left text-xs font-medium text-muted-foreground">{nombre}</th>
                        {HORAS.map((h) => {
                          const v = calor.mapa.get(`${i + 1}-${h}`) ?? 0;
                          return (
                            <td key={h} title={`${nombre} ${h}:00 · ${formatCLP(v)}`} className="h-6 w-6 rounded bg-muted">
                              {v > 0 && <div className="h-full w-full rounded bg-primary" style={{ opacity: 0.15 + 0.85 * (v / (calor.max || 1)) }} />}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </TabsContent>

          {/* ── Mesas y zonas ── */}
          <TabsContent value="mesas" className="space-y-4">
            {r.zonas.length > 1 || (r.zonas[0] && r.zonas[0].zona !== "Sin zona") ? (
              <section className="rounded-2xl border bg-card p-4" aria-labelledby="zonas">
                <h3 id="zonas" className="mb-3 font-bold text-foreground">Por zona</h3>
                <div className="space-y-2">{r.zonas.map((z) => <Barra key={z.zona} etiqueta={z.zona} valor={z.ventas} max={r.zonas[0]?.ventas ?? 0} detalle={`${formatCLP(z.ventas)} · ${z.visitas} visitas`} />)}</div>
              </section>
            ) : (
              <p className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">Ponle zona a tus mesas (terraza, salón, barra) en Sucursal para comparar cuál vende más.</p>
            )}
            <section className="rounded-2xl border bg-card p-4" aria-labelledby="por-mesa">
              <h3 id="por-mesa" className="mb-3 font-bold text-foreground">Por mesa</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Mesa</th><th className="py-2 pr-3 text-right font-medium">Ventas</th>
                    <th className="py-2 pr-3 text-right font-medium">Visitas</th><th className="py-2 text-right font-medium">Duración promedio</th>
                  </tr></thead>
                  <tbody className="divide-y divide-border">
                    {r.mesas.map((m) => (
                      <tr key={m.numero}>
                        <td className="py-2 pr-3 font-medium text-foreground">{m.numero}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{formatCLP(m.ventas)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{m.visitas}</td>
                        <td className="py-2 text-right tabular-nums text-muted-foreground">{m.duracion_min !== null ? `${m.duracion_min} min` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </TabsContent>

          {/* ── Clientes ── */}
          <TabsContent value="clientes">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <ReportKPICard label="Personas que pidieron" value={r.clientes.personas} icon={Users} />
              <ReportKPICard label="Vuelven" value={r.clientes.vuelven} icon={Users}
                subtitle={r.clientes.personas ? `${Math.round((r.clientes.vuelven / r.clientes.personas) * 100)}% ya habían venido` : undefined} />
              <ReportKPICard label="Nuevas" value={r.clientes.nuevas} icon={Users} />
              <ReportKPICard label="Calificación" value={r.calificacion.promedio !== null ? `⭐ ${String(r.calificacion.promedio).replace(".", ",")}` : "—"} icon={Star}
                subtitle={`${r.calificacion.cantidad} ${r.calificacion.cantidad === 1 ? "calificación" : "calificaciones"}`} />
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
