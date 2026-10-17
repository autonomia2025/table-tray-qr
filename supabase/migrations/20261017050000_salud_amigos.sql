-- Fase 9.5 — "Salud" virtual entre amigos en el mismo bar. Cuida la regla más delicada de la comunidad
-- ("nunca mostrar dónde está alguien ahora") con doble permiso:
--   · Nadie aparece presente por defecto: cada persona toca "Avisar a mis amigos que estoy aquí" en la carta,
--     solo para esa visita (termina al cerrarse su mesa o a las 4 horas).
--   · Solo la ven sus amigos que TAMBIÉN están en ese mismo local y TAMBIÉN lo activaron. Nadie de afuera sabe
--     que está ahí.
--   · Entre ellos se mandan un "¡Salud!" (sin plata), con un límite para que no moleste.
CREATE TABLE IF NOT EXISTS public.presencias_comunidad (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,   -- una por persona: la última
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.table_sessions(id) ON DELETE CASCADE,
  hasta timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS presencias_comunidad_tenant_idx ON public.presencias_comunidad (tenant_id, hasta);

CREATE TABLE IF NOT EXISTS public.saludos_amigos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  de_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  para_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  visto_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (de_user_id <> para_user_id)
);
CREATE INDEX IF NOT EXISTS saludos_amigos_para_idx ON public.saludos_amigos (para_user_id, visto_at);
CREATE INDEX IF NOT EXISTS saludos_amigos_par_idx ON public.saludos_amigos (de_user_id, para_user_id, created_at DESC);

