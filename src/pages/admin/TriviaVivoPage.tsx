import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Maximize, Trophy, Users } from "lucide-react";
import { useAdmin } from "@/contexts/AdminContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { mensajeError } from "@/lib/errores";
import { tiene, useModulos } from "@/lib/modulos";
import { LETRAS, avanzarTrivia, crearTrivia, pantallaTrivia, terminarTrivia, type TriviaVivo } from "@/lib/triviaVivo";

/**
 * Noche de trivia en vivo (fase 8.4): la pantalla del local. Se abre en un computador conectado a la tele; el
 * encargado avanza las preguntas y todos juegan desde su mesa. Letra grande, como el KDS.
 */
export default function TriviaVivoPage() {
  const { tenantId, branchId, tenantName } = useAdmin();
  const modulos = useModulos(tenantId);
  const { toast } = useToast();
  const [t, setT] = useState<TriviaVivo | null | undefined>(undefined);
  const [preguntas, setPreguntas] = useState(10);
  const [segundos, setSegundos] = useState(20);
  const [quedan, setQuedan] = useState<number | null>(null);
  const pantalla = useRef<HTMLDivElement>(null);

  const cargar = useCallback(async () => {
    if (!branchId) return;
    const r = await pantallaTrivia(branchId);
    setT(r);
    setQuedan(r?.quedan ?? null);
  }, [branchId]);
  useEffect(() => { cargar(); const id = setInterval(cargar, 2500); return () => clearInterval(id); }, [cargar]);
  // La cuenta regresiva corre en la pantalla entre consultas
  useEffect(() => {
    if (quedan === null || quedan <= 0) return;
    const id = setTimeout(() => setQuedan((q) => (q === null ? q : Math.max(0, q - 1))), 1000);
    return () => clearTimeout(id);
  }, [quedan]);

  const accion = async (fn: () => PromiseLike<{ error: unknown }>) => {
    const { error } = await fn();
    if (error) toast({ title: "No se pudo", description: mensajeError(error), variant: "destructive" });
    cargar();
  };

  if (!tiene(modulos, "juegos")) {
    return (
      <div className="max-w-4xl space-y-2">
        <h2 className="text-2xl font-bold text-foreground">Trivia en vivo</h2>
        <p className="text-sm text-muted-foreground" data-testid="modulo-no-incluido">Juegos en la mesa no está incluido en el plan de tu local. Si te interesa, escríbenos desde Soporte.</p>
      </div>
    );
  }
  if (t === undefined) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  const activa = t && t.estado !== "terminada";
  if (!activa) {
    return (
      <div className="max-w-2xl space-y-6">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold text-foreground"><Trophy className="h-6 w-6 text-primary" /> Trivia en vivo</h2>
          <p className="text-sm text-muted-foreground">Abre esta pantalla en la tele del local. Todos los que están en una mesa juegan desde su celular (les aparece un aviso), y el ranking se ve en vivo. Solo diversión: no da premios.</p>
        </div>
        {t?.estado === "terminada" && <Ranking t={t} titulo="Ganadores de la última trivia" />}
        <div className="grid grid-cols-2 gap-3 rounded-2xl border bg-card p-5">
          <div><Label htmlFor="trivia-preguntas">Preguntas</Label><Input id="trivia-preguntas" type="number" min={3} max={20} value={preguntas} onChange={(e) => setPreguntas(parseInt(e.target.value) || 10)} /></div>
          <div><Label htmlFor="trivia-segundos">Segundos por pregunta</Label><Input id="trivia-segundos" type="number" min={10} max={60} value={segundos} onChange={(e) => setSegundos(parseInt(e.target.value) || 20)} /></div>
          <Button className="col-span-2" onClick={() => accion(() => crearTrivia(branchId!, preguntas, segundos))}>Preparar la trivia</Button>
        </div>
      </div>
    );
  }

  const q = t.pregunta;
  return (
    <div ref={pantalla} className="flex min-h-[80vh] flex-col gap-6 rounded-2xl bg-background p-6" data-testid="pantalla-trivia">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xl font-extrabold text-foreground">🎤 Trivia en vivo · {tenantName}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => pantalla.current?.requestFullscreen?.().catch(() => undefined)}><Maximize className="mr-1 h-4 w-4" />Pantalla completa</Button>
          <Button size="sm" onClick={() => accion(() => avanzarTrivia(t.id))}>
            {t.estado === "esperando" ? "Empezar" : t.estado === "pregunta" ? "Mostrar respuesta" : t.actual >= t.total ? "Ver ganadores" : "Siguiente pregunta"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => accion(() => terminarTrivia(t.id))}>Terminar</Button>
        </div>
      </div>

      {t.estado === "esperando" ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <p className="text-5xl font-extrabold text-foreground">¡Trivia en vivo!</p>
          <p className="text-2xl text-muted-foreground">Abre el QR de tu mesa y toca «Jugar la trivia».</p>
          <p className="text-lg text-muted-foreground">{t.total} preguntas · {t.segundos} segundos cada una</p>
        </div>
      ) : (
        <div className="grid flex-1 gap-6 lg:grid-cols-[2fr_1fr]">
          <div className="flex flex-col gap-5">
            <div className="flex items-center justify-between text-lg text-muted-foreground">
              <span>Pregunta {t.actual} de {t.total} · {q?.tema}</span>
              <span className="flex items-center gap-1"><Users className="h-5 w-5" /> {t.respondieron} {t.respondieron === 1 ? "respondió" : "respondieron"}</span>
            </div>
            <p className="text-4xl font-extrabold leading-tight text-foreground" data-testid="pregunta-pantalla">{q?.texto}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {q?.opciones.map((o, i) => {
                const correcta = t.estado === "resultado" && q.correcta === i;
                return (
                  <motion.div key={i} animate={{ scale: correcta ? 1.03 : 1, opacity: t.estado === "resultado" && !correcta ? 0.45 : 1 }}
                    className={`rounded-2xl border-2 p-5 text-2xl font-bold ${correcta ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-card-foreground"}`}>
                    <span className="mr-3 opacity-70">{LETRAS[i]}</span>{o}
                  </motion.div>
                );
              })}
            </div>
            {t.estado === "pregunta" && quedan !== null && (
              <div className="h-3 overflow-hidden rounded-full bg-muted">
                <motion.div className="h-full bg-primary" animate={{ width: `${(quedan / t.segundos) * 100}%` }} transition={{ duration: 1, ease: "linear" }} />
              </div>
            )}
          </div>
          <Ranking t={t} titulo="Ranking" />
        </div>
      )}
    </div>
  );
}

function Ranking({ t, titulo }: { t: TriviaVivo; titulo: string }) {
  return (
    <div className="rounded-2xl border bg-card p-5" data-testid="ranking-trivia">
      <p className="mb-3 flex items-center gap-2 text-lg font-bold text-card-foreground"><Trophy className="h-5 w-5 text-primary" /> {titulo}</p>
      {t.ranking.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía nadie suma puntos.</p>
      ) : (
        <ol className="space-y-2">
          {t.ranking.map((r, i) => (
            <li key={`${r.alias}-${i}`} className="flex items-center justify-between gap-2 text-lg">
              <span className="truncate text-card-foreground"><span className="mr-2 font-extrabold text-primary">{i + 1}</span>{r.alias}{r.mesa ? <span className="text-sm text-muted-foreground"> · mesa {r.mesa}</span> : null}</span>
              <span className="font-bold tabular-nums text-card-foreground">{r.puntos}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
