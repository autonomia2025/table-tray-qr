-- Fase 2.B — "Pagar al mozo" y "Agregar a mi cuenta" (decisión del fundador del 1 de octubre).
-- Lo principal sigue siendo pagar en la app; esto es el respaldo para quien paga "a la antigua":
--  · "Pagar al mozo" (efectivo o POS, en cualquier local): el pedido queda por cobrar. En prepago
--    no pasa a cocina hasta que el mozo cobra y lo registra (regla 1 del brief).
--  · "Agregar a mi cuenta" (solo locales con cuenta abierta): va directo a cocina y se paga al final,
--    en la app o con el mozo.
--  · El mozo (o la caja, el encargado, el dueño) registra el cobro: queda como pago, con quién cobró.

-- Cómo eligió pagar el comensal cada pedido.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS forma_pago text
  CHECK (forma_pago IS NULL OR forma_pago IN ('app', 'mozo', 'cuenta'));
UPDATE public.orders SET forma_pago = 'app' WHERE forma_pago IS NULL AND source = 'customer_qr' AND payment_status = 'paid';
UPDATE public.orders SET forma_pago = 'mozo' WHERE forma_pago IS NULL AND source = 'waiter';

-- Los pedidos pagados con la app quedan marcados como tales desde la confirmación.
CREATE OR REPLACE FUNCTION public.marcar_forma_pago_app()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.forma_pago IS NULL THEN
    NEW.forma_pago := CASE WHEN NEW.source = 'waiter' THEN 'mozo'
                           WHEN NEW.payment_status = 'paid' THEN 'app' END;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.marcar_forma_pago_app() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS marcar_forma_pago ON public.orders;
