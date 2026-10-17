-- Fase 9.3 — Planes con amigos: "juntémonos el viernes en el bar X", con la primera ronda elegida.
--   · Lo arma alguien con la comunidad activa, en un local donde ya pagó algo, y elige a cuáles de sus amigos
--     invita (solo amigos). Cada invitado responde "voy" o "no voy".
--   · La primera ronda se elige al armar el plan pero NO se cobra ni se pide antes: cuando quien armó el plan
--     llega a una mesa de ese local, la app le ofrece cargarla al carrito con un toque, y el precio se calcula
--     al pagar, como siempre (nada de plata adelantada).
--   · Solo los invitados ven el plan. Si alguien deja de ser amigo, apaga la comunidad o bloquea, deja de verlo.

CREATE TABLE IF NOT EXISTS public.planes_amigos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creador_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  fecha timestamptz NOT NULL,
  mensaje text CHECK (mensaje IS NULL OR char_length(mensaje) BETWEEN 1 AND 120),
  ronda jsonb NOT NULL DEFAULT '[]'::jsonb,       -- [{menu_item_id, quantity}], hasta 8 productos
  cancelado_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(ronda) = 'array' AND jsonb_array_length(ronda) <= 8)
);
CREATE INDEX IF NOT EXISTS planes_amigos_creador_idx ON public.planes_amigos (creador_id, fecha);
CREATE INDEX IF NOT EXISTS planes_amigos_tenant_idx ON public.planes_amigos (tenant_id, fecha);

