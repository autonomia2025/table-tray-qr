import { useState } from "react";
import { motion } from "framer-motion";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { empezarTrivia, girarRuleta, responderTrivia, type PartidaTrivia, type ResultadoTrivia } from "@/lib/juegos";
import type { MesaEnVivo } from "@/lib/mesaEnVivo";

/**
 * Juegos en la mesa (fase 7.8), mientras llega lo pedido: una trivia corta (la corrige el servidor) y la
 * ruleta "¿quién invita la próxima?" (la sortea el servidor; es solo diversión, no mueve plata).
 */
export default function JuegosMesa({ token, enVivo, color, recargar }: {
  token: string; enVivo: MesaEnVivo | null; color: string; recargar: () => void;
}) {
  const { toast } = useToast();
  const [partida, setPartida] = useState<PartidaTrivia | null>(null);
  const [paso, setPaso] = useState(0);
  const [respuestas, setRespuestas] = useState<number[]>([]);
  const [resultado, setResultado] = useState<ResultadoTrivia | null>(null);
  const [ruleta, setRuleta] = useState<{ girando: boolean; elegido?: string; soyYo?: boolean } | null>(null);
  const personas = enVivo?.personas.length ?? 0;

  const jugarTrivia = async () => {
    const r = await empezarTrivia(token);
    if (r.ok === false) { toast({ title: "No se pudo empezar", description: r.error, variant: "destructive" }); return; }
    setPartida(r.dato); setPaso(0); setRespuestas([]); setResultado(null);
  };

  const responder = async (opcion: number) => {
    if (!partida) return;
    const nuevas = [...respuestas, opcion];
    setRespuestas(nuevas);
    if (nuevas.length < partida.preguntas.length) { setPaso(nuevas.length); return; }
    const r = await responderTrivia(token, partida.partida, nuevas);
    if (r.ok === false) { toast({ title: "No se pudo guardar", description: r.error, variant: "destructive" }); return; }
    setResultado(r.dato);
    recargar();
  };

  const girar = async () => {
    setRuleta({ girando: true });
    const [r] = await Promise.all([girarRuleta(token), new Promise((ok) => setTimeout(ok, 1800))]);
    if (r.ok === false) { setRuleta(null); toast({ title: "La ruleta no giró", description: r.error, variant: "destructive" }); return; }
    setRuleta({ girando: false, elegido: r.dato.elegido, soyYo: r.dato.soy_yo });
    recargar();
  };

  const pregunta = partida?.preguntas[paso];
  return (
    <div className="mb-4 rounded-2xl border border-border bg-card p-4" data-testid="juegos-mesa">
      <p className="text-sm font-bold text-card-foreground">Mientras esperan</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button onClick={jugarTrivia} className="rounded-xl border border-border p-3 text-left transition-colors active:bg-accent">
          <span className="text-2xl">🧠</span>
          <span className="mt-1 block text-sm font-semibold text-card-foreground">Trivia</span>
          <span className="block text-xs text-muted-foreground">5 preguntas</span>
        </button>
        <button onClick={girar} disabled={personas < 2} className="rounded-xl border border-border p-3 text-left transition-colors active:bg-accent disabled:opacity-50">
          <span className="text-2xl">🎯</span>
          <span className="mt-1 block text-sm font-semibold text-card-foreground">¿Quién invita la próxima?</span>
          <span className="block text-xs text-muted-foreground">{personas < 2 ? "Con 2 o más en la mesa" : "Gira la ruleta"}</span>
        </button>
      </div>

      {/* Lo que ve toda la mesa */}
      {(!!enVivo?.trivia?.length || enVivo?.ruleta) && (
        <div className="mt-3 space-y-1 text-xs text-muted-foreground">
          {!!enVivo?.trivia?.length && (
            <p data-testid="ranking-trivia">🏆 Trivia: {enVivo.trivia.map((t) => `${t.yo ? "Tú" : t.quien} ${t.puntaje}/5`).join(" · ")}</p>
          )}
          {enVivo?.ruleta && <p>🎯 La ruleta eligió a <strong className="text-card-foreground">{enVivo.ruleta.soy_yo ? "ti" : enVivo.ruleta.elegido}</strong></p>}
        </div>
      )}

      {/* Trivia */}
      <Dialog open={!!partida} onOpenChange={(v) => { if (!v) setPartida(null); }}>
        <DialogContent className="max-w-[360px] rounded-2xl">
          {resultado ? (
            <>
              <DialogHeader>
                <DialogTitle>{resultado.puntaje >= 4 ? "¡Crack! 🏆" : resultado.puntaje >= 2 ? "¡Bien jugado!" : "¡A la próxima!"}</DialogTitle>
                <DialogDescription>Acertaste {resultado.puntaje} de {resultado.de}. Tu mesa ve tu puntaje.</DialogDescription>
              </DialogHeader>
              <ul className="space-y-2 text-sm">
                {partida?.preguntas.map((q, i) => (
                  <li key={q.id} className="rounded-xl border border-border p-2.5">
                    <p className="text-card-foreground">{q.pregunta}</p>
                    <p className={respuestas[i] === resultado.correctas[i] ? "text-xs font-semibold text-emerald-600 dark:text-emerald-400" : "text-xs text-muted-foreground"}>
                      {respuestas[i] === resultado.correctas[i] ? "✓ " : "Era: "}{q.opciones[resultado.correctas[i]]}
                    </p>
                  </li>
                ))}
              </ul>
              <button onClick={() => setPartida(null)} className="w-full rounded-2xl py-3 text-sm font-semibold text-white" style={{ backgroundColor: color }}>Listo</button>
            </>
          ) : pregunta ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-base">Pregunta {paso + 1} de {partida!.preguntas.length}</DialogTitle>
                <DialogDescription className="text-base font-semibold text-foreground">{pregunta.pregunta}</DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                {pregunta.opciones.map((o, i) => (
                  <button key={o} onClick={() => responder(i)} className="w-full rounded-xl border border-border px-3 py-3 text-left text-sm text-card-foreground transition-colors active:bg-accent">
                    {o}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Ruleta */}
      <Dialog open={!!ruleta} onOpenChange={(v) => { if (!v) setRuleta(null); }}>
        <DialogContent className="max-w-[340px] rounded-2xl text-center">
          <DialogHeader>
            <DialogTitle>¿Quién invita la próxima?</DialogTitle>
            <DialogDescription>Es solo un juego: cada uno paga lo suyo.</DialogDescription>
          </DialogHeader>
          {/* La ruleta: una rueda con el color del local y una flecha arriba */}
          <div className="relative mx-auto my-2 h-36 w-36">
            <div className="absolute left-1/2 top-[-6px] z-10 -translate-x-1/2 text-xl text-foreground" aria-hidden>▼</div>
            <motion.div
              className="h-full w-full rounded-full border-4 border-card shadow-md"
              style={{ background: `conic-gradient(${color} 0 25%, hsl(var(--muted)) 0 50%, ${color} 0 75%, hsl(var(--muted)) 0 100%)` }}
              animate={ruleta?.girando ? { rotate: 1440 } : { rotate: 0 }}
              transition={ruleta?.girando ? { duration: 1.8, ease: "easeOut" } : { duration: 0 }}
            />
            <div className="absolute inset-0 m-auto h-8 w-8 rounded-full border-4 border-card bg-background" aria-hidden />
          </div>
          {ruleta && !ruleta.girando && (
            <p className="text-lg font-extrabold text-foreground" data-testid="resultado-ruleta">
              {ruleta.soyYo ? "¡Te tocó a ti! 🎉" : `¡Le tocó a ${ruleta.elegido}! 🎉`}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
