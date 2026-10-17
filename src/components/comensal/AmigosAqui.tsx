import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { amigosAqui, avisarQueEstoy, mandarSalud, type AmigosAqui as Estado } from "@/lib/saludAmigos";

/**
 * Amigos aquí y "¡Salud!" (fase 9.5). Nadie aparece presente si no lo activa; solo te ven tus amigos que también
 * están en este local y lo activaron.
 */
export default function AmigosAqui({ token, color }: { token?: string | null; color: string }) {
  const [e, setE] = useState<Estado | null>(null);
  const [brindis, setBrindis] = useState<string | null>(null);
  const [aviso, setAviso] = useState("");
  const cargar = useCallback(async () => {
    if (!token) return;
    const r = await amigosAqui(token);
    if (!r.ok) return;
    setE(r.dato);
    const s = r.dato.saludos?.[0];
    if (s) { setBrindis(s.de); navigator.vibrate?.([30, 60, 30]); setTimeout(() => setBrindis(null), 5000); }
  }, [token]);
  useEffect(() => { cargar(); const id = setInterval(cargar, 20_000); return () => clearInterval(id); }, [cargar]);
  if (!token || !e?.comunidad) return null;

  const avisar = async (activar: boolean) => { setAviso(""); const r = await avisarQueEstoy(token, activar); if (r.ok === false) setAviso(r.error); cargar(); };
  const salud = async (id: string, nombre: string) => {
    const r = await mandarSalud(token, id);
    setAviso(r.ok ? `🍻 Le mandaste un salud a ${nombre}` : (r as { error: string }).error);
  };

  return (
    <div className="mx-4 mt-3 rounded-2xl border bg-card p-4" data-testid="amigos-aqui">
      <AnimatePresence>
        {brindis && (
          <motion.p initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
            className="mb-2 rounded-xl py-2 text-center text-sm font-bold text-white" style={{ backgroundColor: color }} data-testid="salud-recibido">
            🍻 ¡{brindis} te mandó un salud!
          </motion.p>
        )}
      </AnimatePresence>
      {!e.avisando ? (
        <>
          <p className="text-sm font-bold text-card-foreground">👋 ¿Hay amigos tuyos aquí?</p>
          <p className="text-xs text-muted-foreground">Avisa que estás. Solo lo ven tus amigos que también están en este local y lo activaron; se apaga solo al irte.</p>
          <button onClick={() => avisar(true)} className="mt-2 w-full rounded-xl border py-2.5 text-sm font-semibold text-card-foreground">Avisar a mis amigos que estoy aquí</button>
        </>
      ) : (
        <>
          <p className="text-sm font-bold text-card-foreground">Tus amigos aquí</p>
          {!e.amigos?.length ? <p className="text-xs text-muted-foreground">Ninguno de tus amigos está avisando ahora.</p> : (
            <ul className="mt-1 space-y-1">
              {e.amigos.map((a) => (
                <li key={a.user_id} className="flex items-center justify-between">
                  <span className="text-sm text-card-foreground">{a.nombre}</span>
                  <button onClick={() => salud(a.user_id, a.nombre)} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white" style={{ backgroundColor: color }}>🍻 Salud</button>
                </li>
              ))}
            </ul>
          )}
          <button onClick={() => avisar(false)} className="mt-2 text-xs text-muted-foreground underline">Dejar de avisar</button>
        </>
      )}
      {aviso && <p className="mt-1 text-xs text-muted-foreground">{aviso}</p>}
    </div>
  );
}
