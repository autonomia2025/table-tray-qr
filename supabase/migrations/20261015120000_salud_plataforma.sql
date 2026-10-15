-- Fase 5.4 — Monitoreo interno. Hasta ahora la revisión diaria solo comprobaba que la app y la base
-- respondieran. Ahora la base revisa su propia salud cada hora: los relojes automáticos (pg_cron), las
-- llamadas del reloj a las funciones, los pagos trabados y devoluciones pendientes, las excepciones de caja,
-- las tres auditorías y las activaciones vencidas. El superadmin lo ve en "Salud", y la revisión diaria de
-- GitHub falla (y avisa por correo) si la última revisión encontró un problema.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. El chequeo completo (solo el superadmin; el reloj lo corre como superadmin)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._chequeo_salud()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  relojes jsonb;
  llamadas jsonb;
  pagos jsonb;
  excepciones jsonb;
  auditorias jsonb := '{}'::jsonb;
  locales jsonb;
  fn text;
  n integer;
  problemas text[] := '{}';
  avisos text[] := '{}';
BEGIN
  -- Relojes automáticos: última vez que corrió cada uno y fallas en 24 horas
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'nombre', j.jobname, 'cada', j.schedule, 'activo', j.active,
           'ultima_vez', u.start_time, 'resultado', u.status, 'detalle', left(u.return_message, 160),
           'fallas_24h', (SELECT count(*) FROM cron.job_run_details d WHERE d.jobid = j.jobid AND d.status = 'failed' AND d.start_time > now() - interval '24 hours'))
         ORDER BY j.jobname), '[]'::jsonb)
    INTO relojes
    FROM cron.job j
    LEFT JOIN LATERAL (SELECT d.start_time, d.status, d.return_message FROM cron.job_run_details d
                        WHERE d.jobid = j.jobid ORDER BY d.start_time DESC LIMIT 1) u ON true;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(relojes) r WHERE (r ->> 'fallas_24h')::integer > 0) THEN
    problemas := array_append(problemas, 'Un reloj automático falló en las últimas 24 horas');
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(relojes) r WHERE NOT (r ->> 'activo')::boolean) THEN
    avisos := array_append(avisos, 'Hay un reloj automático apagado');
  END IF;

  -- Llamadas del reloj a las funciones (pg_net): las que no respondieron bien en 24 horas
  SELECT jsonb_build_object(
           'total_24h', count(*),
           'fallidas_24h', count(*) FILTER (WHERE r.status_code IS NULL OR r.status_code >= 400 OR r.timed_out),
           'ultima_falla', max(r.created) FILTER (WHERE r.status_code IS NULL OR r.status_code >= 400 OR r.timed_out),
           'detalle', (SELECT left(coalesce(x.error_msg, x.status_code::text), 160) FROM net._http_response x
                        WHERE x.created > now() - interval '24 hours' AND (x.status_code IS NULL OR x.status_code >= 400 OR x.timed_out)
                        ORDER BY x.created DESC LIMIT 1))
    INTO llamadas
    FROM net._http_response r WHERE r.created > now() - interval '24 hours';
  IF (llamadas ->> 'fallidas_24h')::integer > 0 THEN
    avisos := array_append(avisos, 'El reloj no pudo llamar a una función en las últimas 24 horas');
  END IF;

  -- Plata en movimiento: pagos que salieron a la pasarela sin confirmar, devoluciones sin hacer
  SELECT jsonb_build_object(
           'sin_confirmar', (SELECT count(*) FROM public.intentos_pago WHERE estado = 'reservado' AND token_externo IS NOT NULL AND created_at < now() - interval '1 hour' AND created_at > now() - interval '7 days'),
           'devoluciones_pendientes', (SELECT count(*) FROM public.intentos_pago WHERE estado = 'reembolsado' AND devolucion_estado = 'fallida'),
           'reembolsos_rechazados', (SELECT count(*) FROM public.refunds WHERE status = 'failed' AND revisado_at IS NULL AND created_at > now() - interval '30 days'))
    INTO pagos;
  IF (pagos ->> 'sin_confirmar')::integer > 0 THEN problemas := array_append(problemas, 'Hay pagos con pasarela sin confirmar hace más de una hora'); END IF;
  IF (pagos ->> 'devoluciones_pendientes')::integer > 0 THEN problemas := array_append(problemas, 'Hay cobros que había que devolver y la pasarela no devolvió'); END IF;
  IF (pagos ->> 'reembolsos_rechazados')::integer > 0 THEN avisos := array_append(avisos, 'Hay reembolsos rechazados por la pasarela'); END IF;

  -- Excepciones de caja abiertas en todos los locales (las resuelve cada local)
  SELECT jsonb_build_object(
           'diferencias_pasarela', (SELECT count(*) FROM public.diferencias_pasarela WHERE estado = 'abierta'),
           'boletas_atrasadas', (SELECT count(*) FROM public.payments p WHERE p.boleta_estado = 'pendiente' AND p.dia_negocio < public.dia_negocio(p.branch_id, now()) AND p.created_at > now() - interval '30 days'),
           'locales_con_excepciones', (SELECT count(DISTINCT x.branch_id) FROM (
               SELECT branch_id FROM public.diferencias_pasarela WHERE estado = 'abierta'
               UNION ALL SELECT p.branch_id FROM public.payments p WHERE p.boleta_estado = 'pendiente' AND p.dia_negocio < public.dia_negocio(p.branch_id, now()) AND p.created_at > now() - interval '30 days') x))
    INTO excepciones;
  IF (excepciones ->> 'locales_con_excepciones')::integer > 0 THEN avisos := array_append(avisos, 'Hay locales con excepciones de caja por resolver'); END IF;

  -- Las tres auditorías (si alguna encuentra algo, es un problema)
  FOREACH fn IN ARRAY ARRAY['auditoria_seguridad', 'auditoria_plata', 'auditoria_operacion'] LOOP
    BEGIN
      EXECUTE format('SELECT count(*) FROM public.%I()', fn) INTO n;
    EXCEPTION WHEN others THEN
      n := -1; -- no se pudo correr (por ejemplo, todavía no hay superadmin)
    END;
    auditorias := auditorias || jsonb_build_object(fn, n);
    IF n > 0 THEN problemas := array_append(problemas, format('La %s encontró %s hallazgos', replace(fn, '_', ' de '), n)); END IF;
    IF n < 0 THEN avisos := array_append(avisos, format('No se pudo correr la %s', replace(fn, '_', ' de '))); END IF;
  END LOOP;

  -- Locales: cuántos hay, cuántos vendieron hoy, activaciones vencidas sin usar
  SELECT jsonb_build_object(
           'activos', (SELECT count(*) FROM public.tenants WHERE is_active),
           'con_pedidos_hoy', (SELECT count(DISTINCT o.tenant_id) FROM public.orders o WHERE o.created_at > now() - interval '24 hours'),
           'pedidos_24h', (SELECT count(*) FROM public.orders WHERE created_at > now() - interval '24 hours'),
           'activaciones_vencidas', (SELECT count(*) FROM (SELECT DISTINCT ON (a.tenant_id) a.* FROM public.activaciones_local a
                                      WHERE a.anulado_at IS NULL ORDER BY a.tenant_id, a.created_at DESC) u
                                     WHERE u.used_at IS NULL AND u.expires_at < now()))
    INTO locales;
  IF (locales ->> 'activaciones_vencidas')::integer > 0 THEN avisos := array_append(avisos, 'Hay locales creados cuyo dueño no activó la cuenta a tiempo'); END IF;

  RETURN jsonb_build_object(
    'estado', CASE WHEN cardinality(problemas) > 0 THEN 'problema' WHEN cardinality(avisos) > 0 THEN 'atencion' ELSE 'ok' END,
    'problemas', to_jsonb(problemas), 'avisos', to_jsonb(avisos),
    'relojes', relojes, 'llamadas', llamadas, 'pagos', pagos, 'excepciones', excepciones,
    'auditorias', auditorias, 'locales', locales, 'revisado_at', now());
