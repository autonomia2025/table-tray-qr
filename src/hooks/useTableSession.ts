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
 */
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
    })();
    return () => {
      cancelled = true;
    };
  }, [token, setTableToken, setTableNumber, setTableContext]);

  return { token, table, status };
}
