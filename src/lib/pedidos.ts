import { supabase } from "@/integrations/supabase/client";

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
