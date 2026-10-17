import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ThumbsUp } from "lucide-react";
import { recomendacionesDeAmigos, type RecomendacionAmigos } from "@/lib/recomendaciones";

/** "Tus amigos recomiendan" en la carta (fase 9.4): solo amigos, con 24 horas de desfase. */
export default function RecomendacionesAmigosCarta({ tenantId, slug, token, color }: { tenantId?: string; slug?: string; token?: string | null; color: string }) {
  const navigate = useNavigate();
  const [lista, setLista] = useState<RecomendacionAmigos[]>([]);
  useEffect(() => { if (tenantId) recomendacionesDeAmigos(tenantId).then((r) => setLista(r.ok ? r.dato : [])); }, [tenantId]);
  if (!lista.length || !slug) return null;
  return (
    <div className="mx-4 mt-3 rounded-2xl border bg-card p-4" data-testid="recomiendan-amigos">
      <p className="mb-2 flex items-center gap-2 text-sm font-bold text-card-foreground"><ThumbsUp className="h-4 w-4" style={{ color }} /> Tus amigos recomiendan</p>
      <ul className="space-y-2">
        {lista.slice(0, 5).map((r) => (
          <li key={r.menu_item_id}>
            <button onClick={() => navigate(`/${slug}/item/${r.menu_item_id}${token ? `?t=${token}` : ""}`)} className="w-full text-left">
              <p className="text-sm font-semibold text-card-foreground">{r.plato}</p>
              <p className="text-xs text-muted-foreground">
                {r.amigos[0].nombre}{r.cuantos > 1 ? ` y ${r.cuantos - 1} más` : ""}
                {r.amigos[0].comentario ? ` · “${r.amigos[0].comentario}”` : ""}
              </p>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
