import { supabase } from "@/integrations/supabase/client";

// Pasaporte de la casa (fase 7.6): lo que el cliente fue probando en el local, por sección, y sus insignias.
// Lo calcula la base desde sus pedidos pagados.

export interface Pasaporte {
  activo: boolean;
  probados?: number;
  total?: number;
  secciones?: { id: string; nombre: string; emoji: string | null; total: number; probados: number; completa: boolean;
    items: { id: string; nombre: string; imagen: string | null; probado: boolean }[] }[];
  insignias?: { tipo: "seccion" | "cantidad"; nombre: string; emoji: string }[];
  siguiente?: { nombre: string; faltan: number } | null;
}

export async function miPasaporte(local: string): Promise<Pasaporte | null> {
  const { data, error } = await supabase.rpc("mi_pasaporte", { _tenant_id: local });
  if (error) return null;
  return data as unknown as Pasaporte;
}
