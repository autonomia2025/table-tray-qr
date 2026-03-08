import React, { createContext, useContext, useState } from 'react';

interface SuperAdminContextType {
  impersonating: string | null;
  setImpersonating: (id: string | null) => void;
}

const SuperAdminContext = createContext<SuperAdminContextType>({
  impersonating: null,
  setImpersonating: () => {},
});

export const useSuperAdmin = () => useContext(SuperAdminContext);

export const SuperAdminProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
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
    <SuperAdminContext.Provider value={{ impersonating, setImpersonating }}>
      {children}
    </SuperAdminContext.Provider>
  );
};
