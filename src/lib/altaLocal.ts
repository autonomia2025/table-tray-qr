import { supabase } from "@/integrations/supabase/client";
import { mensajeError } from "@/lib/errores";

// Alta del local por Tablio (fase 5.1): el superadmin o el equipo de ventas crea el local completo de una
// vez (en el servidor) y le manda al dueño un enlace para activar su cuenta con su propia contraseña.

export interface DatosLocalNuevo {
  nombre: string;
  slug: string;
  correoDueno: string;
  nombreDueno?: string;
  telefono?: string;
  color?: string;
  mesas: number;
  modo: "prepaid" | "open_tab";
  leadId?: string;
}

export interface Activacion { estado: "vigente" | "usado" | "vencido" | "anulado" | "no_existe"; local?: string; nombre?: string | null; correo?: string }

export interface EstadoActivacion { tenant_id: string; correo: string; creado_at: string; vence_at: string; activado_at: string | null }

type Resultado<T> = { ok: true; dato: T } | { ok: false; error: string };

export const enlaceActivacion = (token: string) => `${window.location.origin}/activar/${token}`;

/** "nombre del local" → "nombre-del-local" (sin tildes ni símbolos), para proponer la dirección. */
export const sugerirSlug = (nombre: string) =>
  nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

export async function crearLocal(d: DatosLocalNuevo): Promise<Resultado<{ tenant_id: string; slug: string; token: string }>> {
  const { data, error } = await supabase.rpc("crear_local", {
    _nombre: d.nombre, _slug: d.slug, _correo_dueno: d.correoDueno, _nombre_dueno: d.nombreDueno || undefined,
    _telefono: d.telefono || undefined, _color: d.color || undefined, _mesas: d.mesas, _modo: d.modo, _lead_id: d.leadId || undefined,
  });
  if (error) return { ok: false, error: mensajeError(error, "No se pudo crear el local. Intenta de nuevo.") };
  return { ok: true, dato: data as unknown as { tenant_id: string; slug: string; token: string } };
}

export async function nuevoEnlaceActivacion(tenantId: string): Promise<Resultado<string>> {
  const { data, error } = await supabase.rpc("nuevo_enlace_activacion", { _tenant_id: tenantId });
  if (error) return { ok: false, error: mensajeError(error, "No se pudo crear el enlace. Intenta de nuevo.") };
  return { ok: true, dato: (data as unknown as { token: string }).token };
}

export async function estadoActivaciones(): Promise<EstadoActivacion[]> {
  const { data, error } = await supabase.rpc("estado_activaciones");
  if (error) return [];
  return (data ?? []) as EstadoActivacion[];
}

export async function verActivacion(token: string): Promise<Activacion> {
  const { data, error } = await supabase.rpc("ver_activacion", { _token: token });
  if (error || !data) return { estado: "no_existe" };
  return data as unknown as Activacion;
}

/** Activa el local: sin sesión crea la cuenta del dueño; con su sesión, le suma el local a su cuenta. */
export async function activarLocal(token: string, nombre?: string, password?: string):
  Promise<{ ok: true; slug: string; correo: string } | { ok: false; error: string; yaTieneCuenta?: boolean }> {
  const { data, error } = await supabase.functions.invoke("activar-local", { body: { token, nombre, password } });
  if (error || !data || data.error) {
    let cuerpo: { error?: string; ya_tiene_cuenta?: boolean } | null = data ?? null;
    const ctx = (error as { context?: Response } | null)?.context;
    if (!cuerpo && ctx && typeof ctx.json === "function") cuerpo = await ctx.json().catch(() => null);
    return { ok: false, error: cuerpo?.error ?? "No se pudo activar el local. Intenta de nuevo.", yaTieneCuenta: !!cuerpo?.ya_tiene_cuenta };
  }
  return { ok: true, slug: data.slug, correo: data.correo };
}
