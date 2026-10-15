-- Fase 6.1 — PIN del mozo en tablets compartidas. Muchos locales tienen una tablet para los mozos en vez de
-- que cada uno use su teléfono. Ahora el dueño (o el encargado) deja un dispositivo como "tablet compartida",
-- y cada mozo entra con su PIN de 4 números: todo lo que hace queda a su nombre (propinas, cobros, entregas),
-- sin compartir contraseñas. El PIN se guarda cifrado (como una contraseña) en una tabla que nadie lee desde
-- el navegador; 5 intentos fallidos lo bloquean 10 minutos.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Los PIN (cifrados; nadie los lee desde el navegador)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pines_personal (
  staff_id uuid PRIMARY KEY REFERENCES public.staff_users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  pin_hash text NOT NULL,
  intentos integer NOT NULL DEFAULT 0,
  bloqueado_hasta timestamptz,
  actualizado_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pines_personal_tenant ON public.pines_personal (tenant_id);
ALTER TABLE public.pines_personal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pines_personal FROM anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Las tablets compartidas de cada sucursal
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.equipos_compartidos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  nombre text NOT NULL CHECK (char_length(nombre) BETWEEN 1 AND 40),
  token_hash text NOT NULL UNIQUE,
  creado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  ultimo_uso_at timestamptz,
  revocado_at timestamptz
);
CREATE INDEX IF NOT EXISTS equipos_compartidos_branch ON public.equipos_compartidos (branch_id);
CREATE INDEX IF NOT EXISTS equipos_compartidos_tenant ON public.equipos_compartidos (tenant_id);
CREATE INDEX IF NOT EXISTS equipos_compartidos_creado_por ON public.equipos_compartidos (creado_por) WHERE creado_por IS NOT NULL;
ALTER TABLE public.equipos_compartidos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS equipos_compartidos_gestion ON public.equipos_compartidos;
CREATE POLICY equipos_compartidos_gestion ON public.equipos_compartidos FOR SELECT TO authenticated
  USING (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager']));
REVOKE ALL ON public.equipos_compartidos FROM anon, authenticated;
GRANT SELECT (id, tenant_id, branch_id, nombre, created_at, ultimo_uso_at, revocado_at) ON public.equipos_compartidos TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. El mozo define su PIN; el dueño o el encargado lo borran
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.definir_mi_pin(_pin text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  yo public.staff_users;
BEGIN
  SELECT * INTO yo FROM public.staff_users WHERE auth_user_id = auth.uid() AND is_active ORDER BY created_at LIMIT 1;
  IF yo.id IS NULL THEN
    RAISE EXCEPTION 'Solo el equipo del local tiene PIN' USING ERRCODE = '42501';
  END IF;
  IF _pin IS NULL OR _pin !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'El PIN son 4 números' USING ERRCODE = 'P0001';
  END IF;
  IF _pin IN ('0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999', '1234', '4321', '0123', '9876') THEN
    RAISE EXCEPTION 'Ese PIN es muy fácil de adivinar: elige otro' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.pines_personal (staff_id, tenant_id, pin_hash)
  VALUES (yo.id, yo.tenant_id, extensions.crypt(_pin, extensions.gen_salt('bf')))
  ON CONFLICT (staff_id) DO UPDATE
    SET pin_hash = EXCLUDED.pin_hash, intentos = 0, bloqueado_hasta = NULL, actualizado_at = now();
END;
$$;
REVOKE ALL ON FUNCTION public.definir_mi_pin(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.definir_mi_pin(text) TO authenticated;

-- ¿Quién del equipo tiene PIN? (sin el PIN, claro), para el dueño y el propio mozo
CREATE OR REPLACE FUNCTION public.estado_pines(_branch_id uuid)
RETURNS TABLE (staff_id uuid, tiene_pin boolean, bloqueado boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  local uuid := (SELECT tenant_id FROM public.branches WHERE id = _branch_id);
BEGIN
  IF local IS NULL OR NOT public.tiene_rol(local, ARRAY['owner', 'admin', 'manager', 'cashier', 'waiter', 'kitchen']) THEN
    RAISE EXCEPTION 'No tienes permiso para ver esto' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT s.id, p.staff_id IS NOT NULL, coalesce(p.bloqueado_hasta > now(), false)
    FROM public.staff_users s LEFT JOIN public.pines_personal p ON p.staff_id = s.id
   WHERE s.branch_id = _branch_id AND s.is_active
     -- el mozo solo ve el suyo; dueño, administrador y encargado ven todos
     AND (public.tiene_rol(local, ARRAY['owner', 'admin', 'manager']) OR s.auth_user_id = (SELECT auth.uid()));
END;
$$;
REVOKE ALL ON FUNCTION public.estado_pines(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.estado_pines(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.borrar_pin(_staff_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.staff_users;
BEGIN
  SELECT * INTO s FROM public.staff_users WHERE id = _staff_id;
  IF s.id IS NULL OR NOT public.tiene_rol(s.tenant_id, ARRAY['owner', 'admin', 'manager']) THEN
    RAISE EXCEPTION 'No tienes permiso para este cambio' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.pines_personal WHERE staff_id = _staff_id;
  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (s.tenant_id, auth.uid(), 'pin_borrado', 'staff', _staff_id, jsonb_build_object('nombre', s.name));
END;
$$;
REVOKE ALL ON FUNCTION public.borrar_pin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.borrar_pin(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Dejar un dispositivo como tablet compartida (el token se entrega una sola vez y vive en ese dispositivo)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crear_equipo_compartido(_branch_id uuid, _nombre text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  local uuid := (SELECT tenant_id FROM public.branches WHERE id = _branch_id);
  token text := encode(extensions.gen_random_bytes(32), 'hex');
  nuevo uuid;
  nombre_limpio text := left(nullif(btrim(coalesce(_nombre, '')), ''), 40);
BEGIN
  IF local IS NULL OR NOT public.tiene_rol(local, ARRAY['owner', 'admin', 'manager']) THEN
    RAISE EXCEPTION 'Solo el dueño, el administrador o el encargado activan una tablet' USING ERRCODE = '42501';
  END IF;
  IF (SELECT count(*) FROM public.equipos_compartidos WHERE branch_id = _branch_id AND revocado_at IS NULL) >= 20 THEN
    RAISE EXCEPTION 'La sucursal ya tiene 20 tablets activas: desactiva alguna antes' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.equipos_compartidos (tenant_id, branch_id, nombre, token_hash, creado_por)
  VALUES (local, _branch_id, coalesce(nombre_limpio, 'Tablet'), encode(extensions.digest(token, 'sha256'), 'hex'), auth.uid())
  RETURNING id INTO nuevo;
  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (local, auth.uid(), 'tablet_activada', 'equipo_compartido', nuevo, jsonb_build_object('nombre', coalesce(nombre_limpio, 'Tablet')));
  RETURN jsonb_build_object('id', nuevo, 'token', token);
END;
$$;
REVOKE ALL ON FUNCTION public.crear_equipo_compartido(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crear_equipo_compartido(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.revocar_equipo_compartido(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e public.equipos_compartidos;
BEGIN
  SELECT * INTO e FROM public.equipos_compartidos WHERE id = _id;
  IF e.id IS NULL OR NOT public.tiene_rol(e.tenant_id, ARRAY['owner', 'admin', 'manager']) THEN
    RAISE EXCEPTION 'No tienes permiso para este cambio' USING ERRCODE = '42501';
  END IF;
  UPDATE public.equipos_compartidos SET revocado_at = now() WHERE id = _id AND revocado_at IS NULL;
  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (e.tenant_id, auth.uid(), 'tablet_desactivada', 'equipo_compartido', _id, jsonb_build_object('nombre', e.nombre));
END;
$$;
REVOKE ALL ON FUNCTION public.revocar_equipo_compartido(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revocar_equipo_compartido(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. La pantalla de la tablet (pública a propósito: entre un mozo y otro, la tablet no tiene sesión)
-- ─────────────────────────────────────────────────────────────────────────────
-- Con el token de la tablet: el local y el nombre de quienes pueden entrar (solo nombres, sin nada más).
-- Sin un token válido no responde nada.
CREATE OR REPLACE FUNCTION public.equipo_de_tablet(_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e public.equipos_compartidos;
BEGIN
  IF _token IS NULL OR char_length(_token) <> 64 THEN RETURN NULL; END IF;
  SELECT * INTO e FROM public.equipos_compartidos
   WHERE token_hash = encode(extensions.digest(_token, 'sha256'), 'hex') AND revocado_at IS NULL;
  IF e.id IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'local', (SELECT name FROM public.tenants WHERE id = e.tenant_id),
    'sucursal', (SELECT name FROM public.branches WHERE id = e.branch_id),
    'tablet', e.nombre,
    'personas', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'nombre', s.name) ORDER BY s.name), '[]'::jsonb)
                   FROM public.staff_users s JOIN public.pines_personal p ON p.staff_id = s.id
                  WHERE s.branch_id = e.branch_id AND s.is_active AND s.role IN ('waiter', 'manager', 'cashier')));
END;
$$;
REVOKE ALL ON FUNCTION public.equipo_de_tablet(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.equipo_de_tablet(text) TO anon, authenticated;

-- La función entrar-con-pin revisa el PIN (solo el servidor): devuelve la cuenta de esa persona o un motivo
CREATE OR REPLACE FUNCTION public._verificar_pin(_token text, _staff_id uuid, _pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e public.equipos_compartidos;
  s public.staff_users;
  p public.pines_personal;
  correo text;
BEGIN
  SELECT * INTO e FROM public.equipos_compartidos
   WHERE token_hash = encode(extensions.digest(coalesce(_token, ''), 'sha256'), 'hex') AND revocado_at IS NULL;
  IF e.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'Esta tablet ya no está activa. Pídele al encargado que la active de nuevo.');
  END IF;
  SELECT * INTO s FROM public.staff_users
   WHERE id = _staff_id AND branch_id = e.branch_id AND is_active AND role IN ('waiter', 'manager', 'cashier');
  SELECT * INTO p FROM public.pines_personal WHERE staff_id = _staff_id FOR UPDATE;
  IF s.id IS NULL OR p.staff_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'Esa persona no puede entrar en esta tablet.');
  END IF;
  -- Ningún acceso para quien ya no tiene acceso al local
  IF NOT EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.user_id = s.auth_user_id AND tm.tenant_id = s.tenant_id AND tm.is_active) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'Esa persona no puede entrar en esta tablet.');
  END IF;
  IF p.bloqueado_hasta IS NOT NULL AND p.bloqueado_hasta > now() THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'Demasiados intentos. Espera unos minutos o pídele al encargado que borre tu PIN.');
  END IF;
  IF p.pin_hash <> extensions.crypt(coalesce(_pin, ''), p.pin_hash) THEN
    -- Al quinto intento fallido se bloquea 10 minutos (y el contador vuelve a cero)
    UPDATE public.pines_personal
       SET intentos = CASE WHEN intentos + 1 >= 5 THEN 0 ELSE intentos + 1 END,
           bloqueado_hasta = CASE WHEN intentos + 1 >= 5 THEN now() + interval '10 minutes' ELSE bloqueado_hasta END
     WHERE staff_id = _staff_id;
    RETURN jsonb_build_object('ok', false, 'motivo', 'PIN incorrecto.');
  END IF;
  UPDATE public.pines_personal SET intentos = 0, bloqueado_hasta = NULL WHERE staff_id = _staff_id;
  UPDATE public.equipos_compartidos SET ultimo_uso_at = now() WHERE id = e.id;
  SELECT email INTO correo FROM auth.users WHERE id = s.auth_user_id;
  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (s.tenant_id, s.auth_user_id, 'entrada_con_pin', 'equipo_compartido', e.id, jsonb_build_object('tablet', e.nombre));
  RETURN jsonb_build_object('ok', true, 'user_id', s.auth_user_id, 'correo', correo, 'nombre', s.name);
END;
$$;
REVOKE ALL ON FUNCTION public._verificar_pin(text, uuid, text) FROM PUBLIC, anon, authenticated;

-- Al borrar los datos de una persona del equipo, su PIN se va con su ficha (ON DELETE CASCADE).

-- La auditoría de seguridad: equipo_de_tablet es pública a propósito
DO $$
DECLARE
  def text;
BEGIN
  SELECT pg_get_functiondef('public.auditoria_seguridad()'::regprocedure) INTO def;
  IF position('equipo_de_tablet' IN def) = 0 THEN
    def := replace(def, '''estado_salud'',', '''estado_salud'', ''equipo_de_tablet'',');
    IF position('equipo_de_tablet' IN def) = 0 THEN
      RAISE EXCEPTION 'No se pudo anotar equipo_de_tablet como función pública en la auditoría';
    END IF;
    EXECUTE def;
  END IF;
END;
$$;
