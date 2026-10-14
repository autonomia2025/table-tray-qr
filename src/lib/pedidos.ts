import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { mensajeError } from "@/lib/errores";

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
  // Lo que quedó listo se avisa al celular del comensal, aunque lo tenga bloqueado (fase 3.4b).
  // No se espera: si el aviso falla, el pedido igual avanzó.
  if (estado === "ready") {
    supabase.functions.invoke("avisar-listo", { body: { order_id: pedidoId } }).catch(() => undefined);
  }
  return { ok: true, estado: (data as { estado: string }).estado };
}

export async function marcarAgotado(productoId: string, agotado = true) {
  const { error } = await supabase.rpc("marcar_agotado", { _menu_item_id: productoId, _agotado: agotado });
  return error ? { ok: false as const, error: mensajeAmigable(error.message) } : { ok: true as const };
}

// Los mensajes de la base ya vienen en español; si llega algo técnico, se reemplaza.
/** Mensaje para la pantalla a partir del error de la base (ver mensajeError en lib/errores). */
export function mensajeAmigable(mensaje: string) {
  return mensajeError({ message: mensaje });
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

/**
 * Pedir sin pagar en la app (fase 2.B): "Pagar al mozo" (efectivo o POS) o, en locales con cuenta
 * abierta, "Agregar a mi cuenta". El servidor calcula el precio y numera el pedido.
 */
export async function pedirSinPagar(
  qrToken: string,
  lineas: LineaPedido[],
  forma: "mozo" | "cuenta",
  notas?: string,
): Promise<
  | { ok: true; pedidoId: string; numero: number; total: number; aCocina: boolean }
  | { ok: false; error: string }
> {
  const { data, error } = await supabase.rpc("pedir_sin_pagar", {
    _qr_token: qrToken,
    _items: lineas as unknown as Json,
    _forma: forma,
    _notas: notas ?? null,
  });
  if (error) return { ok: false, error: mensajeAmigable(error.message) };
  const r = data as { order_id: string; order_number: number; total: number; a_cocina: boolean };
  return { ok: true, pedidoId: r.order_id, numero: r.order_number, total: r.total, aCocina: r.a_cocina };
}

/** El mozo (o la caja) registra un cobro en efectivo o POS. En prepago, recién ahí pasa a cocina. */
export async function registrarCobroMozo(
  pedidoIds: string[],
  metodo: "cash" | "pos",
  propina = 0,
  recibido?: number | null,
): Promise<{ ok: true; total: number; vuelto: number | null } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("registrar_cobro_mozo", {
    _order_ids: pedidoIds,
    _metodo: metodo,
    _propina: propina,
    _recibido: recibido ?? null,
  });
  if (error) return { ok: false, error: mensajeAmigable(error.message) };
  const r = data as { total: number; vuelto: number | null };
  return { ok: true, total: r.total, vuelto: r.vuelto };
}
