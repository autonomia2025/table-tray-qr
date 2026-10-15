import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Delete, Loader2, Tablet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSesion } from "@/contexts/SesionContext";
import { destinoTrasLogin } from "@/lib/roles";
import { activarEsteDispositivo, entrarConPin, equipoDeTablet, olvidarEsteDispositivo, tokenTablet, type EquipoTablet } from "@/lib/tablet";

/**
 * Tablet compartida (fase 6.1): cada mozo toca su nombre y escribe su PIN de 4 números. Entra a su pantalla
 * de siempre y todo queda a su nombre; al terminar toca "Cambiar de mozo" y la tablet vuelve aquí.
 */
export default function TabletPage() {
  const navigate = useNavigate();
  const { perfil, recargar } = useSesion();
  const [token, setToken] = useState<string | null>(() => tokenTablet());
  const [equipo, setEquipo] = useState<EquipoTablet | null | undefined>(undefined);
  const [persona, setPersona] = useState<{ id: string; nombre: string } | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [entrando, setEntrando] = useState(false);
  const [nombreTablet, setNombreTablet] = useState("Tablet de sala");

  useEffect(() => {
    if (!token) { setEquipo(null); return; }
    equipoDeTablet(token).then(setEquipo);
  }, [token]);

  const entrar = useCallback(async (codigo: string) => {
    if (!persona) return;
    setEntrando(true);
    setError("");
    const r = await entrarConPin(persona.id, codigo);
    if (r.ok === false) { setEntrando(false); setPin(""); setError(r.error); return; }
    const destino = destinoTrasLogin(await recargar());
    navigate(destino || "/mozo/mesas", { replace: true });
  }, [persona, recargar, navigate]);

  const tecla = (d: string) => {
    if (entrando) return;
    setError("");
    const nuevo = (pin + d).slice(0, 4);
    setPin(nuevo);
    if (nuevo.length === 4) entrar(nuevo);
  };

  // Quién puede activar esta tablet: dueño, administrador o encargado con su cuenta abierta aquí
  const gestor = perfil?.locales.find((l) => ["owner", "admin", "manager"].includes(l.rol) && l.branch_id);

  if (equipo === undefined) {
    return <div className="flex min-h-screen items-center justify-center bg-background"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  if (!token || equipo === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-md space-y-4 rounded-2xl border bg-card p-6 text-center">
          <Tablet className="mx-auto h-10 w-10 text-primary" aria-hidden />
          <p className="text-xl font-extrabold text-foreground">{token ? "Esta tablet fue desactivada" : "Esta tablet todavía no está activada"}</p>
          <p className="text-sm text-muted-foreground">
            Una tablet compartida deja que cada mozo entre con su PIN de 4 números, sin compartir contraseñas.
          </p>
          {gestor ? (
            <div className="space-y-2 text-left">
              <label htmlFor="nombre-tablet" className="text-sm font-semibold text-foreground">Nombre de esta tablet</label>
              <Input id="nombre-tablet" value={nombreTablet} maxLength={40} onChange={(e) => setNombreTablet(e.target.value)} />
              <Button className="h-12 w-full" onClick={async () => {
                const r = await activarEsteDispositivo(gestor.branch_id!, nombreTablet);
                if (r.ok === false) { setError(r.error); return; }
                setToken(tokenTablet());
              }}>Activar esta tablet</Button>
            </div>
          ) : (
            <p className="text-sm text-foreground">Pídele al dueño o al encargado que entre aquí con su cuenta y la active desde esta misma pantalla.</p>
          )}
          {token && <Button variant="ghost" onClick={() => { olvidarEsteDispositivo(); setToken(null); }}>Quitar la activación anterior</Button>}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-4 py-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-baseline justify-between gap-3">
          <div>
            <p className="text-2xl font-extrabold text-foreground">{equipo.local}</p>
            <p className="text-sm text-muted-foreground">{equipo.sucursal} · {equipo.tablet}</p>
          </div>
          <p className="text-lg font-extrabold text-foreground">tablio<span className="text-primary">.</span></p>
        </div>

        {!persona ? (
          <>
            <p className="mb-4 text-lg font-bold text-foreground">¿Quién eres?</p>
            {equipo.personas.length === 0 ? (
              <p className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">
                Nadie tiene PIN todavía. Cada mozo lo crea desde su teléfono, en Perfil → «Mi PIN para tablets».
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {equipo.personas.map((p) => (
                  <button key={p.id} type="button" onClick={() => { setPersona(p); setPin(""); setError(""); }}
                    className="rounded-2xl border bg-card px-4 py-6 text-lg font-bold text-foreground shadow-sm transition-colors hover:bg-accent">
                    {p.nombre}
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mx-auto max-w-xs text-center">
            <p className="text-lg font-bold text-foreground">Hola, {persona.nombre}</p>
            <p className="text-sm text-muted-foreground">Escribe tu PIN</p>
            <div className="my-5 flex justify-center gap-3" aria-label={`${pin.length} de 4 números`}>
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className={`h-4 w-4 rounded-full border-2 border-primary ${i < pin.length ? "bg-primary" : ""}`} />
              ))}
            </div>
            {error && <p className="mb-3 text-sm font-semibold text-destructive" role="alert">{error}</p>}
            <div className="grid grid-cols-3 gap-3">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                <button key={d} type="button" onClick={() => tecla(d)} disabled={entrando} aria-label={`Número ${d}`}
                  className="h-16 rounded-2xl border bg-card text-2xl font-bold text-foreground hover:bg-accent disabled:opacity-50">{d}</button>
              ))}
              <button type="button" onClick={() => { setPersona(null); setPin(""); }} className="h-16 rounded-2xl text-sm font-semibold text-muted-foreground">Volver</button>
              <button type="button" onClick={() => tecla("0")} disabled={entrando} aria-label="Número 0"
                className="h-16 rounded-2xl border bg-card text-2xl font-bold text-foreground hover:bg-accent disabled:opacity-50">0</button>
              <button type="button" onClick={() => setPin(pin.slice(0, -1))} aria-label="Borrar" className="flex h-16 items-center justify-center rounded-2xl text-muted-foreground">
                {entrando ? <Loader2 className="h-6 w-6 animate-spin" /> : <Delete className="h-6 w-6" />}
              </button>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
