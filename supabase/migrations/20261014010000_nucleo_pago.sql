-- Fase 2.A — Núcleo del pago: cotización con precio congelado → intento reservado antes de cobrar →
-- confirmación atómica (confirmar_pago). Reglas 2, 3 y 4 del brief:
--  · el precio sale de la base y se congela por 10 minutos antes de pagar;
--  · el intento de pago (con su clave única) se reserva ANTES de cobrar: el mismo pago nunca se
--    cobra ni se produce dos veces;
--  · pedido, pago, mesa y sesión se escriben juntos o no se escribe nada.
-- Pensado para confirmación asíncrona: confirmar_pago es idempotente, así sirve igual para la
-- confirmación inmediata (simulador) que para el aviso de una pasarela real (fase 4).
-- Políticas aprobadas por el fundador: pago tardío con el monto correcto → se respeta;
-- monto que no calza → reembolso automático. Producto agotado mientras alguien paga → se respeta el
-- pedido y se avisa a cocina.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Columnas nuevas: el mozo de la mesa en cada pago (propinas por mozo, brief 7) y alerta para cocina.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS staff_id uuid REFERENCES public.staff_users(id) ON DELETE SET NULL;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS intento_id uuid;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS alerta text;
CREATE INDEX IF NOT EXISTS payments_staff_idx ON public.payments (staff_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Cotizaciones: el precio congelado de lo que se va a pagar.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cotizaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  table_id uuid NOT NULL REFERENCES public.tables(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('carrito', 'pedidos')),
  items jsonb,                          -- carrito: líneas con precio (de calcular_precios)
  order_ids uuid[],                     -- pedidos: los pedidos por pagar
  notas text,
  subtotal integer NOT NULL CHECK (subtotal > 0),
  expira_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  estado text NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'pagada')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cotizaciones_usuario_idx ON public.cotizaciones (user_id, created_at DESC);
