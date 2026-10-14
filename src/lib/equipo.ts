import { supabase } from "@/integrations/supabase/client";
import { mensajeAmigable } from "@/lib/pedidos";

// Control del equipo (fase 3.3). Todo lo calcula la base; aquí solo se pide y se muestra.

export interface Desempeno {
  staff_id: string;
  nombre: string;
  mesas: number;
  pedidos_entregados: number;
  pagos: number;
  ventas: number;
  ticket_promedio: number;
  propinas: number;
  llamados: number;
  llamado_promedio_min: number | null;
  llamados_a_tiempo: number;
  entregas: number;
  retiro_promedio_min: number | null;
  entregas_a_tiempo: number;
  calificaciones: number;
  calificacion_promedio: number | null;
}

export interface Objetivos {
  llamado: number;
  retiro: number;
  pedido: number;
}

export interface MetaAvance {
  tipo: "ventas" | "mesas";
  periodo: "dia" | "semana" | "mes";
  objetivo: number;
  avance: number;
}

type Resultado<T> = { ok: true; dato: T } | { ok: false; error: string };

export async function rankingEquipo(sucursal: string, desde: string, hasta: string): Promise<Resultado<{ objetivos: Objetivos; mozos: Desempeno[] }>> {
  const { data, error } = await supabase.rpc("ranking_equipo", { _branch_id: sucursal, _desde: desde, _hasta: hasta });
  if (error) return { ok: false, error: mensajeAmigable(error.message) };
  return { ok: true, dato: data as unknown as { objetivos: Objetivos; mozos: Desempeno[] } };
}

export async function miDesempeno(sucursal: string): Promise<Resultado<{ objetivos: Objetivos; hoy: Desempeno; semana: Desempeno; mes: Desempeno; metas: MetaAvance[] }>> {
  const { data, error } = await supabase.rpc("mi_desempeno", { _branch_id: sucursal });
  if (error) return { ok: false, error: mensajeAmigable(error.message) };
  return { ok: true, dato: data as never };
}

/** Semáforo de cumplimiento: verde dentro del objetivo, ámbar al pasarse, rojo al doble. */
export type Color = "verde" | "ambar" | "rojo";
export function semaforo(minutos: number | null, objetivo: number): Color | null {
  if (minutos === null || minutos === undefined) return null;
  if (minutos <= objetivo) return "verde";
  return minutos < objetivo * 2 ? "ambar" : "rojo";
}
export const CLASE_SEMAFORO: Record<Color, string> = {
  verde: "text-emerald-600 dark:text-emerald-400",
  ambar: "text-amber-600 dark:text-amber-400",
  rojo: "text-destructive",
};
export const PUNTO_SEMAFORO: Record<Color, string> = {
  verde: "bg-emerald-500",
  ambar: "bg-amber-500",
  rojo: "bg-destructive",
};

export const NOMBRE_PERIODO = { dia: "hoy", semana: "esta semana", mes: "este mes" } as const;
export const NOMBRE_TIPO = { ventas: "Ventas", mesas: "Mesas cerradas" } as const;

/** "1,5 min" */
export function minutos(m: number | null) {
  if (m === null || m === undefined) return "—";
  return `${String(m).replace(".", ",")} min`;
}
