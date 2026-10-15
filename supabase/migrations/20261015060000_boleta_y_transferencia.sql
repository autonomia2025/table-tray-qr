-- Fase 4.3 (etapa 1) — Boleta del local para efectivo y transferencia, y la transferencia como medio de cobro.
-- La boleta siempre es del local (su RUT), nunca de Tablio. Con la app o con POS, el comprobante de la
-- pasarela vale como boleta si el local lo declara en el SII. En efectivo y transferencia, el local la emite
-- con su sistema de siempre: Tablio solo recuerda entregarla, deja marcarla al cobrar (con su número si se
-- quiere) y avisa lo que falta, al mozo y a la caja. La etapa 2 (un proveedor de boletas conectado por cada
-- local) viene después.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Configuración de la sucursal
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS recordar_boleta boolean NOT NULL DEFAULT true;
ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS datos_transferencia text;
ALTER TABLE public.branches DROP CONSTRAINT IF EXISTS branches_datos_transferencia_largo;
ALTER TABLE public.branches ADD CONSTRAINT branches_datos_transferencia_largo
  CHECK (datos_transferencia IS NULL OR char_length(datos_transferencia) <= 300);
GRANT UPDATE (recordar_boleta, datos_transferencia) ON public.branches TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. La boleta de cada cobro en el local (pendiente → entregada)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS boleta_estado text;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS boleta_folio text;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS boleta_marcada_at timestamptz;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS boleta_marcada_por uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_boleta_estado_valido;
ALTER TABLE public.payments ADD CONSTRAINT payments_boleta_estado_valido
  CHECK (boleta_estado IS NULL OR boleta_estado IN ('pendiente', 'entregada'));
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_boleta_folio_largo;
ALTER TABLE public.payments ADD CONSTRAINT payments_boleta_folio_largo
  CHECK (boleta_folio IS NULL OR char_length(boleta_folio) <= 40);
CREATE INDEX IF NOT EXISTS payments_boletas_pendientes ON public.payments (branch_id, created_at)
  WHERE boleta_estado = 'pendiente';
CREATE INDEX IF NOT EXISTS payments_boleta_marcada_por ON public.payments (boleta_marcada_por)
  WHERE boleta_marcada_por IS NOT NULL;

-- Al guardar un pago: ¿necesita boleta del local? Solo efectivo y transferencia cobrados en el local, y
-- solo si la sucursal pide recordarla. Lo demás queda sin boleta (la app y el POS tienen su comprobante).
CREATE OR REPLACE FUNCTION public.boleta_del_pago()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.provider = 'local' AND NEW.method IN ('cash', 'transfer')
     AND coalesce((SELECT b.recordar_boleta FROM public.branches b WHERE b.id = NEW.branch_id), true) THEN
    IF NEW.boleta_estado = 'entregada' THEN
      NEW.boleta_marcada_at := coalesce(NEW.boleta_marcada_at, now());
    ELSE
      NEW.boleta_estado := 'pendiente';
      NEW.boleta_folio := NULL;
      NEW.boleta_marcada_at := NULL;
      NEW.boleta_marcada_por := NULL;
    END IF;
  ELSE
    NEW.boleta_estado := NULL;
    NEW.boleta_folio := NULL;
    NEW.boleta_marcada_at := NULL;
    NEW.boleta_marcada_por := NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.boleta_del_pago() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS boleta_del_pago ON public.payments;
