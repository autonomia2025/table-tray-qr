import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Perfil } from "@/lib/roles";

/**
 * Sesión única de la app (fase 1.2): quién está conectado, con qué rol y en qué locales.
 * Sale de la función mi_perfil() de la base. Ningún panel guarda la identidad en el navegador.
 */
interface SesionContextType {
  cargando: boolean;
  perfil: Perfil | null;
  recargar: () => Promise<Perfil | null>;
  salir: () => Promise<void>;
}

const SesionContext = createContext<SesionContextType | null>(null);

async function leerPerfil(): Promise<Perfil | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const { data, error } = await supabase.rpc("mi_perfil");
  if (error) {
    console.error("mi_perfil:", error.message);
    return null;
  }
  return (data as unknown as Perfil) ?? null;
}

export function SesionProvider({ children }: { children: React.ReactNode }) {
  const [cargando, setCargando] = useState(true);
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const usuarioActual = useRef<string | null>(null);

  const recargar = useCallback(async () => {
    const p = await leerPerfil();
    usuarioActual.current = p?.user_id ?? null;
    setPerfil(p);
    setCargando(false);
    return p;
  }, []);

  useEffect(() => {
    recargar();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((evento, session) => {
      if (evento === "SIGNED_OUT") {
        usuarioActual.current = null;
        setPerfil(null);
        setCargando(false);
      } else if (evento === "SIGNED_IN" && session?.user.id !== usuarioActual.current) {
        // Diferido: no se puede llamar a Supabase dentro de este aviso sin bloquearlo.
        setCargando(true);
        setTimeout(() => recargar(), 0);
      }
    });
    return () => subscription.unsubscribe();
  }, [recargar]);

  const salir = useCallback(async () => {
    await supabase.auth.signOut();
    usuarioActual.current = null;
    setPerfil(null);
  }, []);

  return (
    <SesionContext.Provider value={{ cargando, perfil, recargar, salir }}>
      {children}
    </SesionContext.Provider>
  );
}

export function useSesion() {
  const ctx = useContext(SesionContext);
  if (!ctx) throw new Error("useSesion debe usarse dentro de SesionProvider");
  return ctx;
}
