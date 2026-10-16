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
import { miMesaEnVivo, type DivididoEnVivo } from "@/lib/mesaEnVivo";
import { cotizarParte } from "@/lib/dividir";
import SelectorPropina from "@/components/comensal/SelectorPropina";
import { PROPINA_SUGERIDA, montoPropina, type Propina } from "@/lib/propina";

/**
 * Pagar mi parte de un plato dividido (fase 7.4b). El monto lo fija la base (cotizar_parte); el pago va por el
 * mismo camino que cualquier pago con la app. Cuando están todas las partes, el plato pasa a cocina.
 */
export default function PagarPartePage() {
  const { slug, parteId } = useParams<{ slug: string; parteId: string }>();
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
  const [plato, setPlato] = useState<DivididoEnVivo | null | undefined>(undefined);
  const [propina, setPropina] = useState<Propina>(PROPINA_SUGERIDA);
  const [pagando, setPagando] = useState(false);
  const [error, setError] = useState("");
  const [pagado, setPagado] = useState(false);
  const idem = useRef(crypto.randomUUID());

  useEffect(() => {
    if (!token) { setPlato(null); return; }
    miMesaEnVivo(token).then((m) => setPlato(m?.divididos?.find((d) => d.partes.some((p) => p.id === parteId && p.yo)) ?? null));
  }, [token, parteId]);

  const parte = plato?.partes.find((p) => p.id === parteId);
  const monto = parte?.monto ?? 0;
  const propinaMonto = montoPropina(propina, monto);

  const pagar = async () => {
    if (!token || !parte || pagando) return;
    setError("");
    setPagando(true);
    try {
      const cot = await cotizarParte(token, parte.id);
      if (cot.ok === false) { setError(cot.error); return; }
      const { data, error: err } = await supabase.functions.invoke("process-payment", {
        body: { table_token: token, cotizacion_id: cot.dato.id, method: "card", tip_amount: propinaMonto,
                idempotency_key: `${idem.current}-${cot.dato.id}-${propinaMonto}`, volver_a: "pay" },
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

  if (plato === undefined) {
    return <div className="flex min-h-screen items-center justify-center bg-background"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!plato || !parte) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background p-6 text-center">
        <p className="text-sm text-muted-foreground">Esta parte ya no está disponible.</p>
        <button onClick={() => navigate(`/${slug}/tracking${qs}`)} className="text-sm font-semibold underline" style={{ color }}>Volver a mi pedido</button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-10">
      <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-border bg-background px-4">
        <button onClick={() => navigate(-1)} className="flex h-9 w-9 items-center justify-center rounded-full text-foreground"><ArrowLeft className="h-5 w-5" /></button>
        <span className="text-sm font-bold text-foreground">Pagar mi parte</span>
      </header>
      <div className="mx-auto max-w-md space-y-4 px-4 pt-4">
        {pagado ? (
          <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="rounded-2xl border border-border bg-card p-6 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12" style={{ color }} />
            <h1 className="mt-3 text-xl font-extrabold text-card-foreground">¡Pagaste tu parte!</h1>
            <p className="mt-1 text-sm text-muted-foreground">El plato pasa a la cocina cuando todos paguen la suya.</p>
            <button onClick={() => navigate(`/${slug}/tracking${qs}`)} className="mt-5 w-full rounded-2xl py-3.5 text-sm font-semibold text-white" style={{ backgroundColor: color }}>
              Ver cómo va
            </button>
          </motion.div>
        ) : (
          <>
            <div className="rounded-2xl border border-border bg-card p-4" data-testid="parte-a-pagar">
              <p className="text-xs font-bold text-muted-foreground">PLATO DIVIDIDO</p>
              <p className="mt-1 text-base font-bold text-card-foreground">{plato.plato}</p>
              <p className="text-sm text-muted-foreground">Total {formatCLP(plato.total)} entre {plato.partes.length}</p>
              <ul className="mt-3 space-y-1 text-sm">
                {plato.partes.map((p) => (
                  <li key={p.id} className="flex justify-between">
                    <span className="text-card-foreground">{p.yo ? "Tú" : p.quien} {p.estado === "pagada" ? "✓" : p.estado === "rechazada" ? "· no quiso" : ""}</span>
                    <span className="tabular-nums text-muted-foreground">{formatCLP(p.monto)}</span>
                  </li>
                ))}
              </ul>
              <hr className="my-3 border-border" />
              <div className="flex justify-between font-bold text-card-foreground"><span>Tu parte</span><span>{formatCLP(monto)}</span></div>
            </div>
            <SelectorPropina subtotal={monto} color={color} valor={propina} onCambiar={setPropina} />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <button onClick={pagar} disabled={pagando} className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-semibold text-white disabled:opacity-60" style={{ backgroundColor: color }}>
              {pagando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />} Pagar {formatCLP(monto + propinaMonto)}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
