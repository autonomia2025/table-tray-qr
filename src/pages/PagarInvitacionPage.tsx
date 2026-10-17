import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowLeft, CheckCircle2, CreditCard, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCartStore } from "@/store/cartStore";
import { formatCLP } from "@/lib/format";
import { mensajeAmigable } from "@/lib/pedidos";
import { irAPasarela, type Redireccion } from "@/lib/pagos";
import { miMesaEnVivo } from "@/lib/mesaEnVivo";
import { cotizarInvitacion, type InvitacionEnviada } from "@/lib/invitar";
import SelectorPropina from "@/components/comensal/SelectorPropina";
import { PROPINA_SUGERIDA, montoPropina, type Propina } from "@/lib/propina";

/**
 * Pagar una invitación a otra mesa (fase 9.1), cuando la otra mesa ya la aceptó. El precio lo fija la base
 * (cotizar_invitacion); el pago va por el mismo camino que cualquier pago con la app y el producto pasa a la
 * cocina para la otra mesa.
 */
export default function PagarInvitacionPage() {
  const { slug, invitacionId } = useParams<{ slug: string; invitacionId: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("t") || useCartStore.getState().tableToken;
  const qs = token ? `?t=${token}` : "";
  const { data: color = "#E8531D" } = useQuery({
    queryKey: ["primary-color", slug],
    queryFn: async () => (await supabase.from("tenants").select("primary_color").eq("slug", slug!).maybeSingle()).data?.primary_color || "#E8531D",
    enabled: !!slug,
    staleTime: Infinity,
  });
  const [inv, setInv] = useState<InvitacionEnviada | null | undefined>(undefined);
  const [monto, setMonto] = useState(0);
  const [cotizacion, setCotizacion] = useState<string | null>(null);
  const [propina, setPropina] = useState<Propina>(PROPINA_SUGERIDA);
  const [pagando, setPagando] = useState(false);
  const [error, setError] = useState("");
  const [pagado, setPagado] = useState(false);
  const idem = useRef(crypto.randomUUID());

  // El precio se congela al abrir la página (10 minutos)
  useEffect(() => {
    if (!token || !invitacionId) { setInv(null); return; }
    miMesaEnVivo(token).then(async (m) => {
      const i = m?.invitaciones?.enviadas.find((x) => x.id === invitacionId && x.estado === "aceptada") ?? null;
      if (i) {
        const cot = await cotizarInvitacion(token, i.id);
        if (cot.ok === false) setError(cot.error); else { setMonto(cot.dato.subtotal); setCotizacion(cot.dato.id); }
      }
      setInv(i);
    });
  }, [token, invitacionId]);

  const propinaMonto = montoPropina(propina, monto);

  const pagar = async () => {
    if (!token || !inv || !cotizacion || pagando) return;
    setError("");
    setPagando(true);
    try {
      const { data, error: err } = await supabase.functions.invoke("process-payment", {
        body: { table_token: token, cotizacion_id: cotizacion, method: "card", tip_amount: propinaMonto,
                idempotency_key: `${idem.current}-${cotizacion}-${propinaMonto}`, volver_a: "pay" },
      });
      const r = data as { approved?: boolean; error?: string; pendiente?: boolean; redirigir?: Redireccion } | null;
      if (r?.pendiente && r.redirigir) { irAPasarela(r.redirigir); return; }
      if (err || !r?.approved) {
        const cuerpo = err ? await (err as { context?: Response }).context?.json?.().catch(() => null) : null;
        setError(mensajeAmigable(r?.error || cuerpo?.error || "No pudimos procesar el pago. Intenta de nuevo."));
        return;
      }
      setPagado(true);
    } catch {
      setError("Error de conexión. Revisa tu señal e intenta otra vez.");
    } finally {
      setPagando(false);
    }
  };

  if (inv === undefined) {
    return <div className="flex min-h-screen items-center justify-center bg-background"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!inv) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background p-6 text-center">
        <p className="text-sm text-muted-foreground">Esta invitación ya no está para pagar (puede que haya vencido o que ya la pagaste).</p>
        <button onClick={() => navigate(`/${slug}/tracking${qs}`)} className="text-sm font-semibold underline" style={{ color }}>Volver a mi pedido</button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-10">
      <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-border bg-background px-4">
        <button onClick={() => navigate(-1)} className="flex h-9 w-9 items-center justify-center rounded-full text-foreground"><ArrowLeft className="h-5 w-5" /></button>
        <span className="text-sm font-bold text-foreground">Pagar la invitación</span>
      </header>
      <div className="mx-auto max-w-md space-y-4 px-4 pt-4">
        {pagado ? (
          <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="rounded-2xl border border-border bg-card p-6 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12" style={{ color }} />
            <h1 className="mt-3 text-xl font-extrabold text-card-foreground">¡Invitación pagada!</h1>
            <p className="mt-1 text-sm text-muted-foreground">Ya va a la cocina, y se lo llevan a la mesa {inv.para_mesa}.</p>
            <button onClick={() => navigate(`/${slug}/tracking${qs}`)} className="mt-5 w-full rounded-2xl py-3.5 text-sm font-semibold text-white" style={{ backgroundColor: color }}>
              Ver cómo va
            </button>
          </motion.div>
        ) : (
          <>
            <div className="rounded-2xl border border-border bg-card p-4" data-testid="invitacion-a-pagar">
              <p className="text-xs font-bold text-muted-foreground">INVITACIÓN A LA MESA {inv.para_mesa}</p>
              <div className="mt-1 flex justify-between text-base font-bold text-card-foreground"><span>{inv.producto}</span><span>{formatCLP(monto)}</span></div>
              <p className="mt-1 text-xs text-muted-foreground">La aceptaron. El precio queda fijo por 10 minutos.</p>
            </div>
            <SelectorPropina subtotal={monto} color={color} valor={propina} onCambiar={setPropina} />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <button onClick={pagar} disabled={pagando || !cotizacion} className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-semibold text-white disabled:opacity-60" style={{ backgroundColor: color }}>
              {pagando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />} Pagar {formatCLP(monto + propinaMonto)}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