END;
$$;
REVOKE ALL ON FUNCTION public._chequeo_salud() FROM PUBLIC, anon, authenticated;

-- El superadmin lo ve en vivo
CREATE OR REPLACE FUNCTION public.salud_plataforma()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Solo el superadmin ve la salud de la plataforma' USING ERRCODE = '42501';
  END IF;
  RETURN public._chequeo_salud();
END;
$$;
REVOKE ALL ON FUNCTION public.salud_plataforma() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salud_plataforma() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Cada hora queda registrado (30 días de historia)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.salud_registros (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  estado text NOT NULL CHECK (estado IN ('ok', 'atencion', 'problema')),
  detalle jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS salud_registros_fecha ON public.salud_registros (created_at DESC);
-- Sin datos de ningún local: es de la plataforma. Solo el superadmin la lee.
ALTER TABLE public.salud_registros ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS salud_registros_superadmin ON public.salud_registros;
CREATE POLICY salud_registros_superadmin ON public.salud_registros FOR SELECT TO authenticated
  USING (public.is_platform_admin());
REVOKE ALL ON public.salud_registros FROM anon, authenticated;
GRANT SELECT ON public.salud_registros TO authenticated;

CREATE OR REPLACE FUNCTION public._revisar_salud()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  admin uuid := (SELECT user_id FROM public.platform_admins ORDER BY created_at LIMIT 1);
  r jsonb;
BEGIN
  -- Las auditorías exigen al superadmin: el reloj revisa en su nombre (solo dentro de esta función)
  IF admin IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', admin, 'role', 'authenticated')::text, true);
  END IF;
  r := public._chequeo_salud();
  INSERT INTO public.salud_registros (estado, detalle) VALUES (r ->> 'estado', r);
  DELETE FROM public.salud_registros WHERE created_at < now() - interval '30 days';
  RETURN r ->> 'estado';
END;
$$;
REVOKE ALL ON FUNCTION public._revisar_salud() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'revisar-salud') THEN
    PERFORM cron.unschedule('revisar-salud');
  END IF;
  PERFORM cron.schedule('revisar-salud', '7 * * * *', 'SELECT public._revisar_salud()');
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Lo único público: el estado de la última revisión (para la revisión diaria de GitHub)
-- ─────────────────────────────────────────────────────────────────────────────
-- Pública a propósito: solo dice "ok", "atencion" o "problema" y cuándo se revisó; ningún detalle ni dato
-- de ningún local. Lee el último registro (no corre el chequeo: llamarla muchas veces no cuesta nada).
CREATE OR REPLACE FUNCTION public.estado_salud()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT jsonb_build_object('estado', estado, 'revisado_at', created_at,
                               'reciente', created_at > now() - interval '3 hours')
       FROM public.salud_registros ORDER BY created_at DESC LIMIT 1),
    jsonb_build_object('estado', 'sin_revisar', 'revisado_at', NULL, 'reciente', false))
$$;
REVOKE ALL ON FUNCTION public.estado_salud() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.estado_salud() TO anon, authenticated;

DO $$
DECLARE
  def text;
BEGIN
  SELECT pg_get_functiondef('public.auditoria_seguridad()'::regprocedure) INTO def;
  IF position('estado_salud' IN def) = 0 THEN
    def := replace(def, '''ver_activacion'',', '''ver_activacion'', ''estado_salud'',');
    IF position('estado_salud' IN def) = 0 THEN
      RAISE EXCEPTION 'No se pudo anotar estado_salud como función pública en la auditoría';
    END IF;
    EXECUTE def;
  END IF;
END;
$$;

-- La primera revisión, ahora
SELECT public._revisar_salud();
