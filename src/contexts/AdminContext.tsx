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
  // Check for SuperAdmin impersonation via sessionStorage
  const impersonating = sessionStorage.getItem("superadmin_impersonating");
  const effectiveTenantId = impersonating || ADMIN_TENANT_ID;

  const [ctx, setCtx] = useState<Omit<AdminContextType, "loading">>({
    tenantId: effectiveTenantId,
    branchId: ADMIN_BRANCH_ID,
    tenantName: "",
    branchName: "",
    primaryColor: "#E8531D",
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data: tenant } = await supabase
        .from("tenants")
        .select("name, primary_color")
        .eq("id", effectiveTenantId)
        .single();

      // If impersonating, get the first branch of that tenant
      let branchId = ADMIN_BRANCH_ID;
      let branchName = "";

      if (impersonating) {
        const { data: branch } = await supabase
          .from("branches")
          .select("id, name")
          .eq("tenant_id", effectiveTenantId)
          .limit(1)
          .maybeSingle();
        if (branch) {
          branchId = branch.id;
          branchName = branch.name;
        }
      } else {
        const { data: branch } = await supabase
          .from("branches")
          .select("name")
          .eq("id", ADMIN_BRANCH_ID)
          .single();
        branchName = branch?.name ?? "";
      }

      setCtx({
        tenantId: effectiveTenantId,
        branchId,
        tenantName: tenant?.name ?? "",
        branchName,
        primaryColor: tenant?.primary_color ?? "#E8531D",
      });
      setLoading(false);
    }
    load();
  }, [effectiveTenantId]);

  return <AdminContext.Provider value={{ ...ctx, loading }}>{children}</AdminContext.Provider>;
}

export function useAdmin() {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error("useAdmin must be used within AdminProvider");
  return ctx;
}
