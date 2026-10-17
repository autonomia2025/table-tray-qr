-- Fase 9.6 (compuerta) — El límite de un "salud" cada 2 minutos por pareja ahora lo protege un candado: dos
-- envíos exactamente al mismo tiempo ya no pueden colarse los dos (lo detectó la revisión de la compuerta).
DO $$
DECLARE
  def text;
  nuevo text;
BEGIN
  def := pg_get_functiondef('public.mandar_salud(text,uuid)'::regprocedure);
  nuevo := replace(def, $q$  IF EXISTS (SELECT 1 FROM public.saludos_amigos WHERE de_user_id = yo AND para_user_id = _amigo_id AND created_at > now() - interval '2 minutes') THEN$q$,
    $q$  -- Un envío a la vez por pareja: el límite no se pasa con dos toques al mismo tiempo
  PERFORM pg_advisory_xact_lock(hashtextextended('salud:' || yo::text || ':' || _amigo_id::text, 0));
  IF EXISTS (SELECT 1 FROM public.saludos_amigos WHERE de_user_id = yo AND para_user_id = _amigo_id AND created_at > now() - interval '2 minutes') THEN$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'mandar_salud: no se encontró dónde'; END IF;
  EXECUTE nuevo;
END;
$$;
