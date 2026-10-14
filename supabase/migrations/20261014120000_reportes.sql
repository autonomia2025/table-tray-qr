-- Fase 3.6 — Reportes calculados por el servidor e inicio del dueño que cuenta una historia (brief 5.5).
-- Antes, los reportes traían todos los pedidos al navegador y los sumaban ahí: contaban como venta
-- pedidos sin pagar, usaban días en UTC (en Chile, de 21:00 a 20:59) y se ponían lentos con el volumen.
-- Ahora la base calcula todo por día de negocio (hora de Chile, con la hora de corte de la sucursal):
--   · reporte_local(): ventas (lo cobrado menos lo reembolsado), comparación con el período anterior,
--     por día, por canal, mapa de calor de horas, platos (y los que no se venden), categorías,
--     productividad de cocina (qué platos traban), zonas y mesas, clientes que vuelven y calificación.
--   · historia_del_local(): los datos para contar "cómo te fue" en el inicio del dueño.
-- Solo dueño, administrador y encargado (y el superadmin).

CREATE OR REPLACE FUNCTION public._tenant_reportes(_branch_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  local uuid;
BEGIN
  SELECT tenant_id INTO local FROM public.branches WHERE id = _branch_id;
  IF local IS NULL OR NOT (public.tiene_rol(local, ARRAY['owner', 'admin', 'manager']) OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Solo el dueño o el encargado ven los reportes' USING ERRCODE = '42501';
  END IF;
  RETURN local;
END;
$$;
REVOKE ALL ON FUNCTION public._tenant_reportes(uuid) FROM PUBLIC, anon, authenticated;

-- Ventas de consumo (sin propina) netas de lo reembolsado, de un rango de días de negocio
CREATE OR REPLACE FUNCTION public._ventas_dias(_branch_id uuid, _desde date, _hasta date)
RETURNS TABLE (ventas bigint, pagos bigint, propinas bigint, reembolsado bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(sum(p.amount - least(coalesce(p.refunded_amount, 0), p.amount)), 0),
         count(*),
         coalesce(sum(greatest(0, p.tip_amount - greatest(0, coalesce(p.refunded_amount, 0) - p.amount))), 0),
         coalesce(sum(coalesce(p.refunded_amount, 0)), 0)
    FROM public.payments p
   WHERE p.branch_id = _branch_id AND p.dia_negocio BETWEEN _desde AND _hasta AND p.status <> 'failed'
$$;
REVOKE ALL ON FUNCTION public._ventas_dias(uuid, date, date) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. El reporte del local
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reporte_local(_branch_id uuid, _desde date, _hasta date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  local uuid;
  dias integer;
  v record;
  actual record;
  previo record;
  pedidos integer;
  pedidos_prev integer;
BEGIN
  local := public._tenant_reportes(_branch_id);
  IF _hasta < _desde OR _hasta - _desde > 366 THEN
    RAISE EXCEPTION 'Elige un período de hasta un año' USING ERRCODE = 'P0001';
  END IF;
  dias := _hasta - _desde + 1;
  SELECT * INTO v FROM public._ventana_dias(_branch_id, _desde, _hasta);
  SELECT * INTO actual FROM public._ventas_dias(_branch_id, _desde, _hasta);
  SELECT * INTO previo FROM public._ventas_dias(_branch_id, _desde - dias, _desde - 1);
  SELECT count(*) INTO pedidos FROM public.orders
   WHERE branch_id = _branch_id AND status <> 'cancelled' AND created_at >= v.desde AND created_at < v.hasta;
  SELECT count(*) INTO pedidos_prev FROM public.orders o, public._ventana_dias(_branch_id, _desde - dias, _desde - 1) w
   WHERE o.branch_id = _branch_id AND o.status <> 'cancelled' AND o.created_at >= w.desde AND o.created_at < w.hasta;

  RETURN jsonb_build_object(
    'desde', _desde, 'hasta', _hasta, 'dias', dias,
    'resumen', jsonb_build_object(
      'ventas', actual.ventas, 'pagos', actual.pagos, 'propinas', actual.propinas, 'reembolsado', actual.reembolsado,
      'ticket', CASE WHEN actual.pagos > 0 THEN round(actual.ventas::numeric / actual.pagos) ELSE 0 END,
      'pedidos', pedidos,
      'visitas', (SELECT count(*) FROM public.table_sessions WHERE branch_id = _branch_id AND closed_at >= v.desde AND closed_at < v.hasta)),
    'anterior', jsonb_build_object(
      'ventas', previo.ventas, 'pagos', previo.pagos, 'pedidos', pedidos_prev,
      'ticket', CASE WHEN previo.pagos > 0 THEN round(previo.ventas::numeric / previo.pagos) ELSE 0 END),
    -- Cada día del período (también los que no vendieron)
    'por_dia', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('dia', d.dia::date, 'ventas', coalesce(x.ventas, 0), 'pagos', coalesce(x.pagos, 0)) ORDER BY d.dia), '[]'::jsonb)
        FROM generate_series(_desde, _hasta, interval '1 day') AS d(dia)
        LEFT JOIN (SELECT p.dia_negocio, sum(p.amount - least(coalesce(p.refunded_amount, 0), p.amount)) AS ventas, count(*) AS pagos
                     FROM public.payments p
                    WHERE p.branch_id = _branch_id AND p.dia_negocio BETWEEN _desde AND _hasta AND p.status <> 'failed'
                    GROUP BY p.dia_negocio) x ON x.dia_negocio = d.dia::date),
    'canales', (
      SELECT jsonb_build_object(
        'app', coalesce(sum(p.amount) FILTER (WHERE p.provider <> 'local'), 0),
        'efectivo', coalesce(sum(p.amount) FILTER (WHERE p.provider = 'local' AND p.method = 'cash'), 0),
        'pos', coalesce(sum(p.amount) FILTER (WHERE p.provider = 'local' AND p.method = 'pos'), 0))
        FROM public.payments p
       WHERE p.branch_id = _branch_id AND p.dia_negocio BETWEEN _desde AND _hasta AND p.status <> 'failed'),
    -- Mapa de calor: día de la semana del día de negocio (1 = lunes; la 1 AM del sábado es del viernes) y hora de Chile
    'horas', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('dia_semana', x.dow, 'hora', x.hora, 'ventas', x.ventas, 'pagos', x.pagos)), '[]'::jsonb)
        FROM (SELECT extract(isodow FROM p.dia_negocio)::integer AS dow,
                     extract(hour FROM p.created_at AT TIME ZONE 'America/Santiago')::integer AS hora,
                     sum(p.amount - least(coalesce(p.refunded_amount, 0), p.amount)) AS ventas, count(*) AS pagos
                FROM public.payments p
               WHERE p.branch_id = _branch_id AND p.dia_negocio BETWEEN _desde AND _hasta AND p.status <> 'failed'
               GROUP BY 1, 2) x),
    'platos', (
      SELECT coalesce(jsonb_agg(x ORDER BY x.ventas DESC), '[]'::jsonb) FROM (
        SELECT oi.menu_item_name AS nombre, sum(oi.quantity) AS cantidad, sum(oi.subtotal) AS ventas
          FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id
         WHERE o.branch_id = _branch_id AND o.payment_status = 'paid' AND oi.status <> 'cancelled'
           AND o.created_at >= v.desde AND o.created_at < v.hasta
         GROUP BY oi.menu_item_name ORDER BY sum(oi.subtotal) DESC LIMIT 15) x),
    'sin_ventas', (
      SELECT coalesce(jsonb_agg(mi.name ORDER BY mi.name), '[]'::jsonb)
        FROM public.menu_items mi
       WHERE mi.tenant_id = local AND mi.status = 'available'
         AND NOT EXISTS (SELECT 1 FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id
                          WHERE oi.menu_item_id = mi.id AND o.branch_id = _branch_id
                            AND o.created_at >= v.desde AND o.created_at < v.hasta AND o.status <> 'cancelled')),
    'categorias', (
      SELECT coalesce(jsonb_agg(x ORDER BY x.ventas DESC), '[]'::jsonb) FROM (
        SELECT coalesce(c.name, 'Sin categoría') AS nombre, sum(oi.quantity) AS cantidad, sum(oi.subtotal) AS ventas
          FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id
          LEFT JOIN public.menu_items mi ON mi.id = oi.menu_item_id
          LEFT JOIN public.categories c ON c.id = mi.category_id
         WHERE o.branch_id = _branch_id AND o.payment_status = 'paid' AND oi.status <> 'cancelled'
           AND o.created_at >= v.desde AND o.created_at < v.hasta
         GROUP BY 1) x),
    -- Productividad de cocina: lo que más tarda (mediana y el 90% de las veces), con al menos 3 casos
    'cocina', (
      SELECT coalesce(jsonb_agg(x ORDER BY x.mediana_min DESC), '[]'::jsonb) FROM (
        SELECT oi.menu_item_name AS nombre, s.name AS estacion, count(*) AS preparados,
               round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (oi.ready_at - oi.started_at)) / 60.0))::numeric, 1) AS mediana_min,
               round((percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM (oi.ready_at - oi.started_at)) / 60.0))::numeric, 1) AS p90_min,
               max(mi.prep_time_minutes) AS objetivo_min
          FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id
          LEFT JOIN public.stations s ON s.id = oi.station_id
          LEFT JOIN public.menu_items mi ON mi.id = oi.menu_item_id
         WHERE o.branch_id = _branch_id AND oi.ready_at IS NOT NULL AND oi.started_at IS NOT NULL AND oi.ready_at > oi.started_at
           AND oi.ready_at >= v.desde AND oi.ready_at < v.hasta
         GROUP BY oi.menu_item_name, s.name HAVING count(*) >= 3
         ORDER BY 4 DESC LIMIT 10) x),
    'zonas', (
      SELECT coalesce(jsonb_agg(x ORDER BY x.ventas DESC), '[]'::jsonb) FROM (
        SELECT coalesce(nullif(btrim(t.zone), ''), 'Sin zona') AS zona,
               sum(p.amount - least(coalesce(p.refunded_amount, 0), p.amount)) AS ventas, count(DISTINCT p.session_id) AS visitas
          FROM public.payments p JOIN public.tables t ON t.id = p.table_id
         WHERE p.branch_id = _branch_id AND p.dia_negocio BETWEEN _desde AND _hasta AND p.status <> 'failed'
         GROUP BY 1) x),
    'mesas', (
      SELECT coalesce(jsonb_agg(x ORDER BY x.ventas DESC), '[]'::jsonb) FROM (
        SELECT t.number AS numero, coalesce(sum(p.amount - least(coalesce(p.refunded_amount, 0), p.amount)), 0) AS ventas,
               (SELECT count(*) FROM public.table_sessions ts WHERE ts.table_id = t.id AND ts.closed_at >= v.desde AND ts.closed_at < v.hasta) AS visitas,
               (SELECT round(avg(extract(epoch FROM (ts.closed_at - ts.opened_at)) / 60.0)) FROM public.table_sessions ts
                 WHERE ts.table_id = t.id AND ts.closed_at >= v.desde AND ts.closed_at < v.hasta) AS duracion_min
          FROM public.tables t
          LEFT JOIN public.payments p ON p.table_id = t.id AND p.dia_negocio BETWEEN _desde AND _hasta AND p.status <> 'failed'
         WHERE t.branch_id = _branch_id
         GROUP BY t.id, t.number) x),
    -- Clientes: quiénes vuelven (pidieron antes de este período) y quiénes son nuevos
    'clientes', (
      SELECT jsonb_build_object(
        'personas', count(*),
        'vuelven', count(*) FILTER (WHERE x.antes),
        'nuevas', count(*) FILTER (WHERE NOT x.antes))
        FROM (SELECT o.user_id,
                     EXISTS (SELECT 1 FROM public.orders o2 WHERE o2.user_id = o.user_id AND o2.tenant_id = local
                               AND o2.created_at < v.desde AND o2.status <> 'cancelled') AS antes
                FROM public.orders o
               WHERE o.branch_id = _branch_id AND o.user_id IS NOT NULL AND o.status <> 'cancelled'
                 AND o.created_at >= v.desde AND o.created_at < v.hasta
               GROUP BY o.user_id) x),
    'calificacion', (
      SELECT jsonb_build_object('promedio', round(avg(rating)::numeric, 1), 'cantidad', count(rating))
        FROM public.table_sessions
       WHERE branch_id = _branch_id AND closed_at >= v.desde AND closed_at < v.hasta AND rating IS NOT NULL)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.reporte_local(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reporte_local(uuid, date, date) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. La historia para el inicio del dueño
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.historia_del_local(_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  local uuid;
  hoy date;
  ultimo date;
  v record;
  w7 record;
  hoy_v record;
  ult record;
  comp record;
  sem record;
  sem_prev record;
BEGIN
  local := public._tenant_reportes(_branch_id);
  hoy := public.dia_negocio(_branch_id, now());
  -- El último día con ventas antes de hoy ("anoche", si fue ayer)
  SELECT max(dia_negocio) INTO ultimo FROM public.payments
   WHERE branch_id = _branch_id AND dia_negocio < hoy AND status <> 'failed';
  SELECT * INTO hoy_v FROM public._ventas_dias(_branch_id, hoy, hoy);

  IF ultimo IS NULL THEN
    RETURN jsonb_build_object('hoy', jsonb_build_object('dia', hoy, 'ventas', hoy_v.ventas, 'pagos', hoy_v.pagos,
                                'mesas_abiertas', (SELECT count(*) FROM public.table_sessions WHERE branch_id = _branch_id AND is_active)),
                              'ultimo', NULL);
  END IF;

  SELECT * INTO v FROM public._ventana_dias(_branch_id, ultimo, ultimo);
  SELECT * INTO w7 FROM public._ventana_dias(_branch_id, hoy - 7, hoy - 1);
  SELECT * INTO ult FROM public._ventas_dias(_branch_id, ultimo, ultimo);
  SELECT * INTO comp FROM public._ventas_dias(_branch_id, ultimo - 7, ultimo - 7);
  SELECT * INTO sem FROM public._ventas_dias(_branch_id, hoy - 7, hoy - 1);
  SELECT * INTO sem_prev FROM public._ventas_dias(_branch_id, hoy - 14, hoy - 8);

  RETURN jsonb_build_object(
    'hoy', jsonb_build_object('dia', hoy, 'ventas', hoy_v.ventas, 'pagos', hoy_v.pagos,
                              'mesas_abiertas', (SELECT count(*) FROM public.table_sessions WHERE branch_id = _branch_id AND is_active)),
    'ultimo', jsonb_build_object(
      'dia', ultimo, 'es_ayer', ultimo = hoy - 1, 'ventas', ult.ventas, 'pagos', ult.pagos,
      'ticket', CASE WHEN ult.pagos > 0 THEN round(ult.ventas::numeric / ult.pagos) ELSE 0 END,
      'propinas', ult.propinas,
      'mejor_plato', (SELECT jsonb_build_object('nombre', oi.menu_item_name, 'cantidad', sum(oi.quantity))
                        FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id
                       WHERE o.branch_id = _branch_id AND o.payment_status = 'paid' AND oi.status <> 'cancelled'
                         AND o.created_at >= v.desde AND o.created_at < v.hasta
                       GROUP BY oi.menu_item_name ORDER BY sum(oi.quantity) DESC LIMIT 1),
      'mejor_zona', (SELECT jsonb_build_object('zona', t.zone, 'ventas', sum(p.amount))
                       FROM public.payments p JOIN public.tables t ON t.id = p.table_id
                      WHERE p.branch_id = _branch_id AND p.dia_negocio = ultimo AND p.status <> 'failed'
                        AND nullif(btrim(t.zone), '') IS NOT NULL
                      GROUP BY t.zone ORDER BY sum(p.amount) DESC LIMIT 1),
      'hora_pico', (SELECT jsonb_build_object('hora', x.hora, 'ventas', x.ventas)
                      FROM (SELECT extract(hour FROM p.created_at AT TIME ZONE 'America/Santiago')::integer AS hora, sum(p.amount) AS ventas
                              FROM public.payments p
                             WHERE p.branch_id = _branch_id AND p.dia_negocio = ultimo AND p.status <> 'failed'
                             GROUP BY 1 ORDER BY 2 DESC LIMIT 1) x),
      'mozo', (SELECT jsonb_build_object('nombre', s.name, 'ventas', sum(p.amount))
                 FROM public.payments p JOIN public.staff_users s ON s.id = p.staff_id
                WHERE p.branch_id = _branch_id AND p.dia_negocio = ultimo AND p.status <> 'failed'
                GROUP BY s.name ORDER BY sum(p.amount) DESC LIMIT 1),
      'calificacion', (SELECT round(avg(rating)::numeric, 1) FROM public.table_sessions
                        WHERE branch_id = _branch_id AND closed_at >= v.desde AND closed_at < v.hasta AND rating IS NOT NULL)),
    'mismo_dia_semana_pasada', jsonb_build_object('dia', ultimo - 7, 'ventas', comp.ventas),
    'semana', jsonb_build_object('ventas', sem.ventas, 'anterior', sem_prev.ventas),
    'alertas', jsonb_build_object(
      'agotados', (SELECT coalesce(jsonb_agg(name ORDER BY name), '[]'::jsonb) FROM public.menu_items
                    WHERE tenant_id = local AND status = 'out_of_stock'),
      -- Un plato que tarda claramente más de lo que dice la carta (últimos 7 días, al menos 5 veces)
      'plato_lento', (SELECT jsonb_build_object('nombre', x.nombre, 'mediana_min', x.mediana, 'objetivo_min', x.objetivo)
                        FROM (SELECT oi.menu_item_name AS nombre, max(mi.prep_time_minutes) AS objetivo,
                                     round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (oi.ready_at - oi.started_at)) / 60.0))::numeric) AS mediana
                                FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id
                                LEFT JOIN public.menu_items mi ON mi.id = oi.menu_item_id
                               WHERE o.branch_id = _branch_id AND oi.ready_at >= w7.desde AND oi.ready_at < w7.hasta
                                 AND oi.started_at IS NOT NULL AND oi.ready_at > oi.started_at
                               GROUP BY oi.menu_item_name HAVING count(*) >= 5) x
                       WHERE x.objetivo > 0 AND x.mediana >= x.objetivo * 1.5
                       ORDER BY x.mediana - x.objetivo DESC LIMIT 1),
      'perdido_7_dias', (SELECT coalesce(sum(total_amount), 0) FROM public.orders
                          WHERE branch_id = _branch_id AND perdido_at >= w7.desde AND perdido_at < w7.hasta + interval '1 day'))
  );
