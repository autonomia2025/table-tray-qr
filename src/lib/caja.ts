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
  reembolsos: { cantidad: number; monto: number };
  automaticos: { cantidad: number; monto: number };
  propinas: PropinaMozo[];
  avisos: {
    por_cobrar: { cantidad: number; monto: number };
    sin_confirmar: { cantidad: number; monto: number };
    con_alerta: number;
    mesas_abiertas: number;
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
