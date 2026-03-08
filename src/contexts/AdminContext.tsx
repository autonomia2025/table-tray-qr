import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface AdminContextType {
  tenantId: string;
  branchId: string;
  tenantName: string;
  branchName: string;
  primaryColor: string;
  loading: boolean;
}

const AdminContext = createContext<AdminContextType | null>(null);

// Hardcoded for now — will be replaced by auth
const ADMIN_TENANT_ID = "7adf15c6-326b-4820-b2fc-aca7660133a5";
const ADMIN_BRANCH_ID = "53fd9168-e7b1-4f07-bc1b-a419d6333f6c";

export function AdminProvider({ children }: { children: React.ReactNode }) {
  const [ctx, setCtx] = useState<Omit<AdminContextType, "loading">>({
    tenantId: ADMIN_TENANT_ID,
    branchId: ADMIN_BRANCH_ID,
    tenantName: "",
    branchName: "",
    primaryColor: "#E8531D",
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [{ data: tenant }, { data: branch }] = await Promise.all([
        supabase.from("tenants").select("name, primary_color").eq("id", ADMIN_TENANT_ID).single(),
        supabase.from("branches").select("name").eq("id", ADMIN_BRANCH_ID).single(),
      ]);
      setCtx((prev) => ({
        ...prev,
        tenantName: tenant?.name ?? "",
        branchName: branch?.name ?? "",
        primaryColor: tenant?.primary_color ?? "#E8531D",
      }));
      setLoading(false);
    }
    load();
  }, []);

  return <AdminContext.Provider value={{ ...ctx, loading }}>{children}</AdminContext.Provider>;
}

export function useAdmin() {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error("useAdmin must be used within AdminProvider");
  return ctx;
}
