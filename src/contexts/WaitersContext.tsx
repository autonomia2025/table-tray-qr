import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

interface StaffData {
  staffId: string;
  staffName: string;
  role: string;
  branchId: string;
  tenantId: string;
}

interface WaitersContextType extends StaffData {
  isLoggedIn: boolean;
  login: (staff: StaffData) => void;
  logout: () => void;
}

const BRANCH_ID = "53fd9168-e7b1-4f07-bc1b-a419d6333f6c";
const TENANT_ID = "7adf15c6-326b-4820-b2fc-aca7660133a5";

const defaultValue: WaitersContextType = {
  staffId: '',
  staffName: '',
  role: '',
  branchId: BRANCH_ID,
  tenantId: TENANT_ID,
  isLoggedIn: false,
  login: () => {},
  logout: () => {},
};

const WaitersContext = createContext<WaitersContextType>(defaultValue);

export const useWaiters = () => useContext(WaitersContext);

export const WAITER_BRANCH_ID = BRANCH_ID;
export const WAITER_TENANT_ID = TENANT_ID;

export const WaitersProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [staff, setStaff] = useState<StaffData | null>(() => {
    const saved = sessionStorage.getItem('mozo_staff');
    return saved ? JSON.parse(saved) : null;
  });

  const login = useCallback((data: StaffData) => {
    setStaff(data);
    sessionStorage.setItem('mozo_staff', JSON.stringify(data));
  }, []);

  const logout = useCallback(() => {
    setStaff(null);
    sessionStorage.removeItem('mozo_staff');
  }, []);

  const value: WaitersContextType = {
    staffId: staff?.staffId ?? '',
    staffName: staff?.staffName ?? '',
    role: staff?.role ?? '',
    branchId: staff?.branchId ?? BRANCH_ID,
    tenantId: staff?.tenantId ?? TENANT_ID,
    isLoggedIn: !!staff,
    login,
    logout,
  };

  return <WaitersContext.Provider value={value}>{children}</WaitersContext.Provider>;
};
