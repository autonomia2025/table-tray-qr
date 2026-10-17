-- Fase 9.2 — Perfil y amigos (comunidad). La base de la fase 9, con los criterios del plan:
--   · Solo con cuenta verificada (no invitados) y apagado por defecto: cada persona lo activa con un
--     consentimiento explícito (Ley 21.719) y lo puede apagar cuando quiera (se borran sus amistades).
--   · Amigos solo por invitación mutua: con el código personal de la otra persona, o con alguien de la misma
--     mesa que también tenga la comunidad activa. No se busca a nadie por nombre ni correo.
--   · Bloquear corta la amistad y evita nuevas invitaciones; reportar llega a Tablio, que puede suspender un
--     perfil. Nunca se muestra dónde está alguien ahora (eso viene en las etapas siguientes, con desfase).
-- Es de la plataforma (no de un local): una persona tiene un solo perfil para todos los locales.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Tablas
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.perfiles_comunidad (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre text NOT NULL CHECK (char_length(nombre) BETWEEN 2 AND 30),
  codigo text NOT NULL UNIQUE,                   -- para que un amigo te agregue (TAB-XXXX)
  activo boolean NOT NULL DEFAULT true,          -- false = la persona lo apagó
  suspendido_at timestamptz,                     -- Tablio lo suspendió por un reporte
  consentimiento_at timestamptz NOT NULL,
  politica_version text NOT NULL DEFAULT '2026-10-17',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.amistades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  de_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,   -- quien la pidió
  para_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aceptada')),
  created_at timestamptz NOT NULL DEFAULT now(),
  aceptada_at timestamptz,
  CHECK (de_user_id <> para_user_id)
);
-- Una sola relación por pareja (sin importar quién la pidió)
CREATE UNIQUE INDEX IF NOT EXISTS amistades_pareja_uidx ON public.amistades (least(de_user_id, para_user_id), greatest(de_user_id, para_user_id));
CREATE INDEX IF NOT EXISTS amistades_para_idx ON public.amistades (para_user_id, estado);
CREATE INDEX IF NOT EXISTS amistades_de_idx ON public.amistades (de_user_id, estado);

CREATE TABLE IF NOT EXISTS public.bloqueos_usuario (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bloqueado_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, bloqueado_id),
  CHECK (user_id <> bloqueado_id)
);

