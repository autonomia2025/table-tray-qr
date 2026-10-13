-- Fase 1.10 — Compuerta de seguridad: lo último que quedaba abierto y una auditoría automática
-- que corre en cada cambio (tests/seguridad/f1-10-compuerta.test.ts). Si alguien vuelve a abrir
-- una tabla, deja una regla "para todos" o expone una función, la integración continua falla.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Cuándo se pagó cada pedido (el mozo lo necesita para su cronómetro sin ver los pagos,
--    que traen datos del cliente). Lo escribe solo el servidor.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS paid_at timestamptz;
UPDATE public.orders o
   SET paid_at = coalesce((SELECT min(p.created_at) FROM public.payments p
                            WHERE p.order_id = o.id AND p.status IN ('approved', 'refunded', 'partially_refunded')),
                          o.confirmed_at, o.created_at)
 WHERE o.payment_status IN ('paid', 'refunded') AND o.paid_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Pagos, reembolsos y cierres: solo quienes manejan la plata del local (y Tablio).
--    Antes cualquier miembro (también cocina y mozos) veía los pagos con el correo del cliente.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Tenant members can view payments" ON public.payments;
DROP POLICY IF EXISTS "Tenant members can view refunds" ON public.refunds;
DROP POLICY IF EXISTS "Tenant members can view settlements" ON public.payment_settlements;

CREATE POLICY payments_lectura_caja ON public.payments FOR SELECT TO authenticated
  USING (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager', 'cashier']) OR public.is_platform_admin());
CREATE POLICY refunds_lectura_caja ON public.refunds FOR SELECT TO authenticated
  USING (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager', 'cashier']) OR public.is_platform_admin());
CREATE POLICY payment_settlements_lectura_caja ON public.payment_settlements FOR SELECT TO authenticated
  USING (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager', 'cashier']) OR public.is_platform_admin());

-- Regla 2 del brief: el navegador nunca escribe pagos, reembolsos ni cierres.
REVOKE INSERT, UPDATE, DELETE ON public.payments, public.refunds, public.payment_settlements FROM anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Permisos sobrantes (segunda capa: las reglas ya lo impedían).
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE INSERT, UPDATE, DELETE ON public.platform_admins FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.tenant_members FROM anon;

-- Funciones antiguas que ninguna regla usa ya: nadie las llama desde afuera.
REVOKE ALL ON FUNCTION public.get_tenant_id() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_tenant_member(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.has_staff_role(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.has_backoffice_role(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
-- is_platform_admin la usan reglas del personal: queda para usuarios con sesión, no sin sesión.
REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Auditoría automática. Devuelve los hallazgos; vacío = todo en orden.
--    Las excepciones a propósito están anotadas aquí mismo, con su motivo.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auditoria_seguridad()
RETURNS TABLE (tipo text, objeto text, detalle text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Lectura pública a propósito: la carta y la marca del local se ven sin iniciar sesión,
  -- y los planes y funciones globales son la oferta pública de Tablio.
  publicas constant text[] := ARRAY['plans', 'restaurants', 'branches', 'menus', 'categories', 'menu_items',
                                    'modifier_groups', 'modifiers', 'feature_flags', 'tenants'];
  -- Funciones que se llaman sin sesión a propósito: ver la mesa del QR y ver una invitación de mozo.
  -- rango_estado es una tabla de equivalencias sin datos.
  funciones_publicas constant text[] := ARRAY['ver_mesa', 'ver_invitacion_mozo', 'rango_estado'];
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'No tienes permiso para este cambio' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT 'tabla_sin_rls', c.relname::text, 'La tabla no tiene reglas de acceso activadas'
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;

  RETURN QUERY
  SELECT 'regla_para_todos', p.tablename || '.' || p.policyname, 'Regla con USING/CHECK (true) en ' || p.cmd
    FROM pg_policies p
   WHERE p.schemaname = 'public'
     AND (p.qual = 'true' OR p.with_check = 'true')
     AND NOT (p.cmd = 'SELECT' AND p.tablename = ANY (publicas));

  RETURN QUERY
  SELECT 'regla_escritura_publica', p.tablename || '.' || p.policyname, 'Regla de escritura para el rol public'
    FROM pg_policies p
   WHERE p.schemaname = 'public' AND p.roles = '{public}' AND p.cmd <> 'SELECT';

  RETURN QUERY
  SELECT 'regla_antigua', p.tablename || '.' || p.policyname, 'Usa una función antigua (get_tenant_id, is_tenant_member, has_staff_role)'
    FROM pg_policies p
   WHERE p.schemaname = 'public'
     AND (coalesce(p.qual, '') || coalesce(p.with_check, '')) ~ 'get_tenant_id|is_tenant_member|has_staff_role|has_backoffice_role';

  RETURN QUERY
  SELECT 'escritura_sin_sesion', g.table_name::text, 'El rol anónimo tiene ' || string_agg(g.privilege_type, ', ')
    FROM information_schema.role_table_grants g
   WHERE g.grantee = 'anon' AND g.table_schema = 'public' AND g.privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
   GROUP BY g.table_name;

  RETURN QUERY
  SELECT 'definer_sin_search_path', p.proname::text, 'Función SECURITY DEFINER sin search_path fijo'
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prosecdef
     AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) cfg WHERE cfg LIKE 'search_path=%');

  RETURN QUERY
  SELECT 'funcion_sin_sesion', p.proname::text, 'Se puede llamar sin iniciar sesión'
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND has_function_privilege('anon', p.oid, 'EXECUTE')
     AND NOT (p.proname = ANY (funciones_publicas));

  RETURN QUERY
  SELECT 'dinero_escribible', g.table_name::text, 'El navegador puede escribir ' || string_agg(g.privilege_type, ', ')
    FROM information_schema.role_table_grants g
   WHERE g.grantee IN ('anon', 'authenticated') AND g.table_schema = 'public'
     AND g.table_name IN ('payments', 'refunds', 'payment_settlements', 'orders', 'order_items', 'order_events', 'table_events', 'audit_logs')
     AND g.privilege_type IN ('INSERT', 'UPDATE')
   GROUP BY g.table_name;
END;
$$;
REVOKE ALL ON FUNCTION public.auditoria_seguridad() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auditoria_seguridad() TO authenticated;
