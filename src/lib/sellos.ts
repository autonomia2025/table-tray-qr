import { supabase } from "@/integrations/supabase/client";
import { mensajeAmigable } from "@/lib/pedidos";

// Sellos (fase 3.7): los suma la base al guardarse un pago. Uno por persona y día, desde el monto mínimo
// del programa, solo con cuenta verificada. Los premios los entrega el personal con el código del cliente.

export interface Tarjeta {
  programa: null | {
    tipo: "stamps" | "points";
    meta: number;
    puntos_meta: number;
    puntos_por_mil: number;
    premio: string;
    monto_minimo: number;
  };
  registrado?: boolean;
  /** Invitado que pagó en las últimas 48 horas: si guarda su cuenta, ese sello es suyo */
  pendiente?: boolean;
  correo?: string;
  total?: number;
  /** Sellos de la tarjeta actual (0 a meta - 1) */
  sellos?: number;
  puntos?: number;
  hoy_sumado?: boolean;
  ultimo?: null | { payment_id: string; at: string; sello: boolean; puntos: number; premio: boolean; retroactivo: boolean };
  premios?: { id: string; descripcion: string; codigo: string; ganado_at: string; motivo?: "tarjeta" | "nivel" | "racha" | "sorpresa" }[];
  /** Niveles y rachas (fase 7.5), si el local los usa */
  nivel?: null | {
    nivel: "bronce" | "plata" | "oro";
    visitas: number;
    siguiente: "plata" | "oro" | null;
    faltan: number | null;
    racha: number;
    racha_meta: number | null;
    racha_dia: number | null;
    niveles_activos: boolean;
    premio_plata: string | null;
    premio_oro: string | null;
    racha_premio: string | null;
  };
}

const DIAS = ["domingos", "lunes", "martes", "miércoles", "jueves", "viernes", "sábados"];
export const NOMBRE_NIVEL = { bronce: "Bronce", plata: "Plata", oro: "Oro" } as const;

/** "2 de 3 viernes seguidos" o "2 de 3 semanas seguidas". */
export function textoRacha(n: NonNullable<Tarjeta["nivel"]>): string | null {
  if (!n.racha_meta) return null;
  const actual = n.racha % n.racha_meta || (n.racha > 0 ? n.racha_meta : 0);
  return n.racha_dia === null ? `${actual} de ${n.racha_meta} semanas seguidas` : `${actual} de ${n.racha_meta} ${DIAS[n.racha_dia]} seguidos`;
}

export interface PremioMesa {
  id: string;
  descripcion: string;
  alias: string | null;
}

type Resultado<T> = { ok: true; dato: T } | { ok: false; error: string };

export async function misSellos(local: string, sucursal?: string | null): Promise<Tarjeta | null> {
  const { data, error } = await supabase.rpc("mis_sellos", { _tenant_id: local, _branch_id: sucursal ?? undefined });
  if (error) return null;
  return data as unknown as Tarjeta;
}

export async function premiosEnMesa(mesa: string): Promise<PremioMesa[]> {
  const { data, error } = await supabase.rpc("premios_en_mesa", { _table_id: mesa });
  if (error) return [];
  return (data as unknown as PremioMesa[]) ?? [];
}

export async function entregarPremio(premio: string, codigo: string): Promise<Resultado<{ descripcion: string }>> {
  const { data, error } = await supabase.rpc("entregar_premio", { _premio_id: premio, _codigo: codigo });
  if (error) return { ok: false, error: mensajeAmigable(error.message) };
  return { ok: true, dato: data as unknown as { descripcion: string } };
}

export interface PremiosLocal {
  por_entregar: { id: string; descripcion: string; correo: string; ganado_at: string }[];
  entregados: { id: string; descripcion: string; correo: string; entregado_at: string; entregado_por: string | null }[];
}

export async function premiosPorEntregar(local: string): Promise<PremiosLocal | null> {
  const { data, error } = await supabase.rpc("premios_por_entregar", { _tenant_id: local });
  if (error) return null;
  return data as unknown as PremiosLocal;
}

/**
 * ¿Hay que hacer "caer" el último sello? Sí, si es nuevo para este celular. Recordar qué sello ya se vio
 * es solo una comodidad de pantalla (si se borra, a lo más se repite la animación).
 */
export function selloNuevo(local: string, t: Tarjeta | null): boolean {
  const u = t?.ultimo;
  if (!t?.registrado || !u || (!u.sello && !u.premio)) return false;
  const clave = `tablio-sello-visto-${local}`;
  try {
    if (localStorage.getItem(clave) === u.payment_id) return false;
    localStorage.setItem(clave, u.payment_id);
  } catch {
    // Sin almacenamiento: se anima igual
  }
  // Solo lo reciente: un sello de otro día no "cae" al abrir la app
  return Date.now() - new Date(u.at).getTime() < 6 * 3_600_000;
}