CREATE TABLE IF NOT EXISTS public.reportes_comunidad (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporta_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reportado_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  motivo text NOT NULL CHECK (char_length(motivo) BETWEEN 5 AND 500),
  estado text NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto', 'revisado', 'suspendido')),
  revisado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revisado_at timestamptz,
  nota text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reportes_comunidad_abiertos_idx ON public.reportes_comunidad (created_at DESC) WHERE estado = 'abierto';

-- Nadie las lee ni escribe desde el navegador: todo pasa por funciones. El superadmin lee para moderar.
ALTER TABLE public.perfiles_comunidad ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amistades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bloqueos_usuario ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reportes_comunidad ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['perfiles_comunidad', 'amistades', 'bloqueos_usuario', 'reportes_comunidad'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_superadmin', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_platform_admin())', t || '_superadmin', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
  END LOOP;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Ayudas
-- ─────────────────────────────────────────────────────────────────────────────
-- Con cuenta verificada (no invitado)
CREATE OR REPLACE FUNCTION public._yo_verificado()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  u auth.users;
BEGIN
  SELECT * INTO u FROM auth.users WHERE id = (SELECT auth.uid());
  IF u.id IS NULL OR coalesce(u.is_anonymous, false) OR u.email IS NULL OR u.email_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'Guarda tu cuenta para usar la comunidad' USING ERRCODE = '42501';
  END IF;
  RETURN u.id;
END;
$$;
REVOKE ALL ON FUNCTION public._yo_verificado() FROM PUBLIC, anon, authenticated;

-- Perfil que puede participar (activo y no suspendido)
CREATE OR REPLACE FUNCTION public._en_comunidad(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.perfiles_comunidad p WHERE p.user_id = _user_id AND p.activo AND p.suspendido_at IS NULL)
$$;
REVOKE ALL ON FUNCTION public._en_comunidad(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._bloqueados_entre(_a uuid, _b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.bloqueos_usuario WHERE (user_id = _a AND bloqueado_id = _b) OR (user_id = _b AND bloqueado_id = _a))
$$;
REVOKE ALL ON FUNCTION public._bloqueados_entre(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._codigo_amigo()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  letras constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  c text;
BEGIN
  LOOP
    c := 'TAB-';
    FOR i IN 1..5 LOOP
      c := c || substr(letras, 1 + floor(random() * length(letras))::integer, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.perfiles_comunidad WHERE codigo = c);
  END LOOP;
  RETURN c;
END;
$$;
REVOKE ALL ON FUNCTION public._codigo_amigo() FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Lo que hace cada persona
-- ─────────────────────────────────────────────────────────────────────────────
-- Activar (con consentimiento explícito) o cambiar el nombre
CREATE OR REPLACE FUNCTION public.activar_comunidad(_nombre text, _acepto boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  yo uuid := public._yo_verificado();
  v_nombre text := btrim(coalesce(_nombre, ''));
BEGIN
  IF _acepto IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Para activar la comunidad tienes que aceptar cómo se usan tus datos' USING ERRCODE = 'P0001';
  END IF;
  IF char_length(v_nombre) NOT BETWEEN 2 AND 30 OR v_nombre ~ '(https?://|www\.|@|\d{7,})' THEN
    RAISE EXCEPTION 'Tu nombre va de 2 a 30 letras, sin enlaces ni teléfonos' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.perfiles_comunidad WHERE user_id = yo AND suspendido_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Tu perfil de comunidad está suspendido. Escríbenos si crees que es un error.' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.perfiles_comunidad (user_id, nombre, codigo, consentimiento_at)
  VALUES (yo, v_nombre, public._codigo_amigo(), now())
  ON CONFLICT (user_id) DO UPDATE SET nombre = EXCLUDED.nombre, activo = true, consentimiento_at = now(), updated_at = now();
  RETURN public.mi_comunidad();
END;
$$;
REVOKE ALL ON FUNCTION public.activar_comunidad(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activar_comunidad(text, boolean) TO authenticated;

-- Apagar: deja de aparecer y se borran sus amistades y solicitudes
CREATE OR REPLACE FUNCTION public.apagar_comunidad()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  yo uuid := public._yo_verificado();
BEGIN
  UPDATE public.perfiles_comunidad SET activo = false, updated_at = now() WHERE user_id = yo;
  DELETE FROM public.amistades WHERE de_user_id = yo OR para_user_id = yo;
END;
$$;
REVOKE ALL ON FUNCTION public.apagar_comunidad() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apagar_comunidad() TO authenticated;

-- Mi perfil, mis amigos, solicitudes y gente de mi mesa que también está en la comunidad
CREATE OR REPLACE FUNCTION public.mi_comunidad(_qr_token text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  yo uuid := (SELECT auth.uid());
  p public.perfiles_comunidad;
  mesa_sesion uuid;
BEGIN
  IF yo IS NULL THEN
    RAISE EXCEPTION 'Entra con tu cuenta' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO p FROM public.perfiles_comunidad WHERE user_id = yo;
  IF p.user_id IS NULL OR NOT p.activo THEN
    RETURN jsonb_build_object('activo', false, 'suspendido', false);
  END IF;
  IF p.suspendido_at IS NOT NULL THEN
    RETURN jsonb_build_object('activo', false, 'suspendido', true);
  END IF;
  IF _qr_token IS NOT NULL THEN
    SELECT ts.id INTO mesa_sesion FROM public.table_sessions ts
      JOIN public.comensales_mesa cm ON cm.session_id = ts.id AND cm.user_id = yo
     WHERE ts.table_id = public._mesa_del_qr(_qr_token) AND ts.is_active;
  END IF;
  RETURN jsonb_build_object(
    'activo', true, 'suspendido', false, 'nombre', p.nombre, 'codigo', p.codigo,
    'amigos', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'user_id', o.user_id, 'nombre', o.nombre) ORDER BY o.nombre), '[]'::jsonb)
                 FROM public.amistades a
                 JOIN public.perfiles_comunidad o ON o.user_id = CASE WHEN a.de_user_id = yo THEN a.para_user_id ELSE a.de_user_id END
                WHERE a.estado = 'aceptada' AND (a.de_user_id = yo OR a.para_user_id = yo) AND o.activo AND o.suspendido_at IS NULL),
    'solicitudes', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'nombre', o.nombre) ORDER BY a.created_at), '[]'::jsonb)
                      FROM public.amistades a JOIN public.perfiles_comunidad o ON o.user_id = a.de_user_id
                     WHERE a.para_user_id = yo AND a.estado = 'pendiente' AND o.activo AND o.suspendido_at IS NULL),
    'enviadas', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'nombre', o.nombre) ORDER BY a.created_at), '[]'::jsonb)
                   FROM public.amistades a JOIN public.perfiles_comunidad o ON o.user_id = a.para_user_id
                  WHERE a.de_user_id = yo AND a.estado = 'pendiente'),
    -- En mi mesa: quienes también activaron la comunidad y todavía no son mis amigos (ni hay bloqueo)
    'en_mi_mesa', CASE WHEN mesa_sesion IS NULL THEN '[]'::jsonb ELSE
                  (SELECT coalesce(jsonb_agg(jsonb_build_object('user_id', o.user_id, 'nombre', o.nombre) ORDER BY o.nombre), '[]'::jsonb)
                     FROM public.comensales_mesa cm JOIN public.perfiles_comunidad o ON o.user_id = cm.user_id
                    WHERE cm.session_id = mesa_sesion AND cm.user_id <> yo AND o.activo AND o.suspendido_at IS NULL
                      AND NOT public._bloqueados_entre(yo, o.user_id)
                      AND NOT EXISTS (SELECT 1 FROM public.amistades a WHERE least(a.de_user_id, a.para_user_id) = least(yo, o.user_id)
                                                                        AND greatest(a.de_user_id, a.para_user_id) = greatest(yo, o.user_id))) END);
