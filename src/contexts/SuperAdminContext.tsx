import React, { createContext, useContext, useState } from 'react';
import { useSesion } from '@/contexts/SesionContext';

interface SuperAdminContextType {
  isPlatformAdmin: boolean;
  isLoading: boolean;
  impersonating: string | null;
  setImpersonating: (id: string | null) => void;
}

const SuperAdminContext = createContext<SuperAdminContextType>({
  isPlatformAdmin: false,
  isLoading: true,
  impersonating: null,
  setImpersonating: () => {},
});

export const useSuperAdmin = () => useContext(SuperAdminContext);

export const SuperAdminProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Quién es superadmin lo dice la sesión única (mi_perfil), no una consulta propia.
  const { cargando: isLoading, perfil } = useSesion();
  const isPlatformAdmin = !!perfil?.es_superadmin;
  const [impersonating, setImpersonatingState] = useState<string | null>(
    () => sessionStorage.getItem('superadmin_impersonating')
  );

  const setImpersonating = (id: string | null) => {
    setImpersonatingState(id);
    if (id) {
      sessionStorage.setItem('superadmin_impersonating', id);
    } else {
      sessionStorage.removeItem('superadmin_impersonating');
    }
  };


  return (
    <SuperAdminContext.Provider value={{ isPlatformAdmin, isLoading, impersonating, setImpersonating }}>
      {children}
    </SuperAdminContext.Provider>
  );
};
