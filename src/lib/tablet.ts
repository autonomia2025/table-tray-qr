import { supabase } from "@/integrations/supabase/client";
import { mensajeError } from "@/lib/errores";

// Tablets compartidas (fase 6.1): un dispositivo del local donde cada mozo entra con su PIN. El token de la
// tablet vive solo en ese dispositivo (es su credencial, como una sesión): no es un dato del negocio.

const LLAVE = "tablio_tablet";

export function tokenTablet(): string | null {
  try { return localStorage.getItem(LLAVE); } catch { return null; }
}
export const esModoTablet = () => !!tokenTablet();
function guardarToken(token: string | null) {
  try { if (token) localStorage.setItem(LLAVE, token); else localStorage.removeItem(LLAVE); } catch { /* sin almacenamiento */ }
}

type Resultado<T> = { ok: true; dato: T } | { ok: false; error: string };

/** El dueño, el administrador o el encargado dejan ESTE dispositivo como tablet compartida. */
export async function activarEsteDispositivo(sucursal: string, nombre: string): Promise<Resultado<string>> {
  const { data, error } = await supabase.rpc("crear_equipo_compartido", { _branch_id: sucursal, _nombre: nombre });
  if (error) return { ok: false, error: mensajeError(error, "No se pudo activar la tablet. Intenta de nuevo.") };
  const r = data as unknown as { id: string; token: string };
  guardarToken(r.token);
  return { ok: true, dato: r.id };
}

export function olvidarEsteDispositivo() { guardarToken(null); }

export interface EquipoTablet { local: string; sucursal: string; tablet: string; personas: { id: string; nombre: string }[] }

export async function equipoDeTablet(token: string): Promise<EquipoTablet | null> {
  const { data } = await supabase.rpc("equipo_de_tablet", { _token: token });
  return (data as unknown as EquipoTablet | null) ?? null;
}

/** El mozo entra con su PIN: la tablet queda con la sesión de ESE mozo. */
export async function entrarConPin(persona: string, pin: string): Promise<Resultado<string>> {
  const equipo = tokenTablet();
  if (!equipo) return { ok: false, error: "Este dispositivo no está activado como tablet." };
  const { data, error } = await supabase.functions.invoke("entrar-con-pin", { body: { equipo, persona, pin } });
  if (error || !data?.access_token) {
    let mensaje = data?.error as string | undefined;
    const ctx = (error as { context?: Response } | null)?.context;
    if (!mensaje && ctx && typeof ctx.json === "function") mensaje = (await ctx.json().catch(() => null))?.error;
    return { ok: false, error: mensaje ?? "No se pudo entrar. Intenta de nuevo." };
  }
  // Si había una sesión (otro mozo, o un invitado), se cierra solo en este dispositivo
  await supabase.auth.signOut({ scope: "local" });
  const { error: errSesion } = await supabase.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token });
  if (errSesion) return { ok: false, error: "No se pudo abrir tu sesión. Intenta de nuevo." };
  return { ok: true, dato: data.nombre as string };
}

/** Cambiar de mozo: cierra la sesión solo en esta tablet (no en el teléfono del mozo). */
export async function salirDeLaTablet() {
  await supabase.auth.signOut({ scope: "local" });
}

export async function definirMiPin(pin: string): Promise<Resultado<null>> {
  const { error } = await supabase.rpc("definir_mi_pin", { _pin: pin });
  if (error) return { ok: false, error: mensajeError(error, "No se pudo guardar el PIN. Intenta de nuevo.") };
  return { ok: true, dato: null };
}

export async function estadoPines(sucursal: string): Promise<{ staff_id: string; tiene_pin: boolean; bloqueado: boolean }[]> {
  const { data } = await supabase.rpc("estado_pines", { _branch_id: sucursal });
  return (data ?? []) as { staff_id: string; tiene_pin: boolean; bloqueado: boolean }[];
}

export async function borrarPin(staffId: string): Promise<Resultado<null>> {
  const { error } = await supabase.rpc("borrar_pin", { _staff_id: staffId });
  if (error) return { ok: false, error: mensajeError(error, "No se pudo borrar el PIN.") };
  return { ok: true, dato: null };
}

export async function tabletsDeLaSucursal(sucursal: string) {
  const { data } = await supabase.from("equipos_compartidos")
    .select("id, nombre, created_at, ultimo_uso_at, revocado_at").eq("branch_id", sucursal).order("created_at", { ascending: false });
  return (data ?? []) as { id: string; nombre: string; created_at: string; ultimo_uso_at: string | null; revocado_at: string | null }[];
}

export async function desactivarTablet(id: string): Promise<Resultado<null>> {
  const { error } = await supabase.rpc("revocar_equipo_compartido", { _id: id });
  if (error) return { ok: false, error: mensajeError(error, "No se pudo desactivar la tablet.") };
  return { ok: true, dato: null };
}
