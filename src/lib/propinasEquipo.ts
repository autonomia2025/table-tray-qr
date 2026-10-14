import { supabase } from "@/integrations/supabase/client";
import { mensajeError } from "@/lib/errores";

// Propinas por pagar al equipo (art. 64 del Código del Trabajo): la plata de las propinas queda en el
// local y debe entregarse íntegra al mozo; con tarjeta, en 7 días hábiles. Tablio lleva la cuenta.

export interface PropinasPorPagar {
  pendientes: { staff_id: string; nombre: string; monto: number; pagos: number; desde: string; vence: string; vencida: boolean }[];
  pagadas: { id: string; nombre: string; monto: number; medio: string; nota: string | null; pagado_por: string | null; created_at: string }[];
}

export interface MisPropinas {
  por_cobrar: number;
  desde: string | null;
  vence: string | null;
  pagadas: { monto: number; medio: string; created_at: string; pagado_por: string | null }[];
}

export type MedioPagoPropina = "efectivo" | "transferencia" | "otro";
export const MEDIOS_PAGO_PROPINA: Record<MedioPagoPropina, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  otro: "Otro",
};

type Resultado<T> = { ok: true; dato: T } | { ok: false; error: string };

export async function propinasPorPagar(sucursal: string): Promise<PropinasPorPagar | null> {
  const { data, error } = await supabase.rpc("propinas_por_pagar", { _branch_id: sucursal });
  if (error) return null;
  return data as unknown as PropinasPorPagar;
}

export async function pagarPropinas(sucursal: string, mozo: string, medio: MedioPagoPropina, nota?: string): Promise<Resultado<{ monto: number; nombre: string }>> {
  const { data, error } = await supabase.rpc("pagar_propinas", { _branch_id: sucursal, _staff_id: mozo, _medio: medio, _nota: nota || undefined });
  if (error) return { ok: false, error: mensajeError(error) };
  return { ok: true, dato: data as unknown as { monto: number; nombre: string } };
}

export async function misPropinasPorCobrar(sucursal: string): Promise<MisPropinas | null> {
  const { data, error } = await supabase.rpc("mis_propinas_por_cobrar", { _branch_id: sucursal });
  if (error) return null;
  return data as unknown as MisPropinas;
}

/** "lunes 20 de octubre" a partir de "2026-10-20" (sin correrse por la zona horaria). */
export const fechaLarga = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long" });
