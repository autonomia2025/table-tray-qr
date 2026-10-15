import { supabase } from "@/integrations/supabase/client";
import { mensajeAmigable } from "@/lib/pedidos";

// Caja del local (fase 2.D). La conciliación la calcula la base: la pantalla solo la muestra.

export interface CanalCaja {
  cobrado: number;
  devuelto: number;
  esperado: number;
}

export interface PropinaMozo {
  nombre: string;
  staff_id: string | null;
  pagos: number;
  ventas: number;
  propina: number;
  propina_efectivo: number;
}

export interface CorteCaja {
  numero: number;
  nombre: string;
  hora: string;
  final: boolean;
  efectivo_esperado: number;
  efectivo_contado: number;
  diferencia_efectivo: number;
  pos_esperado: number;
  pos_contado: number | null;
  diferencia_pos: number | null;
  transferencia_esperada: number;
  pagos: number;
  notas: string | null;
  hecho_por: string | null;
}

export interface ResumenCaja {
  dia: string;
  hoy: string;
  desde: string;
  hasta: string;
  cerrado: boolean;
  pagos: number;
  total_neto: number;
  propina_total: number;
  app: CanalCaja;
  efectivo: CanalCaja;
  pos: CanalCaja;
  /** Desde la fase 4.3. Los días cerrados antes no lo traen. */
  transferencia?: CanalCaja;
  /** Cortes de turno del día (fase 6.2) */
  cortes?: CorteCaja[];
  /** Lo que debería haber en el tramo abierto (desde el último corte); solo en días abiertos */
  tramo_abierto?: { numero: number; efectivo: number; pos: number; transferencia: number; app: number; pagos: number };
  reembolsos: { cantidad: number; monto: number };
  automaticos: { cantidad: number; monto: number };
  propinas: PropinaMozo[];
  avisos: {
    por_cobrar: { cantidad: number; monto: number };
    sin_confirmar: { cantidad: number; monto: number };
    con_alerta: number;
    mesas_abiertas: number;
    sin_boleta?: { cantidad: number; monto: number };
  };
  cierre?: {
    efectivo_contado: number;
    diferencia_efectivo: number;
    pos_contado: number | null;
    diferencia_pos: number | null;
    notas: string | null;
    cerrado_por: string | null;
    cerrado_at: string;
  };
}

type Resultado = { ok: true; resumen: ResumenCaja } | { ok: false; error: string };

/** La caja de un día de negocio (sin día: el de hoy). Si ya se cerró, lo que quedó guardado. */
export async function resumenCaja(sucursal: string, dia?: string | null): Promise<Resultado> {
  const { data, error } = await supabase.rpc("resumen_caja", {
    _branch_id: sucursal,
    ...(dia ? { _dia: dia } : {}),
  });
  if (error) return { ok: false, error: mensajeAmigable(error.message) };
  return { ok: true, resumen: data as unknown as ResumenCaja };
}

/** Cierra la caja: la base cuadra lo contado y el día queda bloqueado. */
export async function cerrarCaja(
  sucursal: string,
  dia: string,
  efectivoContado: number,
  posContado: number | null,
  notas: string,
): Promise<Resultado> {
  const { data, error } = await supabase.rpc("cerrar_caja", {
    _branch_id: sucursal,
    _dia: dia,
    _efectivo_contado: efectivoContado,
    _pos_contado: posContado ?? undefined,
    _notas: notas.trim() || undefined,
  });
  if (error) return { ok: false, error: mensajeAmigable(error.message) };
  return { ok: true, resumen: data as unknown as ResumenCaja };
}

/** Corte de turno (fase 6.2): cuenta lo del tramo desde el último corte; lo que llega después es del siguiente. */
export async function hacerCorteCaja(
  sucursal: string,
  efectivoContado: number,
  posContado: number | null,
  nombre: string,
  notas: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.rpc("hacer_corte_caja", {
    _branch_id: sucursal,
    _efectivo_contado: efectivoContado,
    _pos_contado: posContado ?? undefined,
    _nombre: nombre.trim() || undefined,
    _notas: notas.trim() || undefined,
  });
  if (error) return { ok: false, error: mensajeAmigable(error.message) };
  return { ok: true };
}
