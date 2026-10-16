import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { miPasaporte, type Pasaporte } from "@/lib/pasaporte";

/** Pasaporte de la casa (fase 7.6): lo que probaste en el local, por sección, y tus insignias. */
export default function PasaportePage() {
  const { slug } = useParams<{ slug: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { data: local } = useQuery({
    queryKey: ["tenant-pasaporte", slug],
    queryFn: async () => (await supabase.from("tenants").select("id, name, primary_color").eq("slug", slug!).maybeSingle()).data,
    enabled: !!slug,
  });
  const [p, setP] = useState<Pasaporte | null | undefined>(undefined);
  useEffect(() => { if (local?.id) miPasaporte(local.id).then(setP); }, [local?.id]);
  const color = local?.primary_color || "#E8531D";
  const t = params.get("t");

  return (
    <div className="min-h-screen bg-background pb-10">
      <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-border bg-background px-4">
        <button onClick={() => (window.history.length > 1 ? navigate(-1) : navigate(`/${slug}/menu${t ? `?t=${t}` : ""}`))} className="flex h-9 w-9 items-center justify-center rounded-full text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <span className="text-sm font-bold text-foreground">Pasaporte de {local?.name ?? "la casa"}</span>
      </header>
      {p === undefined ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : !p || !p.activo ? (
        <p className="px-6 py-16 text-center text-sm text-muted-foreground">Este local no tiene pasaporte por ahora.</p>
      ) : (
        <div className="mx-auto max-w-md space-y-4 px-4 pt-4">
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-border bg-card p-5 text-center" data-testid="pasaporte-resumen">
            <p className="text-4xl">🛂</p>
            <p className="mt-2 text-2xl font-extrabold text-card-foreground">{p.probados} de {p.total}</p>
            <p className="text-sm text-muted-foreground">cosas distintas probadas en {local?.name}</p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full" style={{ width: `${Math.round(((p.probados ?? 0) / Math.max(1, p.total ?? 1)) * 100)}%`, backgroundColor: color }} />
            </div>
            {p.siguiente && <p className="mt-3 text-xs text-muted-foreground">Te faltan {p.siguiente.faltan} para la insignia «{p.siguiente.nombre}».</p>}
          </motion.div>

          {!!p.insignias?.length && (
            <div className="rounded-2xl border border-border bg-card p-4" data-testid="insignias">
              <p className="mb-2 text-sm font-bold text-card-foreground">Tus insignias</p>
              <div className="flex flex-wrap gap-2">
                {p.insignias.map((i) => (
                  <span key={i.nombre} className="rounded-full border px-3 py-1.5 text-xs font-semibold text-card-foreground">{i.emoji} {i.nombre}</span>
                ))}
              </div>
            </div>
          )}

          {p.secciones?.map((s) => (
            <div key={s.id} className="rounded-2xl border border-border bg-card p-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-bold text-card-foreground">{s.emoji ? `${s.emoji} ` : ""}{s.nombre}</p>
                <span className="text-xs text-muted-foreground">{s.completa ? "¡Completa!" : `${s.probados} de ${s.total}`}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {s.items.map((it) => (
                  <div key={it.id} className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 text-xs ${it.probado ? "border-transparent text-white" : "text-muted-foreground"}`}
                    style={it.probado ? { backgroundColor: color } : undefined}>
                    {it.probado ? <Check className="h-3.5 w-3.5 shrink-0" /> : <span className="h-3.5 w-3.5 shrink-0 rounded-full border" />}
                    <span className="truncate">{it.nombre}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