CREATE TABLE IF NOT EXISTS public.plan_invitados (
  plan_id uuid NOT NULL REFERENCES public.planes_amigos(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  respuesta text NOT NULL DEFAULT 'pendiente' CHECK (respuesta IN ('pendiente', 'voy', 'no_voy')),
  respondida_at timestamptz,
  PRIMARY KEY (plan_id, user_id)
);
CREATE INDEX IF NOT EXISTS plan_invitados_user_idx ON public.plan_invitados (user_id);

ALTER TABLE public.planes_amigos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_invitados ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['planes_amigos', 'plan_invitados'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_superadmin', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_platform_admin())', t || '_superadmin', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
  END LOOP;
END;
$$;

-- ¿Son amigos (aceptados, sin bloqueo, los dos en la comunidad)?
CREATE OR REPLACE FUNCTION public._son_amigos(_a uuid, _b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public._en_comunidad(_a) AND public._en_comunidad(_b) AND NOT public._bloqueados_entre(_a, _b)
     AND EXISTS (SELECT 1 FROM public.amistades a WHERE a.estado = 'aceptada'
                   AND least(a.de_user_id, a.para_user_id) = least(_a, _b) AND greatest(a.de_user_id, a.para_user_id) = greatest(_a, _b))
$$;
REVOKE ALL ON FUNCTION public._son_amigos(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Locales donde puedo armar un plan: donde ya pagué algo
CREATE OR REPLACE FUNCTION public.locales_para_plan()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  yo uuid := public._yo_verificado();
BEGIN
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('tenant_id', t.id, 'nombre', t.name, 'slug', t.slug) ORDER BY t.name), '[]'::jsonb)
            FROM public.tenants t
           WHERE t.is_active AND EXISTS (SELECT 1 FROM public.orders o WHERE o.tenant_id = t.id AND o.user_id = yo AND o.payment_status = 'paid'));
END;
$$;
REVOKE ALL ON FUNCTION public.locales_para_plan() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locales_para_plan() TO authenticated;

CREATE OR REPLACE FUNCTION public.crear_plan(_tenant_id uuid, _fecha timestamptz, _amigos uuid[], _mensaje text DEFAULT NULL, _ronda jsonb DEFAULT '[]'::jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  yo uuid := public._yo_verificado();
  v_mensaje text := nullif(btrim(coalesce(_mensaje, '')), '');
  v_ronda jsonb := coalesce(_ronda, '[]'::jsonb);
  nuevo uuid;
BEGIN
  IF NOT public._en_comunidad(yo) THEN
    RAISE EXCEPTION 'Activa la comunidad para armar planes' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = _tenant_id AND t.is_active)
     OR NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.tenant_id = _tenant_id AND o.user_id = yo AND o.payment_status = 'paid') THEN
    RAISE EXCEPTION 'Elige un local donde ya hayas estado' USING ERRCODE = 'P0001';
  END IF;
  IF _fecha IS NULL OR _fecha < now() + interval '10 minutes' OR _fecha > now() + interval '30 days' THEN
    RAISE EXCEPTION 'Elige una fecha entre hoy y los próximos 30 días' USING ERRCODE = 'P0001';
  END IF;
  IF coalesce(cardinality(_amigos), 0) NOT BETWEEN 1 AND 15 THEN
    RAISE EXCEPTION 'Invita de 1 a 15 amigos' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(_amigos) a WHERE NOT public._son_amigos(yo, a)) THEN
    RAISE EXCEPTION 'Solo puedes invitar a tus amigos' USING ERRCODE = 'P0001';
  END IF;
  IF v_mensaje IS NOT NULL AND (char_length(v_mensaje) > 120 OR lower(v_mensaje) ~ '(https?://|www\.|@|\d{7,})') THEN
    RAISE EXCEPTION 'El mensaje va corto (hasta 120 letras) y sin enlaces ni teléfonos' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(v_ronda) <> 'array' OR jsonb_array_length(v_ronda) > 8
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_ronda) l
                 WHERE (l ->> 'quantity')::integer NOT BETWEEN 1 AND 20
                    OR NOT EXISTS (SELECT 1 FROM public.menu_items m WHERE m.id = (l ->> 'menu_item_id')::uuid AND m.tenant_id = _tenant_id)) THEN
    RAISE EXCEPTION 'La primera ronda tiene que ser de la carta de ese local (hasta 8 productos)' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.planes_amigos WHERE creador_id = yo AND cancelado_at IS NULL AND fecha > now()) >= 5 THEN
    RAISE EXCEPTION 'Ya tienes 5 planes armados. Espera a que pasen o cancela alguno.' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.planes_amigos (creador_id, tenant_id, fecha, mensaje, ronda)
  VALUES (yo, _tenant_id, _fecha, v_mensaje,
          (SELECT coalesce(jsonb_agg(jsonb_build_object('menu_item_id', l ->> 'menu_item_id', 'quantity', (l ->> 'quantity')::integer)), '[]'::jsonb)
             FROM jsonb_array_elements(v_ronda) l))
  RETURNING id INTO nuevo;
  INSERT INTO public.plan_invitados (plan_id, user_id) SELECT nuevo, a FROM (SELECT DISTINCT unnest(_amigos) AS a) x;
  RETURN nuevo;
