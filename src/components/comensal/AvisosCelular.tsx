import { useEffect, useState } from "react";
import { activarAvisos, alCambiarInstalacion, avisosActivos, capacidadAvisos, instalarApp, sePuedeInstalar } from "@/lib/push";

// Avisos al celular aunque esté bloqueado, e instalar la app sin tienda (fase 3.4b).
// Discreto: una línea bajo el estado del pedido; no interrumpe a quien no lo quiere.
export default function AvisosCelular({ tokenMesa, color }: { tokenMesa: string | null; color: string }) {
  const [activos, setActivos] = useState<boolean | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [instalable, setInstalable] = useState(sePuedeInstalar());
  const capacidad = capacidadAvisos();

  useEffect(() => { avisosActivos().then(setActivos); }, []);
  useEffect(() => alCambiarInstalacion(() => setInstalable(sePuedeInstalar())), []);

  const activar = async () => {
    if (!tokenMesa) return;
    setTrabajando(true);
    setError(null);
    const r = await activarAvisos(tokenMesa);
    setTrabajando(false);
    if (r.ok === false) setError(r.error);
    else setActivos(true);
  };

  if (activos === null) return null;
  return (
    <div className="mt-3 space-y-1.5 text-center">
      {capacidad === "listo" && (activos ? (
        <p className="text-xs font-semibold text-[#1A6B45]">🔔 Te avisaremos aunque bloquees el celular</p>
      ) : (
        <button type="button" onClick={activar} disabled={trabajando} className="text-xs font-semibold underline-offset-2 hover:underline disabled:opacity-60" style={{ color }}>
          🔔 Avísame cuando esté listo, aunque bloquee el celular
        </button>
      ))}
      {capacidad === "ios-instalar" && (
        <p className="mx-auto max-w-xs text-xs text-muted-foreground">
          📲 En iPhone: toca <strong>Compartir</strong> → <strong>Agregar a inicio</strong> y abre la app desde ahí para recibir avisos con el celular bloqueado.
        </p>
      )}
      {instalable && (
        <button type="button" onClick={() => instalarApp()} className="block w-full text-xs font-semibold underline-offset-2 hover:underline" style={{ color }}>
          📲 Instalar la app (sin pasar por la tienda)
        </button>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