ALTER TABLE public.presencias_comunidad ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saludos_amigos ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['presencias_comunidad', 'saludos_amigos'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_superadmin', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_platform_admin())', t || '_superadmin', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
  END LOOP;
END;
$$;

-- ¿Está presente (lo activó, su mesa sigue abierta y no venció) en este local?
CREATE OR REPLACE FUNCTION public._presente_comunidad(_user_id uuid, _tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.presencias_comunidad pc JOIN public.table_sessions ts ON ts.id = pc.session_id AND ts.is_active
                  WHERE pc.user_id = _user_id AND pc.tenant_id = _tenant_id AND pc.hasta > now())
$$;
REVOKE ALL ON FUNCTION public._presente_comunidad(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Avisar (o dejar de avisar) a mis amigos que estoy aquí, en esta visita
CREATE OR REPLACE FUNCTION public.avisar_que_estoy(_qr_token text, _activar boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  yo uuid := public._yo_verificado();
  c record;
BEGIN
  IF NOT _activar THEN
    DELETE FROM public.presencias_comunidad WHERE user_id = yo;
    RETURN;
  END IF;
  IF NOT public._en_comunidad(yo) THEN
    RAISE EXCEPTION 'Activa la comunidad para avisar a tus amigos' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO c FROM public._comensal_en_mesa(_qr_token);
  INSERT INTO public.presencias_comunidad (user_id, tenant_id, session_id, hasta)
  VALUES (yo, (c.mesa).tenant_id, c.sesion, now() + interval '4 hours')
  ON CONFLICT (user_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, session_id = EXCLUDED.session_id, hasta = EXCLUDED.hasta, created_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.avisar_que_estoy(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.avisar_que_estoy(text, boolean) TO authenticated;

-- Mis amigos aquí (solo si yo también lo activé) y los "salud" que me llegaron (quedan vistos)
CREATE OR REPLACE FUNCTION public.amigos_aqui(_qr_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  yo uuid := (SELECT auth.uid());
  c record;
  v_saludos jsonb;
BEGIN
  SELECT * INTO c FROM public._comensal_en_mesa(_qr_token);
  IF yo IS NULL OR NOT public._en_comunidad(yo) THEN
    RETURN jsonb_build_object('comunidad', false);
  END IF;
  IF NOT public._presente_comunidad(yo, (c.mesa).tenant_id) THEN
    RETURN jsonb_build_object('comunidad', true, 'avisando', false);
  END IF;
  WITH nuevos AS (
    UPDATE public.saludos_amigos s SET visto_at = now()
     WHERE s.para_user_id = yo AND s.visto_at IS NULL AND s.tenant_id = (c.mesa).tenant_id AND s.created_at > now() - interval '1 hour'
    RETURNING s.de_user_id, s.created_at)
  SELECT coalesce(jsonb_agg(jsonb_build_object('de', p.nombre, 'cuando', n.created_at) ORDER BY n.created_at), '[]'::jsonb) INTO v_saludos
    FROM nuevos n JOIN public.perfiles_comunidad p ON p.user_id = n.de_user_id;
  RETURN jsonb_build_object('comunidad', true, 'avisando', true,
    'amigos', (SELECT coalesce(jsonb_agg(jsonb_build_object('user_id', p.user_id, 'nombre', p.nombre) ORDER BY p.nombre), '[]'::jsonb)
                 FROM public.presencias_comunidad pc JOIN public.perfiles_comunidad p ON p.user_id = pc.user_id
                WHERE pc.tenant_id = (c.mesa).tenant_id AND pc.user_id <> yo AND public._presente_comunidad(pc.user_id, (c.mesa).tenant_id)
                  AND public._son_amigos(yo, pc.user_id)),
    'saludos', v_saludos);
END;
$$;
REVOKE ALL ON FUNCTION public.amigos_aqui(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.amigos_aqui(text) TO authenticated;

-- Mandar un "salud" a un amigo que está aquí (los dos avisando), máximo uno cada 2 minutos por pareja
CREATE OR REPLACE FUNCTION public.mandar_salud(_qr_token text, _amigo_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  yo uuid := public._yo_verificado();
  c record;
BEGIN
  SELECT * INTO c FROM public._comensal_en_mesa(_qr_token);
  IF NOT public._presente_comunidad(yo, (c.mesa).tenant_id) OR NOT public._presente_comunidad(_amigo_id, (c.mesa).tenant_id)
     OR NOT public._son_amigos(yo, _amigo_id) THEN
    RAISE EXCEPTION 'Tu amigo ya no está aquí' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.saludos_amigos WHERE de_user_id = yo AND para_user_id = _amigo_id AND created_at > now() - interval '2 minutes') THEN
    RAISE EXCEPTION 'Recién le mandaste un salud. Espera un poco.' USING ERRCODE = 'P0001';
  END IF;
  -- Lo de más de 7 días se borra (lo mínimo guardado)
  DELETE FROM public.saludos_amigos WHERE created_at < now() - interval '7 days';
  INSERT INTO public.saludos_amigos (de_user_id, para_user_id, tenant_id) VALUES (yo, _amigo_id, (c.mesa).tenant_id);
END;
$$;
REVOKE ALL ON FUNCTION public.mandar_salud(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mandar_salud(text, uuid) TO authenticated;

-- Privacidad y auditoría
DO $$
DECLARE
  def text;
  nuevo text;
BEGIN
  def := pg_get_functiondef('public.mis_datos()'::regprocedure);
  nuevo := replace(def, $q$    'planes_con_amigos', (SELECT count(*) FROM public.planes_amigos pa WHERE pa.creador_id = yo),$q$,
    $q$    'planes_con_amigos', (SELECT count(*) FROM public.planes_amigos pa WHERE pa.creador_id = yo),
    'avisando_que_estoy', (SELECT jsonb_build_object('local', t.name, 'hasta', pc.hasta) FROM public.presencias_comunidad pc JOIN public.tenants t ON t.id = pc.tenant_id WHERE pc.user_id = yo),
    'saludos_enviados', (SELECT count(*) FROM public.saludos_amigos s WHERE s.de_user_id = yo),$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'mis_datos: no se encontró dónde'; END IF;
  EXECUTE nuevo;

  -- Al apagar la comunidad, deja de avisar
  def := pg_get_functiondef('public.apagar_comunidad()'::regprocedure);
  nuevo := replace(def, $q$  DELETE FROM public.amistades WHERE de_user_id = yo OR para_user_id = yo;$q$,
    $q$  DELETE FROM public.amistades WHERE de_user_id = yo OR para_user_id = yo;
  DELETE FROM public.presencias_comunidad WHERE user_id = yo;$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'apagar_comunidad: no se encontró dónde'; END IF;
  EXECUTE nuevo;

  -- Si Tablio suspende un perfil, también deja de avisar
  def := pg_get_functiondef('public.moderar_reporte(uuid,boolean,text)'::regprocedure);
  nuevo := replace(def, $q$    DELETE FROM public.amistades WHERE de_user_id = r.reportado_id OR para_user_id = r.reportado_id;$q$,
    $q$    DELETE FROM public.amistades WHERE de_user_id = r.reportado_id OR para_user_id = r.reportado_id;
    DELETE FROM public.presencias_comunidad WHERE user_id = r.reportado_id;$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'moderar_reporte: no se encontró dónde'; END IF;
  EXECUTE nuevo;

  def := pg_get_functiondef('public.auditoria_operacion()'::regprocedure);
  nuevo := regexp_replace(def, '\n(\s*END;\s*\$function\$)', $q$

  -- Fase 9.5: un aviso de "estoy aquí" es de una mesa de ese mismo local, y nadie avisa sin estar en la comunidad
  RETURN QUERY
  SELECT 'presencia_incoherente', pc.user_id::text,
         CASE WHEN ts.tenant_id IS DISTINCT FROM pc.tenant_id THEN 'Aviso de presencia con una mesa de otro local'
              ELSE 'Aviso de presencia de alguien fuera de la comunidad' END
    FROM public.presencias_comunidad pc LEFT JOIN public.table_sessions ts ON ts.id = pc.session_id
   WHERE ts.tenant_id IS DISTINCT FROM pc.tenant_id
      OR NOT EXISTS (SELECT 1 FROM public.perfiles_comunidad p WHERE p.user_id = pc.user_id AND p.activo AND p.suspendido_at IS NULL);
\1$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'auditoria_operacion: no se encontró el final'; END IF;
  EXECUTE nuevo;
END;
$$;
