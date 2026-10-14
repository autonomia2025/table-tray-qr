-- Fase 3.4 — La mesa en vivo (para el comensal).
--   · mi_mesa_en_vivo(): quién está en la mesa (alias o "invitado") y el estado de MIS pedidos por
--     producto y estación ("tu cerveza está lista, la comida sigue en cocina"), con un tiempo estimado
--     real: el tiempo de cada plato (lo que de verdad tardó las últimas veces, o el que puso el dueño) más
--     lo cargada que está su estación.
--   · lo_de_siempre(): lo que esta persona pide visita tras visita en este local (sirve también para un
--     invitado que vuelve con el mismo celular), para pedirlo con un toque.
-- El comensal no lee estaciones ni pedidos ajenos: todo pasa por estas funciones.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Tiempo de un plato: lo que tardó de verdad (mediana de los últimos 30 días, con al menos 5 casos)
--    o, si no hay historia, el tiempo que puso el dueño (10 min si no puso nada).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._minutos_plato(_menu_item_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT CASE WHEN count(*) >= 5
                 THEN percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (oi.ready_at - oi.started_at)) / 60.0)
            END
       FROM public.order_items oi
      WHERE oi.menu_item_id = _menu_item_id AND oi.ready_at IS NOT NULL AND oi.started_at IS NOT NULL
        AND oi.ready_at > oi.started_at AND oi.ready_at > now() - interval '30 days')::numeric,
    (SELECT nullif(prep_time_minutes, 0)::numeric FROM public.menu_items WHERE id = _menu_item_id),
    10)
$$;
REVOKE ALL ON FUNCTION public._minutos_plato(uuid) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. La mesa en vivo
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mi_mesa_en_vivo(_qr_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  prepago boolean;
  personas jsonb;
  pedidos jsonb;
BEGIN
  SELECT * INTO c FROM public._comensal_en_mesa(_qr_token);
  SELECT payment_mode = 'prepaid' INTO prepago FROM public.branches WHERE id = (c.mesa).branch_id;

  -- Quién está en la mesa: su alias o "Invitado"; yo primero
  SELECT coalesce(jsonb_agg(jsonb_build_object('alias', cm.alias, 'yo', cm.user_id = auth.uid())
                            ORDER BY (cm.user_id = auth.uid()) DESC, cm.created_at), '[]'::jsonb)
    INTO personas
    FROM public.comensales_mesa cm WHERE cm.session_id = c.sesion;

  -- Mis pedidos de esta visita, con cada producto, su estación y cuánto falta
  SELECT coalesce(jsonb_agg(p ORDER BY p ->> 'creado'), '[]'::jsonb) INTO pedidos
    FROM (
      SELECT jsonb_build_object(
               'id', o.id, 'numero', o.order_number, 'estado', o.status, 'creado', o.created_at,
               'pagado', o.payment_status = 'paid', 'forma_pago', o.forma_pago,
               'items', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                                   'id', oi.id, 'nombre', oi.menu_item_name, 'cantidad', oi.quantity,
                                   'estado', oi.status, 'estacion', s.name) ORDER BY s.sort_order, oi.menu_item_name), '[]'::jsonb)
                           FROM public.order_items oi LEFT JOIN public.stations s ON s.id = oi.station_id
                          WHERE oi.order_id = o.id),
               -- Minutos que faltan: lo que tarda cada plato pendiente más la fila de su estación
               -- (cada estación prepara unos 3 productos a la vez; cada tanda que hay delante suma 2 min).
               'faltan_min', (
                 SELECT CASE WHEN count(*) = 0 THEN NULL ELSE greatest(1, ceil(max(
                          extract(epoch FROM (coalesce(oi.started_at, now()) - now())) / 60.0
                          + public._minutos_plato(oi.menu_item_id)
                          + CASE WHEN oi.status = 'confirmed' THEN least(30, 2 * ceil((
                                SELECT count(*) FROM public.order_items o2 JOIN public.orders x ON x.id = o2.order_id
                                 WHERE o2.station_id = oi.station_id AND o2.status IN ('confirmed', 'in_kitchen')
                                   AND x.created_at < o.created_at AND o2.order_id <> o.id
                                   AND (NOT prepago OR x.payment_status = 'paid')) / 3.0)) ELSE 0 END)))::integer END
                   FROM public.order_items oi
                  WHERE oi.order_id = o.id AND oi.status IN ('confirmed', 'in_kitchen')
                    AND (NOT prepago OR o.payment_status = 'paid'))) AS p
        FROM public.orders o
       WHERE o.session_id = c.sesion AND o.user_id = auth.uid() AND o.status <> 'cancelled'
    ) x;

  RETURN jsonb_build_object('mesa', (c.mesa).number, 'personas', personas, 'pedidos', pedidos);
END;
$$;
REVOKE ALL ON FUNCTION public.mi_mesa_en_vivo(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mi_mesa_en_vivo(text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Lo de siempre: lo que pidió en al menos dos visitas distintas, si hoy está disponible
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lo_de_siempre(_qr_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  local uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;
  SELECT t.tenant_id INTO local FROM public.tables t WHERE t.qr_token = _qr_token;
  IF local IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('menu_item_id', x.id, 'nombre', x.name, 'precio', x.price,
                                        'imagen', x.image_url, 'visitas', x.visitas, 'veces', x.veces)
                     ORDER BY x.visitas DESC, x.veces DESC)
      FROM (
        SELECT mi.id, mi.name, mi.price, mi.image_url,
               count(DISTINCT o.session_id) AS visitas, sum(oi.quantity) AS veces
          FROM public.orders o
          JOIN public.order_items oi ON oi.order_id = o.id
          JOIN public.menu_items mi ON mi.id = oi.menu_item_id
         WHERE o.user_id = auth.uid() AND o.tenant_id = local
           AND o.payment_status IN ('paid', 'refunded') AND oi.status <> 'cancelled'
           AND mi.tenant_id = local AND mi.status = 'available'
           -- Sin opciones obligatorias: se agrega con un toque (las que tienen, se eligen en la carta)
           AND NOT EXISTS (SELECT 1 FROM public.modifier_groups g WHERE g.menu_item_id = mi.id AND g.required)
         GROUP BY mi.id, mi.name, mi.price, mi.image_url
        HAVING count(DISTINCT o.session_id) >= 2
         ORDER BY count(DISTINCT o.session_id) DESC, sum(oi.quantity) DESC
         LIMIT 3
      ) x
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.lo_de_siempre(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lo_de_siempre(text) TO authenticated;
