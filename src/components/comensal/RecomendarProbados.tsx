import { useCallback, useEffect, useState } from "react";
import { ThumbsUp } from "lucide-react";
import { Input } from "@/components/ui/input";
import { miComunidad } from "@/lib/comunidad";
import { misRecomendaciones, quitarRecomendacion, recomendarPlato, type MiRecomendacion } from "@/lib/recomendaciones";

/** En el pasaporte (fase 9.4): recomendar a tus amigos lo que probaste. Lo ven desde 24 horas después. */
export default function RecomendarProbados({ tenantId, probados, color }: { tenantId: string; probados: { id: string; nombre: string }[]; color: string }) {
  const [activa, setActiva] = useState(false);
  const [mias, setMias] = useState<MiRecomendacion[]>([]);
  const [editando, setEditando] = useState<string | null>(null);
  const [comentario, setComentario] = useState("");
  const [error, setError] = useState("");
  const cargar = useCallback(async () => {
    const r = await misRecomendaciones(tenantId);
    if (r.ok) setMias(r.dato);
  }, [tenantId]);
  useEffect(() => { miComunidad().then((r) => setActiva(r.ok && r.dato.activo)); cargar(); }, [cargar]);
  if (!activa || probados.length === 0) return null;

  const guardar = async (id: string) => {
    setError("");
    const r = await recomendarPlato(id, comentario.trim());
    if (r.ok === false) { setError(r.error); return; }
    setEditando(null); setComentario(""); cargar();
  };
  const quitar = async (id: string) => { await quitarRecomendacion(id); cargar(); };

  return (
    <div className="rounded-2xl border border-border bg-card p-4" data-testid="recomendar-probados">
      <p className="mb-1 flex items-center gap-2 text-sm font-bold text-card-foreground"><ThumbsUp className="h-4 w-4" style={{ color }} /> Recomienda a tus amigos</p>
      <p className="mb-2 text-xs text-muted-foreground">Lo ven en la carta de este local desde mañana (nunca en el momento).</p>
      <ul className="divide-y divide-border">
        {probados.map((p) => {
          const mia = mias.find((m) => m.menu_item_id === p.id);
          return (
            <li key={p.id} className="py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-card-foreground">{p.nombre}</span>
                {mia ? (
                  <span className="flex items-center gap-2 text-xs">
                    <span className="font-semibold" style={{ color }}>Recomendado ✓</span>
                    <button onClick={() => quitar(p.id)} className="text-muted-foreground underline">Quitar</button>
                  </span>
                ) : (
                  <button onClick={() => { setEditando(p.id); setComentario(""); }} className="rounded-lg border px-2.5 py-1 text-xs font-semibold text-card-foreground">Recomendar</button>
                )}
              </div>
              {mia?.comentario && <p className="text-xs italic text-muted-foreground">“{mia.comentario}”</p>}
              {editando === p.id && (
                <div className="mt-2 flex gap-2">
                  <Input maxLength={140} placeholder="Un comentario (opcional)" value={comentario} onChange={(e) => setComentario(e.target.value)} aria-label={`Comentario sobre ${p.nombre}`} />
                  <button onClick={() => guardar(p.id)} className="shrink-0 rounded-xl px-3 text-sm font-semibold text-white" style={{ backgroundColor: color }}>Guardar</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}
