import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Ticket } from "lucide-react";
import { formatCLP } from "@/lib/format";
import { mensajeError } from "@/lib/errores";
import { misRaspes, raspar, type Resultado } from "@/lib/raspe";

interface Props {
  tenantId: string;
  color: string;
  /** Cambia con cada pago nuevo (vuelve a preguntar si hay un raspe) */
  clave?: string | null;
  /** Al terminar de raspar (la tarjeta muestra el premio con su código) */
  onListo?: () => void;
}

/**
 * Premio sorpresa al pagar (fase 7.7): una tarjeta para raspar con el dedo. El resultado ya lo decidió la base
 * al pagar; al primer toque se le pide y queda debajo de la capa que se raspa.
 */
export default function RaspeYGana({ tenantId, color, clave, onListo }: Props) {
  const { data, refetch } = useQuery({
    queryKey: ["raspes", tenantId, clave],
    queryFn: () => misRaspes(tenantId),
    staleTime: 10_000,
  });
  const pendiente = data?.pendientes?.[0];
  const canvas = useRef<HTMLCanvasElement>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [visto, setVisto] = useState(false);
  const [error, setError] = useState("");
  const pidiendo = useRef(false);
  const rayando = useRef(false);

  // La capa que se raspa, con el color del local
  useEffect(() => {
    const c = canvas.current;
    if (!c || !pendiente) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const { width, height } = c.getBoundingClientRect();
    c.width = width * devicePixelRatio;
    c.height = height * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    for (let x = -height; x < width; x += 14) ctx.fillRect(x, 0, 5, height * 2);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 16px 'Plus Jakarta Sans', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Raspa aquí con el dedo", width / 2, height / 2);
    setResultado(null);
    setVisto(false);
    pidiendo.current = false;
  }, [pendiente, color]);

  const pedir = useCallback(async () => {
    if (pidiendo.current || !pendiente) return;
    pidiendo.current = true;
    try {
      setResultado(await raspar(pendiente.id));
    } catch (e) {
      setError(mensajeError(e, "No pudimos abrir tu raspe. Intenta de nuevo."));
      pidiendo.current = false;
    }
  }, [pendiente]);

  const terminar = useCallback(() => {
    setVisto(true);
    navigator.vibrate?.(30);
    onListo?.();
  }, [onListo]);

  const raspando = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx || visto) return;
    const r = c.getBoundingClientRect();
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(e.clientX - r.left, e.clientY - r.top, 20, 0, Math.PI * 2);
    ctx.fill();
  };

  // Raspada más o menos la mitad: se muestra entero
  const revisar = () => {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx || visto || !resultado) return;
    const pixeles = ctx.getImageData(0, 0, c.width, c.height).data;
    let vacios = 0;
    for (let i = 3; i < pixeles.length; i += 64) if (pixeles[i] === 0) vacios++;
    if (vacios / (pixeles.length / 64) > 0.45) terminar();
  };

  if (!data?.activo) return null;

  if (!pendiente && !visto) {
    return (
      <p className="mt-3 flex items-start gap-2 rounded-xl bg-muted/60 px-3 py-2 text-left text-[11px] text-muted-foreground" data-testid="raspe-info">
        <Ticket className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color }} />
        <span>
          Premio sorpresa: cada día que pagas{data.monto_minimo ? ` desde ${formatCLP(data.monto_minimo)}` : ""} te toca un raspe.
          Gana 1 de cada {data.uno_de}: {data.premio}.
        </span>
      </p>
    );
  }

  return (
    <div className="mt-4 rounded-2xl border-2 border-dashed p-3" style={{ borderColor: color }} data-testid="raspe">
      <p className="mb-2 flex items-center justify-center gap-1.5 text-sm font-bold text-card-foreground">
        <Ticket className="h-4 w-4" style={{ color }} /> ¡Te tocó un raspe!
      </p>
      <div className="relative h-28 overflow-hidden rounded-xl bg-background">
        <div className="absolute inset-0 flex flex-col items-center justify-center px-3 text-center" data-testid="raspe-resultado">
          {!resultado ? (
            <span className="text-xs text-muted-foreground">…</span>
          ) : resultado.gano ? (
            <>
              <span className="text-2xl">🎉</span>
              <span className="text-sm font-extrabold text-foreground">¡Ganaste {resultado.premio}!</span>
              {resultado.codigo && <span className="font-mono text-lg font-extrabold tracking-[0.3em] text-foreground">{resultado.codigo}</span>}
            </>
          ) : (
            <>
              <span className="text-2xl">🍀</span>
              <span className="text-sm font-bold text-foreground">Esta vez no tocó</span>
              <span className="text-[11px] text-muted-foreground">Otro día que pagues, raspas de nuevo.</span>
            </>
          )}
        </div>
        {pendiente && (
          <motion.canvas
            ref={canvas}
            animate={{ opacity: visto ? 0 : 1 }}
            className={`absolute inset-0 h-full w-full touch-none ${visto ? "pointer-events-none" : ""}`}
            aria-label="Tarjeta para raspar"
            onPointerDown={(e) => { rayando.current = true; pedir(); raspando(e); }}
            onPointerMove={(e) => { if (rayando.current) raspando(e); }}
            onPointerUp={() => { rayando.current = false; revisar(); }}
            onPointerLeave={() => { rayando.current = false; revisar(); }}
          />
        )}
      </div>
      {error && <p className="mt-2 text-center text-xs text-destructive">{error}</p>}
      {!visto ? (
        <button onClick={async () => { await pedir(); terminar(); }} className="mt-2 w-full text-center text-xs font-semibold text-muted-foreground underline">
          Mostrar sin raspar
        </button>
      ) : (
        <div className="mt-2 text-center">
          {resultado?.gano && <p className="text-[11px] text-muted-foreground">Muéstrale el código al mozo para que te lo entregue. También queda en tus premios.</p>}
          {(data.pendientes?.length ?? 0) > 1 && (
            <button onClick={() => refetch()} className="mt-1 text-xs font-semibold underline" style={{ color }}>Raspar el siguiente</button>
          )}
        </div>
      )}
    </div>
  );
}
