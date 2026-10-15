import { supabase } from "@/integrations/supabase/client";
import { mensajeError } from "@/lib/errores";
import type { Permiso } from "@/lib/roles";

// Permisos finos (fase 6.3): el dueño o el administrador ajustan qué puede hacer cada rol. La base los hace
// cumplir (tiene_permiso); estas funciones solo los muestran y los cambian.

export type RolAjustable = "manager" | "cashier" | "waiter" | "kitchen";
export const ROLES_AJUSTABLES: RolAjustable[] = ["manager", "cashier", "waiter", "kitchen"];

export interface FilaPermiso {
  permiso: Permiso;
  nombre: string;
  descripcion: string;
  roles: Record<RolAjustable, { permitido: boolean; posible: boolean; de_fabrica: boolean }>;
}

export async function permisosDelLocal(local: string): Promise<FilaPermiso[]> {
  const { data } = await supabase.rpc("permisos_del_local", { _tenant_id: local });
  return (data as unknown as FilaPermiso[] | null) ?? [];
}

export async function guardarPermiso(local: string, rol: RolAjustable, permiso: Permiso, permitido: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.rpc("guardar_permiso_rol", { _tenant_id: local, _rol: rol, _permiso: permiso, _permitido: permitido });
  if (error) return { ok: false, error: mensajeError(error, "No se pudo guardar el permiso. Intenta de nuevo.") };
  return { ok: true };
}
