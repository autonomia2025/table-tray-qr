-- Fase 2.E — Compuerta de la plata.
-- 1. Cada pago guarda TODOS los pedidos que cubre (payments.pedidos). Antes, un pago con la app de
--    varios pedidos pendientes (cuenta abierta) guardaba solo el primero: si se reembolsaba completo,
--    solo ese pedido quedaba "reembolsado". Lo encontró esta compuerta.
-- 2. auditoria_plata(): revisa que la plata calce en toda la base (como auditoria_seguridad, pero
--    para los montos). La prueba f2e-compuerta-plata exige que salga vacía después de todos los casos
--    difíciles: si un cambio futuro descuadra algo, la integración continua falla.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Los pedidos de cada pago
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS pedidos uuid[];

CREATE OR REPLACE FUNCTION public.anotar_pedidos_pago()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cot uuid[];
BEGIN
  IF NEW.pedidos IS NULL THEN
    IF jsonb_typeof(NEW.provider_payload -> 'pedidos') = 'array' THEN
      -- Cobro del mozo o de la caja: la lista viene en el detalle del cobro
      SELECT array_agg(x::uuid) INTO cot
        FROM jsonb_array_elements_text(NEW.provider_payload -> 'pedidos') x;
      NEW.pedidos := cot;
    ELSIF NEW.intento_id IS NOT NULL THEN
      -- Pago con la app de pedidos pendientes: los de la cotización
      SELECT c.order_ids INTO cot
        FROM public.intentos_pago i JOIN public.cotizaciones c ON c.id = i.cotizacion_id
       WHERE i.id = NEW.intento_id AND c.tipo = 'pedidos';
      NEW.pedidos := coalesce(cot, CASE WHEN NEW.order_id IS NOT NULL THEN ARRAY[NEW.order_id] END);
    ELSIF NEW.order_id IS NOT NULL THEN
      NEW.pedidos := ARRAY[NEW.order_id];
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.anotar_pedidos_pago() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS anotar_pedidos_pago ON public.payments;
CREATE TRIGGER anotar_pedidos_pago BEFORE INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.anotar_pedidos_pago();

-- Los pagos que ya existen
UPDATE public.payments p
   SET pedidos = (SELECT array_agg(x::uuid) FROM jsonb_array_elements_text(p.provider_payload -> 'pedidos') x)
 WHERE p.pedidos IS NULL AND jsonb_typeof(p.provider_payload -> 'pedidos') = 'array';
UPDATE public.payments p
   SET pedidos = c.order_ids
  FROM public.intentos_pago i JOIN public.cotizaciones c ON c.id = i.cotizacion_id
 WHERE p.pedidos IS NULL AND i.id = p.intento_id AND c.tipo = 'pedidos';
UPDATE public.payments SET pedidos = ARRAY[order_id] WHERE pedidos IS NULL AND order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS payments_pedidos_idx ON public.payments USING gin (pedidos);

