import { supabase } from "@/integrations/supabase/client";
import { mensajeAmigable } from "@/lib/pedidos";

// Recomendaciones de conocidos (fase 9.4): solo platos que pagaste; tus amigos las ven 24 horas después.

type Resultado<T> = { ok: true; dato: T } | { ok: false; error: string };
export interface RecomendacionAmigos { menu_item_id: string; plato: string; imagen: string | null; cuantos: number; amigos: { nombre: string; comentario: string | null }[] }
export interface MiRecomendacion { menu_item_id: string; comentario: string | null; visible: boolean }

const llamar = async <T>(fn: string, args: Record<string, unknown>): Promise<Resultado<T>> => {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) return { ok: false, error: mensajeAmigable(error.message) };
  return { ok: true, dato: data as T };
};

export const recomendarPlato = (item: string, comentario: string) => llamar<null>("recomendar_plato", { _menu_item_id: item, _comentario: comentario || null });
export const quitarRecomendacion = (item: string) => llamar<null>("quitar_recomendacion", { _menu_item_id: item });
export const misRecomendaciones = (local: string) => llamar<MiRecomendacion[]>("mis_recomendaciones", { _tenant_id: local });
export const recomendacionesDeAmigos = (local: string) => llamar<RecomendacionAmigos[]>("recomendaciones_de_amigos", { _tenant_id: local });
