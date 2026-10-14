import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { mensajeAmigable } from "@/lib/pedidos";

// Turnos del personal (fase 3.1). La propina es del mozo que tomó la mesa (decisión del fundador):
// la base la asigna sola; la pantalla solo muestra el resumen.

export interface ResumenTurno {
  turno_id: string;
  staff_id: string;
  nombre: string;
  inicio: string;
  fin: string | null;
  abierto_por: "mozo" | "automatico";
  cerrado_por: "mozo" | "encargado" | null;
  nota: string | null;
  minutos: number;
  mesas: number;
  pagos: number;
  ventas: number;
  propinas: number;
  propinas_efectivo: number;
}

type Resultado<T> = { ok: true; dato: T } | { ok: false; error: string };

export async function abrirTurno(sucursal: string): Promise<Resultado<{ turno_id: string; nuevo: boolean }>> {
  const { data, error } = await supabase.rpc("abrir_turno", { _branch_id: sucursal });
  if (error) return { ok: false, error: mensajeAmigable(error.message) };
  return { ok: true, dato: data as { turno_id: string; nuevo: boolean } };
}

/** Sin turno: termina el mío. Con turno: un encargado cierra el de otra persona (con nota). */
export async function cerrarTurno(turnoId?: string, nota?: string): Promise<Resultado<ResumenTurno>> {
  const { data, error } = await supabase.rpc("cerrar_turno", {
    ...(turnoId ? { _turno_id: turnoId } : {}),
    ...(nota ? { _nota: nota } : {}),
  });
  if (error) return { ok: false, error: mensajeAmigable(error.message) };
  return { ok: true, dato: data as unknown as ResumenTurno };
}

export async function turnosSucursal(sucursal: string, desde: string, hasta: string): Promise<Resultado<ResumenTurno[]>> {
  const { data, error } = await supabase.rpc("turnos_sucursal", { _branch_id: sucursal, _desde: desde, _hasta: hasta });
  if (error) return { ok: false, error: mensajeAmigable(error.message) };
  return { ok: true, dato: (data ?? []) as unknown as ResumenTurno[] };
}

/** Mi turno abierto (null si no tengo). Se refresca cada minuto y con recargar(). */
export function useMiTurno(sucursal: string | null | undefined) {
  const [turno, setTurno] = useState<ResumenTurno | null>(null);
  const [cargando, setCargando] = useState(true);

  const recargar = useCallback(async () => {
    if (!sucursal) return;
    const { data } = await supabase.rpc("mi_turno", { _branch_id: sucursal });
    setTurno((data as unknown as ResumenTurno | null) ?? null);
    setCargando(false);
  }, [sucursal]);

  useEffect(() => {
    recargar();
    const id = setInterval(recargar, 60_000);
    return () => clearInterval(id);
  }, [recargar]);

  return { turno, cargando, recargar };
}

/** "2 h 15 min" */
export function duracion(minutos: number) {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}
