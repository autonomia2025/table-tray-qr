import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { BellOff, Megaphone, UtensilsCrossed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { bajaPromo, verPromo, type Promo } from "@/lib/campanas";

/**
 * La promoción que abre un aviso de campaña (fase 7.1). Muestra el mensaje del local, con su color, y deja
 * darse de baja de ese local sin iniciar sesión (el enlace es de una sola persona).
 */
export default function PromoPage() {
  const { token } = useParams<{ token: string }>();
  const [promo, setPromo] = useState<Promo | null | undefined>(undefined);
  const [deBaja, setDeBaja] = useState(false);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!token) { setPromo(null); return; }
    verPromo(token).then((p) => { setPromo(p); setDeBaja(!!p?.de_baja); });
  }, [token]);

  if (promo === undefined) {
    return <div className="flex min-h-screen items-center justify-center bg-background"><Skeleton className="h-16 w-16 rounded-full" /></div>;
  }
  if (promo === null) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background p-6 text-center">
        <UtensilsCrossed className="h-10 w-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Esta promoción ya no está disponible.</p>
      </div>
    );
  }

  const color = promo.color || "#E8531D";
  const darseDeBaja = async () => {
    setEnviando(true);
    const ok = await bajaPromo(token!);
    setEnviando(false);
    if (ok) setDeBaja(true);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="px-6 pb-16 pt-12 text-center text-white" style={{ backgroundColor: color }}>
        {promo.logo ? (
          <img src={promo.logo} alt="" className="mx-auto mb-3 h-16 w-16 rounded-full bg-white object-cover" />
        ) : (
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-white/20 text-2xl font-extrabold">{promo.local.charAt(0).toUpperCase()}</div>
        )}
        <p className="text-sm font-semibold opacity-90">{promo.local}</p>
      </div>
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mx-auto -mt-10 max-w-md px-4">
        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color }}>
            <Megaphone className="h-3.5 w-3.5" /> Promoción
          </p>
          <h1 className="text-2xl font-extrabold text-foreground">{promo.titulo}</h1>
          <p className="mt-2 text-base text-foreground">{promo.mensaje}</p>
          <p className="mt-4 text-sm text-muted-foreground">Te esperamos en {promo.local}. Pide y paga con el QR de tu mesa.</p>
        </div>

        <div className="mt-6 text-center">
          {deBaja ? (
            <p className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground" role="status">
              <BellOff className="h-4 w-4" /> Listo: no te llegarán más promociones de {promo.local}.
            </p>
          ) : (
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={darseDeBaja} disabled={enviando}>
              <BellOff className="mr-1 h-4 w-4" /> No quiero más promociones de {promo.local}
            </Button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
