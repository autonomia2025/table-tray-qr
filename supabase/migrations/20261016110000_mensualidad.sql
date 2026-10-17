-- Fase 8.1 — La mensualidad de Tablio (lo único que Tablio le cobra a cada local; nunca toca la plata de las
-- ventas). Cada local tiene su suscripción (plan, precio y día de cobro); la base genera el cobro de cada mes
-- y finanzas registra cuando el local paga (por ahora transferencia u otro medio: el cobro automático con
-- tarjeta espera que el fundador elija proveedor). Los ingresos de Tablio salen de estos cobros reales, no de
-- una estimación en el navegador (brief 6.3).
--   · Nada se corta solo: un local atrasado queda "en gracia" y después "atrasado", con aviso a finanzas y al
--     dueño. Qué pasa con un local muy atrasado lo decide el fundador (y nunca en medio de una noche).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Precios de referencia por plan y suscripción de cada local
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS precio_mensual integer CHECK (precio_mensual IS NULL OR precio_mensual BETWEEN 0 AND 10000000);

CREATE TABLE IF NOT EXISTS public.suscripciones_local (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  plan_id uuid REFERENCES public.plans(id) ON DELETE SET NULL,
  precio_mensual integer NOT NULL CHECK (precio_mensual BETWEEN 0 AND 10000000),
  dia_cobro smallint NOT NULL DEFAULT 5 CHECK (dia_cobro BETWEEN 1 AND 28),
  dias_para_pagar smallint NOT NULL DEFAULT 10 CHECK (dias_para_pagar BETWEEN 0 AND 30),
  dias_gracia smallint NOT NULL DEFAULT 10 CHECK (dias_gracia BETWEEN 0 AND 60),
  prueba_hasta date,
  desde date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Santiago')::date,
  cancelada_at timestamptz,
  notas text CHECK (notas IS NULL OR char_length(notas) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cobros_mensualidad (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  periodo date NOT NULL CHECK (extract(day FROM periodo) = 1),   -- el mes que se cobra
  monto integer NOT NULL CHECK (monto BETWEEN 0 AND 10000000),
  vence_el date NOT NULL,
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'pagado', 'anulado')),
  pagado_at timestamptz,
  medio text CHECK (medio IS NULL OR medio IN ('transferencia', 'tarjeta', 'efectivo', 'otro')),
  referencia text CHECK (referencia IS NULL OR char_length(referencia) <= 120),
  folio_factura text CHECK (folio_factura IS NULL OR char_length(folio_factura) <= 40),
  motivo_anulacion text,
  registrado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((estado = 'pagado') = (pagado_at IS NOT NULL AND medio IS NOT NULL)),
  CHECK (estado <> 'anulado' OR motivo_anulacion IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS cobros_mensualidad_mes_uidx ON public.cobros_mensualidad (tenant_id, periodo);
CREATE INDEX IF NOT EXISTS cobros_mensualidad_pendientes_idx ON public.cobros_mensualidad (vence_el) WHERE estado = 'pendiente';

-- Solo finanzas y el superadmin leen; el dueño ve lo suyo con estado_mensualidad(). Nadie escribe directo.
ALTER TABLE public.suscripciones_local ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cobros_mensualidad ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS suscripciones_local_lectura ON public.suscripciones_local;
CREATE POLICY suscripciones_local_lectura ON public.suscripciones_local FOR SELECT TO authenticated
  USING (public.is_platform_admin() OR public.es_rol_backoffice(ARRAY['finanzas']));
DROP POLICY IF EXISTS cobros_mensualidad_lectura ON public.cobros_mensualidad;
CREATE POLICY cobros_mensualidad_lectura ON public.cobros_mensualidad FOR SELECT TO authenticated
  USING (public.is_platform_admin() OR public.es_rol_backoffice(ARRAY['finanzas']));
REVOKE INSERT, UPDATE, DELETE ON public.suscripciones_local, public.cobros_mensualidad FROM anon, authenticated;
GRANT SELECT ON public.suscripciones_local, public.cobros_mensualidad TO authenticated;

CREATE OR REPLACE FUNCTION public._es_finanzas()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_platform_admin() OR public.es_rol_backoffice(ARRAY['finanzas'])
$$;
REVOKE ALL ON FUNCTION public._es_finanzas() FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Lo que hace finanzas (todo queda en audit_logs)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guardar_suscripcion(
  _tenant_id uuid, _plan_id uuid, _precio_mensual integer, _dia_cobro integer DEFAULT 5,
  _prueba_hasta date DEFAULT NULL, _notas text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  antes jsonb;
BEGIN
  IF NOT public._es_finanzas() THEN
    RAISE EXCEPTION 'Solo finanzas o el superadmin cambian la mensualidad de un local' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = _tenant_id) THEN
    RAISE EXCEPTION 'Ese local no existe' USING ERRCODE = 'P0001';
  END IF;
  IF _plan_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.plans WHERE id = _plan_id) THEN
    RAISE EXCEPTION 'Ese plan no existe' USING ERRCODE = 'P0001';
  END IF;
  IF _precio_mensual IS NULL OR _precio_mensual NOT BETWEEN 0 AND 10000000 THEN
    RAISE EXCEPTION 'El precio va de 0 a 10.000.000 pesos' USING ERRCODE = 'P0001';
  END IF;
  IF _dia_cobro IS NULL OR _dia_cobro NOT BETWEEN 1 AND 28 THEN
    RAISE EXCEPTION 'El día de cobro va del 1 al 28' USING ERRCODE = 'P0001';
  END IF;
  SELECT to_jsonb(s) INTO antes FROM public.suscripciones_local s WHERE tenant_id = _tenant_id FOR UPDATE;
  INSERT INTO public.suscripciones_local (tenant_id, plan_id, precio_mensual, dia_cobro, prueba_hasta, notas)
  VALUES (_tenant_id, _plan_id, _precio_mensual, _dia_cobro, _prueba_hasta, nullif(btrim(coalesce(_notas, '')), ''))
  ON CONFLICT (tenant_id) DO UPDATE SET plan_id = EXCLUDED.plan_id, precio_mensual = EXCLUDED.precio_mensual,
    dia_cobro = EXCLUDED.dia_cobro, prueba_hasta = EXCLUDED.prueba_hasta, notas = EXCLUDED.notas,
    cancelada_at = NULL, updated_at = now();
  -- El plan de la suscripción es el plan del local (módulos, fase 7.9)
  UPDATE public.tenants SET plan_id = _plan_id,
    plan_status = CASE WHEN _prueba_hasta IS NOT NULL AND _prueba_hasta >= (now() AT TIME ZONE 'America/Santiago')::date THEN 'trial' ELSE 'active' END,
    updated_at = now()
   WHERE id = _tenant_id;
  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (_tenant_id, (SELECT auth.uid()), 'suscripcion_guardada', 'suscripcion', _tenant_id,
          jsonb_build_object('antes', antes, 'plan_id', _plan_id, 'precio_mensual', _precio_mensual, 'dia_cobro', _dia_cobro, 'prueba_hasta', _prueba_hasta));
END;
$$;
REVOKE ALL ON FUNCTION public.guardar_suscripcion(uuid, uuid, integer, integer, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_suscripcion(uuid, uuid, integer, integer, date, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancelar_suscripcion(_tenant_id uuid, _motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_motivo text := btrim(coalesce(_motivo, ''));
BEGIN
  IF NOT public._es_finanzas() THEN
    RAISE EXCEPTION 'Solo finanzas o el superadmin cancelan una suscripción' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_motivo) NOT BETWEEN 5 AND 500 THEN
    RAISE EXCEPTION 'Escribe el motivo (de 5 a 500 letras)' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.suscripciones_local SET cancelada_at = now(), updated_at = now() WHERE tenant_id = _tenant_id AND cancelada_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ese local no tiene una suscripción vigente' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.tenants SET plan_status = 'cancelled', updated_at = now() WHERE id = _tenant_id;
  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (_tenant_id, (SELECT auth.uid()), 'suscripcion_cancelada', 'suscripcion', _tenant_id, jsonb_build_object('motivo', v_motivo));
END;
$$;
REVOKE ALL ON FUNCTION public.cancelar_suscripcion(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancelar_suscripcion(uuid, text) TO authenticated;

-- Genera los cobros del mes que ya tocan (idempotente: uno por local y mes). Lo corre el reloj cada día, y
-- finanzas lo puede correr a mano.
CREATE OR REPLACE FUNCTION public._generar_cobros(_hoy date DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  hoy date := coalesce(_hoy, (now() AT TIME ZONE 'America/Santiago')::date);
  mes date := date_trunc('month', coalesce(_hoy, (now() AT TIME ZONE 'America/Santiago')::date))::date;
  hechos integer;
BEGIN
  INSERT INTO public.cobros_mensualidad (tenant_id, periodo, monto, vence_el)
  SELECT s.tenant_id, mes, s.precio_mensual, mes + (s.dia_cobro - 1) + s.dias_para_pagar
    FROM public.suscripciones_local s
   WHERE s.cancelada_at IS NULL
     AND s.precio_mensual > 0
     AND hoy >= mes + (s.dia_cobro - 1)                         -- ya llegó su día de cobro este mes
     AND s.desde <= mes + (s.dia_cobro - 1)                     -- y ya era cliente ese día
     AND (s.prueba_hasta IS NULL OR s.prueba_hasta < mes + (s.dia_cobro - 1))   -- y no estaba en prueba
  ON CONFLICT (tenant_id, periodo) DO NOTHING;
  GET DIAGNOSTICS hechos = ROW_COUNT;
  RETURN hechos;
END;
$$;
REVOKE ALL ON FUNCTION public._generar_cobros(date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.generar_cobros_mes()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public._es_finanzas() THEN
    RAISE EXCEPTION 'Solo finanzas o el superadmin generan cobros' USING ERRCODE = '42501';
  END IF;
  RETURN public._generar_cobros();
END;
$$;
REVOKE ALL ON FUNCTION public.generar_cobros_mes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generar_cobros_mes() TO authenticated;

CREATE OR REPLACE FUNCTION public.registrar_pago_mensualidad(_cobro_id uuid, _medio text, _referencia text DEFAULT NULL, _folio text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.cobros_mensualidad;
BEGIN
  IF NOT public._es_finanzas() THEN
    RAISE EXCEPTION 'Solo finanzas o el superadmin registran pagos de la mensualidad' USING ERRCODE = '42501';
  END IF;
  IF _medio NOT IN ('transferencia', 'tarjeta', 'efectivo', 'otro') THEN
    RAISE EXCEPTION 'Elige cómo pagó' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO c FROM public.cobros_mensualidad WHERE id = _cobro_id FOR UPDATE;
  IF c.id IS NULL THEN
    RAISE EXCEPTION 'Ese cobro no existe' USING ERRCODE = 'P0001';
  END IF;
  IF c.estado = 'pagado' THEN
    RETURN; -- ya estaba registrado (dos clics)
  END IF;
  IF c.estado = 'anulado' THEN
    RAISE EXCEPTION 'Ese cobro está anulado' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.cobros_mensualidad
     SET estado = 'pagado', pagado_at = now(), medio = _medio, registrado_por = (SELECT auth.uid()),
         referencia = nullif(btrim(coalesce(_referencia, '')), ''), folio_factura = nullif(btrim(coalesce(_folio, '')), '')
   WHERE id = c.id;
  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (c.tenant_id, (SELECT auth.uid()), 'mensualidad_pagada', 'cobro_mensualidad', c.id,
          jsonb_build_object('periodo', c.periodo, 'monto', c.monto, 'medio', _medio));
END;
$$;
REVOKE ALL ON FUNCTION public.registrar_pago_mensualidad(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_pago_mensualidad(uuid, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.anular_cobro_mensualidad(_cobro_id uuid, _motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.cobros_mensualidad;
  v_motivo text := btrim(coalesce(_motivo, ''));
BEGIN
  IF NOT public._es_finanzas() THEN
    RAISE EXCEPTION 'Solo finanzas o el superadmin anulan un cobro' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_motivo) NOT BETWEEN 5 AND 500 THEN
    RAISE EXCEPTION 'Escribe el motivo (de 5 a 500 letras)' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO c FROM public.cobros_mensualidad WHERE id = _cobro_id FOR UPDATE;
  IF c.id IS NULL OR c.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'Solo se anula un cobro pendiente' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.cobros_mensualidad SET estado = 'anulado', motivo_anulacion = v_motivo, registrado_por = (SELECT auth.uid()) WHERE id = c.id;
  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (c.tenant_id, (SELECT auth.uid()), 'mensualidad_anulada', 'cobro_mensualidad', c.id,
          jsonb_build_object('periodo', c.periodo, 'monto', c.monto, 'motivo', v_motivo));
END;
$$;
REVOKE ALL ON FUNCTION public.anular_cobro_mensualidad(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.anular_cobro_mensualidad(uuid, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Estado de cada local (lo calcula la base): al día, por vencer, en gracia o atrasado
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._estado_mensualidad(_tenant_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH s AS (SELECT * FROM public.suscripciones_local WHERE tenant_id = _tenant_id),
       hoy AS (SELECT (now() AT TIME ZONE 'America/Santiago')::date AS d),
       pend AS (SELECT c.* FROM public.cobros_mensualidad c WHERE c.tenant_id = _tenant_id AND c.estado = 'pendiente'),
       peor AS (SELECT min(vence_el) AS vence FROM pend)
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM s) THEN jsonb_build_object('estado', 'sin_suscripcion')
    ELSE jsonb_build_object(
      'estado', CASE
        WHEN (SELECT cancelada_at FROM s) IS NOT NULL THEN 'cancelada'
        WHEN (SELECT prueba_hasta FROM s) >= (SELECT d FROM hoy) THEN 'prueba'
        WHEN (SELECT vence FROM peor) IS NULL THEN 'al_dia'
        WHEN (SELECT vence FROM peor) >= (SELECT d FROM hoy) THEN 'por_vencer'
        WHEN (SELECT vence FROM peor) + (SELECT dias_gracia FROM s) >= (SELECT d FROM hoy) THEN 'en_gracia'
        ELSE 'atrasado' END,
      'precio_mensual', (SELECT precio_mensual FROM s),
      'dia_cobro', (SELECT dia_cobro FROM s),
      'prueba_hasta', (SELECT prueba_hasta FROM s),
      'plan', (SELECT p.display_name FROM s JOIN public.plans p ON p.id = s.plan_id),
      'plan_id', (SELECT plan_id FROM s),
      'pendiente', (SELECT coalesce(sum(monto), 0) FROM pend),
      'vence_el', (SELECT vence FROM peor),
      'dias_atraso', greatest(0, (SELECT d FROM hoy) - (SELECT vence FROM peor)))
  END
$$;
REVOKE ALL ON FUNCTION public._estado_mensualidad(uuid) FROM PUBLIC, anon, authenticated;

-- El dueño ve su plan, lo que debe y cómo pagarle a Tablio
CREATE OR REPLACE FUNCTION public.mi_mensualidad(_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.tiene_rol(_tenant_id, ARRAY['owner', 'admin']) AND NOT public._es_finanzas() THEN
    RAISE EXCEPTION 'Solo el dueño o el administrador ven la mensualidad del local' USING ERRCODE = '42501';
  END IF;
  RETURN public._estado_mensualidad(_tenant_id) || jsonb_build_object(
    'cobros', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'periodo', c.periodo, 'monto', c.monto, 'vence_el', c.vence_el,
                                                             'estado', c.estado, 'pagado_at', c.pagado_at, 'folio', c.folio_factura)
                                         ORDER BY c.periodo DESC), '[]'::jsonb)
                 FROM (SELECT * FROM public.cobros_mensualidad WHERE tenant_id = _tenant_id AND estado <> 'anulado'
                        ORDER BY periodo DESC LIMIT 12) c),
    'como_pagar', (SELECT valor FROM public.configuracion_tablio WHERE clave = 'datos_pago_tablio'));
END;
$$;
REVOKE ALL ON FUNCTION public.mi_mensualidad(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mi_mensualidad(uuid) TO authenticated;

-- Finanzas: todos los locales con su estado
CREATE OR REPLACE FUNCTION public.mensualidades_locales()
RETURNS TABLE (tenant_id uuid, local text, estado jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public._es_finanzas() THEN
    RAISE EXCEPTION 'Solo finanzas o el superadmin' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT t.id, t.name, public._estado_mensualidad(t.id) FROM public.tenants t ORDER BY t.name;
END;
$$;
REVOKE ALL ON FUNCTION public.mensualidades_locales() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mensualidades_locales() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. El reloj diario, la salud y la auditoría
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM cron.unschedule('generar-cobros') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'generar-cobros');
  PERFORM cron.schedule('generar-cobros', '17 10 * * *', 'SELECT public._generar_cobros()');
END;
$$;

DO $$
DECLARE
  def text;
  nuevo text;
BEGIN
  -- La auditoría de la plata revisa la mensualidad: un cobro pagado sin fecha o medio (lo impide el CHECK),
  -- un cobro de un local sin suscripción, o un monto distinto al precio sin que lo explique la suscripción
  def := pg_get_functiondef('public.auditoria_plata()'::regprocedure);
  nuevo := regexp_replace(def, '\n(\s*END;\s*\$function\$)', $q$

  -- Fase 8.1: cada cobro de la mensualidad es de un local con suscripción, y nunca hay dos del mismo mes
  RETURN QUERY
  SELECT 'cobro_sin_suscripcion'::text, c.id::text, ('Cobro de ' || to_char(c.periodo, 'MM/YYYY') || ' de un local sin suscripción')::text
    FROM public.cobros_mensualidad c
   WHERE c.estado <> 'anulado' AND NOT EXISTS (SELECT 1 FROM public.suscripciones_local s WHERE s.tenant_id = c.tenant_id);
\1$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'auditoria_plata: no se encontró el final'; END IF;
  EXECUTE nuevo;
END;
$$;
