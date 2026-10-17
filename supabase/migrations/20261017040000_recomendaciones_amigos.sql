-- Fase 9.4 — Recomendaciones de conocidos. Con la comunidad activa, cada persona puede recomendar un plato que
-- pagó, con un comentario corto. Sus amigos lo ven en la carta de ese local:
--   · Con desfase: recién 24 horas después de recomendarlo (nunca revela que alguien está en el local ahora).
--   · Solo amigos vigentes (sin bloqueo, los dos en la comunidad), y solo platos que la persona pagó de verdad.
--   · Las fotos de amigos quedan para después: necesitan moderación previa de cada foto.
CREATE TABLE IF NOT EXISTS public.recomendaciones_amigos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  menu_item_id uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  comentario text CHECK (comentario IS NULL OR char_length(comentario) BETWEEN 1 AND 140),
  visible_desde timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  oculta_at timestamptz,                       -- la ocultó Tablio (moderación)
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS recomendaciones_amigos_uidx ON public.recomendaciones_amigos (user_id, menu_item_id);
CREATE INDEX IF NOT EXISTS recomendaciones_amigos_tenant_idx ON public.recomendaciones_amigos (tenant_id, visible_desde);

ALTER TABLE public.recomendaciones_amigos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recomendaciones_amigos_superadmin ON public.recomendaciones_amigos;
CREATE POLICY recomendaciones_amigos_superadmin ON public.recomendaciones_amigos FOR SELECT TO authenticated USING (public.is_platform_admin());
REVOKE INSERT, UPDATE, DELETE ON public.recomendaciones_amigos FROM anon, authenticated;
GRANT SELECT ON public.recomendaciones_amigos TO authenticated;

-- Recomendar un plato que pagué (o cambiar el comentario: el desfase no se reinicia)
CREATE OR REPLACE FUNCTION public.recomendar_plato(_menu_item_id uuid, _comentario text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  yo uuid := public._yo_verificado();
  v_comentario text := nullif(btrim(coalesce(_comentario, '')), '');
  v_tenant uuid;
BEGIN
  IF NOT public._en_comunidad(yo) THEN
    RAISE EXCEPTION 'Activa la comunidad para recomendar platos' USING ERRCODE = 'P0001';
  END IF;
  SELECT m.tenant_id INTO v_tenant FROM public.menu_items m WHERE m.id = _menu_item_id;
  IF v_tenant IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.orders o JOIN public.order_items oi ON oi.order_id = o.id
        WHERE o.user_id = yo AND o.tenant_id = v_tenant AND o.payment_status = 'paid' AND o.status <> 'cancelled' AND oi.menu_item_id = _menu_item_id) THEN
    RAISE EXCEPTION 'Solo puedes recomendar lo que probaste' USING ERRCODE = 'P0001';
  END IF;
  IF v_comentario IS NOT NULL AND (char_length(v_comentario) > 140 OR lower(v_comentario) ~ '(https?://|www\.|@|\d{7,})') THEN
    RAISE EXCEPTION 'El comentario va corto (hasta 140 letras) y sin enlaces ni teléfonos' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.recomendaciones_amigos (user_id, tenant_id, menu_item_id, comentario)
  VALUES (yo, v_tenant, _menu_item_id, v_comentario)
  ON CONFLICT (user_id, menu_item_id) DO UPDATE SET comentario = EXCLUDED.comentario;
