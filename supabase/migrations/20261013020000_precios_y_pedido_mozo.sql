-- Fase 1.9 — Precios por el servidor y pedido del mozo por el servidor.
--  · Un solo cálculo de precios en la base (calcular_precios), que usan el pago del comensal y el
--    pedido del mozo. Valida opciones inventadas (N6), opciones obligatorias, productos agotados u
--    ocultos, horario y días de cada categoría, local activo y sucursal abierta (N7).
--  · Número de pedido sin choques: un contador por sucursal (antes "contar pedidos + 1", que con
--    dos pedidos al mismo tiempo podía repetir número).
--  · El mozo crea pedidos con crear_pedido_mozo(): el precio sale de la base, nunca del navegador
--    (DIAGNOSTICO 3.7). Se cierra la inserción provisoria de pedidos que quedó en la fase 1.4.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Número de pedido por sucursal.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.contadores_pedidos (
  branch_id uuid PRIMARY KEY REFERENCES public.branches(id) ON DELETE CASCADE,
  ultimo integer NOT NULL DEFAULT 0
);
ALTER TABLE public.contadores_pedidos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contadores_pedidos FROM anon, authenticated;
-- Sin políticas: solo lo usan las funciones del servidor.

INSERT INTO public.contadores_pedidos (branch_id, ultimo)
SELECT branch_id, max(order_number) FROM public.orders GROUP BY branch_id
ON CONFLICT (branch_id) DO UPDATE SET ultimo = greatest(public.contadores_pedidos.ultimo, excluded.ultimo);

CREATE OR REPLACE FUNCTION public.siguiente_numero_pedido(_branch_id uuid)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.contadores_pedidos AS c (branch_id, ultimo) VALUES (_branch_id, 1)
  ON CONFLICT (branch_id) DO UPDATE SET ultimo = c.ultimo + 1
  RETURNING ultimo
