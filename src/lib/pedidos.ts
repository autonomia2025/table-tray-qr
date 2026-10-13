import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

/**
 * Cambios de estado de pedidos: siempre por el servidor (fase 1.4).
 * La base valida el rol, la regla de prepago y deja registro (order_events).
 * Estados en la base: confirmed → in_kitchen → ready → delivered, o cancelled.
 */
export type EstadoPedido = "in_kitchen" | "ready" | "delivered" | "cancelled";

export async function cambiarEstadoPedido(
  pedidoId: string,
  estado: EstadoPedido,
  opciones: { estacionId?: string | null; motivo?: string } = {},
): Promise<{ ok: true; estado: string } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("cambiar_estado_pedido", {
    _order_id: pedidoId,
    _estado: estado,
    _station_id: opciones.estacionId ?? null,
    _motivo: opciones.motivo ?? null,
  });
  if (error) return { ok: false, error: mensajeAmigable(error.message) };
  return { ok: true, estado: (data as { estado: string }).estado };
}

export async function marcarAgotado(productoId: string, agotado = true) {
  const { error } = await supabase.rpc("marcar_agotado", { _menu_item_id: productoId, _agotado: agotado });
  return error ? { ok: false as const, error: mensajeAmigable(error.message) } : { ok: true as const };
}

// Los mensajes de la base ya vienen en español; si llega algo técnico, se reemplaza.
export function mensajeAmigable(mensaje: string) {
  return /[a-z]{3,}_[a-z]{3,}|violates|permission denied|JWT/i.test(mensaje)
    ? "No se pudo hacer el cambio. Intenta de nuevo."
    : mensaje;
}

/** Una línea del pedido tal como la manda la pantalla: el precio lo pone el servidor. */
export interface LineaPedido {
  menu_item_id: string;
  quantity: number;
  modifiers: { groupName: string; modifierName: string }[];
  notes?: string | null;
}

/**
 * Pedido tomado por el mozo (fase 1.9): el servidor calcula precios, valida opciones,
 * abre la mesa si hace falta y numera el pedido. En prepago queda esperando el cobro.
 */
export async function crearPedidoMozo(
  mesaId: string,
  lineas: LineaPedido[],
  notas?: string,
): Promise<
  | { ok: true; pedidoId: string; numero: number; total: number; esperaPago: boolean }
  | { ok: false; error: string }
> {
  const { data, error } = await supabase.rpc("crear_pedido_mozo", {
    _table_id: mesaId,
    _items: lineas as unknown as Json,
    _notas: notas ?? null,
  });
  if (error) return { ok: false, error: mensajeAmigable(error.message) };
  const r = data as { order_id: string; order_number: number; total: number; espera_pago: boolean };
  return { ok: true, pedidoId: r.order_id, numero: r.order_number, total: r.total, esperaPago: r.espera_pago };
}
