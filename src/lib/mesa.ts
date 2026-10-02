import { supabase } from "@/integrations/supabase/client";
import { mensajeAmigable } from "@/lib/pedidos";

/**
 * Mesas y sesiones: siempre por el servidor (fase 1.5).
 * Abrir, tomar, transferir y cerrar validan el rol en la base y quedan registradas (table_events).
 */

export interface SesionDeMesa {
  id: string;
  opened_at: string | null;
  total_amount: number;
  paid_amount: number;
  tip_amount: number;
}

export interface MesaDelQR {
  id: string;
  number: number;
  name: string | null;
  zone: string | null;
  tenant_id: string;
  branch_id: string;
  status: "free" | "occupied" | "waiting_bill";
  sesion: SesionDeMesa | null;
}

type Resultado<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** El comensal resuelve su mesa con el código del QR (la lectura directa de mesas está cerrada). */
export async function verMesa(qrToken: string): Promise<MesaDelQR | null> {
  if (!qrToken) return null;
  const { data, error } = await supabase.rpc("ver_mesa", { _qr_token: qrToken });
  if (error) {
    console.error("ver_mesa:", error.message);
    return null;
  }
  return (data as unknown as MesaDelQR | null) ?? null;
}

async function llamar<T>(fn: string, args: Record<string, unknown>): Promise<Resultado<{ datos: T }>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await supabase.rpc(fn as any, args as any);
  if (error) return { ok: false, error: mensajeAmigable(error.message) };
  return { ok: true, datos: data as T };
}

export const abrirMesa = (mesaId: string) =>
  llamar<{ session_id: string; nueva: boolean }>("abrir_mesa", { _table_id: mesaId });

export const tomarMesa = (mesaId: string) =>
  llamar<{ assigned_waiter_id: string; cambio: boolean }>("tomar_mesa", { _table_id: mesaId });

export const transferirMesa = (mesaId: string, staffId: string) =>
  llamar<{ assigned_waiter_id: string; cambio: boolean; nombre?: string }>("transferir_mesa", {
    _table_id: mesaId,
    _staff_id: staffId,
  });

export const cerrarMesa = (mesaId: string, motivo?: string) =>
  llamar<{ pedidos_sin_pagar: number; monto_sin_pagar: number; pedidos_entregados: number }>("cerrar_mesa", {
    _table_id: mesaId,
    _motivo: motivo ?? null,
  });

export const calificarMesa = (qrToken: string, estrellas: number) =>
  llamar<null>("calificar_mesa", { _qr_token: qrToken, _estrellas: estrellas });

/** La base pide motivo cuando un encargado cierra una mesa con pedidos sin pagar. */
export const pideMotivo = (error: string) => /indica el motivo/i.test(error);

/* ---------- Acciones del comensal sin cámara (fase 1.6) ---------- */

/** Llama al mozo. Si ya hay una llamada pendiente en la mesa, devuelve esa. */
export const llamarMozo = (qrToken: string, motivo: string) =>
  llamar<{ id: string; status: string; nueva: boolean }>("llamar_mozo", { _qr_token: qrToken, _motivo: motivo });

export const cancelarLlamado = (id: string) => llamar<null>("cancelar_llamado", { _id: id });

/** Pide la cuenta: el total lo calcula la base (lo que la mesa tiene sin pagar). */
export const pedirCuenta = (qrToken: string, propina: number, porcentaje: number) =>
  llamar<{ id: string; total: number; propina: number; a_pagar: number }>("pedir_cuenta", {
    _qr_token: qrToken,
    _propina: propina,
    _porcentaje: porcentaje,
  });

export const atenderLlamado = (id: string) => llamar<null>("atender_llamado", { _id: id });
export const atenderCuenta = (id: string) => llamar<null>("atender_cuenta", { _id: id });
