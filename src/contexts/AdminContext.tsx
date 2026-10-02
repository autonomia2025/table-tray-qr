import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useParams, useNavigate } from "react-router-dom";
import { useSesion } from "@/contexts/SesionContext";
import type { RolLocal } from "@/lib/roles";

/**
 * Panel del local (/admin/:slug). Se apoya en la sesión única (mi_perfil):
 *  - un miembro activo del local entra con su rol;
 *  - un superadmin entra a cualquier local como soporte (isImpersonating).
 * Antes, la suplantación dependía de un dato del navegador y saltaba la verificación (DIAGNOSTICO N3).
 */
interface AdminContextType {
  tenantId: string;
  branchId: string;
  tenantName: string;
  branchName: string;
  primaryColor: string;
  slug: string;
  role: RolLocal | "superadmin" | "";
  userId: string;
  isLoading: boolean;
  isAuthenticated: boolean;
  isImpersonating: boolean;
  logout: () => Promise<void>;
}

const AdminContext = createContext<AdminContextType | null>(null);

type Datos = Omit<AdminContextType, "logout" | "isLoading" | "isAuthenticated" | "isImpersonating">;

const VACIO: Datos = {
  tenantId: "", branchId: "", tenantName: "", branchName: "", primaryColor: "#E8531D", slug: "", role: "", userId: "",
};

export function AdminProvider({ children }: { children: React.ReactNode }) {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { cargando, perfil, salir } = useSesion();

  const [datos, setDatos] = useState<Datos>(VACIO);
  const [isLoading, setIsLoading] = useState(true);
  const [isImpersonating, setIsImpersonating] = useState(false);

  useEffect(() => {
    if (cargando) return;
    let cancelado = false;

    (async () => {
      setIsLoading(true);
      if (!perfil || !slug) {
        setDatos(VACIO);
        setIsLoading(false);
        return;
      }

      const local = perfil.locales.find((l) => l.slug === slug);
      let tenantId = local?.tenant_id ?? "";
      let tenantName = local?.nombre ?? "";
      let color = local?.color ?? "#E8531D";
      let branchId = local?.branch_id ?? "";
      let role: Datos["role"] = local?.rol ?? "";
      const soporte = !local && perfil.es_superadmin;

      if (soporte) {
        const { data: tenant } = await supabase
          .from("tenants")
          .select("id, name, primary_color")
          .eq("slug", slug)
          .maybeSingle();
        if (!tenant) {
          if (!cancelado) { setDatos(VACIO); setIsLoading(false); }
          return;
        }
        tenantId = tenant.id;
        tenantName = tenant.name;
        color = tenant.primary_color ?? "#E8531D";
        role = "superadmin";
        const { data: b } = await supabase.from("branches").select("id").eq("tenant_id", tenant.id).order("created_at").limit(1).maybeSingle();
        branchId = b?.id ?? "";
      }

      if (!tenantId) {
        if (!cancelado) { setDatos(VACIO); setIsLoading(false); }
        return;
      }

      const { data: branch } = branchId
        ? await supabase.from("branches").select("name").eq("id", branchId).maybeSingle()
        : { data: null };

      if (cancelado) return;
      setDatos({
        tenantId,
        branchId,
        tenantName,
        branchName: branch?.name ?? "",
        primaryColor: color,
        slug,
        role,
        userId: perfil.user_id,
      });
      setIsImpersonating(soporte);
      setIsLoading(false);
    })();

    return () => { cancelado = true; };
  }, [cargando, perfil, slug]);

  const logout = async () => {
    if (isImpersonating) {
      sessionStorage.removeItem("superadmin_impersonating");
      sessionStorage.removeItem("superadmin_impersonating_slug");
      navigate("/superadmin/tenants");
      return;
    }
    await salir();
    navigate("/login");
  };

  return (
    <AdminContext.Provider value={{ ...datos, isLoading: isLoading || cargando, isAuthenticated: !!datos.tenantId, isImpersonating, logout }}>
      {children}
    </AdminContext.Provider>
  );
}

export function useAdmin() {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error("useAdmin must be used within AdminProvider");
  return ctx;
}