END;
$$;
REVOKE ALL ON FUNCTION public.crear_plan(uuid, timestamptz, uuid[], text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crear_plan(uuid, timestamptz, uuid[], text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.responder_plan(_plan_id uuid, _voy boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  yo uuid := public._yo_verificado();
BEGIN
  UPDATE public.plan_invitados pi SET respuesta = CASE WHEN _voy THEN 'voy' ELSE 'no_voy' END, respondida_at = now()
    FROM public.planes_amigos p
   WHERE pi.plan_id = _plan_id AND pi.user_id = yo AND p.id = pi.plan_id AND p.cancelado_at IS NULL AND p.fecha > now() - interval '6 hours'
     AND public._son_amigos(yo, p.creador_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ese plan ya no está disponible' USING ERRCODE = 'P0001';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.responder_plan(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.responder_plan(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancelar_plan(_plan_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  yo uuid := public._yo_verificado();
BEGIN
  UPDATE public.planes_amigos SET cancelado_at = now() WHERE id = _plan_id AND creador_id = yo AND cancelado_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ese plan ya no se puede cancelar' USING ERRCODE = 'P0001';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.cancelar_plan(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancelar_plan(uuid) TO authenticated;

-- Mis planes: los que armé y a los que me invitaron (solo de amigos vigentes), de las últimas horas en adelante
CREATE OR REPLACE FUNCTION public.mis_planes()
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
  RETURN (SELECT coalesce(jsonb_agg(x.plan ORDER BY x.fecha), '[]'::jsonb) FROM (
    SELECT p.fecha, jsonb_build_object(
      'id', p.id, 'fecha', p.fecha, 'mensaje', p.mensaje, 'local', t.name, 'slug', t.slug, 'tenant_id', t.id,
      'cancelado', p.cancelado_at IS NOT NULL, 'mio', p.creador_id = yo,
      'organiza', (SELECT nombre FROM public.perfiles_comunidad WHERE user_id = p.creador_id),
      'mi_respuesta', (SELECT respuesta FROM public.plan_invitados WHERE plan_id = p.id AND user_id = yo),
      'invitados', (SELECT coalesce(jsonb_agg(jsonb_build_object('nombre', pc.nombre, 'respuesta', pi.respuesta) ORDER BY pc.nombre), '[]'::jsonb)
                      FROM public.plan_invitados pi JOIN public.perfiles_comunidad pc ON pc.user_id = pi.user_id
                     WHERE pi.plan_id = p.id AND public._son_amigos(p.creador_id, pi.user_id)),
      'ronda', CASE WHEN p.creador_id = yo THEN
                 (SELECT coalesce(jsonb_agg(jsonb_build_object('menu_item_id', m.id, 'nombre', m.name, 'cantidad', (l ->> 'quantity')::integer)), '[]'::jsonb)
                    FROM jsonb_array_elements(p.ronda) l JOIN public.menu_items m ON m.id = (l ->> 'menu_item_id')::uuid)
               ELSE (SELECT coalesce(jsonb_agg(m.name), '[]'::jsonb) FROM jsonb_array_elements(p.ronda) l JOIN public.menu_items m ON m.id = (l ->> 'menu_item_id')::uuid) END) AS plan
      FROM public.planes_amigos p JOIN public.tenants t ON t.id = p.tenant_id
     WHERE p.fecha > now() - interval '6 hours'
       AND (p.creador_id = yo
            OR (EXISTS (SELECT 1 FROM public.plan_invitados pi WHERE pi.plan_id = p.id AND pi.user_id = yo) AND public._son_amigos(yo, p.creador_id)))
  ) x);
END;
$$;
REVOKE ALL ON FUNCTION public.mis_planes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mis_planes() TO authenticated;

-- Privacidad y auditoría
DO $$
DECLARE
  def text;
  nuevo text;
BEGIN
  def := pg_get_functiondef('public.mis_datos()'::regprocedure);
  nuevo := replace(def, $q$    'comunidad', (SELECT jsonb_build_object('nombre', p.nombre,$q$,
    $q$    'planes_con_amigos', (SELECT count(*) FROM public.planes_amigos pa WHERE pa.creador_id = yo),
    'comunidad', (SELECT jsonb_build_object('nombre', p.nombre,$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'mis_datos: no se encontró dónde'; END IF;
  EXECUTE nuevo;

  def := pg_get_functiondef('public.auditoria_operacion()'::regprocedure);
  nuevo := regexp_replace(def, '\n(\s*END;\s*\$function\$)', $q$

  -- Fase 9.3: un plan no se invita a sí mismo y su primera ronda es de la carta de su local
  RETURN QUERY
  SELECT 'plan_incoherente', p.id::text,
         CASE WHEN EXISTS (SELECT 1 FROM public.plan_invitados pi WHERE pi.plan_id = p.id AND pi.user_id = p.creador_id)
              THEN 'Quien arma el plan aparece como invitado' ELSE 'La primera ronda tiene productos de otro local' END
    FROM public.planes_amigos p
   WHERE EXISTS (SELECT 1 FROM public.plan_invitados pi WHERE pi.plan_id = p.id AND pi.user_id = p.creador_id)
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(p.ronda) l
                  WHERE NOT EXISTS (SELECT 1 FROM public.menu_items m WHERE m.id = (l ->> 'menu_item_id')::uuid AND m.tenant_id = p.tenant_id));
\1$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'auditoria_operacion: no se encontró el final'; END IF;
  EXECUTE nuevo;
END;
$$;
