import { supabase } from "@/integrations/supabase/client";
import { mensajeAmigable } from "@/lib/pedidos";

// Reportes e inicio del dueño (fase 3.6): todo lo calcula la base por día de negocio (hora de Chile).

export interface Reporte {
  desde: string;
  hasta: string;
  dias: number;
  resumen: { ventas: number; pagos: number; propinas: number; reembolsado: number; ticket: number; pedidos: number; visitas: number };
  anterior: { ventas: number; pagos: number; pedidos: number; ticket: number };
  por_dia: { dia: string; ventas: number; pagos: number }[];
  canales: { app: number; efectivo: number; pos: number };
  horas: { dia_semana: number; hora: number; ventas: number; pagos: number }[];
  platos: { nombre: string; cantidad: number; ventas: number }[];
  sin_ventas: string[];
  categorias: { nombre: string; cantidad: number; ventas: number }[];
  cocina: { nombre: string; estacion: string | null; preparados: number; mediana_min: number; p90_min: number; objetivo_min: number | null }[];
  zonas: { zona: string; ventas: number; visitas: number }[];
  mesas: { numero: number; ventas: number; visitas: number; duracion_min: number | null }[];
  clientes: { personas: number; vuelven: number; nuevas: number };
  calificacion: { promedio: number | null; cantidad: number };
}

export interface Historia {
  hoy: { dia: string; ventas: number; pagos: number; mesas_abiertas: number };
  ultimo: null | {
    dia: string;
    es_ayer: boolean;
    ventas: number;
    pagos: number;
    ticket: number;
    propinas: number;
    mejor_plato: { nombre: string; cantidad: number } | null;
    mejor_zona: { zona: string; ventas: number } | null;
    hora_pico: { hora: number; ventas: number } | null;
    mozo: { nombre: string; ventas: number } | null;
    calificacion: number | null;
  };
  mismo_dia_semana_pasada?: { dia: string; ventas: number };
  semana?: { ventas: number; anterior: number };
  alertas?: {
    agotados: string[];
    plato_lento: { nombre: string; mediana_min: number; objetivo_min: number } | null;
    perdido_7_dias: number;
  };
}

type Resultado<T> = { ok: true; dato: T } | { ok: false; error: string };

export async function reporteLocal(sucursal: string, desde: string, hasta: string): Promise<Resultado<Reporte>> {
  const { data, error } = await supabase.rpc("reporte_local", { _branch_id: sucursal, _desde: desde, _hasta: hasta });
  if (error) return { ok: false, error: mensajeAmigable(error.message) };
  return { ok: true, dato: data as unknown as Reporte };
}

export async function historiaDelLocal(sucursal: string): Promise<Resultado<Historia>> {
  const { data, error } = await supabase.rpc("historia_del_local", { _branch_id: sucursal });
  if (error) return { ok: false, error: mensajeAmigable(error.message) };
  return { ok: true, dato: data as unknown as Historia };
}

/** Día de negocio de hoy en Chile (el corte es a las 06:00: a las 2 AM todavía es "ayer"). */
export const diaNegocio = (diasAtras = 0) =>
  new Date(Date.now() - 6 * 3_600_000 - diasAtras * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Santiago" });

/** "martes 13 de octubre" a partir de "2026-10-13" (sin correrse por la zona horaria). */
export const nombreDia = (iso: string, conMes = false) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("es-CL", conMes ? { weekday: "long", day: "numeric", month: "long" } : { weekday: "long", day: "numeric" });

/** Variación en % (null si no hay con qué comparar). */
export const variacion = (actual: number, antes: number) => (antes > 0 ? Math.round(((actual - antes) / antes) * 100) : null);

export const DIAS_SEMANA = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
