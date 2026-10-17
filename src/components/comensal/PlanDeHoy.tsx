import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { cargarRonda, misPlanes, planDeHoy, type Plan } from "@/lib/planes";

/** En la carta del local del plan (fase 9.3): cargar la primera ronda con un toque. El precio se calcula al pagar. */
export default function PlanDeHoy({ tenantId, slug, token, color }: { tenantId?: string; slug?: string; token?: string | null; color: string }) {
  const navigate = useNavigate();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [aviso, setAviso] = useState("");
  useEffect(() => { if (tenantId) misPlanes().then((r) => setPlan(r.ok ? planDeHoy(r.dato, tenantId) ?? null : null)); }, [tenantId]);
  if (!plan || !slug) return null;
  const pedir = async () => {
    const r = await cargarRonda(plan);
    if (!r.agregados) { setAviso("Lo de tu primera ronda está agotado ahora."); return; }
    navigate(`/${slug}/cart${token ? `?t=${token}` : ""}`);
  };
  return (
    <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="mx-4 mt-3 rounded-2xl border-2 p-3" style={{ borderColor: color }} data-testid="plan-de-hoy">
      <p className="text-sm font-bold text-foreground">🍻 Tu plan con amigos es hoy</p>
      <p className="text-xs text-muted-foreground">Primera ronda: {plan.ronda.map((r) => (typeof r === "string" ? r : `${r.cantidad}× ${r.nombre}`)).join(", ")}</p>
      <button onClick={pedir} className="mt-2 w-full rounded-xl py-2.5 text-sm font-semibold text-white" style={{ backgroundColor: color }}>Pedir la primera ronda</button>
      {aviso && <p className="mt-1 text-xs text-muted-foreground">{aviso}</p>}
    </motion.div>
  );
}
