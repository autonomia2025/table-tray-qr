import React, { createContext, useContext, useMemo } from "react";
import { useSesion } from "@/contexts/SesionContext";
import type { RolLocal } from "@/lib/roles";

/**
 * Datos del mozo conectado. Salen de la sesión única (mi_perfil), no del navegador:
 * antes se guardaban en sessionStorage y cualquiera podía inventarlos (DIAGNOSTICO N2),
 * y además el panel mandaba al mozo a un segundo login (N16).
 */
interface WaitersContextType {
  staffId: string;
  staffName: string;
  role: RolLocal | "";
  branchId: string;
  tenantId: string;
  cargando: boolean;
  isLoggedIn: boolean;
  logout: () => Promise<void>;
}

const ROLES_PANEL_MOZO: RolLocal[] = ["waiter", "manager", "admin", "owner"];

const WaitersContext = createContext<WaitersContextType | null>(null);

export const useWaiters = () => {
  const ctx = useContext(WaitersContext);
  if (!ctx) throw new Error("useWaiters debe usarse dentro de WaitersProvider");
  return ctx;
};

export const WaitersProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { cargando, perfil, salir } = useSesion();

  const value = useMemo<WaitersContextType>(() => {
    const local = perfil?.locales.find((l) => ROLES_PANEL_MOZO.includes(l.rol));
    return {
      staffId: local?.staff_id ?? "",
      staffName: local?.staff_nombre ?? perfil?.email?.split("@")[0] ?? "",
      role: local?.rol ?? "",
      branchId: local?.branch_id ?? "",
      tenantId: local?.tenant_id ?? "",
      cargando,
      isLoggedIn: !!local?.branch_id,
      logout: salir,
    };
  }, [cargando, perfil, salir]);

  return <WaitersContext.Provider value={value}>{children}</WaitersContext.Provider>;
};
