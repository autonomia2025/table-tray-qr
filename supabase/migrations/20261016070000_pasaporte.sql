-- Fase 7.6 — Pasaporte de la casa: cada cliente colecciona lo que va probando en el local (platos y tragos,
-- por sección de la carta) y gana insignias: por completar una sección ("Experto en Cervezas") y por la
-- cantidad de cosas distintas que probó. Son solo insignias, sin premios. Se calcula en el momento desde sus
-- pedidos pagados (no guarda datos nuevos de la persona); el dueño lo puede apagar en Lealtad.

ALTER TABLE public.loyalty_programs ADD COLUMN IF NOT EXISTS pasaporte_activo boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.mi_pasaporte(_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  yo uuid := (SELECT auth.uid());
  activo boolean;
  secciones jsonb;
  v_probados integer;
  v_total integer;
BEGIN
  IF yo IS NULL THEN
    RAISE EXCEPTION 'Tienes que entrar desde el QR de tu mesa' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(bool_or(lp.pasaporte_activo), false) INTO activo
    FROM public.loyalty_programs lp WHERE lp.tenant_id = _tenant_id AND lp.is_active;
  IF NOT activo THEN
    RETURN jsonb_build_object('activo', false);
  END IF;

  -- Lo que probé: productos de pedidos míos pagados (y no anulados ni reembolsados) en este local
  WITH probados AS (
    SELECT DISTINCT oi.menu_item_id
      FROM public.orders o JOIN public.order_items oi ON oi.order_id = o.id
     WHERE o.tenant_id = _tenant_id AND o.user_id = yo AND o.payment_status = 'paid' AND o.status <> 'cancelled'
  ), carta AS (
    SELECT c.id AS cat, c.name AS seccion, c.emoji, c.sort_order AS orden_cat,
           m.id, m.name, m.image_url, m.sort_order, (m.id IN (SELECT menu_item_id FROM probados)) AS probado
      FROM public.categories c JOIN public.menu_items m ON m.category_id = c.id
     WHERE c.tenant_id = _tenant_id AND coalesce(c.is_visible, true) AND coalesce(m.status, 'available') <> 'hidden'
  )
  SELECT coalesce(jsonb_agg(s ORDER BY s ->> 'orden'), '[]'::jsonb), coalesce(sum((s ->> 'probados')::integer), 0)::integer,
         coalesce(sum((s ->> 'total')::integer), 0)::integer
    INTO secciones, v_probados, v_total
    FROM (
      SELECT jsonb_build_object(
               'id', cat, 'nombre', seccion, 'emoji', emoji, 'orden', lpad(coalesce(orden_cat, 0)::text, 6, '0'),
               'total', count(*), 'probados', count(*) FILTER (WHERE probado),
               'completa', bool_and(probado),
               'items', jsonb_agg(jsonb_build_object('id', id, 'nombre', name, 'imagen', image_url, 'probado', probado)
                                  ORDER BY sort_order, name)) AS s
        FROM carta GROUP BY cat, seccion, emoji, orden_cat
    ) x;

  RETURN jsonb_build_object(
    'activo', true, 'probados', v_probados, 'total', v_total, 'secciones', secciones,
    -- Insignias: cada sección completa, y por cantidad de cosas distintas probadas
    'insignias', (
      SELECT coalesce(jsonb_agg(i ORDER BY i ->> 'orden'), '[]'::jsonb) FROM (
        SELECT jsonb_build_object('tipo', 'seccion', 'nombre', 'Experto en ' || (s ->> 'nombre'), 'emoji', coalesce(s ->> 'emoji', '🏅'),
                                  'orden', '1' || (s ->> 'orden')) AS i
          FROM jsonb_array_elements(secciones) s WHERE (s ->> 'completa')::boolean
        UNION ALL
        SELECT jsonb_build_object('tipo', 'cantidad', 'nombre', h.nombre, 'emoji', h.emoji, 'orden', '0' || lpad(h.n::text, 4, '0'))
          FROM (VALUES (3, 'Curioso', '🧭'), (10, 'Explorador', '🗺️'), (25, 'Leyenda de la casa', '👑')) h(n, nombre, emoji)
         WHERE v_probados >= h.n
      ) y),
    'siguiente', (SELECT jsonb_build_object('nombre', h.nombre, 'faltan', h.n - v_probados)
                    FROM (VALUES (3, 'Curioso'), (10, 'Explorador'), (25, 'Leyenda de la casa')) h(n, nombre)
                   WHERE v_probados < h.n ORDER BY h.n LIMIT 1));
END;
$$;
REVOKE ALL ON FUNCTION public.mi_pasaporte(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mi_pasaporte(uuid) TO authenticated;
