-- Fase 7.4b — Dividir un plato. Alguien de la mesa pide un plato para compartir y elige con quiénes lo divide.
-- Cada uno paga SU parte con la app (regla 8: cada persona paga lo suyo); el plato va a cocina recién cuando
-- todas las partes están pagadas (regla 1). Si alguien no paga, quien lo pidió puede pagar esa parte, o el
-- personal lo anula y lo ya pagado se devuelve desde la caja (aparece en Excepciones).
--
-- Plata: cada parte es un pago normal (cotización congelada → intento → confirmar_pago) que cubre el mismo
-- pedido; payments.parte_id dice qué parte paga. Las auditorías lo saben: un pedido dividido tiene varios
-- pagos y la suma de sus partes es exactamente el total.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Estructura
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_forma_pago_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_forma_pago_check
  CHECK (forma_pago IS NULL OR forma_pago IN ('app', 'mozo', 'cuenta', 'dividido'));

CREATE TABLE IF NOT EXISTS public.platos_divididos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.table_sessions(id) ON DELETE CASCADE,
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
  creado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  total integer NOT NULL CHECK (total > 0),
  estado text NOT NULL DEFAULT 'esperando' CHECK (estado IN ('esperando', 'pagado', 'anulado')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resuelto_at timestamptz
);
CREATE INDEX IF NOT EXISTS platos_divididos_sesion ON public.platos_divididos (session_id);
CREATE INDEX IF NOT EXISTS platos_divididos_tenant ON public.platos_divididos (tenant_id);
CREATE INDEX IF NOT EXISTS platos_divididos_creado_por ON public.platos_divididos (creado_por) WHERE creado_por IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.partes_plato (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plato_id uuid NOT NULL REFERENCES public.platos_divididos(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  comensal_id uuid REFERENCES public.comensales_mesa(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  monto integer NOT NULL CHECK (monto > 0),
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'pagada', 'rechazada')),
  payment_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  pagada_at timestamptz
);
CREATE INDEX IF NOT EXISTS partes_plato_plato ON public.partes_plato (plato_id);
CREATE INDEX IF NOT EXISTS partes_plato_usuario ON public.partes_plato (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS partes_plato_comensal ON public.partes_plato (comensal_id) WHERE comensal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS partes_plato_tenant ON public.partes_plato (tenant_id);

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS parte_id uuid REFERENCES public.partes_plato(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payments_parte_vigente ON public.payments (parte_id)
  WHERE parte_id IS NOT NULL AND status IN ('approved', 'partially_refunded');
ALTER TABLE public.partes_plato ADD CONSTRAINT partes_plato_pago_fk FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS partes_plato_pago ON public.partes_plato (payment_id) WHERE payment_id IS NOT NULL;

ALTER TABLE public.cotizaciones DROP CONSTRAINT IF EXISTS cotizaciones_tipo_check;
ALTER TABLE public.cotizaciones ADD CONSTRAINT cotizaciones_tipo_check CHECK (tipo IN ('carrito', 'pedidos', 'parte'));
ALTER TABLE public.cotizaciones ADD COLUMN IF NOT EXISTS parte_id uuid REFERENCES public.partes_plato(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS cotizaciones_parte ON public.cotizaciones (parte_id) WHERE parte_id IS NOT NULL;

ALTER TABLE public.platos_divididos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partes_plato ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platos_divididos, public.partes_plato FROM anon, authenticated;
-- El personal los ve (para saber por qué un pedido espera); el comensal, por mi_mesa_en_vivo.
GRANT SELECT ON public.platos_divididos, public.partes_plato TO authenticated;
CREATE POLICY platos_divididos_personal ON public.platos_divididos FOR SELECT TO authenticated
  USING (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager', 'cashier', 'waiter']));
CREATE POLICY partes_plato_personal ON public.partes_plato FOR SELECT TO authenticated
  USING (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager', 'cashier', 'waiter']));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Dividir un plato
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dividir_plato(_qr_token text, _item jsonb, _comensales uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  yo uuid;
  personas uuid[];
  precios jsonb;
  v_total integer;
  numero integer;
  pedido uuid;
  plato uuid;
  base integer;
  n integer;
  mi_parte uuid;
BEGIN
  SELECT * INTO c FROM public._comensal_en_mesa(_qr_token);
  PERFORM 1 FROM public.tables WHERE id = (c.mesa).id FOR UPDATE; -- primero la mesa
  SELECT id INTO yo FROM public.comensales_mesa WHERE session_id = c.sesion AND user_id = (SELECT auth.uid());
  -- Los de la mesa que eligió, más quien lo pide (sin repetir)
  SELECT array_agg(DISTINCT cm.id) INTO personas
    FROM public.comensales_mesa cm
   WHERE cm.session_id = c.sesion AND (cm.id = ANY (coalesce(_comensales, '{}')) OR cm.id = yo);
  n := coalesce(cardinality(personas), 0);
  IF n < 2 THEN
    RAISE EXCEPTION 'Elige con quién de tu mesa lo divides' USING ERRCODE = 'P0001';
  END IF;
  IF n > 8 THEN
    RAISE EXCEPTION 'Un plato se divide entre 8 personas como máximo' USING ERRCODE = 'P0001';
  END IF;
  IF cardinality(coalesce(_comensales, '{}')) > 0
     AND EXISTS (SELECT 1 FROM unnest(_comensales) x(id) WHERE NOT x.id = ANY (personas)) THEN
    RAISE EXCEPTION 'Alguien que elegiste ya no está en tu mesa' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.platos_divididos p WHERE p.session_id = c.sesion AND p.creado_por = (SELECT auth.uid()) AND p.estado = 'esperando') >= 2 THEN
    RAISE EXCEPTION 'Ya tienes platos divididos esperando que paguen las partes' USING ERRCODE = 'P0001';
  END IF;

  precios := public.calcular_precios((c.mesa).tenant_id, (c.mesa).branch_id, jsonb_build_array(_item));
  v_total := (precios ->> 'total')::integer;
  IF v_total < n THEN
    RAISE EXCEPTION 'Este plato no se puede dividir entre tantos' USING ERRCODE = 'P0001';
  END IF;
  numero := public.siguiente_numero_pedido((c.mesa).branch_id);

  -- El pedido espera, sin pagar, hasta que estén todas las partes (no va a cocina antes: regla 1)
  INSERT INTO public.orders (tenant_id, branch_id, table_id, session_id, order_number, status, source,
                             total_amount, confirmed_at, payment_status, user_id, forma_pago)
  VALUES ((c.mesa).tenant_id, (c.mesa).branch_id, (c.mesa).id, c.sesion, numero, 'confirmed', 'customer_qr',
          v_total, now(), 'unpaid', (SELECT auth.uid()), 'dividido')
  RETURNING id INTO pedido;
  INSERT INTO public.order_items (order_id, tenant_id, menu_item_id, menu_item_name, unit_price, quantity,
                                  subtotal, selected_modifiers, item_notes)
  SELECT pedido, (c.mesa).tenant_id, (l ->> 'menu_item_id')::uuid, l ->> 'menu_item_name',
         (l ->> 'unit_price')::integer, (l ->> 'quantity')::integer, (l ->> 'subtotal')::integer,
         l -> 'selected_modifiers', l ->> 'item_notes'
    FROM jsonb_array_elements(precios -> 'items') l;
  INSERT INTO public.order_events (tenant_id, order_id, estado_anterior, estado_nuevo, productos, actor_user_id, actor_rol, motivo)
  VALUES ((c.mesa).tenant_id, pedido, NULL, 'confirmed', 1, (SELECT auth.uid()), 'comensal', format('dividido entre %s', n));

  INSERT INTO public.platos_divididos (tenant_id, session_id, order_id, creado_por, total)
  VALUES ((c.mesa).tenant_id, c.sesion, pedido, (SELECT auth.uid()), v_total)
  RETURNING id INTO plato;

  -- Partes iguales; lo que sobra de dividir va en la parte de quien lo pidió
  base := v_total / n;
  INSERT INTO public.partes_plato (plato_id, tenant_id, comensal_id, user_id, monto)
  SELECT plato, (c.mesa).tenant_id, cm.id, cm.user_id,
         CASE WHEN cm.id = yo THEN v_total - base * (n - 1) ELSE base END
    FROM public.comensales_mesa cm WHERE cm.id = ANY (personas);
  SELECT id INTO mi_parte FROM public.partes_plato WHERE plato_id = plato AND comensal_id = yo;

  UPDATE public.tables SET status = CASE WHEN status = 'free' THEN 'occupied' ELSE status END WHERE id = (c.mesa).id;
  RETURN jsonb_build_object('plato', plato, 'order_id', pedido, 'total', v_total, 'personas', n, 'mi_parte', mi_parte,
                            'mi_monto', v_total - base * (n - 1));
END;
$$;
REVOKE ALL ON FUNCTION public.dividir_plato(text, jsonb, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dividir_plato(text, jsonb, uuid[]) TO authenticated;

-- Congela el precio de una parte para pagarla (cotización tipo 'parte')
CREATE OR REPLACE FUNCTION public.cotizar_parte(_qr_token text, _parte_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  p public.partes_plato;
  pl public.platos_divididos;
  cot uuid;
  expira timestamptz;
BEGIN
  SELECT * INTO c FROM public._comensal_en_mesa(_qr_token);
  SELECT * INTO p FROM public.partes_plato WHERE id = _parte_id;
  SELECT * INTO pl FROM public.platos_divididos WHERE id = p.plato_id;
  IF p.id IS NULL OR pl.session_id <> c.sesion OR p.user_id IS DISTINCT FROM (SELECT auth.uid()) THEN
    RAISE EXCEPTION 'Esa parte no es tuya' USING ERRCODE = '42501';
  END IF;
  IF pl.estado <> 'esperando' OR p.estado = 'pagada' THEN
    RAISE EXCEPTION 'Esa parte ya no se puede pagar' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.cotizaciones (tenant_id, branch_id, table_id, user_id, tipo, order_ids, subtotal, parte_id)
  VALUES ((c.mesa).tenant_id, (c.mesa).branch_id, (c.mesa).id, (SELECT auth.uid()), 'parte', ARRAY[pl.order_id], p.monto, p.id)
  RETURNING id, expira_at INTO cot, expira;
  RETURN jsonb_build_object('id', cot, 'subtotal', p.monto, 'expira_at', expira);
END;
$$;
REVOKE ALL ON FUNCTION public.cotizar_parte(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cotizar_parte(text, uuid) TO authenticated;

-- No, gracias: quien fue invitado a dividir rechaza su parte (quien lo pidió decide qué hacer)
CREATE OR REPLACE FUNCTION public.rechazar_parte(_qr_token text, _parte_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
BEGIN
  SELECT * INTO c FROM public._comensal_en_mesa(_qr_token);
  UPDATE public.partes_plato p SET estado = 'rechazada'
    FROM public.platos_divididos pl
   WHERE p.id = _parte_id AND pl.id = p.plato_id AND pl.session_id = c.sesion AND pl.estado = 'esperando'
     AND p.estado = 'pendiente' AND p.user_id = (SELECT auth.uid()) AND pl.creado_por IS DISTINCT FROM (SELECT auth.uid());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esa parte ya no se puede rechazar' USING ERRCODE = 'P0001';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.rechazar_parte(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rechazar_parte(text, uuid) TO authenticated;

-- Quien pidió el plato se hace cargo de una parte que falta (pendiente o rechazada) y la paga él
CREATE OR REPLACE FUNCTION public.tomar_parte(_qr_token text, _parte_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  yo uuid;
BEGIN
  SELECT * INTO c FROM public._comensal_en_mesa(_qr_token);
  SELECT id INTO yo FROM public.comensales_mesa WHERE session_id = c.sesion AND user_id = (SELECT auth.uid());
  UPDATE public.partes_plato p SET user_id = (SELECT auth.uid()), comensal_id = yo, estado = 'pendiente'
    FROM public.platos_divididos pl
   WHERE p.id = _parte_id AND pl.id = p.plato_id AND pl.session_id = c.sesion AND pl.estado = 'esperando'
     AND p.estado IN ('pendiente', 'rechazada') AND pl.creado_por = (SELECT auth.uid());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solo quien pidió el plato puede pagar una parte que falta' USING ERRCODE = 'P0001';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.tomar_parte(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tomar_parte(text, uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. El pago de una parte (confirmar_pago): anota la parte y, con la última, el pedido queda pagado
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  def text := pg_get_functiondef('public.confirmar_pago(uuid,boolean,integer,text,text,jsonb,text)'::regprocedure);
  nuevo text := def;
  cambios text[][] := ARRAY[
    ARRAY[$q$  -- Beneficio de campaña (fase 7.2): uno por persona y campaña.$q$,
          $q$  -- Parte de un plato dividido (fase 7.4b): si ya se pagó o el plato se anuló, se devuelve este pago
  IF cot.tipo = 'parte' THEN
    PERFORM 1 FROM public.partes_plato WHERE id = cot.parte_id FOR UPDATE;
    IF NOT EXISTS (SELECT 1 FROM public.partes_plato pp JOIN public.platos_divididos pl ON pl.id = pp.plato_id
                    WHERE pp.id = cot.parte_id AND pp.estado <> 'pagada' AND pl.estado = 'esperando') THEN
      UPDATE public.intentos_pago
         SET estado = 'reembolsado', monto_devolver = coalesce(_monto_cobrado, 0) + it.propina, proveedor = _proveedor, referencia_externa = _referencia, resuelto_at = ahora,
             motivo = 'Esa parte ya estaba pagada o el plato se anuló: se devuelve automáticamente'
       WHERE id = it.id;
      RETURN jsonb_build_object('estado', 'reembolsado', 'nuevo', true,
                                'motivo', 'Esa parte ya estaba pagada o el plato se anuló: se devuelve automáticamente',
                                'reembolsar', _monto_cobrado + it.propina);
    END IF;
  END IF;

  -- Beneficio de campaña (fase 7.2): uno por persona y campaña.$q$],
    ARRAY[$q$  ELSE
    UPDATE public.orders SET payment_status = 'paid', paid_at = ahora WHERE id = ANY (cot.order_ids);
  END IF;$q$,
          $q$  ELSIF cot.tipo = 'pedidos' THEN
    UPDATE public.orders SET payment_status = 'paid', paid_at = ahora WHERE id = ANY (cot.order_ids);
  END IF;$q$],
    ARRAY[$q$                               idempotency_key, staff_id, intento_id, user_id)$q$,
          $q$                               idempotency_key, staff_id, intento_id, user_id, parte_id)$q$],
    ARRAY[$q$          it.idempotency_key, mesa.assigned_waiter_id, it.id, it.user_id)
  RETURNING id INTO pago;$q$,
          $q$          it.idempotency_key, mesa.assigned_waiter_id, it.id, it.user_id, cot.parte_id)
  RETURNING id INTO pago;

  -- Parte de un plato dividido: queda pagada; con la última, el pedido queda pagado y pasa a cocina
  IF cot.tipo = 'parte' THEN
    UPDATE public.partes_plato SET estado = 'pagada', payment_id = pago, pagada_at = ahora WHERE id = cot.parte_id;
    IF NOT EXISTS (SELECT 1 FROM public.partes_plato pp
                    WHERE pp.plato_id = (SELECT plato_id FROM public.partes_plato WHERE id = cot.parte_id)
                      AND pp.estado <> 'pagada') THEN
      UPDATE public.platos_divididos SET estado = 'pagado', resuelto_at = ahora
       WHERE id = (SELECT plato_id FROM public.partes_plato WHERE id = cot.parte_id);
      UPDATE public.orders SET payment_status = 'paid', paid_at = ahora WHERE id = ANY (cot.order_ids);
    END IF;
  END IF;$q$]
  ];
  i integer;
BEGIN
  FOR i IN 1 .. array_length(cambios, 1) LOOP
    IF position(cambios[i][1] IN nuevo) = 0 THEN RAISE EXCEPTION 'confirmar_pago: no se encontró el cambio %', i; END IF;
    nuevo := replace(nuevo, cambios[i][1], cambios[i][2]);
  END LOOP;
  EXECUTE nuevo;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Lo que no puede pasar con un plato dividido
-- ─────────────────────────────────────────────────────────────────────────────
-- El mozo no cobra un plato dividido en efectivo (se cobraría dos veces): cada parte se paga con la app
DO $$
DECLARE
  def text := pg_get_functiondef('public.registrar_cobro_mozo(uuid[],text,integer,integer,boolean,text)'::regprocedure);
  nuevo text;
BEGIN
  nuevo := regexp_replace(def, '(\nBEGIN\n)', E'\\1  IF EXISTS (SELECT 1 FROM public.orders WHERE id = ANY (_order_ids) AND forma_pago = ''dividido'') THEN\n    RAISE EXCEPTION ''Ese plato está dividido: cada persona paga su parte con la app'' USING ERRCODE = ''P0001'';\n  END IF;\n');
  IF nuevo = def THEN RAISE EXCEPTION 'registrar_cobro_mozo: no se encontró el inicio'; END IF;
  EXECUTE nuevo;
END;
$$;

-- Un reembolso total deja el pedido "reembolsado" solo si no queda otro pago vigente que lo cubra
-- (con un plato dividido, devolver la parte de uno no reembolsa las de los demás)
DO $$
DECLARE
  def text := pg_get_functiondef('public.confirmar_reembolso'::regproc);
  nuevo text;
BEGIN
  nuevo := replace(def, $q$     WHERE id = ANY (coalesce(pago.pedidos, ARRAY[pago.order_id])) AND payment_status = 'paid';$q$,
    $q$     WHERE id = ANY (coalesce(pago.pedidos, ARRAY[pago.order_id])) AND payment_status = 'paid'
       AND NOT EXISTS (SELECT 1 FROM public.payments p2 WHERE p2.pedidos @> ARRAY[orders.id] AND p2.id <> pago.id
                         AND p2.status IN ('approved', 'partially_refunded'));$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'confirmar_reembolso: no se encontró dónde'; END IF;
  EXECUTE nuevo;
END;
$$;

-- Si el personal anula el pedido, el plato queda anulado (lo ya pagado aparece en Excepciones para devolverlo)
CREATE OR REPLACE FUNCTION public.al_anular_dividido()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.platos_divididos SET estado = 'anulado', resuelto_at = now()
   WHERE order_id = NEW.id AND estado = 'esperando';
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.al_anular_dividido() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS anular_dividido ON public.orders;
CREATE TRIGGER anular_dividido AFTER UPDATE OF status ON public.orders
  FOR EACH ROW WHEN (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' AND NEW.forma_pago = 'dividido')
  EXECUTE FUNCTION public.al_anular_dividido();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Lo que ve la mesa, la caja y las auditorías
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  def text;
  nuevo text;
BEGIN
  -- La mesa en vivo: quién está (con su id, para elegir con quién dividir) y los platos divididos donde estoy
  def := pg_get_functiondef('public.mi_mesa_en_vivo(text)'::regprocedure);
  nuevo := replace(def, $q$jsonb_build_object('alias', cm.alias, 'yo', cm.user_id = auth.uid())$q$,
                        $q$jsonb_build_object('id', cm.id, 'alias', cm.alias, 'yo', cm.user_id = auth.uid())$q$);
  nuevo := replace(nuevo, $q$    'rondas', (SELECT coalesce(jsonb_agg(jsonb_build_object($q$,
    $q$    'divididos', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                    'id', pl.id, 'estado', pl.estado, 'total', pl.total, 'creado', pl.created_at,
                    'soy_creador', pl.creado_por = auth.uid(),
                    'pedido_estado', o.status,
                    'plato', (SELECT string_agg(oi.quantity || '× ' || oi.menu_item_name, ', ') FROM public.order_items oi WHERE oi.order_id = pl.order_id),
                    'partes', (SELECT jsonb_agg(jsonb_build_object(
                                  'id', pp.id, 'monto', pp.monto, 'estado', pp.estado, 'yo', pp.user_id = auth.uid(),
                                  'quien', coalesce((SELECT cm.alias FROM public.comensales_mesa cm WHERE cm.id = pp.comensal_id), 'Alguien de la mesa'))
                                  ORDER BY pp.created_at, pp.id)
                                 FROM public.partes_plato pp WHERE pp.plato_id = pl.id)) ORDER BY pl.created_at DESC), '[]'::jsonb)
                  FROM public.platos_divididos pl JOIN public.orders o ON o.id = pl.order_id
                 WHERE pl.session_id = c.sesion AND pl.estado <> 'anulado'
                   AND EXISTS (SELECT 1 FROM public.partes_plato pp WHERE pp.plato_id = pl.id AND pp.user_id = auth.uid())),
    'rondas', (SELECT coalesce(jsonb_agg(jsonb_build_object($q$);
  IF nuevo = def THEN RAISE EXCEPTION 'mi_mesa_en_vivo: no se encontró dónde'; END IF;
  EXECUTE nuevo;

  -- La caja: lo ya pagado de un plato anulado hay que devolverlo
  def := pg_get_functiondef('public.excepciones_caja(uuid)'::regprocedure);
  nuevo := replace(def, $q$      -- Reembolso que la pasarela rechazó (y no se hizo después)$q$,
    $q$      -- Parte pagada de un plato dividido que se anuló: hay que devolverla (fase 7.4b)
      SELECT jsonb_build_object(
               'tipo', 'parte_por_devolver', 'id', pp.id, 'fecha', pl.resuelto_at,
               'monto', p.amount + p.tip_amount - p.refunded_amount,
               'mesa', (SELECT t.number FROM public.tables t WHERE t.id = p.table_id),
               'detalle', 'Plato dividido anulado: devolver la parte pagada', 'pago_id', p.id,
               'referencia', p.external_reference)
        FROM public.partes_plato pp
        JOIN public.platos_divididos pl ON pl.id = pp.plato_id
        JOIN public.payments p ON p.id = pp.payment_id
       WHERE p.branch_id = _branch_id AND pl.estado = 'anulado' AND p.status IN ('approved', 'partially_refunded')
      UNION ALL
      -- Reembolso que la pasarela rechazó (y no se hizo después)$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'excepciones_caja: no se encontró dónde'; END IF;
  EXECUTE nuevo;

  -- Auditoría de la plata: un pedido dividido tiene varios pagos (uno por parte) que suman su total
  def := pg_get_functiondef('public.auditoria_plata()'::regprocedure);
  nuevo := replace(def, $q$   WHERE p.status IN ('approved', 'partially_refunded')
   GROUP BY o.id, o.order_number HAVING count(*) > 1;$q$,
    $q$   WHERE p.status IN ('approved', 'partially_refunded') AND p.parte_id IS NULL
   GROUP BY o.id, o.order_number HAVING count(*) > 1;$q$);
  nuevo := replace(nuevo, $q$   WHERE p.pedidos IS NOT NULL AND p.status <> 'failed' AND x.suma IS NOT NULL AND x.suma <> p.amount;$q$,
    $q$   WHERE p.pedidos IS NOT NULL AND p.status <> 'failed' AND x.suma IS NOT NULL AND x.suma <> p.amount AND p.parte_id IS NULL;$q$);
  nuevo := regexp_replace(nuevo, '\n(\s*END;\s*\$function\$)', $q$

  -- Fase 7.4b: cada parte se paga por su monto; un plato pagado tiene todas sus partes pagadas y suman el
  -- total; ningún pago de parte de otro pedido; lo pagado de un plato anulado se devuelve (en un día).
  RETURN QUERY
  SELECT 'parte_no_calza'::text, pp.id::text, format('Parte de %s pagada con %s', pp.monto, p.amount)
    FROM public.partes_plato pp JOIN public.payments p ON p.id = pp.payment_id
    JOIN public.platos_divididos pl ON pl.id = pp.plato_id
   WHERE p.amount <> pp.monto OR NOT (p.pedidos @> ARRAY[pl.order_id]) OR p.parte_id IS DISTINCT FROM pp.id;

  RETURN QUERY
  SELECT 'dividido_no_calza'::text, pl.id::text,
         format('Plato %s de %s con partes que suman %s', pl.estado, pl.total, (SELECT sum(pp.monto) FROM public.partes_plato pp WHERE pp.plato_id = pl.id))
    FROM public.platos_divididos pl JOIN public.orders o ON o.id = pl.order_id
   WHERE (SELECT sum(pp.monto) FROM public.partes_plato pp WHERE pp.plato_id = pl.id) <> pl.total
      OR pl.total <> o.total_amount
      OR (pl.estado = 'pagado' AND (o.payment_status NOT IN ('paid', 'refunded')
            OR EXISTS (SELECT 1 FROM public.partes_plato pp WHERE pp.plato_id = pl.id AND pp.estado <> 'pagada')))
      OR (pl.estado = 'esperando' AND o.payment_status = 'paid');

  RETURN QUERY
  SELECT 'parte_sin_devolver'::text, pp.id::text, format('Parte pagada de un plato anulado el %s sin devolver', pl.resuelto_at::date)
    FROM public.partes_plato pp JOIN public.platos_divididos pl ON pl.id = pp.plato_id
    JOIN public.payments p ON p.id = pp.payment_id
   WHERE pl.estado = 'anulado' AND p.status IN ('approved', 'partially_refunded') AND pl.resuelto_at < now() - interval '1 day';
\1$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'auditoria_plata: no se encontró dónde'; END IF;
  EXECUTE nuevo;

  -- Privacidad: las partes guardan quién (al borrar la persona, la parte queda sin nombre: la plata sigue)
  def := pg_get_functiondef('public._borrar_datos_comensal(uuid)'::regprocedure);
  nuevo := replace(def, '  DELETE FROM public.partidas_trivia WHERE user_id = _user_id;',
    '  DELETE FROM public.partidas_trivia WHERE user_id = _user_id;
  UPDATE public.partes_plato SET user_id = NULL WHERE user_id = _user_id;
  UPDATE public.platos_divididos SET creado_por = NULL WHERE creado_por = _user_id;');
  IF nuevo = def THEN RAISE EXCEPTION '_borrar_datos_comensal: no se encontró dónde'; END IF;
  EXECUTE nuevo;
END;
$$;
