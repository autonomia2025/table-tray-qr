-- Fase 1.7 — Ajustes que pidió el asesor de seguridad de Supabase.

-- 1. Los datos completos de los locales pasan de una vista con permisos del dueño de la base
--    (el asesor la marca como error) a una función que revisa quién la llama.
DROP VIEW IF EXISTS public.tenants_privado;

CREATE OR REPLACE FUNCTION public.tenants_privado()
RETURNS SETOF public.tenants
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.* FROM public.tenants t
   WHERE public.is_platform_admin() OR public.es_backoffice()
$$;
REVOKE ALL ON FUNCTION public.tenants_privado() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenants_privado() TO authenticated;

-- 2. Funciones sin "search_path" fijo.
ALTER FUNCTION public.rango_estado(text) SET search_path = public;
ALTER FUNCTION public.registrar_atencion_llamado() SET search_path = public;

-- 3. Funciones que solo usan los disparadores (triggers): nadie debe poder llamarlas directo.
--    Los disparadores siguen funcionando: el permiso se revisa al crearlos, no al ejecutarse.
REVOKE ALL ON FUNCTION public.asignar_estacion_item() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crear_estacion_predeterminada() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mesa_esperando_cuenta() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recalcular_total_sesion() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validar_mesa() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validar_mismo_local() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.registrar_atencion_llamado() FROM PUBLIC, anon, authenticated;