CREATE TRIGGER boleta_del_pago BEFORE INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.boleta_del_pago();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. El cobro del mozo: efectivo, POS o transferencia, y si entregó la boleta
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.registrar_cobro_mozo(uuid[], text, integer, integer);
CREATE OR REPLACE FUNCTION public.registrar_cobro_mozo(
  _order_ids uuid[],
  _metodo text,
  _propina integer DEFAULT 0,
  _recibido integer DEFAULT NULL,
  _boleta_entregada boolean DEFAULT false,
  _boleta_folio text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  primero record;
  rol text;
  mi_ficha uuid;
  mesa record;
  total integer;
  cantidad integer;
  propina integer := greatest(coalesce(_propina, 0), 0);
  folio text := nullif(btrim(coalesce(_boleta_folio, '')), '');
  pago uuid;
  boleta text;
  ahora timestamptz := now();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Tienes que iniciar sesión' USING ERRCODE = '42501';
  END IF;
  IF _metodo NOT IN ('cash', 'pos', 'transfer') THEN
    RAISE EXCEPTION 'Medio de pago no válido' USING ERRCODE = '22023';
  END IF;
  IF _order_ids IS NULL OR cardinality(_order_ids) = 0 OR cardinality(_order_ids) > 50 THEN
    RAISE EXCEPTION 'Elige qué pedidos cobrar' USING ERRCODE = '22023';
  END IF;
  IF folio IS NOT NULL AND char_length(folio) > 40 THEN
    RAISE EXCEPTION 'El número de boleta es demasiado largo' USING ERRCODE = '22023';
  END IF;

  -- Se bloquean los pedidos: dos personas no cobran lo mismo.
  PERFORM 1 FROM public.orders WHERE id = ANY (_order_ids) FOR UPDATE;
  SELECT o.tenant_id, o.branch_id, o.table_id, o.session_id INTO primero
    FROM public.orders o WHERE o.id = _order_ids[1];
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido no encontrado' USING ERRCODE = 'P0002';
  END IF;

  SELECT tm.role INTO rol FROM public.tenant_members tm
   WHERE tm.user_id = auth.uid() AND tm.tenant_id = primero.tenant_id AND tm.is_active;
  IF rol IS NULL OR rol NOT IN ('owner', 'admin', 'manager', 'cashier', 'waiter') THEN
    RAISE EXCEPTION 'No tienes permiso para este cambio' USING ERRCODE = '42501';
  END IF;
  SELECT s.id INTO mi_ficha FROM public.staff_users s
   WHERE s.auth_user_id = auth.uid() AND s.tenant_id = primero.tenant_id AND s.is_active
   ORDER BY s.created_at LIMIT 1;

  SELECT t.id, t.assigned_waiter_id INTO mesa FROM public.tables t WHERE t.id = primero.table_id;
  IF rol = 'waiter' AND mesa.assigned_waiter_id IS NOT NULL AND mesa.assigned_waiter_id IS DISTINCT FROM mi_ficha THEN
    RAISE EXCEPTION 'Esta mesa la atiende otro mozo' USING ERRCODE = '42501';
  END IF;

  SELECT count(*), coalesce(sum(o.total_amount), 0) INTO cantidad, total
    FROM public.orders o
   WHERE o.id = ANY (_order_ids) AND o.tenant_id = primero.tenant_id AND o.session_id = primero.session_id
     AND o.status <> 'cancelled' AND coalesce(o.payment_status, 'unpaid') = 'unpaid';
  IF cantidad <> cardinality(_order_ids) THEN
    RAISE EXCEPTION 'Alguno de esos pedidos ya está cobrado, cancelado o es de otra mesa' USING ERRCODE = 'P0001';
  END IF;
  IF propina > total * 2 THEN
    RAISE EXCEPTION 'La propina no es válida' USING ERRCODE = '22023';
  END IF;
  IF _metodo = 'cash' AND _recibido IS NOT NULL AND _recibido < total + propina THEN
    RAISE EXCEPTION 'Lo recibido no alcanza para el total' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.orders SET payment_status = 'paid', paid_at = ahora WHERE id = ANY (_order_ids);

  -- La boleta: el disparador boleta_del_pago decide si este cobro la necesita.
  INSERT INTO public.payments (tenant_id, branch_id, session_id, table_id, order_id, amount, tip_amount, method,
                               status, provider, external_reference, provider_payload, staff_id,
                               boleta_estado, boleta_folio, boleta_marcada_por)
  VALUES (primero.tenant_id, primero.branch_id, primero.session_id, primero.table_id, _order_ids[1], total, propina,
          _metodo, 'approved', 'local', NULL,
          jsonb_build_object('pedidos', to_jsonb(_order_ids), 'recibido', CASE WHEN _metodo = 'cash' THEN _recibido END,
                             'cobrado_por', auth.uid(), 'rol', rol),
          mi_ficha,
          CASE WHEN coalesce(_boleta_entregada, false) THEN 'entregada' END,
          CASE WHEN coalesce(_boleta_entregada, false) THEN folio END,
          CASE WHEN coalesce(_boleta_entregada, false) THEN auth.uid() END)
  RETURNING id, boleta_estado INTO pago, boleta;

  UPDATE public.table_sessions
     SET paid_amount = coalesce(paid_amount, 0) + total,
         tip_amount = coalesce(tip_amount, 0) + propina
   WHERE id = primero.session_id;

  INSERT INTO public.order_events (tenant_id, order_id, estado_anterior, estado_nuevo, productos, actor_user_id, actor_rol, motivo)
  SELECT primero.tenant_id, o.id, o.status, o.status, 0, auth.uid(), rol,
         'cobrado ' || CASE _metodo WHEN 'cash' THEN 'en efectivo' WHEN 'pos' THEN 'con POS' ELSE 'por transferencia' END
    FROM public.orders o WHERE o.id = ANY (_order_ids);

  RETURN jsonb_build_object('payment_id', pago, 'total', total, 'propina', propina, 'boleta', boleta,
                            'vuelto', CASE WHEN _metodo = 'cash' AND _recibido IS NOT NULL THEN _recibido - total - propina END);
END;
$$;
REVOKE ALL ON FUNCTION public.registrar_cobro_mozo(uuid[], text, integer, integer, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_cobro_mozo(uuid[], text, integer, integer, boolean, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Marcar la boleta después (quien cobró, o la caja, el encargado, el administrador o el dueño)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.marcar_boleta(_pago_id uuid, _folio text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.payments;
  rol text;
  folio text := nullif(btrim(coalesce(_folio, '')), '');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Tienes que iniciar sesión' USING ERRCODE = '42501';
  END IF;
  IF folio IS NOT NULL AND char_length(folio) > 40 THEN
    RAISE EXCEPTION 'El número de boleta es demasiado largo' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO p FROM public.payments WHERE id = _pago_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cobro no encontrado' USING ERRCODE = 'P0002';
  END IF;
  SELECT tm.role INTO rol FROM public.tenant_members tm
   WHERE tm.user_id = auth.uid() AND tm.tenant_id = p.tenant_id AND tm.is_active;
  IF rol IS NULL OR NOT (rol IN ('owner', 'admin', 'manager', 'cashier')
                         OR (p.provider_payload ->> 'cobrado_por') = auth.uid()::text) THEN
    -- Mismo mensaje que si no existiera: no se revela qué cobros hay
    RAISE EXCEPTION 'Cobro no encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF p.boleta_estado IS NULL THEN
    RAISE EXCEPTION 'Este cobro no necesita boleta del local' USING ERRCODE = 'P0001';
  END IF;
  IF p.boleta_estado = 'entregada' THEN
    RETURN jsonb_build_object('boleta', 'entregada', 'ya_estaba', true);
  END IF;

  UPDATE public.payments
     SET boleta_estado = 'entregada', boleta_folio = folio, boleta_marcada_at = now(), boleta_marcada_por = auth.uid()
   WHERE id = p.id;
  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (p.tenant_id, auth.uid(), 'boleta_entregada', 'payment', p.id,
          jsonb_build_object('folio', folio, 'rol', rol, 'metodo', p.method, 'monto', p.amount));
  RETURN jsonb_build_object('boleta', 'entregada', 'ya_estaba', false);
END;
$$;
REVOKE ALL ON FUNCTION public.marcar_boleta(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marcar_boleta(uuid, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Boletas por entregar: la caja ve las de la sucursal; el mozo, las suyas
-- ─────────────────────────────────────────────────────────────────────────────
-- Últimos 7 días (más atrás ya no tiene sentido entregarla en la mesa; queda en la auditoría del día).
CREATE OR REPLACE FUNCTION public.boletas_pendientes(_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._tenant_caja(_branch_id); -- dueño, administrador, encargado, caja o superadmin
  RETURN (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'id', p.id, 'creado_at', p.created_at, 'dia', p.dia_negocio, 'mesa', t.number,
             'monto', p.amount, 'propina', p.tip_amount, 'metodo', p.method,
             'cobrado_por', coalesce(s.name, 'Personal del local')) ORDER BY p.created_at), '[]'::jsonb)
      FROM public.payments p
      LEFT JOIN public.tables t ON t.id = p.table_id
      LEFT JOIN LATERAL (SELECT su.name FROM public.staff_users su
                          WHERE su.auth_user_id::text = p.provider_payload ->> 'cobrado_por' AND su.tenant_id = p.tenant_id
                          ORDER BY su.created_at LIMIT 1) s ON true
     WHERE p.branch_id = _branch_id AND p.boleta_estado = 'pendiente'
       AND p.status IN ('approved', 'partially_refunded')
       AND p.created_at > now() - interval '7 days');
END;
$$;
REVOKE ALL ON FUNCTION public.boletas_pendientes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.boletas_pendientes(uuid) TO authenticated;

-- Las del propio mozo (o de quien cobró), de las últimas 24 horas
CREATE OR REPLACE FUNCTION public.mis_boletas_pendientes()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'creado_at', p.created_at, 'mesa', t.number, 'monto', p.amount, 'metodo', p.method)
         ORDER BY p.created_at), '[]'::jsonb)
    FROM public.payments p
    LEFT JOIN public.tables t ON t.id = p.table_id
   WHERE (SELECT auth.uid()) IS NOT NULL
     AND p.provider_payload ->> 'cobrado_por' = (SELECT auth.uid())::text
     AND p.boleta_estado = 'pendiente'
     AND p.status IN ('approved', 'partially_refunded')
     AND p.created_at > now() - interval '24 hours'
     AND EXISTS (SELECT 1 FROM public.tenant_members tm
                  WHERE tm.user_id = (SELECT auth.uid()) AND tm.tenant_id = p.tenant_id AND tm.is_active)
$$;
REVOKE ALL ON FUNCTION public.mis_boletas_pendientes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mis_boletas_pendientes() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. La caja: la transferencia es un canal propio (no se cuenta en la caja; se revisa en la cartola)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._conciliar_dia(_branch_id uuid, _dia date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  corte time;
  desde timestamptz;
  hasta timestamptz;
  canales jsonb;
  devoluciones jsonb;
  automaticos jsonb;
  propinas jsonb;
  avisos jsonb;
  app_cobrado integer; app_devuelto integer;
  ef_cobrado integer; ef_devuelto integer;
  pos_cobrado integer; pos_devuelto integer;
  tr_cobrado integer; tr_devuelto integer;
  n_pagos integer;
  propina_total integer;
BEGIN
  SELECT corte_dia INTO corte FROM public.branches WHERE id = _branch_id;
  desde := (_dia + corte) AT TIME ZONE 'America/Santiago';
  hasta := desde + interval '1 day';

  -- Lo cobrado en el día, por canal (lo reembolsado se resta aparte, el día en que se devuelve).
  SELECT count(*),
         coalesce(sum(amount + tip_amount) FILTER (WHERE provider <> 'local'), 0),
         coalesce(sum(amount + tip_amount) FILTER (WHERE provider = 'local' AND method = 'cash'), 0),
         coalesce(sum(amount + tip_amount) FILTER (WHERE provider = 'local' AND method = 'pos'), 0),
         coalesce(sum(amount + tip_amount) FILTER (WHERE provider = 'local' AND method = 'transfer'), 0),
         coalesce(sum(tip_amount), 0),
         jsonb_build_object(
           'app', jsonb_build_object('pagos', count(*) FILTER (WHERE provider <> 'local'),
                                     'consumo', coalesce(sum(amount) FILTER (WHERE provider <> 'local'), 0),
                                     'propina', coalesce(sum(tip_amount) FILTER (WHERE provider <> 'local'), 0)),
           'efectivo', jsonb_build_object('pagos', count(*) FILTER (WHERE provider = 'local' AND method = 'cash'),
                                     'consumo', coalesce(sum(amount) FILTER (WHERE provider = 'local' AND method = 'cash'), 0),
                                     'propina', coalesce(sum(tip_amount) FILTER (WHERE provider = 'local' AND method = 'cash'), 0)),
           'pos', jsonb_build_object('pagos', count(*) FILTER (WHERE provider = 'local' AND method = 'pos'),
                                     'consumo', coalesce(sum(amount) FILTER (WHERE provider = 'local' AND method = 'pos'), 0),
                                     'propina', coalesce(sum(tip_amount) FILTER (WHERE provider = 'local' AND method = 'pos'), 0)),
           'transferencia', jsonb_build_object('pagos', count(*) FILTER (WHERE provider = 'local' AND method = 'transfer'),
                                     'consumo', coalesce(sum(amount) FILTER (WHERE provider = 'local' AND method = 'transfer'), 0),
                                     'propina', coalesce(sum(tip_amount) FILTER (WHERE provider = 'local' AND method = 'transfer'), 0)))
    INTO n_pagos, app_cobrado, ef_cobrado, pos_cobrado, tr_cobrado, propina_total, canales
    FROM public.payments
   WHERE branch_id = _branch_id AND dia_negocio = _dia
     AND status IN ('approved', 'partially_refunded', 'refunded');

  -- Reembolsos hechos en el día, según por dónde se devolvió la plata.
  SELECT coalesce(sum(r.amount) FILTER (WHERE p.provider <> 'local'), 0),
         coalesce(sum(r.amount) FILTER (WHERE p.provider = 'local' AND p.method = 'cash'), 0),
         coalesce(sum(r.amount) FILTER (WHERE p.provider = 'local' AND p.method = 'pos'), 0),
         coalesce(sum(r.amount) FILTER (WHERE p.provider = 'local' AND p.method = 'transfer'), 0),
         jsonb_build_object('cantidad', count(*), 'monto', coalesce(sum(r.amount), 0))
    INTO app_devuelto, ef_devuelto, pos_devuelto, tr_devuelto, devoluciones
    FROM public.refunds r JOIN public.payments p ON p.id = r.payment_id
   WHERE p.branch_id = _branch_id AND r.status = 'completed' AND r.dia_negocio = _dia;

  -- Cobros que la app devolvió sola (el precio no calzaba, otro ya había pagado lo mismo...).
  SELECT jsonb_build_object('cantidad', count(*), 'monto', coalesce(sum(i.monto + i.propina), 0))
    INTO automaticos
    FROM public.intentos_pago i JOIN public.cotizaciones c ON c.id = i.cotizacion_id
   WHERE c.branch_id = _branch_id AND i.estado = 'reembolsado'
     AND i.resuelto_at >= desde AND i.resuelto_at < hasta;

  -- Propinas por mozo (Tablio informa; la plata es de los trabajadores). Netas de lo reembolsado.
  SELECT coalesce(jsonb_agg(to_jsonb(x) - 'propina_efectivo_raw'
                              || jsonb_build_object('propina_efectivo', coalesce(x.propina_efectivo_raw, 0))
                            ORDER BY x.propina DESC, x.nombre), '[]'::jsonb) INTO propinas
    FROM (
      SELECT coalesce(s.name, 'Sin mozo asignado') AS nombre,
             p.staff_id,
             count(*) AS pagos,
             sum(p.amount) AS ventas,
             sum(greatest(0, p.tip_amount - greatest(0, p.refunded_amount - p.amount))) AS propina,
             sum(greatest(0, p.tip_amount - greatest(0, p.refunded_amount - p.amount)))
               FILTER (WHERE p.provider = 'local' AND p.method = 'cash') AS propina_efectivo_raw
        FROM public.payments p LEFT JOIN public.staff_users s ON s.id = p.staff_id
       WHERE p.branch_id = _branch_id AND p.dia_negocio = _dia
         AND p.status IN ('approved', 'partially_refunded', 'refunded')
       GROUP BY s.name, p.staff_id
    ) x;

  -- Lo que conviene revisar antes de cerrar.
  avisos := jsonb_build_object(
    'por_cobrar', (SELECT jsonb_build_object('cantidad', count(*), 'monto', coalesce(sum(total_amount), 0))
                     FROM public.orders
                    WHERE branch_id = _branch_id AND created_at >= desde AND created_at < hasta
                      AND coalesce(payment_status, 'unpaid') = 'unpaid' AND status <> 'cancelled'),
    'sin_confirmar', (SELECT jsonb_build_object('cantidad', count(*), 'monto', coalesce(sum(i.monto + i.propina), 0))
                        FROM public.intentos_pago i JOIN public.cotizaciones c ON c.id = i.cotizacion_id
                       WHERE c.branch_id = _branch_id AND i.estado = 'reservado'
                         AND i.created_at >= desde AND i.created_at < hasta
                         AND i.created_at < now() - interval '15 minutes'),
    'con_alerta', (SELECT count(*) FROM public.orders
                    WHERE branch_id = _branch_id AND created_at >= desde AND created_at < hasta
                      AND alerta IS NOT NULL),
    'mesas_abiertas', (SELECT count(*) FROM public.table_sessions
                        WHERE branch_id = _branch_id AND is_active),
    'sin_boleta', (SELECT jsonb_build_object('cantidad', count(*), 'monto', coalesce(sum(amount), 0))
                     FROM public.payments
                    WHERE branch_id = _branch_id AND dia_negocio = _dia AND boleta_estado = 'pendiente'
                      AND status IN ('approved', 'partially_refunded'))
  );

  RETURN jsonb_build_object(
    'dia', _dia, 'desde', desde, 'hasta', hasta,
    'pagos', n_pagos,
    'canales', canales,
    'app', jsonb_build_object('cobrado', app_cobrado, 'devuelto', app_devuelto, 'esperado', app_cobrado - app_devuelto),
    'efectivo', jsonb_build_object('cobrado', ef_cobrado, 'devuelto', ef_devuelto, 'esperado', ef_cobrado - ef_devuelto),
    'pos', jsonb_build_object('cobrado', pos_cobrado, 'devuelto', pos_devuelto, 'esperado', pos_cobrado - pos_devuelto),
    'transferencia', jsonb_build_object('cobrado', tr_cobrado, 'devuelto', tr_devuelto, 'esperado', tr_cobrado - tr_devuelto),
    'reembolsos', devoluciones,
    'automaticos', automaticos,
    'propina_total', propina_total,
    'propinas', propinas,
    'avisos', avisos,
    'total_neto', (app_cobrado - app_devuelto) + (ef_cobrado - ef_devuelto) + (pos_cobrado - pos_devuelto)
                  + (tr_cobrado - tr_devuelto)
  );
END;
$$;
REVOKE ALL ON FUNCTION public._conciliar_dia(uuid, date) FROM PUBLIC, anon, authenticated;

-- Reportes: la transferencia como canal
DO $$
DECLARE
  def text;
BEGIN
  SELECT pg_get_functiondef('public.reporte_local(uuid, date, date)'::regprocedure) INTO def;
  IF position('''transferencia''' IN def) = 0 THEN
    def := replace(def,
      $r$'pos', coalesce(sum(p.amount) FILTER (WHERE p.provider = 'local' AND p.method = 'pos'), 0))$r$,
      $r$'pos', coalesce(sum(p.amount) FILTER (WHERE p.provider = 'local' AND p.method = 'pos'), 0),
        'transferencia', coalesce(sum(p.amount) FILTER (WHERE p.provider = 'local' AND p.method = 'transfer'), 0))$r$);
    IF position('''transferencia''' IN def) = 0 THEN
      RAISE EXCEPTION 'No se pudo agregar la transferencia a los reportes';
    END IF;
    EXECUTE def;
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. El demo: los cobros de ejemplo de días anteriores ya tienen su boleta entregada (antes de cerrar el día)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  def text;
BEGIN
  SELECT pg_get_functiondef('public._sembrar_historia_demo(integer)'::regprocedure) INTO def;
  IF position('boleta_estado' IN def) = 0 THEN
    def := replace(def, '    r := public._conciliar_dia(sucursal, d);',
                   '    UPDATE public.payments SET boleta_estado = ''entregada'', boleta_marcada_at = created_at
     WHERE branch_id = sucursal AND dia_negocio = d AND boleta_estado = ''pendiente'';
    r := public._conciliar_dia(sucursal, d);');
    IF position('boleta_estado' IN def) = 0 THEN
      RAISE EXCEPTION 'No se pudieron marcar las boletas de la historia del demo';
    END IF;
    EXECUTE def;
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. La auditoría de la operación revisa que la boleta sea coherente
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  def text;
BEGIN
  SELECT pg_get_functiondef('public.auditoria_operacion()'::regprocedure) INTO def;
  IF position('boleta_sin_motivo' IN def) = 0 THEN
    def := replace(def, '  -- Sellos ───',
'  -- Boletas del local ──────────────────────────────────────────────────────
  -- Solo efectivo y transferencia cobrados en el local llevan boleta; la entregada tiene fecha y quién.
  RETURN QUERY
  SELECT ''boleta_sin_motivo'', p.id::text, ''El pago tiene boleta del local pero no es efectivo ni transferencia''
    FROM public.payments p
   WHERE p.boleta_estado IS NOT NULL AND NOT (p.provider = ''local'' AND p.method IN (''cash'', ''transfer''));

  RETURN QUERY
  SELECT ''boleta_incompleta'', p.id::text, ''La boleta figura entregada pero no dice cuándo''
    FROM public.payments p
   WHERE p.boleta_estado = ''entregada'' AND p.boleta_marcada_at IS NULL;

  -- Sellos ───');
    IF position('boleta_sin_motivo' IN def) = 0 THEN
      RAISE EXCEPTION 'No se pudo agregar la revisión de boletas a la auditoría';
    END IF;
    EXECUTE def;
  END IF;
END;
$$;
