-- Fase 8.2 — Métricas de finanzas desde cobros reales (brief 6.3: "debe calcularse desde cobros reales de
-- suscripción, no estimarse desde el plan"). Hasta ahora las páginas de finanzas estimaban en el navegador con
-- precios fijos escritos en el código. Ahora todo sale de la base:
--   · Ingresos de cada mes: lo facturado (cobros del mes, sin anulados) y lo cobrado (pagados).
--   · Ingreso mensual comprometido: la suma de las mensualidades vigentes (sin prueba ni canceladas).
--   · Clientes: pagando cada mes, nuevos (su primer mes pagado) y perdidos (cancelados ese mes).
--   · Abandono: perdidos del mes sobre los que pagaban el mes anterior.
--   · Cohortes: de los que pagaron por primera vez un mes, cuántos siguen pagando cada mes siguiente (solo
--     meses terminados).

CREATE OR REPLACE FUNCTION public.metricas_finanzas(_meses integer DEFAULT 12)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  hoy date := (now() AT TIME ZONE 'America/Santiago')::date;
  mes_actual date := date_trunc('month', (now() AT TIME ZONE 'America/Santiago'))::date;
  n integer := least(greatest(coalesce(_meses, 12), 1), 36);
  desde date;
BEGIN
  IF NOT public._es_finanzas() THEN
    RAISE EXCEPTION 'Solo finanzas o el superadmin' USING ERRCODE = '42501';
  END IF;
  desde := (mes_actual - make_interval(months => n - 1))::date;

  RETURN jsonb_build_object(
    'actual', (
      SELECT jsonb_build_object(
        'mrr', coalesce(sum(s.precio_mensual) FILTER (WHERE s.cancelada_at IS NULL AND (s.prueba_hasta IS NULL OR s.prueba_hasta < hoy)), 0),
        'clientes_activos', count(*) FILTER (WHERE s.cancelada_at IS NULL AND (s.prueba_hasta IS NULL OR s.prueba_hasta < hoy)),
        'en_prueba', count(*) FILTER (WHERE s.cancelada_at IS NULL AND s.prueba_hasta >= hoy),
        'cancelados', count(*) FILTER (WHERE s.cancelada_at IS NOT NULL),
        'por_cobrar', (SELECT coalesce(sum(c.monto), 0) FROM public.cobros_mensualidad c WHERE c.estado = 'pendiente'),
        'vencido', (SELECT coalesce(sum(c.monto), 0) FROM public.cobros_mensualidad c WHERE c.estado = 'pendiente' AND c.vence_el < hoy),
        'locales_atrasados', (SELECT count(DISTINCT c.tenant_id) FROM public.cobros_mensualidad c
                               JOIN public.suscripciones_local s2 ON s2.tenant_id = c.tenant_id
                              WHERE c.estado = 'pendiente' AND c.vence_el + s2.dias_gracia < hoy))
        FROM public.suscripciones_local s),
    'meses', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'mes', m.mes,
               'facturado', (SELECT coalesce(sum(c.monto), 0) FROM public.cobros_mensualidad c WHERE c.periodo = m.mes AND c.estado <> 'anulado'),
               'cobrado', (SELECT coalesce(sum(c.monto), 0) FROM public.cobros_mensualidad c WHERE c.periodo = m.mes AND c.estado = 'pagado'),
               'pagando', (SELECT count(DISTINCT c.tenant_id) FROM public.cobros_mensualidad c WHERE c.periodo = m.mes AND c.estado = 'pagado'),
               'nuevos', (SELECT count(*) FROM (SELECT c.tenant_id FROM public.cobros_mensualidad c WHERE c.estado = 'pagado'
                                                 GROUP BY c.tenant_id HAVING min(c.periodo) = m.mes) x),
               'perdidos', (SELECT count(*) FROM public.suscripciones_local s
                             WHERE date_trunc('month', s.cancelada_at AT TIME ZONE 'America/Santiago')::date = m.mes),
               'pagando_antes', (SELECT count(DISTINCT c.tenant_id) FROM public.cobros_mensualidad c
                                  WHERE c.periodo = (m.mes - interval '1 month')::date AND c.estado = 'pagado'))
             ORDER BY m.mes), '[]'::jsonb)
        FROM (SELECT generate_series(desde, mes_actual, interval '1 month')::date AS mes) m),
    'cohortes', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'mes', co.mes, 'tamano', co.tamano,
               -- Solo meses ya terminados (el mes en curso todavía se está cobrando)
               'siguen', (SELECT coalesce(jsonb_agg((SELECT count(DISTINCT c.tenant_id) FROM public.cobros_mensualidad c
                                            WHERE c.estado = 'pagado' AND c.tenant_id = ANY (co.locales)
                                              AND c.periodo = (co.mes + make_interval(months => k))::date) ORDER BY k), '[]'::jsonb)
                            FROM generate_series(0, (extract(year FROM age(mes_actual, co.mes)) * 12 + extract(month FROM age(mes_actual, co.mes)))::integer - 1) k))
             ORDER BY co.mes), '[]'::jsonb)
        FROM (SELECT p.primero AS mes, count(*) AS tamano, array_agg(p.tenant_id) AS locales
                FROM (SELECT c.tenant_id, min(c.periodo) AS primero FROM public.cobros_mensualidad c WHERE c.estado = 'pagado' GROUP BY c.tenant_id) p
               WHERE p.primero >= desde
               GROUP BY p.primero) co),
    'locales', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'tenant_id', t.id, 'local', t.name, 'plan', p.display_name, 'precio_mensual', s.precio_mensual,
               'desde', s.desde, 'prueba_hasta', s.prueba_hasta, 'cancelada_at', s.cancelada_at,
               'pagado_total', (SELECT coalesce(sum(c.monto), 0) FROM public.cobros_mensualidad c WHERE c.tenant_id = t.id AND c.estado = 'pagado'),
               'meses_pagados', (SELECT count(*) FROM public.cobros_mensualidad c WHERE c.tenant_id = t.id AND c.estado = 'pagado'),
               'estado', public._estado_mensualidad(t.id) ->> 'estado')
             ORDER BY t.name), '[]'::jsonb)
        FROM public.suscripciones_local s
        JOIN public.tenants t ON t.id = s.tenant_id
        LEFT JOIN public.plans p ON p.id = s.plan_id));
END;
$$;
REVOKE ALL ON FUNCTION public.metricas_finanzas(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.metricas_finanzas(integer) TO authenticated;
