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
  const [impersonating, setImpersonating] = useState<string | null>(null);

  return (
    <SuperAdminContext.Provider value={{ impersonating, setImpersonating }}>
      {children}
    </SuperAdminContext.Provider>
  );
};
