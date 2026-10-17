import { supabase } from "@/integrations/supabase/client";
import { mensajeAmigable } from "@/lib/pedidos";

// Invitar un trago a otra mesa (fase 9.1): la otra mesa acepta primero y recién ahí quien invita paga.
// Estados y montos los decide la base.

type Resultado<T> = { ok: true; dato: T } | { ok: false; error: string };
export type EstadoInvitacion = "ofrecida" | "aceptada" | "pagada" | "rechazada" | "cancelada" | "vencida";
export interface InvitacionRecibida { id: string; de_mesa: number; de_alias: string | null; producto: string; mensaje: string | null; estado: EstadoInvitacion }
export interface InvitacionEnviada { id: string; para_mesa: number; producto: string; estado: EstadoInvitacion; vence_at: string }

const llamar = async <T>(fn: string, args: Record<string, unknown>): Promise<Resultado<T>> => {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) return { ok: false, error: mensajeAmigable(error.message) };
  return { ok: true, dato: data as T };
};

export const mesasParaInvitar = (token: string) => llamar<number[]>("mesas_para_invitar", { _qr_token: token });
export const invitarOtraMesa = (token: string, mesa: number, item: string, mensaje: string) =>
  llamar<string>("invitar_otra_mesa", { _qr_token: token, _mesa: mesa, _menu_item_id: item, _mensaje: mensaje || null });
export const responderInvitacion = (token: string, id: string, aceptar: boolean, bloquear = false) =>
  llamar<null>("responder_invitacion", { _qr_token: token, _invitacion_id: id, _aceptar: aceptar, _bloquear: bloquear });
export const cancelarInvitacion = (token: string, id: string) => llamar<null>("cancelar_invitacion", { _qr_token: token, _invitacion_id: id });
export const cotizarInvitacion = (token: string, id: string) =>
  llamar<{ id: string; subtotal: number; expira_at: string }>("cotizar_invitacion", { _qr_token: token, _invitacion_id: id });
