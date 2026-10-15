import { supabase } from "@/integrations/supabase/client";

// Salud de la plataforma (fase 5.4): la base se revisa sola cada hora; el superadmin la ve en vivo.

export type EstadoSalud = "ok" | "atencion" | "problema";

export interface Salud {
  estado: EstadoSalud;
  problemas: string[];
  avisos: string[];
  relojes: { nombre: string; cada: string; activo: boolean; ultima_vez: string | null; resultado: string | null; detalle: string | null; fallas_24h: number }[];
  llamadas: { total_24h: number; fallidas_24h: number; ultima_falla: string | null; detalle: string | null };
  pagos: { sin_confirmar: number; devoluciones_pendientes: number; reembolsos_rechazados: number };
  excepciones: { diferencias_pasarela: number; boletas_atrasadas: number; locales_con_excepciones: number };
  auditorias: Record<string, number>;
  locales: { activos: number; con_pedidos_hoy: number; pedidos_24h: number; activaciones_vencidas: number };
  revisado_at: string;
}

export async function saludPlataforma(): Promise<Salud | null> {
  const { data, error } = await supabase.rpc("salud_plataforma");
  if (error) return null;
  return data as unknown as Salud;
}

export async function historialSalud(): Promise<{ id: number; estado: EstadoSalud; created_at: string }[]> {
  const { data } = await supabase.from("salud_registros").select("id, estado, created_at").order("created_at", { ascending: false }).limit(72);
  return ((data ?? []) as { id: number; estado: EstadoSalud; created_at: string }[]).reverse();
}
