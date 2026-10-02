import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useCartStore } from "@/store/cartStore";

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
const mesasUnidas = new Set<string>();

async function entrarComoComensal(token: string) {
  let { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) {
      console.error("No se pudo crear la sesión de invitado:", error.message);
      return;
    }
    session = data.session;
  }
  const clave = `${session?.user.id}:${token}`;
  if (!session || mesasUnidas.has(clave)) return;
  const { error } = await supabase.rpc("unirse_a_mesa", { _qr_token: token });
  if (error) console.error("unirse_a_mesa:", error.message);
  else mesasUnidas.add(clave);
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
      const { data } = await supabase
        .from("tables")
        .select("id, number, name, tenant_id, branch_id")
        .eq("qr_token", token)
        .maybeSingle();
      if (cancelled) return;
      if (!data) {
        setStatus("invalid");
        setTable(null);
        return;
      }
      setTable(data as TableInfo);
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
