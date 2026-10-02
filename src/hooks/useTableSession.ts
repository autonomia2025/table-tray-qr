import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useCartStore } from "@/store/cartStore";
import { verMesa } from "@/lib/mesa";

export interface TableInfo {
  id: string;
  number: number;
  name: string | null;
  tenant_id: string;
  branch_id: string;
}

/**
 * Un QR por mesa: al abrir /:slug/menu?t=token se resuelve la mesa,
 * se guarda en el dispositivo y no hace falta volver a escanear.
 *
 * Fase 1.3: el comensal siempre tiene identidad propia. Si no tiene sesión, entra como
 * invitado (anónimo) y queda registrado en la sesión de la mesa (unirse_a_mesa).
 */
// Uniones en curso (para no repetir la misma llamada si varias pantallas la piden a la vez).
// No se guarda el resultado: la mesa puede cerrarse y abrirse una sesión nueva, o el comensal
// puede cambiar de cuenta; unirse_a_mesa es idempotente y barata.
const uniones = new Map<string, Promise<boolean>>();

/** Asegura la identidad del comensal (invitado si no tiene sesión) y lo registra en la mesa. */
function entrarComoComensal(token: string): Promise<boolean> {
  const previa = uniones.get(token);
  if (previa) return previa;
  const promesa = (async () => {
    let { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) {
        console.error("No se pudo crear la sesión de invitado:", error.message);
        return false;
      }
      session = data.session;
    }
    if (!session) return false;
    const { error } = await supabase.rpc("unirse_a_mesa", { _qr_token: token });
    if (error) {
      console.error("unirse_a_mesa:", error.message);
      return false;
    }
    return true;
  })();
  uniones.set(token, promesa);
  promesa.finally(() => uniones.delete(token));
  return promesa;
}

export function useTableSession() {
  const location = useLocation();
  const storeToken = useCartStore((s) => s.tableToken);
  const setTableToken = useCartStore((s) => s.setTableToken);
  const setTableNumber = useCartStore((s) => s.setTableNumber);
  const setTableContext = useCartStore((s) => s.setTableContext);

  const urlToken = new URLSearchParams(location.search).get("t") || "";
  const token = urlToken || storeToken || "";

  const [table, setTable] = useState<TableInfo | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "invalid">(
    token ? "loading" : "idle",
  );

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setStatus("idle");
      setTable(null);
      return;
    }
    setStatus("loading");
    (async () => {
      const data = await verMesa(token);
      if (cancelled) return;
      if (!data) {
        setStatus("invalid");
        setTable(null);
        return;
      }
      setTable({ id: data.id, number: data.number, name: data.name, tenant_id: data.tenant_id, branch_id: data.branch_id });
      setTableToken(token);
      setTableNumber(data.number);
      setTableContext(data.tenant_id, data.branch_id);
      setStatus("ready");
      entrarComoComensal(token);
    })();
    return () => {
      cancelled = true;
    };
  }, [token, setTableToken, setTableNumber, setTableContext]);

  return { token, table, status };
}

/**
 * Para pantallas del comensal que no pasan por la carta (seguimiento, cuenta, pago):
 * asegura su identidad y lo registra en la mesa del código, para que pueda ver sus pedidos.
 * Devuelve true cuando ya está registrado: recién ahí la base le muestra sus pedidos
 * (null mientras se registra).
 */
export function useComensalEnMesa(token: string | null | undefined): boolean | null {
  // null = registrándose; true = registrado; false = no se pudo (sin código o con error)
  const [unido, setUnido] = useState<boolean | null>(token ? null : false);
  useEffect(() => {
    let cancelado = false;
    setUnido(token ? null : false);
    if (token) entrarComoComensal(token).then((ok) => { if (!cancelado) setUnido(ok); });
    return () => { cancelado = true; };
  }, [token]);
  return unido;
}
