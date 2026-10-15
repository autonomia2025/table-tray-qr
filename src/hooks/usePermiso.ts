import { useSesion } from "@/contexts/SesionContext";
import type { Permiso } from "@/lib/roles";

/**
 * ¿La persona conectada puede hacer esto en este local? (fase 6.3). Solo ordena la pantalla: la base es la
 * que bloquea. Mientras carga, o sin lista de permisos, se muestra lo de siempre y decide la base.
 */
export function usePermiso(tenantId: string | null | undefined) {
  const { perfil } = useSesion();
  return (permiso: Permiso): boolean => {
    if (!perfil) return true;
    if (perfil.es_superadmin) return true;
    const local = perfil.locales.find((l) => l.tenant_id === tenantId);
    if (!local) return true;
    if (local.rol === "owner" || local.rol === "admin") return true;
    return local.permisos ? local.permisos.includes(permiso) : true;
  };
}
