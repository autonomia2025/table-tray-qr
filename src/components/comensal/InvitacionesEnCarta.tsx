import { useCallback, useEffect, useState } from "react";
import { miMesaEnVivo, type MesaEnVivo } from "@/lib/mesaEnVivo";
import InvitacionesMesa from "@/components/comensal/InvitacionesMesa";

/** Invitaciones a otra mesa en la carta (fase 9.1): se ven sin haber pedido nada todavía. */
export default function InvitacionesEnCarta({ token, slug, tenantId, color }: { token?: string | null; slug?: string; tenantId?: string; color: string }) {
  const [enVivo, setEnVivo] = useState<MesaEnVivo | null>(null);
  const cargar = useCallback(() => { if (token) miMesaEnVivo(token).then(setEnVivo); }, [token]);
  useEffect(() => { cargar(); const id = setInterval(cargar, 15_000); return () => clearInterval(id); }, [cargar]);
  if (!token || !slug || !enVivo || enVivo.modulos?.invitar === false) return null;
  return (
    <div className="px-4 pt-3">
      <InvitacionesMesa token={token} slug={slug} tenantId={tenantId} enVivo={enVivo} color={color} recargar={cargar} />
    </div>
  );
}
