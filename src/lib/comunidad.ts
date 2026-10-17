import { supabase } from "@/integrations/supabase/client";
import { mensajeAmigable } from "@/lib/pedidos";

// Comunidad (fase 9.2): perfil y amigos, solo con cuenta y con permiso explícito. Todo lo decide la base.

type Resultado<T> = { ok: true; dato: T } | { ok: false; error: string };
export interface Comunidad {
  activo: boolean;
  suspendido: boolean;
  nombre?: string;
  codigo?: string;
  amigos?: { id: string; user_id: string; nombre: string }[];
  solicitudes?: { id: string; nombre: string }[];
  enviadas?: { id: string; nombre: string }[];
  en_mi_mesa?: { user_id: string; nombre: string }[];
}

const llamar = async <T>(fn: string, args: Record<string, unknown> = {}): Promise<Resultado<T>> => {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) return { ok: false, error: mensajeAmigable(error.message) };
  return { ok: true, dato: data as T };
};

export const miComunidad = (qr?: string | null) => llamar<Comunidad>("mi_comunidad", { _qr_token: qr ?? null });
export const activarComunidad = (nombre: string, acepto: boolean) => llamar<Comunidad>("activar_comunidad", { _nombre: nombre, _acepto: acepto });
export const apagarComunidad = () => llamar<null>("apagar_comunidad");
export const pedirAmistadPorCodigo = (codigo: string) => llamar<null>("pedir_amistad", { _codigo: codigo });
export const pedirAmistadEnMesa = (qr: string, userId: string) => llamar<null>("pedir_amistad", { _qr_token: qr, _user_id: userId });
export const responderAmistad = (id: string, aceptar: boolean) => llamar<null>("responder_amistad", { _amistad_id: id, _aceptar: aceptar });
export const quitarAmistad = (id: string) => llamar<null>("quitar_amistad", { _amistad_id: id });
export const bloquearUsuario = (userId: string) => llamar<null>("bloquear_usuario", { _user_id: userId });
export const reportarUsuario = (userId: string, motivo: string) => llamar<null>("reportar_usuario", { _user_id: userId, _motivo: motivo });
