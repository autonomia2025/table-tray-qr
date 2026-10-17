import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Minus, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { cancelarPlan, crearPlan, localesParaPlan, misPlanes, responderPlan, type Plan } from "@/lib/planes";

const cuando = (iso: string) => new Date(iso).toLocaleString("es-CL", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

/** Planes con amigos (fase 9.3), dentro de "Comunidad y amigos". */
export default function PlanesAmigos({ amigos, color }: { amigos: { user_id: string; nombre: string }[]; color: string }) {
  const [planes, setPlanes] = useState<Plan[]>([]);
  const [armando, setArmando] = useState(false);
  const [error, setError] = useState("");
  const cargar = useCallback(async () => { const r = await misPlanes(); if (r.ok) setPlanes(r.dato); }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const hacer = async (p: Promise<{ ok: boolean }>) => {
    setError("");
    const r = await p;
    if (!r.ok) setError((r as unknown as { error: string }).error);
    cargar();
  };

  return (
    <div className="rounded-2xl border bg-card p-4" data-testid="planes-amigos">
      <p className="mb-2 flex items-center gap-2 text-sm font-bold text-card-foreground"><CalendarDays className="h-4 w-4 text-muted-foreground" /> Planes</p>
      {planes.length === 0 && !armando && <p className="text-sm text-muted-foreground">Arma un plan con tus amigos en un local donde ya estuviste.</p>}
      <ul className="space-y-3">
        {planes.map((p) => (
          <li key={p.id} className={`rounded-xl border p-3 ${p.cancelado ? "opacity-60" : ""}`} data-testid="plan">
            <p className="text-sm font-bold text-card-foreground">{p.local} · <span className="font-normal">{cuando(p.fecha)}</span></p>
            <p className="text-xs text-muted-foreground">{p.mio ? "Lo armaste tú" : `Te invita ${p.organiza}`}{p.cancelado ? " · cancelado" : ""}</p>
            {p.mensaje && <p className="mt-1 text-sm italic text-muted-foreground">“{p.mensaje}”</p>}
            {p.ronda.length > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">Primera ronda: {p.ronda.map((r) => (typeof r === "string" ? r : `${r.cantidad}× ${r.nombre}`)).join(", ")}</p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              {p.invitados.map((i) => `${i.nombre} ${i.respuesta === "voy" ? "✓" : i.respuesta === "no_voy" ? "✗" : "…"}`).join(" · ")}
            </p>
            {!p.cancelado && !p.mio && (
              <div className="mt-2 flex gap-2">
                <button onClick={() => hacer(responderPlan(p.id, true))} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${p.mi_respuesta === "voy" ? "text-white" : "border text-card-foreground"}`}
                  style={p.mi_respuesta === "voy" ? { backgroundColor: color } : undefined}>Voy</button>
                <button onClick={() => hacer(responderPlan(p.id, false))} className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${p.mi_respuesta === "no_voy" ? "bg-muted" : ""} text-card-foreground`}>No voy</button>
              </div>
            )}
            {!p.cancelado && p.mio && <button onClick={() => hacer(cancelarPlan(p.id))} className="mt-2 text-xs text-muted-foreground underline">Cancelar el plan</button>}
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      {armando ? (
        <NuevoPlan amigos={amigos} color={color} onListo={() => { setArmando(false); cargar(); }} onCancelar={() => setArmando(false)} />
      ) : amigos.length > 0 && (
        <button onClick={() => setArmando(true)} className="mt-3 w-full rounded-xl border py-2.5 text-sm font-semibold text-card-foreground">Armar un plan</button>
      )}
    </div>
  );
}

function NuevoPlan({ amigos, color, onListo, onCancelar }: { amigos: { user_id: string; nombre: string }[]; color: string; onListo: () => void; onCancelar: () => void }) {
  const [locales, setLocales] = useState<{ tenant_id: string; nombre: string }[]>([]);
  const [local, setLocal] = useState("");
  const [fecha, setFecha] = useState("");
  const [elegidos, setElegidos] = useState<string[]>([]);
  const [mensaje, setMensaje] = useState("");
  const [carta, setCarta] = useState<{ id: string; name: string }[]>([]);
  const [busca, setBusca] = useState("");
  const [ronda, setRonda] = useState<Record<string, number>>({});
  const [error, setError] = useState("");
  useEffect(() => { localesParaPlan().then((r) => { if (r.ok) { setLocales(r.dato); if (r.dato.length === 1) setLocal(r.dato[0].tenant_id); } }); }, []);
  useEffect(() => {
    setRonda({});
    if (!local) { setCarta([]); return; }
    supabase.from("menu_items").select("id, name").eq("tenant_id", local).eq("status", "available").order("name").then(({ data }) => setCarta(data ?? []));
  }, [local]);
  const lista = useMemo(() => carta.filter((m) => m.name.toLowerCase().includes(busca.toLowerCase())).slice(0, 12), [carta, busca]);
  const cambiar = (id: string, d: number) => setRonda((r) => {
    const n = Math.max(0, Math.min(20, (r[id] ?? 0) + d));
    const { [id]: _, ...resto } = r;
    return n ? { ...resto, [id]: n } : resto;
  });

  const guardar = async () => {
    setError("");
    const r = await crearPlan(local, new Date(fecha).toISOString(), elegidos, mensaje.trim(),
      Object.entries(ronda).map(([menu_item_id, quantity]) => ({ menu_item_id, quantity })));
    if (r.ok === false) { setError(r.error); return; }
    onListo();
  };

  return (
    <div className="mt-3 space-y-3 rounded-xl border p-3" data-testid="nuevo-plan">
      {locales.length === 0 ? <p className="text-sm text-muted-foreground">Puedes armar planes en locales donde ya hayas pagado algo.</p> : (
        <select aria-label="Local del plan" value={local} onChange={(e) => setLocal(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground">
          <option value="">Elige el local</option>
          {locales.map((l) => <option key={l.tenant_id} value={l.tenant_id}>{l.nombre}</option>)}
        </select>
      )}
      <Input type="datetime-local" aria-label="Fecha y hora del plan" value={fecha} onChange={(e) => setFecha(e.target.value)} />
      <div>
        <p className="mb-1 text-xs font-semibold text-card-foreground">¿A quiénes invitas?</p>
        <div className="space-y-1">
          {amigos.map((a) => (
            <label key={a.user_id} className="flex items-center gap-2 text-sm text-card-foreground">
              <Checkbox checked={elegidos.includes(a.user_id)} onCheckedChange={(v) => setElegidos((e) => (v === true ? [...e, a.user_id] : e.filter((x) => x !== a.user_id)))} aria-label={`Invitar a ${a.nombre}`} />
              {a.nombre}
            </label>
          ))}
        </div>
      </div>
      <Input maxLength={120} placeholder="Un mensaje (opcional)" value={mensaje} onChange={(e) => setMensaje(e.target.value)} aria-label="Mensaje del plan" />
      {local && (
        <div>
          <p className="mb-1 text-xs font-semibold text-card-foreground">Primera ronda (opcional): la pides con un toque al llegar</p>
          <Input placeholder="Busca en la carta" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar en la carta del plan" />
          <ul className="mt-1 max-h-48 space-y-1 overflow-y-auto">
            {lista.map((m) => (
              <li key={m.id} className="flex items-center justify-between text-sm">
                <span className="text-card-foreground">{m.name}</span>
                <span className="flex items-center gap-2">
                  <button onClick={() => cambiar(m.id, -1)} aria-label={`Menos ${m.name}`} className="rounded-full border p-1"><Minus className="h-3 w-3" /></button>
                  <span className="w-4 text-center tabular-nums">{ronda[m.id] ?? 0}</span>
                  <button onClick={() => cambiar(m.id, 1)} aria-label={`Más ${m.name}`} className="rounded-full border p-1"><Plus className="h-3 w-3" /></button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <button onClick={guardar} disabled={!local || !fecha || elegidos.length === 0} className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: color }}>Invitar al plan</button>
        <button onClick={onCancelar} className="rounded-xl border px-3 text-sm text-card-foreground">Cancelar</button>
      </div>
    </div>
  );
}