END;
$$;
REVOKE ALL ON FUNCTION public.mi_comunidad(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mi_comunidad(text) TO authenticated;

-- Pedir amistad: con el código de la otra persona, o a alguien de mi mesa (que también está en la comunidad)
CREATE OR REPLACE FUNCTION public.pedir_amistad(_codigo text DEFAULT NULL, _qr_token text DEFAULT NULL, _user_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  yo uuid := public._yo_verificado();
  otro uuid;
  previa public.amistades;
BEGIN
  IF NOT public._en_comunidad(yo) THEN
    RAISE EXCEPTION 'Activa la comunidad para agregar amigos' USING ERRCODE = 'P0001';
  END IF;
  IF _codigo IS NOT NULL THEN
    SELECT user_id INTO otro FROM public.perfiles_comunidad WHERE codigo = upper(btrim(_codigo)) AND activo AND suspendido_at IS NULL;
  ELSIF _qr_token IS NOT NULL AND _user_id IS NOT NULL THEN
    -- Solo alguien que está ahora en mi misma mesa
    SELECT cm2.user_id INTO otro
      FROM public.table_sessions ts
      JOIN public.comensales_mesa cm ON cm.session_id = ts.id AND cm.user_id = yo
      JOIN public.comensales_mesa cm2 ON cm2.session_id = ts.id AND cm2.user_id = _user_id
     WHERE ts.table_id = public._mesa_del_qr(_qr_token) AND ts.is_active AND public._en_comunidad(_user_id);
  END IF;
  IF otro IS NULL OR otro = yo THEN
    RAISE EXCEPTION 'No encontramos a esa persona en la comunidad' USING ERRCODE = 'P0001';
  END IF;
  IF public._bloqueados_entre(yo, otro) THEN
    RAISE EXCEPTION 'No encontramos a esa persona en la comunidad' USING ERRCODE = 'P0001'; -- no se revela el bloqueo
  END IF;
  IF (SELECT count(*) FROM public.amistades WHERE de_user_id = yo AND estado = 'pendiente') >= 20 THEN
    RAISE EXCEPTION 'Tienes muchas solicitudes esperando. Espera a que respondan.' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO previa FROM public.amistades
   WHERE least(de_user_id, para_user_id) = least(yo, otro) AND greatest(de_user_id, para_user_id) = greatest(yo, otro) FOR UPDATE;
  IF previa.id IS NULL THEN
    INSERT INTO public.amistades (de_user_id, para_user_id) VALUES (yo, otro) ON CONFLICT DO NOTHING;
  ELSIF previa.estado = 'pendiente' AND previa.para_user_id = yo THEN
    -- La otra persona ya me lo había pedido: queda aceptada
    UPDATE public.amistades SET estado = 'aceptada', aceptada_at = now() WHERE id = previa.id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.pedir_amistad(text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pedir_amistad(text, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.responder_amistad(_amistad_id uuid, _aceptar boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  yo uuid := public._yo_verificado();
BEGIN
  IF _aceptar THEN
    UPDATE public.amistades SET estado = 'aceptada', aceptada_at = now()
     WHERE id = _amistad_id AND para_user_id = yo AND estado = 'pendiente';
  ELSE
    DELETE FROM public.amistades WHERE id = _amistad_id AND para_user_id = yo AND estado = 'pendiente';
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esa solicitud ya no está' USING ERRCODE = 'P0001';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.responder_amistad(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.responder_amistad(uuid, boolean) TO authenticated;

-- Quitar a un amigo (o retirar una solicitud que mandé)
CREATE OR REPLACE FUNCTION public.quitar_amistad(_amistad_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  yo uuid := public._yo_verificado();
BEGIN
  DELETE FROM public.amistades WHERE id = _amistad_id AND (de_user_id = yo OR para_user_id = yo);
END;
$$;
REVOKE ALL ON FUNCTION public.quitar_amistad(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.quitar_amistad(uuid) TO authenticated;

-- Bloquear: corta la amistad y evita nuevas solicitudes (sin avisarle)
CREATE OR REPLACE FUNCTION public.bloquear_usuario(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  yo uuid := public._yo_verificado();
BEGIN
  IF _user_id IS NULL OR _user_id = yo THEN
    RAISE EXCEPTION 'No se puede bloquear a esa persona' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.bloqueos_usuario (user_id, bloqueado_id) VALUES (yo, _user_id) ON CONFLICT DO NOTHING;
  DELETE FROM public.amistades WHERE least(de_user_id, para_user_id) = least(yo, _user_id) AND greatest(de_user_id, para_user_id) = greatest(yo, _user_id);
END;
$$;
REVOKE ALL ON FUNCTION public.bloquear_usuario(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bloquear_usuario(uuid) TO authenticated;

-- Reportar a alguien con quien tengo relación (amigo, solicitud o mesa): llega a Tablio
CREATE OR REPLACE FUNCTION public.reportar_usuario(_user_id uuid, _motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  yo uuid := public._yo_verificado();
  v_motivo text := btrim(coalesce(_motivo, ''));
BEGIN
  IF char_length(v_motivo) NOT BETWEEN 5 AND 500 THEN
    RAISE EXCEPTION 'Cuéntanos qué pasó (de 5 a 500 letras)' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.perfiles_comunidad WHERE user_id = _user_id) THEN
    RAISE EXCEPTION 'No encontramos a esa persona en la comunidad' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.reportes_comunidad WHERE reporta_id = yo AND created_at > now() - interval '1 day') >= 10 THEN
    RAISE EXCEPTION 'Ya enviaste varios reportes hoy. Los estamos revisando.' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.reportes_comunidad (reporta_id, reportado_id, motivo) VALUES (yo, _user_id, v_motivo);
END;
$$;
REVOKE ALL ON FUNCTION public.reportar_usuario(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reportar_usuario(uuid, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Moderación (superadmin)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reportes_comunidad_abiertos()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Solo el superadmin modera la comunidad' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object(
            'id', r.id, 'motivo', r.motivo, 'created_at', r.created_at, 'estado', r.estado,
            'reportado_id', r.reportado_id, 'reportado', p.nombre,
            'reportes_total', (SELECT count(*) FROM public.reportes_comunidad x WHERE x.reportado_id = r.reportado_id),
            'suspendido', p.suspendido_at IS NOT NULL) ORDER BY r.created_at DESC), '[]'::jsonb)
            FROM public.reportes_comunidad r LEFT JOIN public.perfiles_comunidad p ON p.user_id = r.reportado_id
           WHERE r.estado = 'abierto' OR r.created_at > now() - interval '30 days');
END;
$$;
REVOKE ALL ON FUNCTION public.reportes_comunidad_abiertos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reportes_comunidad_abiertos() TO authenticated;

-- Revisar un reporte: dejarlo como revisado o suspender el perfil (con nota y auditoría)
CREATE OR REPLACE FUNCTION public.moderar_reporte(_reporte_id uuid, _suspender boolean, _nota text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.reportes_comunidad;
  v_nota text := btrim(coalesce(_nota, ''));
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Solo el superadmin modera la comunidad' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_nota) NOT BETWEEN 5 AND 500 THEN
    RAISE EXCEPTION 'Escribe una nota (de 5 a 500 letras)' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO r FROM public.reportes_comunidad WHERE id = _reporte_id FOR UPDATE;
  IF r.id IS NULL THEN
    RAISE EXCEPTION 'Ese reporte no existe' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.reportes_comunidad SET estado = CASE WHEN _suspender THEN 'suspendido' ELSE 'revisado' END,
         revisado_por = (SELECT auth.uid()), revisado_at = now(), nota = v_nota
   WHERE id = r.id;
  IF _suspender AND r.reportado_id IS NOT NULL THEN
    UPDATE public.perfiles_comunidad SET suspendido_at = now(), updated_at = now() WHERE user_id = r.reportado_id;
    DELETE FROM public.amistades WHERE de_user_id = r.reportado_id OR para_user_id = r.reportado_id;
  END IF;
  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (NULL, (SELECT auth.uid()), CASE WHEN _suspender THEN 'comunidad_perfil_suspendido' ELSE 'comunidad_reporte_revisado' END,
          'reporte_comunidad', r.id, jsonb_build_object('nota', v_nota));
END;
$$;
REVOKE ALL ON FUNCTION public.moderar_reporte(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.moderar_reporte(uuid, boolean, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Privacidad y auditoría
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  def text;
  nuevo text;
BEGIN
  -- Sus datos de comunidad aparecen en sus datos (y se borran con su cuenta: ON DELETE CASCADE)
  def := pg_get_functiondef('public.mis_datos()'::regprocedure);
  nuevo := replace(def, $q$    'invitaciones_a_otras_mesas', (SELECT count(*) FROM public.invitaciones_mesa i WHERE i.de_user_id = yo),$q$,
    $q$    'invitaciones_a_otras_mesas', (SELECT count(*) FROM public.invitaciones_mesa i WHERE i.de_user_id = yo),
    'comunidad', (SELECT jsonb_build_object('nombre', p.nombre, 'activo', p.activo, 'consentimiento', p.consentimiento_at,
                                            'amigos', (SELECT count(*) FROM public.amistades a WHERE (a.de_user_id = yo OR a.para_user_id = yo) AND a.estado = 'aceptada'),
                                            'bloqueados', (SELECT count(*) FROM public.bloqueos_usuario b WHERE b.user_id = yo))
                    FROM public.perfiles_comunidad p WHERE p.user_id = yo),$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'mis_datos: no se encontró dónde'; END IF;
  EXECUTE nuevo;

  -- La auditoría de la operación revisa la comunidad: nadie es amigo de alguien que lo bloqueó, ni de un perfil
  -- apagado o suspendido
  def := pg_get_functiondef('public.auditoria_operacion()'::regprocedure);
  nuevo := regexp_replace(def, '\n(\s*END;\s*\$function\$)', $q$

  -- Fase 9.2: ninguna amistad entre personas que se bloquearon, ni con un perfil apagado, suspendido o inexistente
  RETURN QUERY
  SELECT 'amistad_incoherente', a.id::text,
         CASE WHEN public._bloqueados_entre(a.de_user_id, a.para_user_id) THEN 'Amistad entre personas que se bloquearon'
              ELSE 'Amistad con un perfil apagado, suspendido o sin comunidad' END
    FROM public.amistades a
   WHERE public._bloqueados_entre(a.de_user_id, a.para_user_id)
      OR NOT EXISTS (SELECT 1 FROM public.perfiles_comunidad p WHERE p.user_id = a.de_user_id AND p.activo AND p.suspendido_at IS NULL)
      OR NOT EXISTS (SELECT 1 FROM public.perfiles_comunidad p WHERE p.user_id = a.para_user_id AND p.activo AND p.suspendido_at IS NULL);
\1$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'auditoria_operacion: no se encontró el final'; END IF;
  EXECUTE nuevo;
END;
$$;
