-- Fase 1.7 — Configuración del local (carta, sucursal, equipo, lealtad, marca).
-- Lo que encontramos y se cierra aquí:
--  · cualquiera leía RUT, correo, teléfono y estado del plan de todos los locales;
--  · cualquiera leía el costo de cada plato (los márgenes del local);
--  · cualquiera leía el equipo de todos los locales;
--  · cualquier miembro del local (también un mozo) podía cambiar el plan del local,
--    editar la carta y el programa de lealtad;
--  · cualquiera podía escribir en el registro de auditoría;
--  · desactivar a alguien del equipo no le quitaba el acceso (solo cambiaba su ficha).
-- La carta sigue siendo pública: el comensal la ve sin iniciar sesión.

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Ayudantes.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.es_backoffice()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.backoffice_members WHERE user_id = auth.uid() AND is_active)
$$;
REVOKE ALL ON FUNCTION public.es_backoffice() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.es_backoffice() TO authenticated;

-- Una fila no puede apuntar a algo de otro local (por ejemplo, un plato en la categoría de otro local).
CREATE OR REPLACE FUNCTION public.validar_mismo_local()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ref_id uuid := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
  ref_local uuid;
BEGIN
  IF ref_id IS NULL THEN
    RETURN NEW;
  END IF;
  EXECUTE format('SELECT tenant_id FROM public.%I WHERE id = $1', TG_ARGV[1]) INTO ref_local USING ref_id;
  IF ref_local IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'No puedes usar datos de otro local' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('menus', 'branch_id', 'branches'),
    ('categories', 'menu_id', 'menus'),
    ('categories', 'station_id', 'stations'),
    ('menu_items', 'category_id', 'categories'),
    ('modifier_groups', 'menu_item_id', 'menu_items'),
    ('modifiers', 'group_id', 'modifier_groups'),
    ('stations', 'branch_id', 'branches'),
    ('branches', 'restaurant_id', 'restaurants'),
    ('staff_users', 'branch_id', 'branches'),
    ('staff_invitations', 'branch_id', 'branches'),
    ('loyalty_programs', 'branch_id', 'branches')
  ) AS t(tabla, columna, destino) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'mismo_local_' || r.columna, r.tabla);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF %I, tenant_id ON public.%I FOR EACH ROW EXECUTE FUNCTION public.validar_mismo_local(%L, %L)',
      'mismo_local_' || r.columna, r.columna, r.tabla, r.columna, r.destino);
  END LOOP;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Locales (tenants): lo público es la marca; lo privado, solo para Tablio.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "tenants_public_read" ON public.tenants;
DROP POLICY IF EXISTS "tenants_staff_update" ON public.tenants;

REVOKE SELECT, INSERT, UPDATE, DELETE ON public.tenants FROM anon;
REVOKE SELECT, UPDATE ON public.tenants FROM authenticated;
-- Columnas públicas (la carta las necesita sin iniciar sesión). RUT, correo, teléfono y plan quedan fuera.
GRANT SELECT (id, name, slug, logo_url, primary_color, secondary_color, cover_image_url, welcome_message, timezone, is_active)
  ON public.tenants TO anon, authenticated;
-- El dueño o administrador edita solo la marca; el plan y el estado los cambia Tablio.
GRANT UPDATE (name, logo_url, primary_color, secondary_color, cover_image_url, welcome_message, timezone)
  ON public.tenants TO authenticated;

-- Filas visibles para todos, pero solo con las columnas públicas de arriba (es la marca del local).
CREATE POLICY tenants_lectura_publica ON public.tenants FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY tenants_edicion_marca ON public.tenants FOR UPDATE TO authenticated
  USING (public.tiene_rol(id, ARRAY['owner', 'admin']))
  WITH CHECK (public.tiene_rol(id, ARRAY['owner', 'admin']));

-- Datos completos de los locales, solo para el superadmin y el equipo de Tablio (ventas, finanzas).
CREATE OR REPLACE VIEW public.tenants_privado WITH (security_barrier = true) AS
  SELECT t.* FROM public.tenants t
   WHERE public.is_platform_admin() OR public.es_backoffice();
REVOKE ALL ON public.tenants_privado FROM PUBLIC, anon;
GRANT SELECT ON public.tenants_privado TO authenticated;

