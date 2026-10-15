import { supabase } from "@/integrations/supabase/client";
import { mensajeError } from "@/lib/errores";

// Boleta del local (fase 4.3, etapa 1). La boleta siempre es del local, con su RUT, y la emite con su sistema
// de siempre. Con la app o con POS, el comprobante de la pasarela vale como boleta (si el local lo declara en
// el SII). En efectivo y transferencia, Tablio recuerda entregarla: queda pendiente hasta que alguien la marca.

export type MetodoBoleta = "cash" | "transfer";

export interface BoletaPendiente {
  id: string;
  creado_at: string;
  mesa: number | null;
  monto: number;
  metodo: MetodoBoleta;
  dia?: string;
  propina?: number;
  cobrado_por?: string;
}

/** Cómo se dice cada medio de cobro en el local. */
export const MEDIO_COBRO: Record<string, string> = {
  cash: "Efectivo",
  pos: "POS",
  transfer: "Transferencia",
};

type Resultado = { ok: true; yaEstaba: boolean } | { ok: false; error: string };

/** Marca la boleta de un cobro como entregada (quien cobró, o la caja, el encargado, el administrador o el dueño). */
export async function marcarBoleta(pagoId: string, folio?: string | null): Promise<Resultado> {
  const { data, error } = await supabase.rpc("marcar_boleta", { _pago_id: pagoId, _folio: folio?.trim() || undefined });
  if (error) return { ok: false, error: mensajeError(error, "No se pudo marcar la boleta. Intenta de nuevo.") };
  return { ok: true, yaEstaba: Boolean((data as { ya_estaba?: boolean } | null)?.ya_estaba) };
}

/** Las boletas por entregar de la sucursal, de los últimos 7 días (caja, encargado, administrador, dueño). */
export async function boletasPendientes(sucursal: string): Promise<BoletaPendiente[]> {
  const { data, error } = await supabase.rpc("boletas_pendientes", { _branch_id: sucursal });
  if (error) return [];
  return (data as unknown as BoletaPendiente[]) ?? [];
}

/** Las boletas que me faltan entregar a mí (lo que cobré en las últimas 24 horas). */
export async function misBoletasPendientes(): Promise<BoletaPendiente[]> {
  const { data, error } = await supabase.rpc("mis_boletas_pendientes");
  if (error) return [];
  return (data as unknown as BoletaPendiente[]) ?? [];
}