END;
$$;
REVOKE ALL ON FUNCTION public.recomendar_plato(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recomendar_plato(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.quitar_recomendacion(_menu_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  yo uuid := public._yo_verificado();
BEGIN
  DELETE FROM public.recomendaciones_amigos WHERE user_id = yo AND menu_item_id = _menu_item_id;
END;
$$;
REVOKE ALL ON FUNCTION public.quitar_recomendacion(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.quitar_recomendacion(uuid) TO authenticated;

-- Mis recomendaciones en un local (para marcarlas en el pasaporte)
CREATE OR REPLACE FUNCTION public.mis_recomendaciones(_tenant_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('menu_item_id', r.menu_item_id, 'comentario', r.comentario, 'visible', r.visible_desde <= now())), '[]'::jsonb)
    FROM public.recomendaciones_amigos r WHERE r.user_id = (SELECT auth.uid()) AND r.tenant_id = _tenant_id
$$;
REVOKE ALL ON FUNCTION public.mis_recomendaciones(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mis_recomendaciones(uuid) TO authenticated;

-- Lo que recomiendan mis amigos en este local (con desfase y sin ocultas)
CREATE OR REPLACE FUNCTION public.recomendaciones_de_amigos(_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  yo uuid := (SELECT auth.uid());
BEGIN
  IF yo IS NULL OR NOT public._en_comunidad(yo) THEN RETURN '[]'::jsonb; END IF;
  RETURN (SELECT coalesce(jsonb_agg(x ORDER BY x ->> 'cuantos' DESC, x ->> 'plato'), '[]'::jsonb) FROM (
    SELECT jsonb_build_object('menu_item_id', m.id, 'plato', m.name, 'imagen', m.image_url, 'cuantos', count(*),
             'amigos', jsonb_agg(jsonb_build_object('nombre', p.nombre, 'comentario', r.comentario) ORDER BY r.created_at DESC)) AS x
      FROM public.recomendaciones_amigos r
      JOIN public.menu_items m ON m.id = r.menu_item_id AND coalesce(m.status, 'available') <> 'hidden'
      JOIN public.perfiles_comunidad p ON p.user_id = r.user_id
     WHERE r.tenant_id = _tenant_id AND r.visible_desde <= now() AND r.oculta_at IS NULL AND r.user_id <> yo
       AND public._son_amigos(yo, r.user_id)
     GROUP BY m.id, m.name, m.image_url) y);
END;
$$;
REVOKE ALL ON FUNCTION public.recomendaciones_de_amigos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recomendaciones_de_amigos(uuid) TO authenticated;

-- Moderación: Tablio oculta una recomendación (con nota y auditoría)
CREATE OR REPLACE FUNCTION public.ocultar_recomendacion(_recomendacion_id uuid, _nota text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nota text := btrim(coalesce(_nota, ''));
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Solo el superadmin modera la comunidad' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_nota) NOT BETWEEN 5 AND 500 THEN
    RAISE EXCEPTION 'Escribe una nota (de 5 a 500 letras)' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.recomendaciones_amigos SET oculta_at = now() WHERE id = _recomendacion_id AND oculta_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esa recomendación no existe o ya está oculta' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (NULL, (SELECT auth.uid()), 'comunidad_recomendacion_oculta', 'recomendacion', _recomendacion_id, jsonb_build_object('nota', v_nota));
END;
$$;
REVOKE ALL ON FUNCTION public.ocultar_recomendacion(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ocultar_recomendacion(uuid, text) TO authenticated;

-- Privacidad y auditoría
DO $$
DECLARE
  def text;
  nuevo text;
BEGIN
  def := pg_get_functiondef('public.mis_datos()'::regprocedure);
  nuevo := replace(def, $q$    'planes_con_amigos', (SELECT count(*) FROM public.planes_amigos pa WHERE pa.creador_id = yo),$q$,
    $q$    'planes_con_amigos', (SELECT count(*) FROM public.planes_amigos pa WHERE pa.creador_id = yo),
    'recomendaciones', (SELECT coalesce(jsonb_agg(jsonb_build_object('local', t.name, 'plato', m.name, 'comentario', r.comentario, 'fecha', r.created_at)), '[]'::jsonb)
                          FROM public.recomendaciones_amigos r JOIN public.tenants t ON t.id = r.tenant_id JOIN public.menu_items m ON m.id = r.menu_item_id
                         WHERE r.user_id = yo),$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'mis_datos: no se encontró dónde'; END IF;
  EXECUTE nuevo;

  def := pg_get_functiondef('public.auditoria_operacion()'::regprocedure);
  nuevo := regexp_replace(def, '\n(\s*END;\s*\$function\$)', $q$

  -- Fase 9.4: cada recomendación es de un plato de su local y respeta el desfase de 24 horas
  RETURN QUERY
  SELECT 'recomendacion_incoherente', r.id::text,
         CASE WHEN m.tenant_id IS DISTINCT FROM r.tenant_id THEN 'Recomendación de un plato de otro local'
              ELSE 'Recomendación visible antes de 24 horas' END
    FROM public.recomendaciones_amigos r LEFT JOIN public.menu_items m ON m.id = r.menu_item_id
   WHERE m.tenant_id IS DISTINCT FROM r.tenant_id OR r.visible_desde < r.created_at + interval '24 hours';
\1$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'auditoria_operacion: no se encontró el final'; END IF;
  EXECUTE nuevo;
END;
$$;