$$;
REVOKE ALL ON FUNCTION public.siguiente_numero_pedido(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.siguiente_numero_pedido(uuid) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Calcular precios: la única fuente de precios para cobrar o pedir.
--    _items: [{ menu_item_id, quantity, modifiers: [{ groupName, modifierName }], notes }]
--    Devuelve { total, items: [{ menu_item_id, menu_item_name, unit_price, quantity, subtotal,
--                                selected_modifiers: [{ groupName, modifierName, extraPrice }], item_notes }] }
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.calcular_precios(_tenant_id uuid, _branch_id uuid, _items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  zona text;
  ahora timestamp;
  linea jsonb;
  item record;
  mod jsonb;
  opcion record;
  grupo record;
  id_texto text;
  cantidad integer;
  extra integer;
  elegidas jsonb;
  cuantas integer;
  maximo integer;
  subtotal integer;
  total integer := 0;
  lineas jsonb := '[]'::jsonb;
BEGIN
  SELECT coalesce(nullif(t.timezone, ''), 'America/Santiago') INTO zona
    FROM public.tenants t WHERE t.id = _tenant_id AND t.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Este local no está recibiendo pedidos' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.branches b
                  WHERE b.id = _branch_id AND b.tenant_id = _tenant_id AND coalesce(b.is_open, true)) THEN
    RAISE EXCEPTION 'El local está cerrado en este momento' USING ERRCODE = 'P0001';
  END IF;
  BEGIN
    ahora := now() AT TIME ZONE zona;
  EXCEPTION WHEN OTHERS THEN
    ahora := now() AT TIME ZONE 'America/Santiago';
  END;

  IF jsonb_typeof(_items) IS DISTINCT FROM 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'El pedido está vacío' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(_items) > 50 THEN
    RAISE EXCEPTION 'El pedido tiene demasiados productos' USING ERRCODE = '22023';
  END IF;

  FOR linea IN SELECT value FROM jsonb_array_elements(_items) LOOP
    id_texto := linea ->> 'menu_item_id';
    IF id_texto IS NULL OR id_texto !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Uno de los productos ya no está en la carta' USING ERRCODE = 'P0001';
    END IF;

    SELECT mi.id, mi.name, mi.price, mi.status, c.is_visible, c.available_from, c.available_until, c.available_days
      INTO item
      FROM public.menu_items mi
      JOIN public.categories c ON c.id = mi.category_id
     WHERE mi.id = id_texto::uuid AND mi.tenant_id = _tenant_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Uno de los productos ya no está en la carta' USING ERRCODE = 'P0001';
    END IF;
    IF coalesce(item.status, 'available') <> 'available' OR NOT coalesce(item.is_visible, true) THEN
      RAISE EXCEPTION '"%" ya no está disponible', item.name USING ERRCODE = 'P0001';
    END IF;
    IF item.available_days IS NOT NULL AND NOT (extract(dow FROM ahora)::int = ANY (item.available_days)) THEN
      RAISE EXCEPTION '"%" no está disponible hoy', item.name USING ERRCODE = 'P0001';
    END IF;
    IF item.available_from IS NOT NULL AND item.available_until IS NOT NULL AND NOT (
         CASE WHEN item.available_from <= item.available_until
              THEN ahora::time BETWEEN item.available_from AND item.available_until
              ELSE ahora::time >= item.available_from OR ahora::time <= item.available_until -- cruza la medianoche
         END) THEN
      RAISE EXCEPTION '"%" no está disponible a esta hora', item.name USING ERRCODE = 'P0001';
    END IF;

    BEGIN
      cantidad := coalesce((linea ->> 'quantity')::integer, 1);
    EXCEPTION WHEN OTHERS THEN
      cantidad := 0;
    END;
    IF cantidad NOT BETWEEN 1 AND 20 THEN
      RAISE EXCEPTION 'La cantidad de "%" no es válida (de 1 a 20)', item.name USING ERRCODE = '22023';
    END IF;

    -- Opciones elegidas: cada una tiene que existir y estar disponible para ESTE producto.
    extra := 0;
    elegidas := '[]'::jsonb;
    IF linea ? 'modifiers' AND jsonb_typeof(linea -> 'modifiers') = 'array' THEN
      IF jsonb_array_length(linea -> 'modifiers') > 20 THEN
        RAISE EXCEPTION 'Demasiadas opciones en "%"', item.name USING ERRCODE = '22023';
      END IF;
      FOR mod IN SELECT value FROM jsonb_array_elements(linea -> 'modifiers') LOOP
        SELECT m.name AS opcion, m.extra_price, m.is_available, g.name AS grupo
          INTO opcion
          FROM public.modifiers m
          JOIN public.modifier_groups g ON g.id = m.group_id
         WHERE g.menu_item_id = item.id
           AND g.name = mod ->> 'groupName'
           AND m.name = mod ->> 'modifierName'
         LIMIT 1;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Una de las opciones de "%" no es válida', item.name USING ERRCODE = 'P0001';
        END IF;
        IF opcion.is_available = false THEN
          RAISE EXCEPTION 'La opción "%" de "%" ya no está disponible', opcion.opcion, item.name USING ERRCODE = 'P0001';
        END IF;
        IF elegidas @> jsonb_build_array(jsonb_build_object('groupName', opcion.grupo, 'modifierName', opcion.opcion)) THEN
          RAISE EXCEPTION 'La opción "%" está repetida en "%"', opcion.opcion, item.name USING ERRCODE = '22023';
        END IF;
        extra := extra + coalesce(opcion.extra_price, 0);
        elegidas := elegidas || jsonb_build_array(jsonb_build_object(
          'groupName', opcion.grupo, 'modifierName', opcion.opcion, 'extraPrice', coalesce(opcion.extra_price, 0)));
      END LOOP;
    END IF;

    -- Reglas de cada grupo: obligatorios y máximos.
    FOR grupo IN SELECT g.name, g.type, g.required, g.min_selections, g.max_selections
                   FROM public.modifier_groups g WHERE g.menu_item_id = item.id LOOP
      SELECT count(*) INTO cuantas FROM jsonb_array_elements(elegidas) e WHERE e ->> 'groupName' = grupo.name;
      IF coalesce(grupo.required, false) AND cuantas < greatest(coalesce(grupo.min_selections, 1), 1) THEN
        RAISE EXCEPTION 'Elige "%" para "%"', grupo.name, item.name USING ERRCODE = 'P0001';
      END IF;
      maximo := CASE WHEN grupo.type = 'choose_one' THEN 1 ELSE coalesce(nullif(grupo.max_selections, 0), 99) END;
      IF cuantas > maximo THEN
        RAISE EXCEPTION 'Elegiste demasiadas opciones en "%" de "%"', grupo.name, item.name USING ERRCODE = 'P0001';
      END IF;
    END LOOP;

    subtotal := (coalesce(item.price, 0) + extra) * cantidad;
    total := total + subtotal;
    lineas := lineas || jsonb_build_array(jsonb_build_object(
      'menu_item_id', item.id,
      'menu_item_name', item.name,
      'unit_price', coalesce(item.price, 0),
      'quantity', cantidad,
      'subtotal', subtotal,
      'selected_modifiers', elegidas,
      'item_notes', left(nullif(btrim(coalesce(linea ->> 'notes', '')), ''), 200)));
  END LOOP;

  RETURN jsonb_build_object('total', total, 'items', lineas);
END;
$$;
REVOKE ALL ON FUNCTION public.calcular_precios(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calcular_precios(uuid, uuid, jsonb) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Pedido del mozo, por el servidor.
--    Queda "por pagar". En prepago no pasa a cocina hasta que se registre el cobro
--    ("Pagar al mozo", fase 2); en cuenta abierta va directo a cocina.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crear_pedido_mozo(_table_id uuid, _items jsonb, _notas text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a record;
  precios jsonb;
  sesion uuid;
  numero integer;
  pedido uuid;
  modo text;
  productos integer;
BEGIN
  SELECT * INTO a FROM public._mesa_y_actor(_table_id);
  IF a.rol NOT IN ('owner', 'admin', 'manager', 'waiter') THEN
    RAISE EXCEPTION 'No tienes permiso para este cambio' USING ERRCODE = '42501';
  END IF;
  IF a.rol = 'waiter' AND (a.mesa).assigned_waiter_id IS NOT NULL
     AND (a.mesa).assigned_waiter_id IS DISTINCT FROM a.staff_id THEN
    RAISE EXCEPTION 'Esta mesa la atiende otro mozo' USING ERRCODE = '42501';
  END IF;

  precios := public.calcular_precios((a.mesa).tenant_id, (a.mesa).branch_id, _items);
  sesion := (public.abrir_mesa(_table_id) ->> 'session_id')::uuid;
  numero := public.siguiente_numero_pedido((a.mesa).branch_id);

  INSERT INTO public.orders (tenant_id, branch_id, table_id, session_id, order_number, status, source,
                             total_amount, notes, confirmed_at, payment_status)
  VALUES ((a.mesa).tenant_id, (a.mesa).branch_id, _table_id, sesion, numero, 'confirmed', 'waiter',
          (precios ->> 'total')::integer, left(nullif(btrim(coalesce(_notas, '')), ''), 300), now(), 'unpaid')
  RETURNING id INTO pedido;

  INSERT INTO public.order_items (order_id, tenant_id, menu_item_id, menu_item_name, unit_price, quantity,
                                  subtotal, selected_modifiers, item_notes)
  SELECT pedido, (a.mesa).tenant_id, (l ->> 'menu_item_id')::uuid, l ->> 'menu_item_name',
         (l ->> 'unit_price')::integer, (l ->> 'quantity')::integer, (l ->> 'subtotal')::integer,
         l -> 'selected_modifiers', l ->> 'item_notes'
    FROM jsonb_array_elements(precios -> 'items') l;
  GET DIAGNOSTICS productos = ROW_COUNT;

  INSERT INTO public.order_events (tenant_id, order_id, estado_anterior, estado_nuevo, productos, actor_user_id, actor_rol, motivo)
  VALUES ((a.mesa).tenant_id, pedido, NULL, 'confirmed', productos, auth.uid(), a.rol, 'pedido tomado por el personal');

  SELECT payment_mode INTO modo FROM public.branches WHERE id = (a.mesa).branch_id;
  RETURN jsonb_build_object('order_id', pedido, 'order_number', numero, 'total', (precios ->> 'total')::integer,
                            'espera_pago', modo = 'prepaid');
END;
$$;
REVOKE ALL ON FUNCTION public.crear_pedido_mozo(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crear_pedido_mozo(uuid, jsonb, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Se cierra la inserción provisoria de pedidos desde el navegador (fase 1.4).
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "orders_insercion_personal" ON public.orders;
DROP POLICY IF EXISTS "order_items_insercion_personal" ON public.order_items;
REVOKE INSERT ON public.orders FROM authenticated;
REVOKE INSERT ON public.order_items FROM authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. El reinicio del demo también reinicia la numeración de pedidos del demo.
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
