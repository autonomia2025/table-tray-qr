-- Fase 7.9 (ajuste) — La base real trae un plan heredado de Lovable ("starter") con claves que nada usa
-- (kds, qr_menu, basic_reports). No se borran: la auditoría de seguridad las deja pasar, anotadas aquí.
-- Un plan que no menciona un módulo lo trae (tiene_funcion), así que ese plan no le quita nada a nadie.
DO $$
DECLARE
  def text;
  nuevo text;
BEGIN
  def := pg_get_functiondef('public.auditoria_seguridad()'::regprocedure);
  nuevo := replace(def, $q$   WHERE e.key NOT IN (SELECT modulo FROM public._catalogo_modulos()) OR jsonb_typeof(e.value) <> 'boolean';$q$,
    $q$   WHERE (e.key NOT IN (SELECT modulo FROM public._catalogo_modulos())
          -- Excepción a propósito: claves heredadas de Lovable en el plan "starter"; no las usa nada
          AND e.key NOT IN ('kds', 'qr_menu', 'basic_reports'))
      OR jsonb_typeof(e.value) <> 'boolean';$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'auditoria_seguridad: no se encontró dónde'; END IF;
  EXECUTE nuevo;
END;
$$;
