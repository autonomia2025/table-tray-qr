import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { mensajeAmigable } from "@/lib/pedidos";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Target, Trash2, Trophy } from "lucide-react";
import { formatCLP } from "@/lib/format";
import {
  CLASE_SEMAFORO, NOMBRE_PERIODO, NOMBRE_TIPO, PUNTO_SEMAFORO, minutos, rankingEquipo, semaforo,
  type Desempeno, type Objetivos,
} from "@/lib/equipo";

// Control del equipo (fase 3.3): ranking por período con tiempos y cumplimiento, y metas por mozo.

// Día de negocio de hoy en Chile (el corte es a las 06:00: a las 2 AM todavía es "ayer")
const diaNegocio = (diasAtras = 0) =>
  new Date(Date.now() - 6 * 3_600_000 - diasAtras * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Santiago" });

const PERIODOS = [
  { id: "hoy", texto: "Hoy", desde: () => diaNegocio(0) },
  { id: "7", texto: "7 días", desde: () => diaNegocio(6) },
  { id: "30", texto: "30 días", desde: () => diaNegocio(29) },
] as const;

function Cumplimiento({ promedio, aTiempo, total, objetivo }: { promedio: number | null; aTiempo: number; total: number; objetivo: number }) {
  if (!total) return <span className="text-muted-foreground">—</span>;
  const color = semaforo(promedio, objetivo);
  const pct = Math.round((aTiempo / total) * 100);
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {color && <span className={`h-2 w-2 rounded-full ${PUNTO_SEMAFORO[color]}`} aria-hidden />}
      <span className={color ? `font-semibold ${CLASE_SEMAFORO[color]}` : ""}>{minutos(promedio)}</span>
      <span className="text-xs text-muted-foreground">· {pct}% a tiempo</span>
    </span>
  );
}

interface Meta { id: string; staff_id: string | null; tipo: "ventas" | "mesas"; periodo: "dia" | "semana" | "mes"; objetivo: number }

