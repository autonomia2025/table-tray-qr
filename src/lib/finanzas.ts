import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Métricas de finanzas de Tablio (fase 8.2): salen de los cobros reales de la mensualidad, calculadas en la base.

export interface MesFinanzas { mes: string; facturado: number; cobrado: number; pagando: number; nuevos: number; perdidos: number; pagando_antes: number }
export interface MetricasFinanzas {
  actual: { mrr: number; clientes_activos: number; en_prueba: number; cancelados: number; por_cobrar: number; vencido: number; locales_atrasados: number };
  meses: MesFinanzas[];
  cohortes: { mes: string; tamano: number; siguen: number[] }[];
  locales: { tenant_id: string; local: string; plan: string | null; precio_mensual: number; desde: string; prueba_hasta: string | null;
    cancelada_at: string | null; pagado_total: number; meses_pagados: number; estado: string }[];
}

export async function metricasFinanzas(meses = 12): Promise<MetricasFinanzas | null> {
  const { data, error } = await supabase.rpc("metricas_finanzas", { _meses: meses });
  if (error) return null;
  return data as unknown as MetricasFinanzas;
}

export function useMetricasFinanzas(meses = 12) {
  const [m, setM] = useState<MetricasFinanzas | null | undefined>(undefined);
  useEffect(() => { metricasFinanzas(meses).then(setM); }, [meses]);
  return m;
}

/** "oct 26" para los gráficos. */
export const mesCorto = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("es-CL", { month: "short", year: "2-digit" });

/** Abandono del mes: perdidos sobre los que pagaban el mes anterior (en %, con un decimal). */
export const abandono = (m: MesFinanzas) => (m.pagando_antes > 0 ? Math.round((m.perdidos / m.pagando_antes) * 1000) / 10 : 0);
