import { supabase } from "@/integrations/supabase/client";

/**
 * Cuando Tablio entra al panel de un local ("modo soporte") o "ve como" a un miembro de su equipo,
 * queda registrado en la auditoría (regla 7; DIAGNOSTICO N3). Una vez por pestaña y por destino.
 * Qué datos ve cada uno lo deciden las reglas de la base, no esta marca.
 */
const registrados = new Set<string>();

export function registrarAccesoSoporte(tipo: "local" | "miembro", id: string | null | undefined) {
  if (!id) return;
  const clave = `${tipo}:${id}`;
  if (registrados.has(clave)) return;
  registrados.add(clave);
  supabase.rpc("registrar_acceso_soporte", { _tipo: tipo, _id: id }).then(({ error }) => {
    if (error) {
      registrados.delete(clave);
      console.error("registrar_acceso_soporte:", error.message);
    }
  });
}