export default function DesempenoEquipo({ branchId, tenantId }: { branchId: string; tenantId: string }) {
  const { toast } = useToast();
  const [periodo, setPeriodo] = useState<(typeof PERIODOS)[number]["id"]>("7");
  const [mozos, setMozos] = useState<Desempeno[]>([]);
  const [objetivos, setObjetivos] = useState<Objetivos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [metas, setMetas] = useState<Meta[]>([]);
  const [equipo, setEquipo] = useState<{ id: string; name: string }[]>([]);
  const [nueva, setNueva] = useState({ staff: "todos", tipo: "ventas" as Meta["tipo"], periodo: "dia" as Meta["periodo"], objetivo: "" });

  const cargar = useCallback(async () => {
    if (!branchId) return;
    setCargando(true);
    const p = PERIODOS.find((x) => x.id === periodo)!;
    const [r, { data: m }, { data: e }] = await Promise.all([
      rankingEquipo(branchId, p.desde(), diaNegocio(0)),
      supabase.from("metas_mozo").select("id, staff_id, tipo, periodo, objetivo").eq("branch_id", branchId).order("periodo"),
      supabase.from("staff_users").select("id, name").eq("tenant_id", tenantId).eq("role", "waiter").eq("is_active", true).order("name"),
    ]);
    setCargando(false);
    if (r.ok === false) { toast({ title: "No se pudo cargar el desempeño", description: r.error, variant: "destructive" }); return; }
    setMozos(r.dato.mozos);
    setObjetivos(r.dato.objetivos);
    setMetas((m ?? []) as Meta[]);
    setEquipo(e ?? []);
  }, [branchId, tenantId, periodo, toast]);

  useEffect(() => { cargar(); }, [cargar]);

  const nombreDe = useMemo(() => new Map(equipo.map((e) => [e.id, e.name])), [equipo]);

  const guardarMeta = async () => {
    const objetivo = parseInt(nueva.objetivo.replace(/\D/g, ""), 10);
    if (!objetivo) return;
    const staff = nueva.staff === "todos" ? null : nueva.staff;
    const existente = metas.find((m) => m.staff_id === staff && m.tipo === nueva.tipo && m.periodo === nueva.periodo);
    const { error } = existente
      ? await supabase.from("metas_mozo").update({ objetivo }).eq("id", existente.id)
      : await supabase.from("metas_mozo").insert({ tenant_id: tenantId, branch_id: branchId, staff_id: staff, tipo: nueva.tipo, periodo: nueva.periodo, objetivo });
    if (error) { toast({ title: "No se pudo guardar la meta", description: mensajeAmigable(error.message), variant: "destructive" }); return; }
    toast({ title: existente ? "Meta actualizada" : "Meta creada" });
    setNueva((n) => ({ ...n, objetivo: "" }));
    cargar();
  };

  const borrarMeta = async (id: string) => {
    const { error } = await supabase.from("metas_mozo").delete().eq("id", id);
    if (error) { toast({ title: "No se pudo borrar la meta", description: mensajeAmigable(error.message), variant: "destructive" }); return; }
    cargar();
  };

  const medalla = ["🥇", "🥈", "🥉"];

  return (
    <section className="mt-10 space-y-8" aria-labelledby="desempeno-titulo">
      {/* Ranking */}
      <div>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-muted-foreground" />
              <h2 id="desempeno-titulo" className="text-lg font-bold text-foreground">Desempeño del equipo</h2>
            </div>
            {objetivos && (
              <p className="text-sm text-muted-foreground">
                Objetivos: responder un llamado en {objetivos.llamado} min y llevar lo listo en {objetivos.retiro} min (se cambian en Sucursal).
              </p>
            )}
          </div>
          <div className="flex gap-1 rounded-lg bg-muted p-1" role="group" aria-label="Período">
            {PERIODOS.map((p) => (
              <button
                key={p.id}
                onClick={() => setPeriodo(p.id)}
                aria-pressed={periodo === p.id}
                className={`rounded-md px-3 py-1 text-sm font-semibold transition-colors ${periodo === p.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
              >
                {p.texto}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Mozo</th>
                <th className="px-3 py-3 text-right font-medium text-muted-foreground" title="Visitas completas: mesas que cerró atendiéndolas">Mesas cerradas</th>
                <th className="px-3 py-3 text-right font-medium text-muted-foreground">Entregas</th>
                <th className="px-3 py-3 text-right font-medium text-muted-foreground">Ventas</th>
                <th className="px-3 py-3 text-right font-medium text-muted-foreground">Ticket</th>
                <th className="px-3 py-3 text-right font-medium text-muted-foreground">Propinas</th>
                <th className="px-3 py-3 text-left font-medium text-muted-foreground">Responde llamados</th>
                <th className="px-3 py-3 text-left font-medium text-muted-foreground">Lleva lo listo</th>
                <th className="px-3 py-3 text-right font-medium text-muted-foreground">Calificación</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {cargando ? (
                <tr><td colSpan={9} className="py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></td></tr>
              ) : mozos.length === 0 ? (
                <tr><td colSpan={9} className="py-8 text-center text-muted-foreground">Aún no hay mozos con actividad</td></tr>
              ) : mozos.map((m, i) => (
                <tr key={m.staff_id} className="hover:bg-muted/30">
                  <td className="whitespace-nowrap px-4 py-3 font-medium text-foreground">
                    {m.ventas > 0 && i < 3 && <span className="mr-1.5" aria-label={`Puesto ${i + 1}`}>{medalla[i]}</span>}
                    {m.nombre}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{m.mesas}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{m.pedidos_entregados}</td>
                  <td className="px-3 py-3 text-right font-semibold tabular-nums">{formatCLP(m.ventas)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{m.pagos ? formatCLP(m.ticket_promedio) : "—"}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{formatCLP(m.propinas)}</td>
                  <td className="px-3 py-3">{objetivos && <Cumplimiento promedio={m.llamado_promedio_min} aTiempo={m.llamados_a_tiempo} total={m.llamados} objetivo={objetivos.llamado} />}</td>
                  <td className="px-3 py-3">{objetivos && <Cumplimiento promedio={m.retiro_promedio_min} aTiempo={m.entregas_a_tiempo} total={m.entregas} objetivo={objetivos.retiro} />}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                    {m.calificacion_promedio !== null ? <>⭐ {String(m.calificacion_promedio).replace(".", ",")} <span className="text-xs text-muted-foreground">({m.calificaciones})</span></> : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">La calificación del cliente es del mozo que tenía la mesa al cerrarla. Las ventas y propinas, del mozo que la tomó.</p>
      </div>

      {/* Metas */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <Target className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-bold text-foreground">Metas</h2>
        </div>
        <p className="mb-3 text-sm text-muted-foreground">Cada mozo ve el avance de su meta en su perfil. Una meta para "Todos" vale para quien no tenga una propia.</p>
        <div className="mb-3 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border">
              {metas.length === 0 && (
                <tr><td className="px-4 py-3 text-muted-foreground">Sin metas todavía</td></tr>
              )}
              {metas.map((m) => (
                <tr key={m.id}>
                  <td className="px-4 py-3 font-medium text-foreground">{m.staff_id ? nombreDe.get(m.staff_id) ?? "Mozo" : "Todos los mozos"}</td>
                  <td className="px-3 py-3 text-muted-foreground">{NOMBRE_TIPO[m.tipo]} {NOMBRE_PERIODO[m.periodo]}</td>
                  <td className="px-3 py-3 text-right font-semibold tabular-nums">{m.tipo === "ventas" ? formatCLP(m.objetivo) : `${m.objetivo} mesas`}</td>
                  <td className="w-12 px-3 py-3 text-right">
                    <Button variant="ghost" size="icon" onClick={() => borrarMeta(m.id)} aria-label="Borrar meta"><Trash2 className="h-4 w-4" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-44">
            <Label className="text-xs">Para</Label>
            <Select value={nueva.staff} onValueChange={(v) => setNueva((n) => ({ ...n, staff: v }))}>
              <SelectTrigger aria-label="Para quién"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos los mozos</SelectItem>
                {equipo.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="w-32">
            <Label className="text-xs">Qué</Label>
            <Select value={nueva.tipo} onValueChange={(v) => setNueva((n) => ({ ...n, tipo: v as Meta["tipo"] }))}>
              <SelectTrigger aria-label="Qué se mide"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ventas">Ventas</SelectItem>
                <SelectItem value="mesas">Mesas cerradas</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="w-36">
            <Label className="text-xs">Período</Label>
            <Select value={nueva.periodo} onValueChange={(v) => setNueva((n) => ({ ...n, periodo: v as Meta["periodo"] }))}>
              <SelectTrigger aria-label="Período de la meta"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="dia">Por día</SelectItem>
                <SelectItem value="semana">Por semana</SelectItem>
                <SelectItem value="mes">Por mes</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="w-36">
            <Label htmlFor="meta-objetivo" className="text-xs">{nueva.tipo === "ventas" ? "Monto" : "Mesas"}</Label>
            <Input id="meta-objetivo" inputMode="numeric" value={nueva.objetivo} placeholder={nueva.tipo === "ventas" ? "150000" : "20"}
              onChange={(e) => setNueva((n) => ({ ...n, objetivo: e.target.value.replace(/\D/g, "") }))} />
          </div>
          <Button onClick={guardarMeta} disabled={!nueva.objetivo}>Guardar meta</Button>
        </div>
      </div>
    </section>
  );
}