END;
$$;
REVOKE ALL ON FUNCTION public.historia_del_local(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.historia_del_local(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Historia de ejemplo para el local de demo
-- ─────────────────────────────────────────────────────────────────────────────
-- Al reiniciar el demo se borra todo, y el inicio y los reportes quedaban vacíos: no servían para
-- mostrarle Tablio a un dueño. Esto siembra 4 semanas de ventas creíbles (más gente el fin de semana,
-- peaks de almuerzo y noche, platos estrella, propinas, calificaciones, días cerrados en caja) y una
-- chorrillana que últimamente sale lenta, para que el inicio tenga algo que contar.
-- Solo toca el local de demo, solo días anteriores a hoy (hoy queda limpio para probar) y cada pago
-- cuadra con sus pedidos: auditoria_plata() sigue vacía. Determinista (misma semilla, misma historia).
CREATE OR REPLACE FUNCTION public._sembrar_historia_demo(_dias integer DEFAULT 28)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  demo constant uuid := '651c363f-0084-50af-9873-be98cfeaaf47';
  sucursal uuid;
  hoy date;
  d date;
  mozos uuid[];
  mesas uuid[];
  platos uuid[];
  horas integer[] := ARRAY[13, 13, 14, 14, 14, 15, 19, 20, 20, 21, 21, 21, 22, 22, 22, 23, 23, 0, 1];
  visitas integer;
  hora integer;
  numero integer;
  inicio timestamptz;
  t timestamptz;
  fin timestamptz;
  mozo uuid;
  mozo_auth uuid;
  sesion uuid;
  pedido uuid;
  total integer;
  propina integer;
  pagado integer;
  propinas integer;
  forma text;
  metodo text;
  plato record;
  elegido uuid;
  cant integer;
  prep numeric;
  listo timestamptz;
  creados integer := 0;
  r jsonb;
BEGIN
  SELECT id INTO sucursal FROM public.branches WHERE tenant_id = demo ORDER BY created_at LIMIT 1;
  IF sucursal IS NULL THEN RETURN 0; END IF;
  hoy := public.dia_negocio(sucursal, now());
  PERFORM setseed(0.36);

  SELECT array_agg(id ORDER BY name) INTO mozos FROM public.staff_users
   WHERE tenant_id = demo AND role = 'waiter' AND is_active;
  SELECT array_agg(id ORDER BY number) INTO mesas FROM public.tables WHERE branch_id = sucursal;
  -- Los más pedidos aparecen más veces en la bolsa
  SELECT array_agg(m.id ORDER BY m.name) INTO platos
    FROM public.menu_items m
    CROSS JOIN LATERAL generate_series(1, CASE
      WHEN m.name IN ('Schop Torobayo 500cc', 'Piscola', 'Papas fritas') THEN 6
      WHEN m.name IN ('Chorrillana para 2', 'Barros Luco', 'Hamburguesa Tablio', 'Schop Calafate 500cc', 'Pisco Sour') THEN 4
      WHEN m.name IN ('Terremoto', 'Empanaditas de queso (6)', 'Bebida en lata', 'Michelada', 'Chacarero') THEN 2
      ELSE 1 END)
   WHERE m.tenant_id = demo AND m.status = 'available';
  IF mozos IS NULL OR mesas IS NULL OR platos IS NULL THEN RETURN 0; END IF;

  FOR k IN REVERSE _dias..1 LOOP
    d := hoy - k;
    numero := 0;
    -- Lunes flojo, viernes y sábado llenos; las últimas semanas un poco mejor que las primeras
    visitas := (ARRAY[6, 7, 8, 11, 16, 19, 9])[extract(isodow FROM d)::integer]
               + floor(random() * 4)::integer - 1 + CASE WHEN k <= 14 THEN 1 ELSE 0 END;
    FOR i IN 1..visitas LOOP
      hora := horas[1 + floor(random() * array_length(horas, 1))::integer];
      -- Después de medianoche solo de jueves a sábado
      IF hora < 6 AND extract(isodow FROM d) NOT IN (4, 5, 6) THEN hora := 20 + floor(random() * 3)::integer; END IF;
      inicio := ((d::timestamp + make_interval(hours => hora)) AT TIME ZONE 'America/Santiago');
      IF extract(hour FROM inicio AT TIME ZONE 'America/Santiago') < 6 THEN inicio := inicio + interval '1 day'; END IF;
      inicio := inicio + make_interval(mins => floor(random() * 60)::integer);
      mozo := mozos[1 + floor(random() * array_length(mozos, 1))::integer];
      SELECT auth_user_id INTO mozo_auth FROM public.staff_users WHERE id = mozo;

      INSERT INTO public.table_sessions (tenant_id, table_id, branch_id, opened_at, is_active, staff_id)
      VALUES (demo, mesas[1 + floor(random() * array_length(mesas, 1))::integer], sucursal, inicio, false, mozo)
      RETURNING id INTO sesion;

      pagado := 0;
      propinas := 0;
      fin := inicio;
      FOR j IN 1..(1 + (random() < 0.45)::integer + (random() < 0.15)::integer) LOOP
        t := inicio + make_interval(mins => (j - 1) * 25 + floor(random() * 6)::integer);
        numero := numero + 1;
        forma := CASE WHEN random() < 0.78 THEN 'app' ELSE 'mozo' END;
        metodo := CASE WHEN forma = 'app' THEN 'card' WHEN random() < 0.6 THEN 'cash' ELSE 'pos' END;

        INSERT INTO public.orders (tenant_id, session_id, table_id, branch_id, order_number, status, source,
                                   total_amount, payment_status, forma_pago, created_at, confirmed_at, paid_at,
                                   kitchen_accepted_at)
        SELECT demo, sesion, ts.table_id, sucursal, numero, 'delivered', 'customer_qr', 0, 'paid', forma,
               t, t, t + interval '2 minutes', t + interval '3 minutes'
          FROM public.table_sessions ts WHERE ts.id = sesion
        RETURNING id INTO pedido;

        total := 0;
        listo := t;
        FOR l IN 1..(1 + floor(random() * 3)::integer) LOOP
          elegido := platos[1 + floor(random() * array_length(platos, 1))::integer];
          SELECT * INTO plato FROM public.menu_items WHERE id = elegido;
          cant := CASE WHEN random() < 0.8 THEN 1 ELSE 2 END;
          prep := greatest(1, plato.prep_time_minutes) * (0.75 + random() * 0.6);
          -- La chorrillana viene saliendo lenta esta semana: el inicio lo avisa
          IF plato.name = 'Chorrillana para 2' AND k <= 7 THEN prep := prep * 1.8; END IF;
          INSERT INTO public.order_items (tenant_id, order_id, menu_item_id, menu_item_name, unit_price, quantity,
                                          subtotal, status, created_at, started_at, ready_at, delivered_at, delivered_by)
          VALUES (demo, pedido, plato.id, plato.name, plato.price, cant, plato.price * cant, 'delivered', t,
                  t + interval '3 minutes', t + interval '3 minutes' + make_interval(secs => prep * 60),
                  t + interval '3 minutes' + make_interval(secs => prep * 60 + 60 + floor(random() * 240)), mozo_auth);
          total := total + plato.price * cant;
          listo := greatest(listo, t + interval '3 minutes' + make_interval(secs => prep * 60));
        END LOOP;
        UPDATE public.orders SET total_amount = total, ready_at = listo, delivered_at = listo + interval '3 minutes'
         WHERE id = pedido;

        -- Propina sugerida del 10%: la mayoría la deja con la app, menos en efectivo
        propina := CASE WHEN random() < CASE WHEN forma = 'app' THEN 0.6 ELSE 0.3 END
                        THEN (round(total * 0.1 / 100) * 100)::integer ELSE 0 END;
        INSERT INTO public.payments (tenant_id, branch_id, session_id, table_id, order_id, amount, tip_amount,
                                     method, status, provider, staff_id, pedidos, created_at)
        SELECT demo, sucursal, sesion, o.table_id, pedido, total, propina, metodo, 'approved',
               CASE WHEN forma = 'app' THEN 'simulated' ELSE 'local' END, mozo, ARRAY[pedido], t + interval '2 minutes'
          FROM public.orders o WHERE o.id = pedido;
        UPDATE public.payments SET dia_negocio = d, created_at = t + interval '2 minutes', updated_at = t + interval '2 minutes'
         WHERE order_id = pedido;
        pagado := pagado + total;
        propinas := propinas + propina;
        fin := greatest(fin, listo + interval '3 minutes');
        creados := creados + 1;
      END LOOP;

      UPDATE public.table_sessions
         SET closed_at = fin + make_interval(mins => 15 + floor(random() * 30)::integer),
             paid_amount = pagado, tip_amount = propinas,
             rating = CASE WHEN random() < 0.35 THEN
                        CASE WHEN random() < 0.62 THEN 5 WHEN random() < 0.8 THEN 4 ELSE 3 END END
       WHERE id = sesion;
    END LOOP;

    -- El día quedó cerrado y cuadrado en caja, como lo haría el local
    r := public._conciliar_dia(sucursal, d);
    INSERT INTO public.payment_settlements (
      tenant_id, branch_id, settlement_date, provider, expected_amount, settled_amount, difference, payments_count,
      total_neto, efectivo_esperado, efectivo_contado, diferencia_efectivo, pos_esperado, pos_contado, diferencia_pos,
      detalle, status, notes, closed_by_name, closed_at)
    VALUES (demo, sucursal, d, 'simulated', (r -> 'app' ->> 'esperado')::integer, (r -> 'app' ->> 'esperado')::integer,
            0, (r ->> 'pagos')::integer, (r ->> 'total_neto')::integer,
            (r -> 'efectivo' ->> 'esperado')::integer, (r -> 'efectivo' ->> 'esperado')::integer, 0,
            (r -> 'pos' ->> 'esperado')::integer, (r -> 'pos' ->> 'esperado')::integer, 0,
            r, 'closed', 'Historia de ejemplo del demo', 'Caja Demo',
            ((d + 1)::timestamp + interval '4 hours 30 minutes') AT TIME ZONE 'America/Santiago')
    ON CONFLICT (branch_id, settlement_date) DO NOTHING;
  END LOOP;
  RETURN creados;
END;
$$;
REVOKE ALL ON FUNCTION public._sembrar_historia_demo(integer) FROM PUBLIC, anon, authenticated;

-- El reinicio del demo deja la historia de ejemplo
DO $$
DECLARE
  def text;
BEGIN
  SELECT pg_get_functiondef('public.reiniciar_demo()'::regprocedure) INTO def;
  IF position('_sembrar_historia_demo' IN def) = 0 THEN
    def := replace(def, '  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, metadata)
  VALUES (demo, auth.uid(), ''demo_reiniciado''',
                   '  PERFORM public._sembrar_historia_demo();

  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, metadata)
  VALUES (demo, auth.uid(), ''demo_reiniciado''');
    IF position('_sembrar_historia_demo' IN def) = 0 THEN
      RAISE EXCEPTION 'No se pudo agregar la historia de ejemplo al reinicio del demo';
    END IF;
    EXECUTE def;
  END IF;
END;
$$;
