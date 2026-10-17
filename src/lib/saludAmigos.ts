import { supabase } from "@/integrations/supabase/client";
import { mensajeAmigable } from "@/lib/pedidos";

// "Salud" entre amigos en el mismo bar (fase 9.5): doble permiso; nadie aparece presente si no lo activa.

type Resultado<T> = { ok: true; dato: T } | { ok: false; error: string };
export interface AmigosAqui {
  comunidad: boolean;
  avisando?: boolean;
  amigos?: { user_id: string; nombre: string }[];
  saludos?: { de: string; cuando: string }[];
}

const llamar = async <T>(fn: string, args: Record<string, unknown>): Promise<Resultado<T>> => {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) return { ok: false, error: mensajeAmigable(error.message) };
  return { ok: true, dato: data as T };
};

export const amigosAqui = (qr: string) => llamar<AmigosAqui>("amigos_aqui", { _qr_token: qr });
export const avisarQueEstoy = (qr: string, activar: boolean) => llamar<null>("avisar_que_estoy", { _qr_token: qr, _activar: activar });
export const mandarSalud = (qr: string, amigo: string) => llamar<null>("mandar_salud", { _qr_token: qr, _amigo_id: amigo });
