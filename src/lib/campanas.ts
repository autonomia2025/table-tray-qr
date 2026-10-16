import { supabase } from "@/integrations/supabase/client";
import { mensajeError } from "@/lib/errores";

// Campañas (fase 7.1): el local le escribe a sus clientes que aceptaron promociones, por aviso al celular.
// A quién le llega, los límites y la medición los decide la base; aquí solo se llaman sus funciones.

export type Publico = "todos" | "dormidos" | "frecuentes" | "por_plato";

export const NOMBRE_PUBLICO: Record<Publico, { titulo: string; detalle: string }> = {
  todos: { titulo: "Todos tus clientes", detalle: "Los que juntan sellos y aceptaron promociones." },
  dormidos: { titulo: "No vienen hace 30 días", detalle: "Para invitarlos de vuelta." },
  frecuentes: { titulo: "Frecuentes", detalle: "3 visitas o más en los últimos 90 días." },
  por_plato: { titulo: "Pidieron un plato", detalle: "Los que lo pidieron en los últimos 90 días." },
};

export interface Campana {
  id: string;
  titulo: string;
  mensaje: string;
  publico: Publico;
  plato: string | null;
  plato_nombre: string | null;
  estado: "borrador" | "enviada";
  creada_at: string;
  enviada_at: string | null;
  destinatarios: number;
  con_aviso: number;
  entregados: number;
  fallidos: number;
  abiertos: number;
  volvieron: number;
  ventas: number;
  medicion_abierta: boolean;
}

export interface Alcance { total: number; con_aviso: number; descansando: number }

type Resultado<T> = { ok: true; dato: T } | { ok: false; error: string };

export async function alcanceCampana(local: string, publico: Publico, plato: string | null): Promise<Alcance | null> {
  const { data, error } = await supabase.rpc("publico_campana", { _tenant_id: local, _publico: publico, _plato: plato ?? undefined });
  if (error) return null;
  return data as unknown as Alcance;
}

export async function campanasDelLocal(local: string): Promise<Campana[]> {
  const { data } = await supabase.rpc("resultados_campanas", { _tenant_id: local });
  return (data as unknown as Campana[] | null) ?? [];
}

export async function guardarCampana(
  local: string, c: { id?: string | null; titulo: string; mensaje: string; publico: Publico; plato: string | null },
): Promise<Resultado<string>> {
  const { data, error } = await supabase.rpc("guardar_campana", {
    _tenant_id: local, _titulo: c.titulo, _mensaje: c.mensaje, _publico: c.publico,
    _plato: c.plato ?? undefined, _campana_id: c.id ?? undefined,
  });
  if (error) return { ok: false, error: mensajeError(error, "No se pudo guardar la campaña. Intenta de nuevo.") };
  return { ok: true, dato: data as string };
}

export async function borrarCampana(id: string): Promise<Resultado<null>> {
  const { error } = await supabase.rpc("borrar_campana", { _campana_id: id });
  if (error) return { ok: false, error: mensajeError(error, "No se pudo borrar la campaña.") };
  return { ok: true, dato: null };
}

/** Manda la campaña (la función reserva el envío con tu sesión y manda los avisos). */
export async function enviarCampana(id: string): Promise<Resultado<{ destinatarios: number; con_aviso: number; entregados?: number }>> {
  const { data, error } = await supabase.functions.invoke("enviar-campana", { body: { campana_id: id } });
  if (error) {
    // El mensaje de la base (horario, límite, permiso) viene en el cuerpo de la respuesta
    let cuerpo: { error?: string; codigo?: string } | undefined;
    try { cuerpo = await (error as { context?: Response }).context?.json(); } catch { /* sin cuerpo */ }
    return { ok: false, error: mensajeError(cuerpo?.error ? { message: cuerpo.error, code: cuerpo.codigo } : error, "No se pudo enviar la campaña. Intenta de nuevo.") };
  }
  return { ok: true, dato: data as { destinatarios: number; con_aviso: number; entregados?: number } };
}

export interface Promo { local: string; slug: string; color: string | null; logo: string | null; titulo: string; mensaje: string; enviada_at: string; de_baja: boolean }

export async function verPromo(token: string): Promise<Promo | null> {
  const { data } = await supabase.rpc("ver_promo", { _token: token });
  return (data as unknown as Promo | null) ?? null;
}

export async function bajaPromo(token: string): Promise<boolean> {
  const { data } = await supabase.rpc("baja_promo", { _token: token });
  return data === true;
}
