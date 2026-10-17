import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowLeft, Loader2, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { mensajeError } from "@/lib/errores";
import { LETRAS, responderTrivia, triviaDeMiMesa, type TriviaVivo } from "@/lib/triviaVivo";

/** Trivia en vivo desde la mesa (fase 8.4): la misma pregunta que se ve en la pantalla del local. */
export default function TriviaVivoMesaPage() {
  const { slug } = useParams<{ slug: string }>();
  const [params] = useSearchParams();
  const token = params.get("t");
  const navigate = useNavigate();
  const { data: local } = useQuery({
    queryKey: ["tenant-trivia", slug],
    queryFn: async () => (await supabase.from("tenants").select("name, primary_color").eq("slug", slug!).maybeSingle()).data,
    enabled: !!slug,
  });
  const color = local?.primary_color || "#E8531D";
  const [t, setT] = useState<TriviaVivo | null | undefined>(undefined);
  const [quedan, setQuedan] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  const cargar = useCallback(async () => {
    if (!token) return;
    const r = await triviaDeMiMesa(token);
    setT(r);
    setQuedan(r?.quedan ?? null);
  }, [token]);
  useEffect(() => { cargar(); const id = setInterval(cargar, 3000); return () => clearInterval(id); }, [cargar]);
  useEffect(() => {
    if (quedan === null || quedan <= 0) return;
    const id = setTimeout(() => setQuedan((q) => (q === null ? q : Math.max(0, q - 1))), 1000);
    return () => clearTimeout(id);
  }, [quedan]);

  const responder = async (opcion: number) => {
    if (!t || !token || enviando) return;
    setEnviando(true);
    setError("");
    const { error: e } = await responderTrivia(token, t.id, t.actual, opcion);
    if (e) setError(mensajeError(e, "No pudimos guardar tu respuesta."));
    await cargar();
    setEnviando(false);
  };

  const q = t?.pregunta;
  const mia = t?.mi_respuesta;

  return (
    <div className="min-h-screen bg-background pb-10">
      <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-border bg-background px-4">
        <button onClick={() => (window.history.length > 1 ? navigate(-1) : navigate(`/${slug}/menu${token ? `?t=${token}` : ""}`))} className="flex h-9 w-9 items-center justify-center rounded-full text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <span className="text-sm font-bold text-foreground">🎤 Trivia en vivo · {local?.name ?? ""}</span>
        {t?.mis_puntos != null && <span className="ml-auto text-sm font-bold tabular-nums" style={{ color }}>{t.mis_puntos} pts</span>}
      </header>

      <div className="mx-auto max-w-md space-y-4 px-4 pt-5">
        {t === undefined ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : !t ? (
          <p className="py-16 text-center text-sm text-muted-foreground">Ahora no hay trivia en vivo en el local.</p>
        ) : t.estado === "esperando" ? (
          <div className="rounded-2xl border bg-card p-6 text-center">
            <p className="text-4xl">🎤</p>
            <p className="mt-2 text-lg font-extrabold text-card-foreground">¡Ya estás adentro!</p>
            <p className="text-sm text-muted-foreground">La trivia empieza cuando el local lo diga. Mira la pantalla.</p>
          </div>
        ) : t.estado === "terminada" ? (
          <div className="rounded-2xl border bg-card p-6 text-center" data-testid="trivia-terminada">
            <p className="text-4xl">🏆</p>
            <p className="mt-2 text-lg font-extrabold text-card-foreground">¡Terminó la trivia!</p>
            <p className="text-sm text-muted-foreground">Hiciste {t.mis_puntos ?? 0} puntos.</p>
          </div>
        ) : (
          <motion.div key={t.actual} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3" data-testid="pregunta-celular">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Pregunta {t.actual} de {t.total}</span>
              {t.estado === "pregunta" && quedan !== null && <span className="font-bold tabular-nums" style={{ color }}>{quedan} s</span>}
            </div>
            <p className="text-lg font-extrabold text-foreground">{q?.texto}</p>
            <div className="space-y-2">
              {q?.opciones.map((o, i) => {
                const elegida = mia?.opcion === i;
                const correcta = t.estado === "resultado" && q.correcta === i;
                const bloqueada = !!mia || t.estado !== "pregunta" || quedan === 0;
                return (
                  <button key={i} disabled={bloqueada || enviando} onClick={() => responder(i)}
                    className={`flex w-full items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left text-sm font-semibold transition ${correcta ? "text-white" : "text-card-foreground"} ${bloqueada && !elegida && !correcta ? "opacity-50" : ""}`}
                    style={correcta ? { backgroundColor: color, borderColor: color } : elegida ? { borderColor: color } : undefined}>
                    <span className="font-extrabold opacity-70">{LETRAS[i]}</span>{o}
                  </button>
                );
              })}
            </div>
            {error && <p className="text-center text-xs text-destructive">{error}</p>}
            {t.estado === "pregunta" && mia && <p className="text-center text-sm text-muted-foreground">Listo. Espera el resultado en la pantalla.</p>}
            {t.estado === "resultado" && (
              <p className="text-center text-sm font-bold" style={{ color: mia?.correcta ? color : undefined }} data-testid="mi-resultado">
                {mia ? (mia.correcta ? `¡Bien! +${mia.puntos} puntos` : "Esta vez no.") : "No alcanzaste a responder."}
              </p>
            )}
          </motion.div>
        )}

        {t && t.ranking.length > 0 && (
          <div className="rounded-2xl border bg-card p-4">
            <p className="mb-2 flex items-center gap-2 text-sm font-bold text-card-foreground"><Trophy className="h-4 w-4" style={{ color }} /> Ranking</p>
            <ol className="space-y-1 text-sm">
              {t.ranking.slice(0, 5).map((r, i) => (
                <li key={`${r.alias}-${i}`} className={`flex justify-between ${r.yo ? "font-bold" : ""}`}>
                  <span className="truncate text-card-foreground">{i + 1}. {r.alias}{r.yo ? " (tú)" : ""}</span>
                  <span className="tabular-nums text-card-foreground">{r.puntos}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