-- El reembolso total marca como reembolsados todos los pedidos del pago.
CREATE OR REPLACE FUNCTION public.confirmar_reembolso(_refund_id uuid, _ok boolean, _referencia text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  pago record;
  total_devuelto integer;
  completo boolean;
BEGIN
  SELECT * INTO r FROM public.refunds WHERE id = _refund_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reembolso no encontrado' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO pago FROM public.payments WHERE id = r.payment_id FOR UPDATE;
  IF r.status <> 'pending' THEN
    RETURN jsonb_build_object('estado', r.status, 'nuevo', false,
                              'completo', pago.status = 'refunded');
  END IF;

  IF NOT _ok THEN
    UPDATE public.refunds SET status = 'failed', resuelto_at = now(), external_reference = _referencia WHERE id = r.id;
    RETURN jsonb_build_object('estado', 'failed', 'nuevo', true, 'completo', false);
  END IF;

  total_devuelto := coalesce(pago.refunded_amount, 0) + r.amount;
  completo := total_devuelto >= pago.amount + coalesce(pago.tip_amount, 0);

  UPDATE public.refunds SET status = 'completed', resuelto_at = now(), external_reference = _referencia WHERE id = r.id;
  UPDATE public.payments
     SET refunded_amount = total_devuelto,
         status = CASE WHEN completo THEN 'refunded' ELSE 'partially_refunded' END
   WHERE id = pago.id;

  -- La sesión de la mesa refleja lo devuelto (solo la parte del consumo, no la propina).
  IF pago.session_id IS NOT NULL THEN
    UPDATE public.table_sessions
       SET paid_amount = greatest(0, coalesce(paid_amount, 0) - least(r.amount, pago.amount))
     WHERE id = pago.session_id;
  END IF;

  -- Reembolso total: todos los pedidos de ese pago quedan "reembolsados".
  IF completo THEN
    UPDATE public.orders SET payment_status = 'refunded'
     WHERE id = ANY (coalesce(pago.pedidos, ARRAY[pago.order_id])) AND payment_status = 'paid';
  END IF;

  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (pago.tenant_id, r.authorized_by, 'reembolso', 'payment', pago.id,
          jsonb_build_object('monto', r.amount, 'motivo', r.reason, 'rol', r.authorized_role,
                             'devolucion', r.devolucion, 'completo', completo));

  RETURN jsonb_build_object('estado', 'completed', 'nuevo', true, 'completo', completo, 'monto', r.amount);
END;
$$;
REVOKE ALL ON FUNCTION public.confirmar_reembolso(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirmar_reembolso(uuid, boolean, text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. La auditoría de la plata (solo superadmin). Vacía = todo calza.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auditoria_plata()
RETURNS TABLE (tipo text, objeto text, detalle text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Los pedidos de antes de la fase 1 (octubre de 2026) vienen del sistema anterior (Lovable), donde el
  -- navegador podía marcarlos como pagados sin pago: no son confiables y no se pueden corregir sin
  -- inventar datos. Quedan anotados en docs/DIAGNOSTICO.md (N17). Los pagos se revisan todos.
  desde constant timestamptz := '2026-10-01 00:00:00-03';
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'No tienes permiso para este cambio' USING ERRCODE = '42501';
  END IF;

  -- Lo reembolsado de cada pago es exactamente la suma de sus reembolsos hechos.
  RETURN QUERY
  SELECT 'reembolsado_no_calza', p.id::text,
         format('El pago dice %s reembolsado y sus reembolsos suman %s', p.refunded_amount, coalesce(r.suma, 0))
    FROM public.payments p
    LEFT JOIN (SELECT payment_id, sum(amount) AS suma FROM public.refunds WHERE status = 'completed' GROUP BY 1) r
      ON r.payment_id = p.id
   WHERE coalesce(p.refunded_amount, 0) <> coalesce(r.suma, 0);

  -- Nunca se devuelve más de lo cobrado.
  RETURN QUERY
  SELECT 'reembolso_de_mas', p.id::text,
         format('Se devolvió %s de un cobro de %s', p.refunded_amount, p.amount + coalesce(p.tip_amount, 0))
    FROM public.payments p
   WHERE coalesce(p.refunded_amount, 0) > p.amount + coalesce(p.tip_amount, 0);

  -- El estado del pago corresponde a lo reembolsado.
  RETURN QUERY
  SELECT 'estado_pago_incoherente', p.id::text,
         format('Estado %s con %s reembolsado de %s', p.status, coalesce(p.refunded_amount, 0), p.amount + coalesce(p.tip_amount, 0))
    FROM public.payments p
   WHERE (p.status = 'approved' AND coalesce(p.refunded_amount, 0) > 0)
      OR (p.status = 'partially_refunded' AND (coalesce(p.refunded_amount, 0) = 0
            OR p.refunded_amount >= p.amount + coalesce(p.tip_amount, 0)))
      OR (p.status = 'refunded' AND coalesce(p.refunded_amount, 0) < p.amount + coalesce(p.tip_amount, 0));

  -- Un reembolso reservado se resuelve en minutos (si no, la plata quedó en el aire).
  RETURN QUERY
  SELECT 'reembolso_trabado', r.id::text, format('Reembolso de %s pendiente desde %s', r.amount, r.created_at)
    FROM public.refunds r
   WHERE r.status = 'pending' AND r.created_at < now() - interval '15 minutes';

  -- Todo pago aprobado por la pasarela quedó guardado como pago.
  RETURN QUERY
  SELECT 'intento_aprobado_sin_pago', i.id::text, format('Intento aprobado de %s sin pago guardado', i.monto + i.propina)
    FROM public.intentos_pago i
   WHERE i.estado = 'aprobado'
     AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.id = i.payment_id);

  -- Un pago reservado se resuelve (aprobado, rechazado o devuelto); si no, hay que revisarlo con la pasarela.
  RETURN QUERY
  SELECT 'intento_sin_resolver', i.id::text, format('Intento de %s reservado desde %s', i.monto + i.propina, i.created_at)
    FROM public.intentos_pago i
   WHERE i.estado = 'reservado' AND i.created_at < now() - interval '1 hour';

  -- Un mismo intento nunca produce dos pagos.
  RETURN QUERY
  SELECT 'pago_duplicado', p.intento_id::text, format('%s pagos del mismo intento', count(*))
    FROM public.payments p
   WHERE p.intento_id IS NOT NULL
   GROUP BY p.intento_id HAVING count(*) > 1;

  -- Todo pedido pagado (o reembolsado) tiene su pago.
  RETURN QUERY
  SELECT 'pedido_pagado_sin_pago', o.id::text, format('Pedido %s marcado %s sin pago que lo cubra', o.order_number, o.payment_status)
    FROM public.orders o
   WHERE o.payment_status IN ('paid', 'refunded') AND o.created_at >= desde
     AND NOT EXISTS (SELECT 1 FROM public.payments p
                      WHERE p.pedidos @> ARRAY[o.id] AND p.status <> 'failed');

  -- Ningún pedido se cobra dos veces.
  RETURN QUERY
  SELECT 'pedido_cobrado_dos_veces', o.id::text, format('Pedido %s cubierto por %s pagos vigentes', o.order_number, count(*))
    FROM public.orders o JOIN public.payments p ON p.pedidos @> ARRAY[o.id]
   WHERE p.status IN ('approved', 'partially_refunded')
   GROUP BY o.id, o.order_number HAVING count(*) > 1;

  -- Lo cobrado por consumo es exactamente el total de los pedidos que cubre (sin propina).
  RETURN QUERY
  SELECT 'monto_no_calza', p.id::text, format('Se cobró %s por pedidos que suman %s', p.amount, x.suma)
    FROM public.payments p
    JOIN LATERAL (SELECT sum(o.total_amount) AS suma FROM public.orders o WHERE o.id = ANY (p.pedidos)) x ON true
   WHERE p.pedidos IS NOT NULL AND p.status <> 'failed' AND x.suma IS NOT NULL AND x.suma <> p.amount;

  -- En prepago, nada pasa a cocina sin pagar (regla 1).
  RETURN QUERY
  SELECT 'cocina_sin_pago', o.id::text, format('Pedido %s en %s sin pagar en un local de prepago', o.order_number, o.status)
    FROM public.orders o JOIN public.branches b ON b.id = o.branch_id
   WHERE b.payment_mode = 'prepaid' AND o.created_at >= desde
     AND o.status IN ('in_kitchen', 'ready', 'delivered')
     AND coalesce(o.payment_status, 'unpaid') = 'unpaid'
     AND o.forma_pago IS DISTINCT FROM 'cuenta';

  -- Cada pago queda en su día de negocio.
  RETURN QUERY
  SELECT 'pago_sin_dia', p.id::text, 'Pago sin día de negocio'
    FROM public.payments p
   WHERE p.branch_id IS NOT NULL AND p.dia_negocio IS NULL;

  -- Un cierre no cambia: lo guardado al cerrar es lo mismo que resulta hoy de esos pagos y reembolsos.
  RETURN QUERY
  SELECT 'cierre_cambio', s.id::text,
         format('Cierre del %s guardó %s neto (efectivo %s, POS %s) y hoy da %s (efectivo %s, POS %s)',
                s.settlement_date, s.total_neto, s.efectivo_esperado, s.pos_esperado,
                (c.r ->> 'total_neto'), (c.r -> 'efectivo' ->> 'esperado'), (c.r -> 'pos' ->> 'esperado'))
    FROM public.payment_settlements s
    CROSS JOIN LATERAL (SELECT public._conciliar_dia(s.branch_id, s.settlement_date) AS r) c
   WHERE s.status = 'closed' AND s.detalle <> '{}'::jsonb
     AND ((c.r ->> 'total_neto')::integer <> s.total_neto
       OR (c.r -> 'efectivo' ->> 'esperado')::integer <> s.efectivo_esperado
       OR (c.r -> 'pos' ->> 'esperado')::integer <> s.pos_esperado);
END;
$$;
REVOKE ALL ON FUNCTION public.auditoria_plata() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auditoria_plata() TO authenticated;
