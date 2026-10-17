import { supabase } from "@/integrations/supabase/client";

// La mensualidad de Tablio (fase 8.1): lo único que Tablio le cobra a cada local. El estado lo calcula la base.

export type EstadoMensualidad = "sin_suscripcion" | "prueba" | "al_dia" | "por_vencer" | "en_gracia" | "atrasado" | "cancelada";

export interface Mensualidad {
  estado: EstadoMensualidad;
  precio_mensual?: number;
  dia_cobro?: number;
  prueba_hasta?: string | null;
  plan?: string | null;
  plan_id?: string | null;
  pendiente?: number;
  vence_el?: string | null;
  dias_atraso?: number;
  cobros?: { id: string; periodo: string; monto: number; vence_el: string; estado: "pendiente" | "pagado"; pagado_at: string | null; folio: string | null }[];
  como_pagar?: string | null;
}

export const TEXTO_ESTADO: Record<EstadoMensualidad, string> = {
  sin_suscripcion: "Sin suscripción",
  prueba: "En prueba",
  al_dia: "Al día",
  por_vencer: "Por pagar",
  en_gracia: "Vencida (en gracia)",
  atrasado: "Atrasada",
  cancelada: "Cancelada",
};

/** Tono del aviso: los atrasos se destacan; lo demás es informativo. */
export const estadoMalo = (e?: EstadoMensualidad) => e === "en_gracia" || e === "atrasado";

/** Mes de un cobro, en palabras ("octubre de 2026"). */
export const nombreMes = (periodo: string) => {
  const t = new Date(`${periodo}T12:00:00`).toLocaleDateString("es-CL", { month: "long", year: "numeric" });
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** "13 de octubre" a partir de "2026-10-13" (sin correrse por la zona horaria). */
export const fechaDia = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("es-CL", { day: "numeric", month: "long" });

export async function miMensualidad(local: string): Promise<Mensualidad | null> {
  const { data, error } = await supabase.rpc("mi_mensualidad", { _tenant_id: local });
  if (error) return null;
  return data as unknown as Mensualidad;
}
