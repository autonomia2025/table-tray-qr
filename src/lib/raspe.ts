import { supabase } from "@/integrations/supabase/client";

// Premio sorpresa al pagar (fase 7.7). El resultado lo decide la base al pagar; aquí solo se pide y se raspa.

export interface MisRaspes {
  activo: boolean;
  premio: string | null;
  uno_de: number | null;
  monto_minimo: number | null;
  pendientes: { id: string; fecha: string }[];
}

export interface Resultado {
  gano: boolean;
  premio: string | null;
  codigo: string | null;
}

export async function misRaspes(local: string): Promise<MisRaspes | null> {
  const { data, error } = await supabase.rpc("mis_raspes", { _tenant_id: local });
  if (error) return null;
  return data as unknown as MisRaspes;
}

export async function raspar(id: string): Promise<Resultado> {
  const { data, error } = await supabase.rpc("raspar", { _raspe_id: id });
  if (error) throw error;
  return data as unknown as Resultado;
}
