-- Fase 1.4 — Dominio PEDIDOS.
-- Los cambios de estado los hace el servidor (brief, regla 6), con el rol validado,
-- la hora del servidor y un registro de quién lo hizo (regla 7). La lectura y escritura
-- pública de pedidos se cierra (DIAGNOSTICO problemas 2, 4 y 6).
-- Los estados siguen en inglés en la base: confirmed → in_kitchen → ready → delivered (o cancelled).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Estaciones (barra, cocina…). Configurables por sucursal; ninguna fija en el código.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  es_predeterminada boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS stations_una_predeterminada
  ON public.stations (branch_id) WHERE es_predeterminada = true;

ALTER TABLE public.stations ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.stations FROM anon;
-- Los nombres de estación no son sensibles: el comensal los ve en el estado de su pedido.
CREATE POLICY stations_lectura ON public.stations FOR SELECT USING (true);
CREATE POLICY stations_gestion ON public.stations FOR ALL TO authenticated
  USING (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager']))
  WITH CHECK (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager']));

-- Cada sucursal tiene su estación predeterminada ("Cocina"); las nuevas la reciben solas.
INSERT INTO public.stations (tenant_id, branch_id, name, es_predeterminada)
SELECT b.tenant_id, b.id, 'Cocina', true
  FROM public.branches b
 WHERE NOT EXISTS (SELECT 1 FROM public.stations s WHERE s.branch_id = b.id AND s.es_predeterminada);

CREATE OR REPLACE FUNCTION public.crear_estacion_predeterminada()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.stations (tenant_id, branch_id, name, es_predeterminada)
  VALUES (NEW.tenant_id, NEW.id, 'Cocina', true);
  RETURN NEW;
END;
$$;
CREATE TRIGGER sucursal_estacion_predeterminada
  AFTER INSERT ON public.branches
  FOR EACH ROW EXECUTE FUNCTION public.crear_estacion_predeterminada();

-- Cada categoría puede ir a una estación (vacío = la predeterminada de la sucursal).
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS station_id uuid REFERENCES public.stations(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Estado por producto y estación.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'confirmed',
  ADD COLUMN IF NOT EXISTS station_id uuid REFERENCES public.stations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS ready_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_status_check
  CHECK (status IN ('confirmed', 'in_kitchen', 'ready', 'delivered', 'cancelled'));

-- Estación de un producto: la de su categoría o la predeterminada de la sucursal del pedido.
CREATE OR REPLACE FUNCTION public.asignar_estacion_item()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.station_id IS NULL THEN
    SELECT coalesce(c.station_id, s.id) INTO NEW.station_id
      FROM public.orders o
      LEFT JOIN public.menu_items mi ON mi.id = NEW.menu_item_id
      LEFT JOIN public.categories c ON c.id = mi.category_id
      LEFT JOIN public.stations s ON s.branch_id = o.branch_id AND s.es_predeterminada
     WHERE o.id = NEW.order_id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER order_items_estacion
  BEFORE INSERT ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.asignar_estacion_item();

-- Datos existentes: estado del pedido y estación predeterminada.
UPDATE public.order_items oi
   SET status = CASE WHEN o.status IN ('confirmed', 'in_kitchen', 'ready', 'delivered', 'cancelled')
                     THEN o.status ELSE 'confirmed' END,
       station_id = coalesce(oi.station_id, (
         SELECT s.id FROM public.stations s WHERE s.branch_id = o.branch_id AND s.es_predeterminada))
  FROM public.orders o
 WHERE o.id = oi.order_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Registro de eventos: cada cambio con hora del servidor y quién lo hizo. Solo crece.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.order_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  station_id uuid REFERENCES public.stations(id) ON DELETE SET NULL,
  estado_anterior text,
  estado_nuevo text NOT NULL,
  productos integer NOT NULL DEFAULT 0,
  actor_user_id uuid,
  actor_rol text,
  motivo text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_events_order_idx ON public.order_events (order_id, created_at);

ALTER TABLE public.order_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_events FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.order_events FROM authenticated;
GRANT SELECT ON public.order_events TO authenticated;
CREATE POLICY order_events_lectura ON public.order_events FOR SELECT TO authenticated
  USING (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager', 'cashier', 'waiter', 'kitchen'])
         OR public.is_platform_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Cambiar el estado de un pedido (o de lo que le toca a una estación).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rango_estado(_estado text)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _estado
    WHEN 'confirmed' THEN 1 WHEN 'in_kitchen' THEN 2 WHEN 'ready' THEN 3
    WHEN 'delivered' THEN 4 WHEN 'cancelled' THEN 9 ELSE 0 END
$$;

CREATE OR REPLACE FUNCTION public.cambiar_estado_pedido(
  _order_id uuid,
  _estado text,
  _station_id uuid DEFAULT NULL,
  _motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pedido record;
  modo_pago text;
  rol text;
  cambiados integer := 0;
  estado_final text;
  ahora timestamptz := now();
  motivo_limpio text := nullif(btrim(coalesce(_motivo, '')), '');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Tienes que iniciar sesión' USING ERRCODE = '42501';
  END IF;
  IF public.rango_estado(_estado) = 0 OR _estado = 'confirmed' THEN
    RAISE EXCEPTION 'Estado no válido' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO pedido FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido no encontrado' USING ERRCODE = 'P0002';
  END IF;

  SELECT tm.role INTO rol FROM public.tenant_members tm
   WHERE tm.user_id = auth.uid() AND tm.tenant_id = pedido.tenant_id AND tm.is_active;

  -- Quién puede hacer qué (el mozo no maneja estados de cocina: brief 5.2).
  IF rol IS NULL
     OR (_estado IN ('in_kitchen', 'ready') AND rol NOT IN ('owner', 'admin', 'manager', 'kitchen'))
     OR (_estado = 'delivered' AND rol NOT IN ('owner', 'admin', 'manager', 'kitchen', 'waiter'))
     OR (_estado = 'cancelled' AND rol NOT IN ('owner', 'admin', 'manager')) THEN
    RAISE EXCEPTION 'No tienes permiso para este cambio' USING ERRCODE = '42501';
  END IF;

  IF _estado = 'cancelled' THEN
    IF motivo_limpio IS NULL OR char_length(motivo_limpio) < 3 THEN
      RAISE EXCEPTION 'Indica el motivo de la cancelación' USING ERRCODE = '22023';
    END IF;
    IF _station_id IS NOT NULL THEN
      RAISE EXCEPTION 'La cancelación es del pedido completo' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- En prepago, nada se prepara sin pago confirmado (brief, regla 1). Ahora lo exige la base.
  SELECT payment_mode INTO modo_pago FROM public.branches WHERE id = pedido.branch_id;
  IF modo_pago = 'prepaid' AND pedido.payment_status <> 'paid' AND _estado <> 'cancelled' THEN
    RAISE EXCEPTION 'El pedido no está pagado' USING ERRCODE = '42501';
  END IF;

  IF pedido.status = 'cancelled' THEN
    RAISE EXCEPTION 'El pedido está cancelado' USING ERRCODE = '22023';
  END IF;

  -- Avanzar solo hacia adelante: lo que ya está en ese estado o más allá no se toca.
  UPDATE public.order_items oi
     SET status = _estado,
         started_at = CASE WHEN _estado IN ('in_kitchen', 'ready', 'delivered') THEN coalesce(oi.started_at, ahora) ELSE oi.started_at END,
         ready_at = CASE WHEN _estado IN ('ready', 'delivered') THEN coalesce(oi.ready_at, ahora) ELSE oi.ready_at END,
         delivered_at = CASE WHEN _estado = 'delivered' THEN ahora ELSE oi.delivered_at END
   WHERE oi.order_id = _order_id
     AND oi.status NOT IN ('delivered', 'cancelled')
     AND (_station_id IS NULL OR oi.station_id = _station_id)
     AND (_estado = 'cancelled' OR public.rango_estado(oi.status) < public.rango_estado(_estado))
     -- El mozo entrega solo lo que cocina ya marcó listo.
     AND (rol <> 'waiter' OR oi.status = 'ready');
  GET DIAGNOSTICS cambiados = ROW_COUNT;

  -- Estado del pedido: el más atrasado de sus productos (cancelado si no queda ninguno vivo).
  IF EXISTS (SELECT 1 FROM public.order_items WHERE order_id = _order_id) THEN
    SELECT CASE
             WHEN count(*) FILTER (WHERE status <> 'cancelled') = 0 THEN 'cancelled'
             ELSE (ARRAY['confirmed', 'in_kitchen', 'ready', 'delivered'])[
                    min(public.rango_estado(status)) FILTER (WHERE status <> 'cancelled')]
           END
      INTO estado_final
      FROM public.order_items WHERE order_id = _order_id;
  ELSIF public.rango_estado(_estado) > public.rango_estado(pedido.status) OR _estado = 'cancelled' THEN
    estado_final := _estado; -- pedidos antiguos sin productos
  ELSE
    estado_final := pedido.status;
  END IF;

  IF estado_final IS DISTINCT FROM pedido.status OR cambiados > 0 THEN
    UPDATE public.orders
       SET status = estado_final,
           kitchen_accepted_at = CASE WHEN public.rango_estado(estado_final) BETWEEN 2 AND 4 THEN coalesce(kitchen_accepted_at, ahora) ELSE kitchen_accepted_at END,
           ready_at = CASE WHEN estado_final IN ('ready', 'delivered') THEN coalesce(ready_at, ahora) ELSE ready_at END,
           delivered_at = CASE WHEN estado_final = 'delivered' THEN coalesce(delivered_at, ahora) ELSE delivered_at END,
           cancelled_reason = CASE WHEN _estado = 'cancelled' THEN motivo_limpio ELSE cancelled_reason END
     WHERE id = _order_id;

    INSERT INTO public.order_events (tenant_id, order_id, station_id, estado_anterior, estado_nuevo, productos, actor_user_id, actor_rol, motivo)
    VALUES (pedido.tenant_id, _order_id, _station_id, pedido.status, estado_final, cambiados, auth.uid(), rol, motivo_limpio);
  END IF;

  RETURN jsonb_build_object('estado', estado_final, 'productos_cambiados', cambiados);
END;
$$;

REVOKE ALL ON FUNCTION public.cambiar_estado_pedido(uuid, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cambiar_estado_pedido(uuid, text, uuid, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Marcar un producto agotado o disponible (cocina, encargado, administración).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.marcar_agotado(_menu_item_id uuid, _agotado boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  local uuid;
BEGIN
  SELECT tenant_id INTO local FROM public.menu_items WHERE id = _menu_item_id;
  IF local IS NULL OR NOT public.tiene_rol(local, ARRAY['owner', 'admin', 'manager', 'kitchen']) THEN
    RAISE EXCEPTION 'No tienes permiso para este cambio' USING ERRCODE = '42501';
  END IF;
  UPDATE public.menu_items
     SET status = CASE WHEN _agotado THEN 'out_of_stock' ELSE 'available' END
   WHERE id = _menu_item_id;
END;
$$;

REVOKE ALL ON FUNCTION public.marcar_agotado(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marcar_agotado(uuid, boolean) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Reglas de acceso de pedidos y productos pedidos.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "orders_public_insert" ON public.orders;
DROP POLICY IF EXISTS "orders_public_read" ON public.orders;
DROP POLICY IF EXISTS "orders_public_update_status" ON public.orders;
DROP POLICY IF EXISTS "orders_staff_manage" ON public.orders;

REVOKE INSERT, UPDATE, DELETE ON public.orders FROM anon;
REVOKE UPDATE ON public.orders FROM authenticated;

-- El personal del local ve los pedidos de su local.
CREATE POLICY orders_lectura_personal ON public.orders FOR SELECT TO authenticated
  USING (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager', 'cashier', 'waiter', 'kitchen']));
-- El comensal ve los pedidos de la sesión de mesa en la que está.
CREATE POLICY orders_lectura_comensal ON public.orders FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.comensales_mesa cm
                  WHERE cm.session_id = orders.session_id AND cm.user_id = auth.uid()));
CREATE POLICY orders_lectura_superadmin ON public.orders FOR SELECT TO authenticated
  USING (public.is_platform_admin());
-- Provisorio hasta la fase 1.9 (pedido manual por el servidor): el personal crea pedidos manuales.
CREATE POLICY orders_insercion_personal ON public.orders FOR INSERT TO authenticated
  WITH CHECK (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager', 'waiter']));

DROP POLICY IF EXISTS "order_items_public_insert" ON public.order_items;
DROP POLICY IF EXISTS "order_items_public_read" ON public.order_items;
DROP POLICY IF EXISTS "order_items_staff_manage" ON public.order_items;

REVOKE INSERT, UPDATE, DELETE ON public.order_items FROM anon;
REVOKE UPDATE ON public.order_items FROM authenticated;

CREATE POLICY order_items_lectura_personal ON public.order_items FOR SELECT TO authenticated
  USING (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager', 'cashier', 'waiter', 'kitchen']));
CREATE POLICY order_items_lectura_comensal ON public.order_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orders o
                   JOIN public.comensales_mesa cm ON cm.session_id = o.session_id
                  WHERE o.id = order_items.order_id AND cm.user_id = auth.uid()));
CREATE POLICY order_items_lectura_superadmin ON public.order_items FOR SELECT TO authenticated
  USING (public.is_platform_admin());
-- Provisorio hasta la fase 1.9.
CREATE POLICY order_items_insercion_personal ON public.order_items FOR INSERT TO authenticated
  WITH CHECK (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager', 'waiter']));
