import { supabase } from "@/integrations/supabase/client";
import { mensajeError } from "@/lib/errores";

// Excepciones de la caja (fase 4.6; brief 5.4): lo que necesita una persona. La lista la arma la base.
//  - devolucion_fallida: pago sin pedido. La app debía devolverlo solo y la pasarela no lo devolvió.
//  - reembolso_fallido: un reembolso que la pasarela rechazó.
//  - diferencia_pasarela: monto que no calza con Transbank al conciliar.
//  - boleta_atrasada: cobro en efectivo o transferencia de un día anterior sin boleta marcada.
//  - pago_sin_confirmar: salió a Webpay y la revisión automática todavía no lo resuelve.

export type TipoExcepcion = "devolucion_fallida" | "reembolso_fallido" | "diferencia_pasarela" | "boleta_atrasada" | "pago_sin_confirmar";

export interface Excepcion {
  tipo: TipoExcepcion;
  id: string;
  fecha: string;
  monto: number;
  mesa: number | null;
  detalle: string;
  referencia?: string | null;
  dia?: string;
  pago_id?: string;
  intentos?: number;
  cobrado_por?: string | null;
  autorizado_por?: string | null;
}

export const TITULO_EXCEPCION: Record<TipoExcepcion, string> = {
  devolucion_fallida: "Cobro sin pedido por devolver",
  reembolso_fallido: "Reembolso rechazado por la pasarela",
  diferencia_pasarela: "Monto que no calza con Transbank",
  boleta_atrasada: "Boleta sin marcar",
  pago_sin_confirmar: "Pago sin confirmar",
};

type Resultado = { ok: true } | { ok: false; error: string };

export async function excepcionesCaja(sucursal: string): Promise<Excepcion[] | null> {
  const { data, error } = await supabase.rpc("excepciones_caja", { _branch_id: sucursal });
  if (error) return null;
  return (data as unknown as Excepcion[]) ?? [];
}

/** Resolver a mano: con nota cuando no queda otra constancia (devuelto a mano, descartado, revisado, no entregada). */
export async function resolverExcepcion(
  tipo: TipoExcepcion, id: string, accion: "a_mano" | "descartar" | "revisada" | "entregada" | "no_entregada",
  nota?: string, folio?: string,
): Promise<Resultado> {
  const { error } = await supabase.rpc("resolver_excepcion", {
    _tipo: tipo, _id: id, _accion: accion, _nota: nota?.trim() || undefined, _folio: folio?.trim() || undefined,
  });
  if (error) return { ok: false, error: mensajeError(error, "No se pudo resolver. Intenta de nuevo.") };
  return { ok: true };
}

/** "Reintentar ahora": la revisión de pagos de la sucursal (confirma lo pendiente y reintenta devoluciones). */
export async function revisarPagosAhora(sucursal: string): Promise<{ ok: true; devueltos: number; confirmados: number; cerrados: number } | { ok: false; error: string }> {
  const { data, error } = await supabase.functions.invoke("revisar-pagos", { body: { branch_id: sucursal } });
  if (error || !data || data.error) return { ok: false, error: "No se pudo revisar con la pasarela. Intenta en un momento." };
  return { ok: true, devueltos: data.devueltos ?? 0, confirmados: data.confirmados ?? 0, cerrados: data.cerrados ?? 0 };
}

/** Reintenta un reembolso rechazado (mismo pago, mismo monto y motivo). */
export async function reintentarReembolso(pagoId: string, monto: number, motivo: string): Promise<Resultado> {
  const { data, error } = await supabase.functions.invoke("refund-payment", {
    body: { payment_id: pagoId, amount: monto, reason: motivo },
  });
  if (error || data?.error) return { ok: false, error: data?.error ?? "La pasarela volvió a rechazarlo. Intenta más tarde." };
  return { ok: true };
}
