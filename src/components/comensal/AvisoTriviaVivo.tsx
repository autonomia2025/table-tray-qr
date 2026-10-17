import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { triviaDeMiMesa } from "@/lib/triviaVivo";

/** Aviso en la carta y el seguimiento cuando el local tiene una trivia en vivo (fase 8.4). */
export default function AvisoTriviaVivo({ token, slug, color }: { token?: string | null; slug?: string; color: string }) {
  const navigate = useNavigate();
  const [activa, setActiva] = useState(false);
  useEffect(() => {
    if (!token) return;
    let vivo = true;
    const ver = () => triviaDeMiMesa(token).then((t) => { if (vivo) setActiva(!!t && t.estado !== "terminada"); });
    ver();
    const id = setInterval(ver, 15_000);
    return () => { vivo = false; clearInterval(id); };
  }, [token]);
  if (!activa || !token || !slug) return null;
  return (
    <motion.button initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} onClick={() => navigate(`/${slug}/trivia?t=${token}`)}
      className="mx-4 mt-3 flex w-[calc(100%-2rem)] items-center justify-between rounded-2xl px-4 py-3 text-left text-sm font-bold text-white shadow-sm"
      style={{ backgroundColor: color }} data-testid="aviso-trivia-vivo">
      <span>🎤 ¡Trivia en vivo en el local!</span>
      <span className="rounded-full bg-white/20 px-3 py-1 text-xs">Jugar la trivia</span>
    </motion.button>
  );
}