ALTER TABLE public.cotizaciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cotizaciones FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.cotizaciones FROM authenticated;
CREATE POLICY cotizaciones_propias ON public.cotizaciones FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY cotizaciones_lectura_caja ON public.cotizaciones FOR SELECT TO authenticated
  USING (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager', 'cashier']) OR public.is_platform_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Intentos de pago: se reservan antes de cobrar, con una clave única por intento.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.intentos_pago (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  cotizacion_id uuid NOT NULL REFERENCES public.cotizaciones(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  metodo text NOT NULL,
  monto integer NOT NULL CHECK (monto > 0),
  propina integer NOT NULL DEFAULT 0 CHECK (propina >= 0),
  estado text NOT NULL DEFAULT 'reservado'
    CHECK (estado IN ('reservado', 'aprobado', 'rechazado', 'reembolsado')),
  motivo text,                          -- por qué se rechazó o se reembolsó
  proveedor text,
  referencia_externa text,
  payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resuelto_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS intentos_pago_clave_uidx ON public.intentos_pago (idempotency_key);
CREATE INDEX IF NOT EXISTS intentos_pago_cotizacion_idx ON public.intentos_pago (cotizacion_id);
ALTER TABLE public.intentos_pago ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.intentos_pago FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.intentos_pago FROM authenticated;
CREATE POLICY intentos_pago_propios ON public.intentos_pago FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY intentos_pago_lectura_caja ON public.intentos_pago FOR SELECT TO authenticated
  USING (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager', 'cashier']) OR public.is_platform_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Cotizar. La usa el servidor (process-payment) con la identidad ya verificada.
--    carrito: precios de calcular_precios; pedidos: los pedidos por pagar de la mesa
--    (por defecto, solo los del propio comensal: cada persona paga lo suyo, regla 8).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crear_cotizacion(
  _user_id uuid,
  _qr_token text,
  _items jsonb DEFAULT NULL,
  _order_ids uuid[] DEFAULT NULL,
  _notas text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  mesa record;
  sesion uuid;
  precios jsonb;
  pedidos uuid[];
  subtotal integer;
  cot uuid;
  expira timestamptz;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Abre la carta desde el QR de tu mesa para pagar.' USING ERRCODE = '42501';
  END IF;
  SELECT t.id, t.tenant_id, t.branch_id INTO mesa
    FROM public.tables t JOIN public.tenants te ON te.id = t.tenant_id AND te.is_active
   WHERE t.qr_token = _qr_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'QR de mesa no válido' USING ERRCODE = 'P0001';
  END IF;

  IF _items IS NOT NULL AND jsonb_typeof(_items) = 'array' AND jsonb_array_length(_items) > 0 THEN
    precios := public.calcular_precios(mesa.tenant_id, mesa.branch_id, _items);
    subtotal := (precios ->> 'total')::integer;
    INSERT INTO public.cotizaciones (tenant_id, branch_id, table_id, user_id, tipo, items, notas, subtotal)
    VALUES (mesa.tenant_id, mesa.branch_id, mesa.id, _user_id, 'carrito', precios -> 'items',
            left(nullif(btrim(coalesce(_notas, '')), ''), 300), subtotal)
    RETURNING id, expira_at INTO cot, expira;
  ELSE
    SELECT id INTO sesion FROM public.table_sessions WHERE table_id = mesa.id AND is_active;
    IF sesion IS NULL THEN
      RAISE EXCEPTION 'No hay nada por pagar en esta mesa' USING ERRCODE = 'P0001';
    END IF;
    SELECT array_agg(o.id ORDER BY o.confirmed_at), coalesce(sum(o.total_amount), 0)
      INTO pedidos, subtotal
      FROM public.orders o
     WHERE o.session_id = sesion AND o.status <> 'cancelled'
       AND coalesce(o.payment_status, 'unpaid') NOT IN ('paid', 'refunded')
       AND (CASE WHEN _order_ids IS NOT NULL AND cardinality(_order_ids) > 0
                 THEN o.id = ANY (_order_ids)
                 ELSE o.user_id = _user_id OR o.user_id IS NULL END);
    IF coalesce(subtotal, 0) <= 0 THEN
      RAISE EXCEPTION 'No tienes nada pendiente de pago 🎉' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO public.cotizaciones (tenant_id, branch_id, table_id, user_id, tipo, order_ids, subtotal)
    VALUES (mesa.tenant_id, mesa.branch_id, mesa.id, _user_id, 'pedidos', pedidos, subtotal)
    RETURNING id, expira_at INTO cot, expira;
  END IF;

  RETURN jsonb_build_object('id', cot, 'subtotal', subtotal, 'expira_at', expira, 'items', precios -> 'items');
END;
$$;
REVOKE ALL ON FUNCTION public.crear_cotizacion(uuid, text, jsonb, uuid[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crear_cotizacion(uuid, text, jsonb, uuid[], text) TO service_role;

-- El comensal pide su cotización (muestra el precio congelado antes de pagar).
CREATE OR REPLACE FUNCTION public.cotizar(_qr_token text, _items jsonb DEFAULT NULL, _order_ids uuid[] DEFAULT NULL, _notas text DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.crear_cotizacion(auth.uid(), _qr_token, _items, _order_ids, _notas)
$$;
REVOKE ALL ON FUNCTION public.cotizar(text, jsonb, uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cotizar(text, jsonb, uuid[], text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Reservar el intento ANTES de cobrar. Si la clave ya existe, devuelve ese intento
--    (el servidor responde lo mismo de antes y no cobra otra vez).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reservar_intento_pago(
  _cotizacion_id uuid,
  _user_id uuid,
  _idempotency_key text,
  _metodo text,
  _propina integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cot record;
  previo record;
  intento uuid;
  propina integer := greatest(coalesce(_propina, 0), 0);
BEGIN
  IF _idempotency_key IS NULL OR char_length(_idempotency_key) NOT BETWEEN 8 AND 100 THEN
    RAISE EXCEPTION 'Falta la clave del pago' USING ERRCODE = '22023';
  END IF;
  IF _metodo NOT IN ('card', 'apple_pay', 'google_pay') THEN
    RAISE EXCEPTION 'Medio de pago no válido' USING ERRCODE = '22023';
  END IF;

  -- La misma clave: el mismo intento (pago repetido, doble toque, mala conexión).
  SELECT * INTO previo FROM public.intentos_pago WHERE idempotency_key = _idempotency_key;
  IF FOUND THEN
    IF previo.user_id <> _user_id OR previo.cotizacion_id <> _cotizacion_id THEN
      RAISE EXCEPTION 'Esa clave de pago ya se usó' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('id', previo.id, 'estado', previo.estado, 'repetido', true,
                              'monto', previo.monto, 'propina', previo.propina, 'payment_id', previo.payment_id);
  END IF;

  SELECT * INTO cot FROM public.cotizaciones WHERE id = _cotizacion_id FOR UPDATE;
  IF NOT FOUND OR cot.user_id <> _user_id THEN
    RAISE EXCEPTION 'No encontramos tu cotización' USING ERRCODE = 'P0002';
  END IF;
  IF cot.estado = 'pagada' THEN
    RAISE EXCEPTION 'Este pedido ya está pagado' USING ERRCODE = 'P0001';
  END IF;
  IF cot.expira_at < now() THEN
    RAISE EXCEPTION 'El precio venció. Vuelve a confirmar tu pedido.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.intentos_pago WHERE cotizacion_id = _cotizacion_id AND estado = 'reservado') THEN
    RAISE EXCEPTION 'Ya hay un pago en curso para este pedido' USING ERRCODE = 'P0001';
  END IF;
  IF propina > cot.subtotal * 2 THEN
    RAISE EXCEPTION 'La propina no es válida' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.intentos_pago (tenant_id, cotizacion_id, user_id, idempotency_key, metodo, monto, propina)
  VALUES (cot.tenant_id, cot.id, _user_id, _idempotency_key, _metodo, cot.subtotal, propina)
  RETURNING id INTO intento;

  RETURN jsonb_build_object('id', intento, 'estado', 'reservado', 'repetido', false,
                            'monto', cot.subtotal, 'propina', propina);
END;
$$;
REVOKE ALL ON FUNCTION public.reservar_intento_pago(uuid, uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reservar_intento_pago(uuid, uuid, text, text, integer) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Confirmar el pago: todo junto o nada. Idempotente (se puede llamar dos veces sin efecto doble).
--    _monto_cobrado: lo que el proveedor dice que cobró (sin propina).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.confirmar_pago(
  _intento_id uuid,
  _aprobado boolean,
  _monto_cobrado integer,
  _proveedor text,
  _referencia text,
  _payload jsonb DEFAULT '{}'::jsonb,
  _correo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  it record;
  cot record;
  mesa record;
  sesion uuid;
  pedido uuid;
  numero integer;
  pago uuid;
  ya_pagados integer;
  agotados text;
  ahora timestamptz := now();
BEGIN
  SELECT * INTO it FROM public.intentos_pago WHERE id = _intento_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Intento de pago no encontrado' USING ERRCODE = 'P0002';
  END IF;

  -- Ya resuelto: devuelve lo mismo (la pasarela puede avisar dos veces).
  IF it.estado <> 'reservado' THEN
    RETURN jsonb_build_object('estado', it.estado, 'payment_id', it.payment_id, 'nuevo', false,
      'order_id', (SELECT order_id FROM public.payments WHERE id = it.payment_id),
      'order_number', (SELECT o.order_number FROM public.payments p JOIN public.orders o ON o.id = p.order_id WHERE p.id = it.payment_id),
      'motivo', it.motivo);
  END IF;

  IF NOT _aprobado THEN
    UPDATE public.intentos_pago SET estado = 'rechazado', motivo = 'Pago rechazado por el medio de pago',
           proveedor = _proveedor, referencia_externa = _referencia, resuelto_at = ahora
     WHERE id = it.id;
    RETURN jsonb_build_object('estado', 'rechazado', 'nuevo', true, 'motivo', 'Pago rechazado');
  END IF;

  SELECT * INTO cot FROM public.cotizaciones WHERE id = it.cotizacion_id FOR UPDATE;
  SELECT t.id, t.tenant_id, t.branch_id, t.assigned_waiter_id INTO mesa FROM public.tables t WHERE t.id = cot.table_id FOR UPDATE;

  -- Monto que no calza (aviso tardío o cobro distinto) o algo ya pagado por otra persona:
  -- se devuelve la plata automáticamente (política aprobada por el fundador).
  IF cot.estado = 'pagada' OR coalesce(_monto_cobrado, 0) <> it.monto THEN
    UPDATE public.intentos_pago
       SET estado = 'reembolsado', proveedor = _proveedor, referencia_externa = _referencia, resuelto_at = ahora,
           motivo = CASE WHEN cot.estado = 'pagada' THEN 'Ya estaba pagado: se devuelve automáticamente'
                         ELSE 'El monto cobrado no coincide con el precio: se devuelve automáticamente' END
     WHERE id = it.id;
    RETURN jsonb_build_object('estado', 'reembolsado', 'nuevo', true,
                              'motivo', (SELECT motivo FROM public.intentos_pago WHERE id = it.id),
                              'reembolsar', _monto_cobrado + it.propina);
  END IF;

  IF cot.tipo = 'pedidos' THEN
    -- Dos personas pagando lo mismo: si alguno de esos pedidos ya se pagó, se devuelve este pago.
    PERFORM 1 FROM public.orders WHERE id = ANY (cot.order_ids) FOR UPDATE;
    SELECT count(*) INTO ya_pagados FROM public.orders
     WHERE id = ANY (cot.order_ids) AND coalesce(payment_status, 'unpaid') IN ('paid', 'refunded');
    IF ya_pagados > 0 THEN
      UPDATE public.intentos_pago
         SET estado = 'reembolsado', proveedor = _proveedor, referencia_externa = _referencia, resuelto_at = ahora,
             motivo = 'Otra persona de la mesa ya pagó esto: se devuelve automáticamente'
       WHERE id = it.id;
      RETURN jsonb_build_object('estado', 'reembolsado', 'nuevo', true,
                                'motivo', 'Otra persona de la mesa ya pagó esto: se devuelve automáticamente',
                                'reembolsar', _monto_cobrado + it.propina);
    END IF;
  END IF;

  -- Pago tardío con el monto correcto: se respeta el precio congelado (aunque la cotización haya vencido).
  INSERT INTO public.table_sessions (tenant_id, table_id, branch_id, opened_at, is_active, total_amount)
  VALUES (mesa.tenant_id, mesa.id, mesa.branch_id, ahora, true, 0)
  ON CONFLICT (table_id) WHERE is_active = true DO NOTHING;
  SELECT id INTO sesion FROM public.table_sessions WHERE table_id = mesa.id AND is_active;

  IF cot.tipo = 'carrito' THEN
    numero := public.siguiente_numero_pedido(mesa.branch_id);
    -- Producto agotado mientras se pagaba: se respeta el pedido y se avisa a cocina.
    SELECT string_agg(DISTINCT mi.name, ', ') INTO agotados
      FROM jsonb_array_elements(cot.items) l
      JOIN public.menu_items mi ON mi.id = (l ->> 'menu_item_id')::uuid
     WHERE coalesce(mi.status, 'available') <> 'available';

    INSERT INTO public.orders (tenant_id, branch_id, table_id, session_id, order_number, status, source,
                               total_amount, notes, confirmed_at, payment_status, paid_at, user_id, alerta)
    VALUES (mesa.tenant_id, mesa.branch_id, mesa.id, sesion, numero, 'confirmed', 'customer_qr',
            cot.subtotal, cot.notas, ahora, 'paid', ahora, it.user_id,
            CASE WHEN agotados IS NOT NULL THEN 'Pagado con producto agotado: ' || agotados END)
    RETURNING id INTO pedido;

    INSERT INTO public.order_items (order_id, tenant_id, menu_item_id, menu_item_name, unit_price, quantity,
                                    subtotal, selected_modifiers, item_notes)
    SELECT pedido, mesa.tenant_id, (l ->> 'menu_item_id')::uuid, l ->> 'menu_item_name',
           (l ->> 'unit_price')::integer, (l ->> 'quantity')::integer, (l ->> 'subtotal')::integer,
           l -> 'selected_modifiers', l ->> 'item_notes'
      FROM jsonb_array_elements(cot.items) l;

    -- Popularidad de cada plato
    UPDATE public.menu_items mi SET total_orders = coalesce(mi.total_orders, 0) + x.cantidad
      FROM (SELECT (l ->> 'menu_item_id')::uuid AS id, sum((l ->> 'quantity')::integer) AS cantidad
              FROM jsonb_array_elements(cot.items) l GROUP BY 1) x
     WHERE mi.id = x.id;

    INSERT INTO public.order_events (tenant_id, order_id, estado_anterior, estado_nuevo, productos, actor_user_id, actor_rol, motivo)
    VALUES (mesa.tenant_id, pedido, NULL, 'confirmed', jsonb_array_length(cot.items), it.user_id, 'comensal',
            coalesce('pagado con la app' || CASE WHEN agotados IS NOT NULL THEN ' · agotado: ' || agotados END, 'pagado con la app'));
  ELSE
    UPDATE public.orders SET payment_status = 'paid', paid_at = ahora WHERE id = ANY (cot.order_ids);
  END IF;

  INSERT INTO public.payments (tenant_id, branch_id, session_id, table_id, order_id, amount, tip_amount, method,
                               wallet, status, provider, external_reference, provider_payload, customer_email,
                               idempotency_key, staff_id, intento_id, user_id)
  VALUES (mesa.tenant_id, mesa.branch_id, sesion, mesa.id,
          coalesce(pedido, cot.order_ids[1]), it.monto, it.propina, it.metodo,
          CASE WHEN it.metodo IN ('apple_pay', 'google_pay') THEN it.metodo END,
          'approved', _proveedor, _referencia, coalesce(_payload, '{}'::jsonb), nullif(lower(_correo), ''),
          it.idempotency_key, mesa.assigned_waiter_id, it.id, it.user_id)
  RETURNING id INTO pago;

  UPDATE public.table_sessions
     SET paid_amount = coalesce(paid_amount, 0) + it.monto,
         tip_amount = coalesce(tip_amount, 0) + it.propina
   WHERE id = sesion;
  UPDATE public.tables SET status = CASE WHEN status = 'free' THEN 'occupied' ELSE status END WHERE id = mesa.id;
  UPDATE public.cotizaciones SET estado = 'pagada' WHERE id = cot.id;
  UPDATE public.intentos_pago SET estado = 'aprobado', payment_id = pago, proveedor = _proveedor,
         referencia_externa = _referencia, resuelto_at = ahora
   WHERE id = it.id;

  RETURN jsonb_build_object('estado', 'aprobado', 'nuevo', true, 'payment_id', pago,
                            'order_id', coalesce(pedido, cot.order_ids[1]),
                            'order_number', (SELECT order_number FROM public.orders WHERE id = pedido),
                            'session_id', sesion);
END;
$$;
REVOKE ALL ON FUNCTION public.confirmar_pago(uuid, boolean, integer, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirmar_pago(uuid, boolean, integer, text, text, jsonb, text) TO service_role;

-- La cocina ve la alerta de producto agotado; el resto de la operación sigue igual.
-- (orders.alerta la escribe solo confirmar_pago; nadie escribe orders desde el navegador.)

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. El reinicio del demo también borra cotizaciones e intentos del demo.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reiniciar_demo()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  demo constant uuid := '651c363f-0084-50af-9873-be98cfeaaf47';
  pedidos integer;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Solo un superadmin puede reiniciar el demo' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = demo AND slug = 'demo-tablio') THEN
    RAISE EXCEPTION 'No existe el local de demo en esta base';
  END IF;

  SELECT count(*) INTO pedidos FROM public.orders WHERE tenant_id = demo;

  DELETE FROM public.refunds WHERE tenant_id = demo;
  DELETE FROM public.loyalty_rewards WHERE tenant_id = demo;
  DELETE FROM public.loyalty_customers WHERE tenant_id = demo;
  DELETE FROM public.intentos_pago WHERE tenant_id = demo;
  DELETE FROM public.cotizaciones WHERE tenant_id = demo;
  DELETE FROM public.payments WHERE tenant_id = demo;
  DELETE FROM public.payment_settlements WHERE tenant_id = demo;
  DELETE FROM public.order_items WHERE tenant_id = demo;
  DELETE FROM public.orders WHERE tenant_id = demo;
  DELETE FROM public.bill_requests WHERE tenant_id = demo;
  DELETE FROM public.waiter_calls WHERE tenant_id = demo;
  DELETE FROM public.table_events WHERE tenant_id = demo;
  DELETE FROM public.table_sessions WHERE tenant_id = demo;
  DELETE FROM public.staff_invitations WHERE tenant_id = demo;
  DELETE FROM public.support_tickets WHERE tenant_id = demo;
  DELETE FROM public.contadores_pedidos WHERE branch_id IN (SELECT id FROM public.branches WHERE tenant_id = demo);
  UPDATE public.tables SET status = 'free', assigned_waiter_id = NULL WHERE tenant_id = demo;
  UPDATE public.menu_items SET status = 'available', total_orders = 0 WHERE tenant_id = demo;

  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, metadata)
  VALUES (demo, auth.uid(), 'demo_reiniciado', 'tenant', jsonb_build_object('pedidos_borrados', pedidos));

  RETURN jsonb_build_object('pedidos_borrados', pedidos);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. La auditoría automática también vigila las tablas nuevas de la plata.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auditoria_seguridad()
RETURNS TABLE (tipo text, objeto text, detalle text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Lectura pública a propósito: la carta y la marca del local se ven sin iniciar sesión,
  -- y los planes y funciones globales son la oferta pública de Tablio.
  publicas constant text[] := ARRAY['plans', 'restaurants', 'branches', 'menus', 'categories', 'menu_items',
                                    'modifier_groups', 'modifiers', 'feature_flags', 'tenants'];
  -- Funciones que se llaman sin sesión a propósito: ver la mesa del QR y ver una invitación de mozo.
  -- rango_estado es una tabla de equivalencias sin datos.
  funciones_publicas constant text[] := ARRAY['ver_mesa', 'ver_invitacion_mozo', 'rango_estado'];
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'No tienes permiso para este cambio' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT 'tabla_sin_rls', c.relname::text, 'La tabla no tiene reglas de acceso activadas'
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;

  RETURN QUERY
  SELECT 'regla_para_todos', p.tablename || '.' || p.policyname, 'Regla con USING/CHECK (true) en ' || p.cmd
    FROM pg_policies p
   WHERE p.schemaname = 'public'
     AND (p.qual = 'true' OR p.with_check = 'true')
     AND NOT (p.cmd = 'SELECT' AND p.tablename = ANY (publicas));

  RETURN QUERY
  SELECT 'regla_escritura_publica', p.tablename || '.' || p.policyname, 'Regla de escritura para el rol public'
    FROM pg_policies p
   WHERE p.schemaname = 'public' AND p.roles = '{public}' AND p.cmd <> 'SELECT';

  RETURN QUERY
  SELECT 'regla_antigua', p.tablename || '.' || p.policyname, 'Usa una función antigua (get_tenant_id, is_tenant_member, has_staff_role)'
    FROM pg_policies p
   WHERE p.schemaname = 'public'
     AND (coalesce(p.qual, '') || coalesce(p.with_check, '')) ~ 'get_tenant_id|is_tenant_member|has_staff_role|has_backoffice_role';

  RETURN QUERY
  SELECT 'escritura_sin_sesion', g.table_name::text, 'El rol anónimo tiene ' || string_agg(g.privilege_type, ', ')
    FROM information_schema.role_table_grants g
   WHERE g.grantee = 'anon' AND g.table_schema = 'public' AND g.privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
   GROUP BY g.table_name;

  RETURN QUERY
  SELECT 'definer_sin_search_path', p.proname::text, 'Función SECURITY DEFINER sin search_path fijo'
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prosecdef
     AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) cfg WHERE cfg LIKE 'search_path=%');

  RETURN QUERY
  SELECT 'funcion_sin_sesion', p.proname::text, 'Se puede llamar sin iniciar sesión'
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND has_function_privilege('anon', p.oid, 'EXECUTE')
     AND NOT (p.proname = ANY (funciones_publicas));

  RETURN QUERY
  SELECT 'dinero_escribible', g.table_name::text, 'El navegador puede escribir ' || string_agg(g.privilege_type, ', ')
    FROM information_schema.role_table_grants g
   WHERE g.grantee IN ('anon', 'authenticated') AND g.table_schema = 'public'
     AND g.table_name IN ('payments', 'refunds', 'payment_settlements', 'orders', 'order_items', 'order_events', 'table_events', 'audit_logs',
                          'cotizaciones', 'intentos_pago')
     AND g.privilege_type IN ('INSERT', 'UPDATE')
   GROUP BY g.table_name;
END;
$$;