CREATE TRIGGER marcar_forma_pago BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.marcar_forma_pago_app();

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. El comensal pide sin pagar en la app: "Pagar al mozo" o "Agregar a mi cuenta".
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pedir_sin_pagar(_qr_token text, _items jsonb, _forma text, _notas text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  modo text;
  precios jsonb;
  numero integer;
  pedido uuid;
  pendientes integer;
BEGIN
  IF _forma NOT IN ('mozo', 'cuenta') THEN
    RAISE EXCEPTION 'Forma de pago no válida' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO c FROM public._comensal_en_mesa(_qr_token);
  SELECT payment_mode INTO modo FROM public.branches WHERE id = (c.mesa).branch_id;
  IF _forma = 'cuenta' AND coalesce(modo, 'prepaid') <> 'open_tab' THEN
    RAISE EXCEPTION 'En este local se paga al pedir: elige pagar ahora o pagarle al mozo' USING ERRCODE = 'P0001';
  END IF;

  -- Contra el abuso: pocos pedidos esperando cobro por persona.
  SELECT count(*) INTO pendientes FROM public.orders
   WHERE session_id = c.sesion AND user_id = auth.uid() AND status <> 'cancelled'
     AND coalesce(payment_status, 'unpaid') = 'unpaid' AND forma_pago = 'mozo';
  IF _forma = 'mozo' AND pendientes >= 3 THEN
    RAISE EXCEPTION 'Ya tienes pedidos esperando que el mozo te cobre' USING ERRCODE = 'P0001';
  END IF;

  precios := public.calcular_precios((c.mesa).tenant_id, (c.mesa).branch_id, _items);
  numero := public.siguiente_numero_pedido((c.mesa).branch_id);

  INSERT INTO public.orders (tenant_id, branch_id, table_id, session_id, order_number, status, source,
                             total_amount, notes, confirmed_at, payment_status, user_id, forma_pago)
  VALUES ((c.mesa).tenant_id, (c.mesa).branch_id, (c.mesa).id, c.sesion, numero, 'confirmed', 'customer_qr',
          (precios ->> 'total')::integer, left(nullif(btrim(coalesce(_notas, '')), ''), 300), now(),
          'unpaid', auth.uid(), _forma)
  RETURNING id INTO pedido;

  INSERT INTO public.order_items (order_id, tenant_id, menu_item_id, menu_item_name, unit_price, quantity,
                                  subtotal, selected_modifiers, item_notes)
  SELECT pedido, (c.mesa).tenant_id, (l ->> 'menu_item_id')::uuid, l ->> 'menu_item_name',
         (l ->> 'unit_price')::integer, (l ->> 'quantity')::integer, (l ->> 'subtotal')::integer,
         l -> 'selected_modifiers', l ->> 'item_notes'
    FROM jsonb_array_elements(precios -> 'items') l;

  INSERT INTO public.order_events (tenant_id, order_id, estado_anterior, estado_nuevo, productos, actor_user_id, actor_rol, motivo)
  VALUES ((c.mesa).tenant_id, pedido, NULL, 'confirmed', jsonb_array_length(precios -> 'items'), auth.uid(), 'comensal',
          CASE WHEN _forma = 'mozo' THEN 'pagará al mozo' ELSE 'agregado a su cuenta' END);

  UPDATE public.tables SET status = CASE WHEN status = 'free' THEN 'occupied' ELSE status END WHERE id = (c.mesa).id;

  RETURN jsonb_build_object('order_id', pedido, 'order_number', numero, 'total', (precios ->> 'total')::integer,
                            'forma', _forma, 'a_cocina', _forma = 'cuenta' OR coalesce(modo, 'prepaid') <> 'prepaid');
END;
$$;
REVOKE ALL ON FUNCTION public.pedir_sin_pagar(text, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pedir_sin_pagar(text, jsonb, text, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. El mozo registra el cobro (efectivo o POS). Queda como pago, con quién cobró.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.registrar_cobro_mozo(
  _order_ids uuid[],
  _metodo text,
  _propina integer DEFAULT 0,
  _recibido integer DEFAULT NULL
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
  pago uuid;
  ahora timestamptz := now();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Tienes que iniciar sesión' USING ERRCODE = '42501';
  END IF;
  IF _metodo NOT IN ('cash', 'pos') THEN
    RAISE EXCEPTION 'Medio de pago no válido' USING ERRCODE = '22023';
  END IF;
  IF _order_ids IS NULL OR cardinality(_order_ids) = 0 OR cardinality(_order_ids) > 50 THEN
    RAISE EXCEPTION 'Elige qué pedidos cobrar' USING ERRCODE = '22023';
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

  INSERT INTO public.payments (tenant_id, branch_id, session_id, table_id, order_id, amount, tip_amount, method,
                               status, provider, external_reference, provider_payload, staff_id)
  VALUES (primero.tenant_id, primero.branch_id, primero.session_id, primero.table_id, _order_ids[1], total, propina,
          _metodo, 'approved', 'local', NULL,
          jsonb_build_object('pedidos', to_jsonb(_order_ids), 'recibido', _recibido, 'cobrado_por', auth.uid(), 'rol', rol),
          mi_ficha)
  RETURNING id INTO pago;

  UPDATE public.table_sessions
     SET paid_amount = coalesce(paid_amount, 0) + total,
         tip_amount = coalesce(tip_amount, 0) + propina
   WHERE id = primero.session_id;

  INSERT INTO public.order_events (tenant_id, order_id, estado_anterior, estado_nuevo, productos, actor_user_id, actor_rol, motivo)
  SELECT primero.tenant_id, o.id, o.status, o.status, 0, auth.uid(), rol,
         'cobrado ' || CASE WHEN _metodo = 'cash' THEN 'en efectivo' ELSE 'con POS' END
    FROM public.orders o WHERE o.id = ANY (_order_ids);

  RETURN jsonb_build_object('payment_id', pago, 'total', total, 'propina', propina,
                            'vuelto', CASE WHEN _metodo = 'cash' AND _recibido IS NOT NULL THEN _recibido - total - propina END);
END;
$$;
REVOKE ALL ON FUNCTION public.registrar_cobro_mozo(uuid[], text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_cobro_mozo(uuid[], text, integer, integer) TO authenticated;

-- El pedido que toma el mozo a mano también queda como "pagar al mozo".
-- (crear_pedido_mozo inserta con source = 'waiter'; el disparador lo marca 'mozo'.)
