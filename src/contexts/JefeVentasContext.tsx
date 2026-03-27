import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface JefeVentasProfile {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  avatar_url: string | null;
  role: string;
}

interface JefeVentasContextType {
  profile: JefeVentasProfile | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isPlatformAdmin: boolean;
}

const JefeVentasContext = createContext<JefeVentasContextType>({
  profile: null,
  isLoading: true,
  isAuthenticated: false,
  isPlatformAdmin: false,
});

export const useJefeVentas = () => useContext(JefeVentasContext);

export const JefeVentasProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [profile, setProfile] = useState<JefeVentasProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);

  useEffect(() => {
    const check = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setProfile(null); setIsLoading(false); return; }

      // Check platform admin
      const { data: pa } = await supabase.from('platform_admins').select('id').eq('user_id', session.user.id).maybeSingle();
      setIsPlatformAdmin(!!pa);

      // Check backoffice member with jefe_ventas role
      const { data } = await supabase
        .from('backoffice_members')
        .select('id, name, email, phone, avatar_url, role')
        .eq('user_id', session.user.id)
        .eq('is_active', true)
        .maybeSingle();

      if (data && (data.role === 'jefe_ventas' || !!pa)) {
        setProfile(data as JefeVentasProfile);
      }
      setIsLoading(false);
    };
    check();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => check());
    return () => subscription.unsubscribe();
  }, []);

  return (
    <JefeVentasContext.Provider value={{ profile, isLoading, isAuthenticated: !!profile || isPlatformAdmin, isPlatformAdmin }}>
      {children}
    </JefeVentasContext.Provider>
  );
};