-- Activar o desactivar un local: solo el superadmin, y queda registrado.
CREATE OR REPLACE FUNCTION public.sa_activar_local(_tenant_id uuid, _activo boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'No tienes permiso para este cambio' USING ERRCODE = '42501';
  END IF;
  UPDATE public.tenants SET is_active = _activo, updated_at = now() WHERE id = _tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Local no encontrado' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (_tenant_id, auth.uid(), CASE WHEN _activo THEN 'local_activado' ELSE 'local_desactivado' END,
          'tenant', _tenant_id, '{}'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.sa_activar_local(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sa_activar_local(uuid, boolean) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Sucursales y restaurantes: lectura pública (dirección, horario, modo de pago);
--    el dueño o administrador edita su sucursal; crear y borrar, solo Tablio.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "branches_staff_manage" ON public.branches;
DROP POLICY IF EXISTS "restaurants_staff_manage" ON public.restaurants;

REVOKE INSERT, UPDATE, DELETE ON public.branches FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.restaurants FROM anon;
REVOKE UPDATE ON public.branches FROM authenticated;
GRANT UPDATE (name, address, city, phone, is_open, opening_hours, payment_mode) ON public.branches TO authenticated;

CREATE POLICY branches_edicion ON public.branches FOR UPDATE TO authenticated
  USING (public.tiene_rol(tenant_id, ARRAY['owner', 'admin']))
  WITH CHECK (public.tiene_rol(tenant_id, ARRAY['owner', 'admin']));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Carta: lectura pública; la editan dueño, administrador y encargado.
--    El costo de cada plato no es público (son los márgenes del local).
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "menus_staff_manage" ON public.menus;
DROP POLICY IF EXISTS "categories_staff_manage" ON public.categories;
DROP POLICY IF EXISTS "menu_items_staff_manage" ON public.menu_items;
DROP POLICY IF EXISTS "modifier_groups_staff_manage" ON public.modifier_groups;
DROP POLICY IF EXISTS "modifiers_staff_manage" ON public.modifiers;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['menus', 'categories', 'menu_items', 'modifier_groups', 'modifiers'] LOOP
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM anon', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated
         USING (public.tiene_rol(tenant_id, ARRAY[''owner'', ''admin'', ''manager'']))
         WITH CHECK (public.tiene_rol(tenant_id, ARRAY[''owner'', ''admin'', ''manager'']))',
      t || '_gestion', t);
  END LOOP;
END;
$$;

REVOKE SELECT, INSERT, UPDATE ON public.menu_items FROM anon, authenticated;
GRANT SELECT (id, tenant_id, category_id, name, description_short, description_long, price, image_url, image_is_real,
              prep_time_minutes, status, labels, allergens, sort_order, total_orders, created_at, updated_at)
  ON public.menu_items TO anon, authenticated;
-- Las ventas (total_orders) las cuenta el servidor; el costo queda fuera hasta tener su pantalla.
GRANT INSERT (tenant_id, category_id, name, description_short, description_long, price, image_url, image_is_real,
              prep_time_minutes, status, labels, allergens, sort_order)
  ON public.menu_items TO authenticated;
GRANT UPDATE (category_id, name, description_short, description_long, price, image_url, image_is_real,
              prep_time_minutes, status, labels, allergens, sort_order)
  ON public.menu_items TO authenticated;
ALTER TABLE public.menu_items DROP CONSTRAINT IF EXISTS menu_items_precio_valido;
ALTER TABLE public.menu_items ADD CONSTRAINT menu_items_precio_valido CHECK (price >= 0) NOT VALID;

-- Estaciones: solo el personal (el comensal no las necesita).
DROP POLICY IF EXISTS "stations_lectura" ON public.stations;
REVOKE ALL ON public.stations FROM anon;
CREATE POLICY stations_lectura_personal ON public.stations FOR SELECT TO authenticated
  USING (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager', 'cashier', 'waiter', 'kitchen']));
CREATE POLICY stations_lectura_superadmin ON public.stations FOR SELECT TO authenticated
  USING (public.is_platform_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Equipo: lo ve solo el personal de ese local. Los cambios van por funciones que
--    respetan la jerarquía y actualizan también el acceso real (tenant_members).
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "staff_users_public_read" ON public.staff_users;
DROP POLICY IF EXISTS "staff_users_tenant_manage" ON public.staff_users;
DROP POLICY IF EXISTS "staff_users_tenant_read" ON public.staff_users;
DROP POLICY IF EXISTS "superadmin_insert_staff_users" ON public.staff_users;

REVOKE ALL ON public.staff_users FROM anon;
REVOKE INSERT, UPDATE ON public.staff_users FROM authenticated;
GRANT SELECT, DELETE ON public.staff_users TO authenticated; -- borrar: solo superadmin (política existente)

CREATE POLICY staff_users_lectura_personal ON public.staff_users FOR SELECT TO authenticated
  USING (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager', 'cashier', 'waiter', 'kitchen']));
CREATE POLICY staff_users_lectura_superadmin ON public.staff_users FOR SELECT TO authenticated
  USING (public.is_platform_admin());

-- Qué rol puede asignar cada uno (igual que create-tenant-user).
CREATE OR REPLACE FUNCTION public.puede_asignar_rol(_tenant_id uuid, _rol text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_platform_admin()
      OR (public.tiene_rol(_tenant_id, ARRAY['owner']) AND _rol IN ('admin', 'manager', 'cashier', 'waiter', 'kitchen'))
      OR (public.tiene_rol(_tenant_id, ARRAY['admin']) AND _rol IN ('manager', 'cashier', 'waiter', 'kitchen'))
$$;
REVOKE ALL ON FUNCTION public.puede_asignar_rol(uuid, text) FROM PUBLIC, anon, authenticated;

-- Editar nombre y rol de alguien del equipo.
CREATE OR REPLACE FUNCTION public.actualizar_personal(_staff_id uuid, _nombre text, _rol text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ficha record;
  nombre_limpio text := nullif(btrim(coalesce(_nombre, '')), '');
BEGIN
  SELECT * INTO ficha FROM public.staff_users WHERE id = _staff_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No encontramos a esa persona' USING ERRCODE = 'P0002';
  END IF;
  -- Hay que poder asignar tanto el rol actual como el nuevo (un administrador no edita a un dueño).
  IF NOT (public.puede_asignar_rol(ficha.tenant_id, ficha.role) AND public.puede_asignar_rol(ficha.tenant_id, _rol)) THEN
    RAISE EXCEPTION 'No tienes permiso para este cambio' USING ERRCODE = '42501';
  END IF;
  IF ficha.auth_user_id = auth.uid() AND _rol <> ficha.role THEN
    RAISE EXCEPTION 'No puedes cambiar tu propio rol' USING ERRCODE = '42501';
  END IF;
  IF nombre_limpio IS NULL OR char_length(nombre_limpio) > 60 THEN
    RAISE EXCEPTION 'Escribe un nombre de hasta 60 letras' USING ERRCODE = '22023';
  END IF;

  UPDATE public.staff_users SET name = nombre_limpio, role = _rol WHERE id = _staff_id;
  IF ficha.auth_user_id IS NOT NULL THEN
    UPDATE public.tenant_members SET role = _rol
     WHERE user_id = ficha.auth_user_id AND tenant_id = ficha.tenant_id;
  END IF;

  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (ficha.tenant_id, auth.uid(), 'personal_actualizado', 'staff_user', _staff_id,
          jsonb_build_object('rol_anterior', ficha.role, 'rol_nuevo', _rol,
                             'nombre_anterior', ficha.name, 'nombre_nuevo', nombre_limpio));
END;
$$;

-- Activar o desactivar a alguien: desactivado, pierde el acceso al local de inmediato.
CREATE OR REPLACE FUNCTION public.activar_personal(_staff_id uuid, _activo boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ficha record;
BEGIN
  SELECT * INTO ficha FROM public.staff_users WHERE id = _staff_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No encontramos a esa persona' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.puede_asignar_rol(ficha.tenant_id, ficha.role) THEN
    RAISE EXCEPTION 'No tienes permiso para este cambio' USING ERRCODE = '42501';
  END IF;
  IF ficha.auth_user_id = auth.uid() THEN
    RAISE EXCEPTION 'No puedes desactivarte a ti mismo' USING ERRCODE = '42501';
  END IF;

  UPDATE public.staff_users SET is_active = _activo WHERE id = _staff_id;
  IF ficha.auth_user_id IS NOT NULL THEN
    UPDATE public.tenant_members SET is_active = _activo
     WHERE user_id = ficha.auth_user_id AND tenant_id = ficha.tenant_id;
  END IF;
  -- Si atendía mesas, quedan sin mozo para que otro las tome.
  IF NOT _activo THEN
    UPDATE public.tables SET assigned_waiter_id = NULL WHERE assigned_waiter_id = _staff_id;
  END IF;

  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (ficha.tenant_id, auth.uid(), CASE WHEN _activo THEN 'personal_activado' ELSE 'personal_desactivado' END,
          'staff_user', _staff_id, jsonb_build_object('nombre', ficha.name, 'rol', ficha.role));
END;
$$;

REVOKE ALL ON FUNCTION public.actualizar_personal(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.activar_personal(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.actualizar_personal(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.activar_personal(uuid, boolean) TO authenticated;

-- Quién es del equipo (cuentas y roles): dueño, administrador y encargado; cada uno ve lo suyo.
DROP POLICY IF EXISTS "tenant_members_tenant_read" ON public.tenant_members;
CREATE POLICY tenant_members_lectura_gestion ON public.tenant_members FOR SELECT TO authenticated
  USING (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager']));

-- Invitaciones para unirse como mozo, cocina o caja: las crean el dueño o el administrador.
DROP POLICY IF EXISTS "staff_invitations_staff_manage" ON public.staff_invitations;
REVOKE ALL ON public.staff_invitations FROM anon;
CREATE POLICY staff_invitations_gestion ON public.staff_invitations FOR ALL TO authenticated
  USING (public.tiene_rol(tenant_id, ARRAY['owner', 'admin']))
  WITH CHECK (public.tiene_rol(tenant_id, ARRAY['owner', 'admin']) AND role IN ('waiter', 'kitchen', 'cashier'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Lealtad: el programa lo configuran dueño, administrador y encargado;
--    los clientes y sus premios los ve el equipo que los atiende (no la cocina ni el mozo).
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Tenant members can create loyalty programs" ON public.loyalty_programs;
DROP POLICY IF EXISTS "Tenant members can update loyalty programs" ON public.loyalty_programs;
DROP POLICY IF EXISTS "Tenant members can view loyalty programs" ON public.loyalty_programs;
DROP POLICY IF EXISTS "Tenant members can view loyalty customers" ON public.loyalty_customers;
DROP POLICY IF EXISTS "Tenant members can view loyalty rewards" ON public.loyalty_rewards;

REVOKE INSERT, UPDATE, DELETE ON public.loyalty_programs FROM anon;
REVOKE ALL ON public.loyalty_customers FROM anon;
REVOKE ALL ON public.loyalty_rewards FROM anon;

CREATE POLICY loyalty_programs_gestion ON public.loyalty_programs FOR ALL TO authenticated
  USING (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager']))
  WITH CHECK (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager']));
CREATE POLICY loyalty_programs_lectura_personal ON public.loyalty_programs FOR SELECT TO authenticated
  USING (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager', 'cashier', 'waiter', 'kitchen']) OR public.is_platform_admin());
CREATE POLICY loyalty_customers_lectura ON public.loyalty_customers FOR SELECT TO authenticated
  USING (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager', 'cashier']) OR public.is_platform_admin());
CREATE POLICY loyalty_rewards_lectura ON public.loyalty_rewards FOR SELECT TO authenticated
  USING (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager', 'cashier']) OR public.is_platform_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Funciones activadas por local y registro de auditoría.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "tenant_ff_tenant_read" ON public.tenant_feature_flags;
REVOKE ALL ON public.tenant_feature_flags FROM anon;
CREATE POLICY tenant_ff_lectura_personal ON public.tenant_feature_flags FOR SELECT TO authenticated
  USING (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager', 'cashier', 'waiter', 'kitchen']));

-- La auditoría la escriben solo el servidor y las funciones de la base; la leen dueño, administrador y Tablio.
DROP POLICY IF EXISTS "audit_logs_insert" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_tenant_read" ON public.audit_logs;
REVOKE ALL ON public.audit_logs FROM anon;
REVOKE INSERT, UPDATE ON public.audit_logs FROM authenticated;
CREATE POLICY audit_logs_lectura_local ON public.audit_logs FOR SELECT TO authenticated
  USING (public.tiene_rol(tenant_id, ARRAY['owner', 'admin']));
CREATE POLICY audit_logs_lectura_superadmin ON public.audit_logs FOR SELECT TO authenticated
  USING (public.is_platform_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. El reinicio del demo también borra el registro de mesas que dejan las pruebas.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reiniciar_demo()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  demo constant uuid := '651c363f-0084-50af-9873-be98cfeaaf47';
  pedidos integer;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Solo un superadmin puede reiniciar el demo' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = demo AND slug = 'demo-tablio') THEN
    RAISE EXCEPTION 'No existe el local de demo en esta base';
  END IF;

  SELECT count(*) INTO pedidos FROM public.orders WHERE tenant_id = demo;

  DELETE FROM public.refunds WHERE tenant_id = demo;
  DELETE FROM public.loyalty_rewards WHERE tenant_id = demo;
  DELETE FROM public.loyalty_customers WHERE tenant_id = demo;
  DELETE FROM public.payments WHERE tenant_id = demo;
  DELETE FROM public.payment_settlements WHERE tenant_id = demo;
  DELETE FROM public.order_items WHERE tenant_id = demo;
  DELETE FROM public.orders WHERE tenant_id = demo;
  DELETE FROM public.bill_requests WHERE tenant_id = demo;
  DELETE FROM public.waiter_calls WHERE tenant_id = demo;
  DELETE FROM public.table_events WHERE tenant_id = demo;
  DELETE FROM public.table_sessions WHERE tenant_id = demo;
  DELETE FROM public.staff_invitations WHERE tenant_id = demo;
  DELETE FROM public.support_tickets WHERE tenant_id = demo;
  UPDATE public.tables SET status = 'free', assigned_waiter_id = NULL WHERE tenant_id = demo;
  UPDATE public.menu_items SET status = 'available', total_orders = 0 WHERE tenant_id = demo;

  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, metadata)
  VALUES (demo, auth.uid(), 'demo_reiniciado', 'tenant', jsonb_build_object('pedidos_borrados', pedidos));

  RETURN jsonb_build_object('pedidos_borrados', pedidos);
END;
$$;
