import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Módulos por plan (fase 7.9). Lo cumple la base (tiene_funcion); aquí solo se esconde lo que el local no tiene.
// Lo básico (pedir, pagar, mozo, cocina, caja, sellos, reportes) nunca es un módulo.

export type Modulo = "campanas" | "niveles" | "pasaporte" | "raspe" | "juegos" | "ronda" | "dividir" | "tablets";
export type Modulos = Partial<Record<Modulo, boolean>>;

export interface ModuloCatalogo { modulo: Modulo; nombre: string; descripcion: string; orden: number }

export async function modulosDelLocal(local: string): Promise<Modulos> {
  const { data, error } = await supabase.rpc("modulos_del_local", { _tenant_id: local });
  if (error) return {};
  return (data ?? {}) as Modulos;
}

/** Mientras carga (o si falla) se muestra todo: la base igual rechaza lo que no corresponde. */
export const tiene = (m: Modulos | undefined, modulo: Modulo) => m?.[modulo] !== false;

export function useModulos(local?: string | null) {
  return useQuery({
    queryKey: ["modulos", local],
    queryFn: () => modulosDelLocal(local!),
    enabled: !!local,
    staleTime: 60_000,
  }).data;
}

export async function catalogoModulos(): Promise<ModuloCatalogo[]> {
  const { data } = await supabase.rpc("_catalogo_modulos");
  return ((data ?? []) as unknown as ModuloCatalogo[]).sort((a, b) => a.orden - b.orden);
}
