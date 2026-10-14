import { useQuery } from "@tanstack/react-query";
import { useSesion } from "@/contexts/SesionContext";
import { misSellos, type Tarjeta } from "@/lib/sellos";

/** Tarjeta de sellos del comensal en un local (fase 3.7). Se vuelve a consultar al cambiar la cuenta. */
export function useTarjetaSellos(tenantId?: string, branchId?: string | null) {
  const { perfil } = useSesion();
  return useQuery<Tarjeta | null>({
    queryKey: ["sellos", tenantId, branchId, perfil?.user_id, perfil?.es_anonimo, perfil?.email],
    queryFn: () => misSellos(tenantId!, branchId),
    enabled: !!tenantId && !!perfil,
    staleTime: 15_000,
    // Al aparecer (por ejemplo, después de pagar) siempre pregunta de nuevo: lo guardado es de antes del pago
    refetchOnMount: "always",
  });
}
