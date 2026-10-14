-- Fase 3.8 — Compuerta de la fase 3 (operación de sala).
-- 1. auditoria_operacion(): como auditoria_plata, revisa que la operación calce en toda la base
--    (turnos y propinas, estaciones, pedidos y sus productos, mesas y mesas unidas, códigos de
--    presencia, sesiones y sellos). La prueba f3-8 exige que salga vacía y que detecte un descuadre
--    hecho a propósito.
-- 2. Índices para las búsquedas más frecuentes (el asesor de Supabase marcó llaves sin índice).
-- 3. Reglas de acceso que calculaban auth.uid() una vez por fila: ahora una vez por consulta.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Auditoría de la operación
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auditoria_operacion()
RETURNS TABLE (tipo text, objeto text, detalle text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Pedidos de antes del estado por producto (fase 3.2) y fichas de lealtad de antes del libro de
  -- movimientos (fase 3.7): vienen de reglas anteriores y no se pueden corregir sin inventar datos.
  desde_productos constant timestamptz := '2026-10-14 12:00:00+00';
  desde_sellos constant timestamptz := '2026-10-14 16:00:00+00';
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'No tienes permiso para este cambio' USING ERRCODE = '42501';
  END IF;

  -- Turnos y propinas ────────────────────────────────────────────────────────
  -- La propina es del mozo de la mesa: si el pago tiene a alguien, es un mozo de ese local.
  RETURN QUERY
  SELECT 'propina_sin_mozo_del_local', p.id::text, format('Pago con propina %s a nombre de %s', p.tip_amount, s.role)
    FROM public.payments p JOIN public.staff_users s ON s.id = p.staff_id
   WHERE s.tenant_id <> p.tenant_id OR s.role <> 'waiter';

  -- El turno de un pago es del mismo mozo que se lleva la propina.
  RETURN QUERY
  SELECT 'turno_de_otro_mozo', p.id::text, 'El pago apunta al turno de otra persona'
    FROM public.payments p JOIN public.turnos t ON t.id = p.turno_id
   WHERE t.staff_id IS DISTINCT FROM p.staff_id;

  -- Un turno es de una persona de su local.
  RETURN QUERY
  SELECT 'turno_de_otro_local', t.id::text, 'Turno de una persona de otro local'
    FROM public.turnos t JOIN public.staff_users s ON s.id = t.staff_id
   WHERE s.tenant_id <> t.tenant_id;

  -- Estaciones ───────────────────────────────────────────────────────────────
  -- Cada sucursal tiene una sola estación principal, activa.
  RETURN QUERY
  SELECT 'estacion_principal', b.id::text, format('La sucursal tiene %s estaciones principales activas', count(s.id))
    FROM public.branches b
    LEFT JOIN public.stations s ON s.branch_id = b.id AND s.es_predeterminada AND s.is_active
   GROUP BY b.id HAVING count(s.id) <> 1;

  -- Un producto se prepara en una estación de la sucursal del pedido.
  RETURN QUERY
  SELECT 'estacion_de_otra_sucursal', oi.id::text, 'El producto está en una estación de otra sucursal'
    FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id JOIN public.stations s ON s.id = oi.station_id
   WHERE s.branch_id <> o.branch_id;

  -- Pedidos y productos ──────────────────────────────────────────────────────
  -- El pedido está en el estado de su producto más atrasado (o cancelado si no queda ninguno vivo).
  RETURN QUERY
  SELECT 'estado_pedido_no_calza', o.id::text, format('Pedido %s en %s y sus productos dicen %s', o.order_number, o.status, x.esperado)
    FROM public.orders o
    JOIN LATERAL (
      SELECT CASE WHEN count(*) FILTER (WHERE oi.status <> 'cancelled') = 0 THEN 'cancelled'
                  ELSE (ARRAY['confirmed', 'in_kitchen', 'ready', 'delivered'])[
                         min(public.rango_estado(oi.status)) FILTER (WHERE oi.status <> 'cancelled')] END AS esperado
        FROM public.order_items oi WHERE oi.order_id = o.id HAVING count(*) > 0) x ON true
   WHERE o.created_at >= desde_productos AND o.status <> x.esperado;

  -- Lo entregado estuvo listo antes, y tiene hora de entrega; lo listo, hora de listo.
  RETURN QUERY
  SELECT 'producto_sin_tiempos', oi.id::text, format('Producto %s sin sus horas (listo %s, entregado %s)', oi.status, oi.ready_at, oi.delivered_at)
    FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id
   WHERE o.created_at >= desde_productos
     AND ((oi.status = 'delivered' AND (oi.delivered_at IS NULL OR oi.ready_at IS NULL OR oi.delivered_at < oi.ready_at))
       OR (oi.status = 'ready' AND oi.ready_at IS NULL)
       OR (oi.avisado_at IS NOT NULL AND oi.ready_at IS NULL));

  -- Mesas, sesiones y mesas unidas ───────────────────────────────────────────
  -- Una sesión abierta no tiene cierre; una cerrada, sí.
  RETURN QUERY
  SELECT 'sesion_incoherente', ts.id::text, format('Sesión %s con cierre %s', CASE WHEN ts.is_active THEN 'abierta' ELSE 'cerrada' END, ts.closed_at)
    FROM public.table_sessions ts
   WHERE ts.is_active = (ts.closed_at IS NOT NULL);

  -- Una mesa con gente sentada no figura libre.
  RETURN QUERY
  SELECT 'mesa_libre_con_sesion', t.id::text, format('Mesa %s libre con una sesión abierta con pedidos', t.number)
    FROM public.tables t
   WHERE t.status = 'free'
     AND EXISTS (SELECT 1 FROM public.table_sessions ts JOIN public.orders o ON o.session_id = ts.id
                  WHERE ts.table_id = t.id AND ts.is_active AND o.status <> 'cancelled');

  -- Una mesa unida apunta a una principal de su sucursal, que no está unida a otra y está ocupada.
  RETURN QUERY
  SELECT 'mesa_unida_incoherente', t.id::text, format('Mesa %s unida a la %s (%s)', t.number, p.number,
         CASE WHEN p.branch_id <> t.branch_id THEN 'otra sucursal' WHEN p.unida_a IS NOT NULL THEN 'que también está unida'
              ELSE 'que está libre' END)
    FROM public.tables t JOIN public.tables p ON p.id = t.unida_a
   WHERE p.branch_id <> t.branch_id OR p.unida_a IS NOT NULL OR p.status = 'free';

  -- Cada mesa tiene su código de presencia, de su mismo local.
  RETURN QUERY
  SELECT 'mesa_sin_codigo', t.id::text, format('Mesa %s sin código de presencia', t.number)
    FROM public.tables t LEFT JOIN public.codigos_mesa c ON c.table_id = t.id
   WHERE c.table_id IS NULL OR c.tenant_id <> t.tenant_id OR c.branch_id <> t.branch_id;

  -- Quien está sentado en una mesa es de ese local.
  RETURN QUERY
  SELECT 'comensal_de_otro_local', cm.id::text, 'Comensal registrado en una mesa de otro local'
    FROM public.comensales_mesa cm JOIN public.tables t ON t.id = cm.table_id
   WHERE cm.tenant_id <> t.tenant_id;

  -- Sellos ───────────────────────────────────────────────────────────────────
  -- Las visitas de la ficha son exactamente los sellos vigentes del libro.
  RETURN QUERY
  SELECT 'visitas_no_calzan', c.id::text, format('La ficha dice %s visitas y el libro tiene %s sellos', c.visits, coalesce(m.n, 0))
    FROM public.loyalty_customers c
    LEFT JOIN (SELECT customer_id, count(*) AS n FROM public.movimientos_lealtad WHERE sello AND anulado_at IS NULL GROUP BY 1) m
      ON m.customer_id = c.id
   WHERE c.created_at >= desde_sellos AND c.visits <> coalesce(m.n, 0);

  -- Un movimiento es del mismo local que su pago, y un pago devuelto entero no deja sello vigente
  -- (salvo que su premio ya se haya entregado: ese sello quedó consumido).
  RETURN QUERY
  SELECT 'sello_incoherente', m.id::text,
         CASE WHEN p.tenant_id <> m.tenant_id THEN 'Movimiento de otro local que su pago'
              ELSE 'Sello vigente de un pago devuelto entero' END
    FROM public.movimientos_lealtad m JOIN public.payments p ON p.id = m.payment_id
    LEFT JOIN public.loyalty_rewards r ON r.id = m.premio_id
   WHERE p.tenant_id <> m.tenant_id
      OR (p.status = 'refunded' AND m.anulado_at IS NULL AND (m.sello OR m.puntos > 0) AND coalesce(r.status, '') <> 'redeemed');

  -- Un premio por entregar tiene código y su sello sigue vigente; uno entregado, fecha y quién.
  RETURN QUERY
  SELECT 'premio_incoherente', r.id::text,
         CASE WHEN r.status = 'earned' AND r.codigo IS NULL THEN 'Premio por entregar sin código'
              WHEN r.status = 'earned' THEN 'Premio por entregar de un sello anulado'
              ELSE 'Premio entregado sin fecha o sin quién lo entregó' END
    FROM public.loyalty_rewards r LEFT JOIN public.movimientos_lealtad m ON m.id = r.movimiento_id
   WHERE r.created_at >= desde_sellos
     AND ((r.status = 'earned' AND (r.codigo IS NULL OR m.anulado_at IS NOT NULL))
       OR (r.status = 'redeemed' AND (r.redeemed_at IS NULL OR r.entregado_por IS NULL)));
END;
$$;
REVOKE ALL ON FUNCTION public.auditoria_operacion() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auditoria_operacion() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Índices para las búsquedas frecuentes
-- ─────────────────────────────────────────────────────────────────────────────
-- Solo los que usan las pantallas en vivo (mesas, cocina, seguimiento, caja, sellos). El resto de las
-- llaves sin índice son de tablas chicas (backoffice, configuración) y no lo necesitan.
CREATE INDEX IF NOT EXISTS order_items_order_idx ON public.order_items (order_id);
CREATE INDEX IF NOT EXISTS order_items_station_idx ON public.order_items (station_id);
CREATE INDEX IF NOT EXISTS orders_session_idx ON public.orders (session_id);
CREATE INDEX IF NOT EXISTS orders_table_idx ON public.orders (table_id);
CREATE INDEX IF NOT EXISTS orders_branch_created_idx ON public.orders (branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payments_order_idx ON public.payments (order_id);
CREATE INDEX IF NOT EXISTS payments_table_idx ON public.payments (table_id);
CREATE INDEX IF NOT EXISTS payments_user_idx ON public.payments (user_id);
CREATE INDEX IF NOT EXISTS table_sessions_branch_idx ON public.table_sessions (branch_id);
CREATE INDEX IF NOT EXISTS tables_branch_idx ON public.tables (branch_id);
CREATE INDEX IF NOT EXISTS tables_unida_a_idx ON public.tables (unida_a) WHERE unida_a IS NOT NULL;
CREATE INDEX IF NOT EXISTS waiter_calls_table_idx ON public.waiter_calls (table_id);
CREATE INDEX IF NOT EXISTS waiter_calls_branch_idx ON public.waiter_calls (branch_id);
CREATE INDEX IF NOT EXISTS bill_requests_table_idx ON public.bill_requests (table_id);
CREATE INDEX IF NOT EXISTS comensales_mesa_table_idx ON public.comensales_mesa (table_id);
CREATE INDEX IF NOT EXISTS cotizaciones_table_idx ON public.cotizaciones (table_id);
CREATE INDEX IF NOT EXISTS intentos_pago_payment_idx ON public.intentos_pago (payment_id);
CREATE INDEX IF NOT EXISTS menu_items_category_idx ON public.menu_items (category_id);
CREATE INDEX IF NOT EXISTS categories_menu_idx ON public.categories (menu_id);
CREATE INDEX IF NOT EXISTS modifier_groups_item_idx ON public.modifier_groups (menu_item_id);
CREATE INDEX IF NOT EXISTS modifiers_group_idx ON public.modifiers (group_id);
CREATE INDEX IF NOT EXISTS menus_branch_idx ON public.menus (branch_id);
CREATE INDEX IF NOT EXISTS staff_users_auth_user_idx ON public.staff_users (auth_user_id);
CREATE INDEX IF NOT EXISTS tenant_members_tenant_idx ON public.tenant_members (tenant_id);
CREATE INDEX IF NOT EXISTS loyalty_customers_user_idx ON public.loyalty_customers (user_id);
CREATE INDEX IF NOT EXISTS loyalty_rewards_movimiento_idx ON public.loyalty_rewards (movimiento_id);
CREATE INDEX IF NOT EXISTS movimientos_lealtad_premio_idx ON public.movimientos_lealtad (premio_id);
CREATE INDEX IF NOT EXISTS table_events_session_idx ON public.table_events (session_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Reglas de acceso: auth.uid() una vez por consulta, no una vez por fila
-- ─────────────────────────────────────────────────────────────────────────────
-- Misma regla, mismo resultado: solo se envuelve auth.uid() en un SELECT para que Postgres lo calcule
-- una sola vez (recomendación del asesor de Supabase, "auth_rls_initplan").
DO $$
DECLARE
  pol record;
  usando text;
  chequeo text;
  sql text;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname, qual, with_check FROM pg_policies
     WHERE schemaname = 'public'
       AND (qual ~ 'auth\.uid\(\)' OR with_check ~ 'auth\.uid\(\)')
  LOOP
    usando := regexp_replace(pol.qual, '(?<!SELECT )auth\.uid\(\)', '(SELECT auth.uid())', 'g');
    chequeo := regexp_replace(pol.with_check, '(?<!SELECT )auth\.uid\(\)', '(SELECT auth.uid())', 'g');
    IF usando IS NOT DISTINCT FROM pol.qual AND chequeo IS NOT DISTINCT FROM pol.with_check THEN
      CONTINUE;
    END IF;
    sql := format('ALTER POLICY %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);
    IF usando IS NOT NULL THEN sql := sql || format(' USING (%s)', usando); END IF;
    IF chequeo IS NOT NULL THEN sql := sql || format(' WITH CHECK (%s)', chequeo); END IF;
    EXECUTE sql;
  END LOOP;
END;
$$;
