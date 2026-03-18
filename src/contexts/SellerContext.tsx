import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface SellerProfile {
  id: string;
  name: string;
  email: string;
  zone: string | null;
  role: string;
  avatar_url: string | null;
  phone: string | null;
}

interface SellerContextType {
  seller: SellerProfile | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

const SellerContext = createContext<SellerContextType>({
  seller: null,
  isLoading: true,
  isAuthenticated: false,
});

export const useSeller = () => useContext(SellerContext);

export const SellerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [seller, setSeller] = useState<SellerProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const check = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setSeller(null);
        setIsLoading(false);
        return;
      }
      const { data } = await supabase
        .from('backoffice_members')
        .select('id, name, email, zone, role, avatar_url, phone')
        .eq('user_id', session.user.id)
        .eq('is_active', true)
        .maybeSingle();

      setSeller(data as SellerProfile | null);
      setIsLoading(false);
    };
    check();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      check();
    });
    return () => subscription.unsubscribe();
  }, []);

  return (
    <SellerContext.Provider value={{ seller, isLoading, isAuthenticated: !!seller }}>
      {children}
    </SellerContext.Provider>
  );
};
