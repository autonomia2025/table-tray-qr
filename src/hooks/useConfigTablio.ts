import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

/**
 * Configuración de la plataforma Tablio guardada en la base (fase 1.8).
 * Antes vivía en el navegador del superadmin y se perdía al cambiar de computador.
 * La leen el superadmin y el equipo de Tablio; la cambia solo el superadmin.
 */
export function useConfigTablio<T>(clave: string, porDefecto: T) {
  const [valor, setValor] = useState<T>(porDefecto);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let cancelado = false;
    supabase
      .from("configuracion_tablio")
      .select("valor")
      .eq("clave", clave)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelado) return;
        if (data) setValor(data.valor as T);
        setCargando(false);
      });
    return () => { cancelado = true; };
  }, [clave]);

  const guardar = useCallback(
    async (nuevo: T) => {
      const { error } = await supabase.from("configuracion_tablio").upsert({ clave, valor: nuevo as unknown as Json });
      if (!error) setValor(nuevo);
      return !error;
    },
    [clave],
  );

  return { valor, guardar, cargando };
}
