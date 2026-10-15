-- Fase 5.1 — Alta del local por Tablio. Antes, el superadmin creaba un local escribiendo directo desde el
-- navegador, en pasos sueltos (si fallaba a mitad quedaba un local a medias), sin mesas ni códigos, y
-- eligiendo él la contraseña del dueño. Ahora una sola función en el servidor crea todo de una vez y el
-- dueño activa su cuenta con un enlace, eligiendo su propia contraseña.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Enlaces de activación del dueño (un solo uso, 14 días)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.activaciones_local (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  correo text NOT NULL,
  nombre_dueno text,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '14 days',
  used_at timestamptz,
  usado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  anulado_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activaciones_local_tenant ON public.activaciones_local (tenant_id);
CREATE INDEX IF NOT EXISTS activaciones_local_branch ON public.activaciones_local (branch_id);
CREATE INDEX IF NOT EXISTS activaciones_local_usado_por ON public.activaciones_local (usado_por) WHERE usado_por IS NOT NULL;
CREATE INDEX IF NOT EXISTS activaciones_local_created_by ON public.activaciones_local (created_by) WHERE created_by IS NOT NULL;
-- El enlace es secreto: nadie lo lee desde el navegador (se entrega una sola vez, al crearlo)
ALTER TABLE public.activaciones_local ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.activaciones_local FROM anon, authenticated;

-- ¿Quién da de alta locales? El superadmin y el equipo de ventas activo (jefe de ventas y vendedores).
CREATE OR REPLACE FUNCTION public._puede_dar_alta()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_platform_admin() OR public.es_rol_backoffice(ARRAY['jefe_ventas', 'vendedor'])
$$;
REVOKE ALL ON FUNCTION public._puede_dar_alta() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._nuevo_enlace_activacion(_tenant_id uuid, _branch_id uuid, _correo text, _nombre text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
BEGIN
  -- El enlace anterior que nadie usó deja de servir
  UPDATE public.activaciones_local SET anulado_at = now()
   WHERE tenant_id = _tenant_id AND used_at IS NULL AND anulado_at IS NULL;
  INSERT INTO public.activaciones_local (tenant_id, branch_id, token, correo, nombre_dueno, created_by)
  VALUES (_tenant_id, _branch_id, v_token, lower(_correo), _nombre, auth.uid());
  RETURN v_token;
END;
$$;
REVOKE ALL ON FUNCTION public._nuevo_enlace_activacion(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Crear el local completo de una vez
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crear_local(
  _nombre text,
  _slug text,
  _correo_dueno text,
  _nombre_dueno text DEFAULT NULL,
  _telefono text DEFAULT NULL,
  _color text DEFAULT '#E8531D',
  _mesas integer DEFAULT 10,
  _modo text DEFAULT 'prepaid',
  _lead_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nombre text := btrim(coalesce(_nombre, ''));
  v_slug text := lower(btrim(coalesce(_slug, '')));
  v_correo text := lower(btrim(coalesce(_correo_dueno, '')));
  local uuid;
  restaurante uuid;
  sucursal uuid;
  v_token text;
  n integer;
BEGIN
  IF NOT public._puede_dar_alta() THEN
    RAISE EXCEPTION 'Solo Tablio da de alta locales' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_nombre) < 2 OR char_length(v_nombre) > 80 THEN
    RAISE EXCEPTION 'El nombre del local debe tener entre 2 y 80 letras' USING ERRCODE = 'P0001';
  END IF;
  IF v_slug !~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$' THEN
    RAISE EXCEPTION 'La dirección del local va en minúsculas, sin espacios ni tildes (de 3 a 40 letras, números o guiones)' USING ERRCODE = 'P0001';
  END IF;
  IF v_slug IN ('admin', 'mozo', 'kds', 'login', 'superadmin', 'vendedor', 'jefe-ventas', 'finanzas', 'backoffice', 'privacidad', 'activar', 'api') THEN
    RAISE EXCEPTION 'Esa dirección está reservada: elige otra' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tenants WHERE tenants.slug = v_slug) THEN
    RAISE EXCEPTION 'Esa dirección ya la usa otro local: elige otra' USING ERRCODE = 'P0001';
  END IF;
  IF v_correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'El correo del dueño no es válido' USING ERRCODE = 'P0001';
  END IF;
  IF coalesce(_mesas, 0) < 1 OR _mesas > 200 THEN
    RAISE EXCEPTION 'Las mesas van de 1 a 200' USING ERRCODE = 'P0001';
  END IF;
  IF coalesce(_modo, '') NOT IN ('prepaid', 'open_tab') THEN
    RAISE EXCEPTION 'Modo de cobro no válido' USING ERRCODE = '22023';
  END IF;
  IF _color IS NOT NULL AND _color !~ '^#[0-9A-Fa-f]{6}$' THEN
    RAISE EXCEPTION 'El color va en formato #RRGGBB' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.tenants (name, slug, email, phone, primary_color, plan_id, plan_status, is_active)
  VALUES (v_nombre, v_slug, v_correo, nullif(btrim(coalesce(_telefono, '')), ''), coalesce(_color, '#E8531D'),
          (SELECT id FROM public.plans ORDER BY created_at LIMIT 1), 'trial', true)
  RETURNING id INTO local;
  INSERT INTO public.restaurants (tenant_id, name) VALUES (local, v_nombre) RETURNING id INTO restaurante;
  -- La sucursal parte sin cobros con la app: el dueño conecta su pasarela (nunca cobros simulados)
  INSERT INTO public.branches (tenant_id, restaurant_id, name, is_open, payment_mode, pagos_simulados)
  VALUES (local, restaurante, 'Principal', false, _modo, false)
  RETURNING id INTO sucursal;
  INSERT INTO public.menus (tenant_id, branch_id, name, is_active) VALUES (local, sucursal, 'Carta', true);
  -- Mesas con su QR (el código de presencia y la estación principal los crea la base sola)
  FOR n IN 1.._mesas LOOP
    INSERT INTO public.tables (tenant_id, branch_id, number, name, capacity, qr_token, status)
    VALUES (local, sucursal, n, 'Mesa ' || n, 4, encode(extensions.gen_random_bytes(16), 'hex'), 'free');
  END LOOP;

  v_token := public._nuevo_enlace_activacion(local, sucursal, v_correo, nullif(btrim(coalesce(_nombre_dueno, '')), ''));

  IF _lead_id IS NOT NULL THEN
    UPDATE public.leads SET converted_tenant_id = local, stage = 'piloto_activo', updated_at = now()
     WHERE id = _lead_id AND converted_tenant_id IS NULL;
  END IF;

  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (local, auth.uid(), 'local_creado', 'tenant', local,
          jsonb_build_object('slug', v_slug, 'mesas', _mesas, 'modo', _modo, 'lead_id', _lead_id));

  RETURN jsonb_build_object('tenant_id', local, 'branch_id', sucursal, 'slug', v_slug, 'token', v_token);
END;
$$;
REVOKE ALL ON FUNCTION public.crear_local(text, text, text, text, text, text, integer, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crear_local(text, text, text, text, text, text, integer, text, uuid) TO authenticated;

-- Un enlace nuevo (el anterior se venció o se perdió); el anterior deja de servir
CREATE OR REPLACE FUNCTION public.nuevo_enlace_activacion(_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ultimo public.activaciones_local;
  v_token text;
BEGIN
  IF NOT public._puede_dar_alta() THEN
    RAISE EXCEPTION 'Solo Tablio da de alta locales' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO ultimo FROM public.activaciones_local WHERE tenant_id = _tenant_id ORDER BY created_at DESC LIMIT 1;
  IF ultimo.id IS NULL THEN
    RAISE EXCEPTION 'Ese local no se creó con un enlace de activación' USING ERRCODE = 'P0002';
  END IF;
  IF ultimo.used_at IS NOT NULL THEN
    RAISE EXCEPTION 'El dueño ya activó su cuenta' USING ERRCODE = 'P0001';
  END IF;
  v_token := public._nuevo_enlace_activacion(_tenant_id, ultimo.branch_id, ultimo.correo, ultimo.nombre_dueno);
  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (_tenant_id, auth.uid(), 'enlace_activacion_nuevo', 'tenant', _tenant_id, '{}'::jsonb);
  RETURN jsonb_build_object('token', v_token);
END;
$$;
REVOKE ALL ON FUNCTION public.nuevo_enlace_activacion(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nuevo_enlace_activacion(uuid) TO authenticated;

-- Estado de la activación de cada local (sin el enlace), para el backoffice
CREATE OR REPLACE FUNCTION public.estado_activaciones()
RETURNS TABLE (tenant_id uuid, correo text, creado_at timestamptz, vence_at timestamptz, activado_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public._puede_dar_alta() THEN
    RAISE EXCEPTION 'Solo Tablio ve las activaciones' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT DISTINCT ON (a.tenant_id) a.tenant_id, a.correo, a.created_at, a.expires_at, a.used_at
    FROM public.activaciones_local a
   WHERE a.anulado_at IS NULL
   ORDER BY a.tenant_id, a.created_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.estado_activaciones() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.estado_activaciones() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. La página de activación (pública a propósito: quien tiene el enlace todavía no tiene cuenta)
-- ─────────────────────────────────────────────────────────────────────────────
-- Solo responde el nombre del local, el correo a medias y si el enlace sirve; sin el enlace no se sabe nada.
CREATE OR REPLACE FUNCTION public.ver_activacion(_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.activaciones_local;
  local text;
BEGIN
  IF _token IS NULL OR char_length(_token) <> 48 THEN
    RETURN jsonb_build_object('estado', 'no_existe');
  END IF;
  SELECT * INTO a FROM public.activaciones_local WHERE token = _token;
  IF a.id IS NULL THEN RETURN jsonb_build_object('estado', 'no_existe'); END IF;
  SELECT name INTO local FROM public.tenants WHERE id = a.tenant_id;
  RETURN jsonb_build_object(
    'estado', CASE WHEN a.used_at IS NOT NULL THEN 'usado' WHEN a.anulado_at IS NOT NULL THEN 'anulado'
                   WHEN a.expires_at < now() THEN 'vencido' ELSE 'vigente' END,
    'local', local,
    'nombre', a.nombre_dueno,
    'correo', regexp_replace(a.correo, '^(.).*(@.*)$', '\1•••\2'));
END;
$$;
REVOKE ALL ON FUNCTION public.ver_activacion(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ver_activacion(text) TO anon, authenticated;

-- La función activar-local reserva el enlace antes de crear la cuenta (dos personas no usan el mismo) y
-- después deja al dueño en su local. Solo el servidor.
CREATE OR REPLACE FUNCTION public._reservar_activacion(_token text)
RETURNS TABLE (id uuid, tenant_id uuid, branch_id uuid, correo text, nombre_dueno text, slug text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.activaciones_local a SET used_at = now()
   WHERE a.token = _token AND a.used_at IS NULL AND a.anulado_at IS NULL AND a.expires_at > now()
  RETURNING a.id, a.tenant_id, a.branch_id, a.correo, a.nombre_dueno, (SELECT t.slug FROM public.tenants t WHERE t.id = a.tenant_id);
END;
$$;
REVOKE ALL ON FUNCTION public._reservar_activacion(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._liberar_activacion(_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.activaciones_local SET used_at = NULL WHERE id = _id AND usado_por IS NULL
$$;
REVOKE ALL ON FUNCTION public._liberar_activacion(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._completar_activacion(_id uuid, _user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.activaciones_local;
BEGIN
  SELECT * INTO a FROM public.activaciones_local WHERE id = _id AND used_at IS NOT NULL AND usado_por IS NULL FOR UPDATE;
  IF a.id IS NULL THEN
    RAISE EXCEPTION 'Enlace de activación no reservado' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.tenant_members (user_id, tenant_id, branch_id, role, is_active)
  VALUES (_user_id, a.tenant_id, a.branch_id, 'owner', true)
  ON CONFLICT DO NOTHING;
  UPDATE public.activaciones_local SET usado_por = _user_id WHERE id = a.id;
  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (a.tenant_id, _user_id, 'local_activado', 'tenant', a.tenant_id, '{}'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public._completar_activacion(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. La auditoría de seguridad: ver_activacion es pública a propósito (quien abre el enlace no tiene cuenta)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  def text;
BEGIN
  SELECT pg_get_functiondef('public.auditoria_seguridad()'::regprocedure) INTO def;
  IF position('ver_activacion' IN def) = 0 THEN
    def := replace(def, '''ver_invitacion_mozo'',', '''ver_invitacion_mozo'', ''ver_activacion'',');
    IF position('ver_activacion' IN def) = 0 THEN
      RAISE EXCEPTION 'No se pudo anotar ver_activacion como función pública en la auditoría';
    END IF;
    EXECUTE def;
  END IF;
END;
$$;
