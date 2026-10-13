-- Fase 1.8 — Plataforma y backoffice de Tablio (superadmin, ventas, finanzas, soporte).
-- Lo que se cierra o se corrige aquí:
--  · cualquiera, sin sesión, leía los pagos de las mesas abiertas (con el correo del cliente);
--  · un vendedor desactivado seguía viendo y editando sus prospectos;
--  · un vendedor podía pasarle sus prospectos a otro, y firmar actividades a nombre de otro;
--  · el jefe de ventas podía cambiar el rol o la cuenta de cualquier miembro (y la regla se
--    consultaba a sí misma: error de "recursión infinita", DIAGNOSTICO N14);
--  · cualquier miembro del local (también un mozo) veía y creaba tickets de soporte;
--  · los gastos de Tablio y la configuración de ventas vivían en el navegador (se perdían);
--  · entrar al panel de un local "en modo soporte" no quedaba registrado (DIAGNOSTICO N3).

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Ayudantes: quién es quien en el equipo de Tablio (solo miembros activos).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mi_miembro_backoffice()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.backoffice_members
   WHERE user_id = auth.uid() AND is_active
   ORDER BY created_at LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.es_rol_backoffice(_roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.backoffice_members
                  WHERE user_id = auth.uid() AND is_active AND role = ANY (_roles))
$$;

REVOKE ALL ON FUNCTION public.mi_miembro_backoffice() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.es_rol_backoffice(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mi_miembro_backoffice() TO authenticated;
GRANT EXECUTE ON FUNCTION public.es_rol_backoffice(text[]) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Pagos: nadie sin sesión los lee.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Public can view payments of active sessions" ON public.payments;
REVOKE ALL ON public.payments FROM anon;
REVOKE ALL ON public.refunds FROM anon;
REVOKE ALL ON public.payment_settlements FROM anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Prospectos (leads) y su historial.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "leads_jefe_manage" ON public.leads;
DROP POLICY IF EXISTS "leads_jefe_read" ON public.leads;
DROP POLICY IF EXISTS "leads_seller_insert" ON public.leads;
DROP POLICY IF EXISTS "leads_seller_read_own" ON public.leads;
DROP POLICY IF EXISTS "leads_seller_update_own" ON public.leads;
REVOKE ALL ON public.leads FROM anon;

CREATE POLICY leads_jefe ON public.leads FOR ALL TO authenticated
  USING (public.es_rol_backoffice(ARRAY['jefe_ventas']))
  WITH CHECK (public.es_rol_backoffice(ARRAY['jefe_ventas']));
-- Finanzas y marketing leen el embudo (para costos y adquisición), sin editarlo.
CREATE POLICY leads_lectura_finanzas ON public.leads FOR SELECT TO authenticated
  USING (public.es_rol_backoffice(ARRAY['finanzas', 'marketing']));
-- El vendedor activo ve, crea y edita solo los suyos, y no se los pasa a otro.
CREATE POLICY leads_vendedor ON public.leads FOR ALL TO authenticated
  USING (assigned_seller_id = public.mi_miembro_backoffice())
  WITH CHECK (assigned_seller_id = public.mi_miembro_backoffice());

DROP POLICY IF EXISTS "lead_activities_jefe_insert" ON public.lead_activities;
DROP POLICY IF EXISTS "lead_activities_jefe_read" ON public.lead_activities;
DROP POLICY IF EXISTS "lead_activities_seller_insert" ON public.lead_activities;
DROP POLICY IF EXISTS "lead_activities_seller_read" ON public.lead_activities;
REVOKE ALL ON public.lead_activities FROM anon;
REVOKE UPDATE ON public.lead_activities FROM authenticated; -- el historial no se reescribe

CREATE POLICY lead_activities_jefe ON public.lead_activities FOR SELECT TO authenticated
  USING (public.es_rol_backoffice(ARRAY['jefe_ventas']));
CREATE POLICY lead_activities_jefe_alta ON public.lead_activities FOR INSERT TO authenticated
  WITH CHECK (public.es_rol_backoffice(ARRAY['jefe_ventas']));
CREATE POLICY lead_activities_vendedor ON public.lead_activities FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.leads l
                  WHERE l.id = lead_activities.lead_id AND l.assigned_seller_id = public.mi_miembro_backoffice()));
CREATE POLICY lead_activities_vendedor_alta ON public.lead_activities FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.leads l
                       WHERE l.id = lead_activities.lead_id AND l.assigned_seller_id = public.mi_miembro_backoffice()));

-- Quién registró la actividad lo pone la base (el miembro del equipo que la crea), no el navegador.
CREATE OR REPLACE FUNCTION public.firmar_actividad_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.user_id := coalesce(public.mi_miembro_backoffice(),
                          CASE WHEN public.is_platform_admin() THEN NEW.user_id END);
  NEW.created_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.firmar_actividad_lead() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS firmar_actividad_lead ON public.lead_activities;
CREATE TRIGGER firmar_actividad_lead BEFORE INSERT ON public.lead_activities
  FOR EACH ROW EXECUTE FUNCTION public.firmar_actividad_lead();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Metas de vendedores.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "seller_goals_jefe_manage" ON public.seller_goals;
DROP POLICY IF EXISTS "seller_goals_own_read" ON public.seller_goals;
REVOKE ALL ON public.seller_goals FROM anon;
CREATE POLICY seller_goals_jefe ON public.seller_goals FOR ALL TO authenticated
  USING (public.es_rol_backoffice(ARRAY['jefe_ventas']))
  WITH CHECK (public.es_rol_backoffice(ARRAY['jefe_ventas']));
CREATE POLICY seller_goals_propias ON public.seller_goals FOR SELECT TO authenticated
  USING (seller_id = public.mi_miembro_backoffice());
CREATE POLICY seller_goals_lectura_finanzas ON public.seller_goals FOR SELECT TO authenticated
  USING (public.es_rol_backoffice(ARRAY['finanzas']));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Equipo de Tablio e invitaciones.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "backoffice_members_jefe_read" ON public.backoffice_members;
DROP POLICY IF EXISTS "backoffice_members_jefe_update" ON public.backoffice_members;
REVOKE ALL ON public.backoffice_members FROM anon;

-- El jefe de ventas ve al equipo comercial y edita a sus vendedores; finanzas ve al equipo (comisiones).
CREATE POLICY backoffice_members_lectura_jefes ON public.backoffice_members FOR SELECT TO authenticated
  USING (public.es_rol_backoffice(ARRAY['jefe_ventas', 'finanzas']));
CREATE POLICY backoffice_members_jefe_vendedores ON public.backoffice_members FOR UPDATE TO authenticated
  USING (role = 'vendedor' AND public.es_rol_backoffice(ARRAY['jefe_ventas']))
  WITH CHECK (role = 'vendedor' AND public.es_rol_backoffice(ARRAY['jefe_ventas']));
-- Cada uno edita su propio perfil (nombre, teléfono, foto).
CREATE POLICY backoffice_members_perfil_propio ON public.backoffice_members FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND is_active)
  WITH CHECK (user_id = auth.uid());

-- Rol, cuenta, correo y activación: solo el superadmin (el jefe sí activa o desactiva vendedores).
CREATE OR REPLACE FUNCTION public.proteger_miembro_backoffice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_platform_admin() OR auth.uid() IS NULL THEN
    RETURN NEW; -- superadmin o el servidor (service_role)
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'Solo Tablio puede cambiar el rol, la cuenta o el correo de un miembro' USING ERRCODE = '42501';
  END IF;
  IF NEW.is_active IS DISTINCT FROM OLD.is_active
     AND NOT (OLD.role = 'vendedor' AND public.es_rol_backoffice(ARRAY['jefe_ventas'])) THEN
    RAISE EXCEPTION 'No tienes permiso para este cambio' USING ERRCODE = '42501';
  END IF;
  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
    VALUES (auth.uid(), CASE WHEN NEW.is_active THEN 'miembro_activado' ELSE 'miembro_desactivado' END,
            'backoffice_member', NEW.id, jsonb_build_object('nombre', NEW.name, 'rol', NEW.role));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proteger_miembro_backoffice() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS proteger_miembro_backoffice ON public.backoffice_members;
CREATE TRIGGER proteger_miembro_backoffice BEFORE UPDATE ON public.backoffice_members
  FOR EACH ROW EXECUTE FUNCTION public.proteger_miembro_backoffice();

DROP POLICY IF EXISTS "backoffice_invitations_jefe_manage" ON public.backoffice_invitations;
REVOKE ALL ON public.backoffice_invitations FROM anon;
-- El jefe de ventas invita solo vendedores; los demás roles los invita el superadmin.
CREATE POLICY backoffice_invitations_jefe ON public.backoffice_invitations FOR ALL TO authenticated
  USING (public.es_rol_backoffice(ARRAY['jefe_ventas']) AND role = 'vendedor')
  WITH CHECK (public.es_rol_backoffice(ARRAY['jefe_ventas']) AND role = 'vendedor');

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Soporte: los tickets los ven y crean dueño, administrador y encargado del local.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "support_tickets_tenant_insert" ON public.support_tickets;
DROP POLICY IF EXISTS "support_tickets_tenant_read" ON public.support_tickets;
DROP POLICY IF EXISTS "support_tickets_superadmin_all" ON public.support_tickets;
REVOKE ALL ON public.support_tickets FROM anon;

CREATE POLICY support_tickets_superadmin ON public.support_tickets FOR ALL TO authenticated
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());
CREATE POLICY support_tickets_lectura_local ON public.support_tickets FOR SELECT TO authenticated
  USING (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager']));
CREATE POLICY support_tickets_alta_local ON public.support_tickets FOR INSERT TO authenticated
  WITH CHECK (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager']) AND user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Planes y funciones globales: lectura pública (son la oferta de Tablio); los cambia el superadmin.
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE INSERT, UPDATE, DELETE ON public.plans FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.feature_flags FROM anon;
DROP POLICY IF EXISTS plans_superadmin ON public.plans;
CREATE POLICY plans_superadmin ON public.plans FOR ALL TO authenticated
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Lo que vivía en el navegador pasa a la base.
-- ─────────────────────────────────────────────────────────────────────────────
-- Configuración de la plataforma (zonas de venta, comisiones, alertas).
CREATE TABLE IF NOT EXISTS public.configuracion_tablio (
  clave text PRIMARY KEY CHECK (clave ~ '^[a-z_]{2,40}$'),
  valor jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
ALTER TABLE public.configuracion_tablio ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.configuracion_tablio FROM anon;
CREATE POLICY configuracion_tablio_lectura ON public.configuracion_tablio FOR SELECT TO authenticated
  USING (public.is_platform_admin() OR public.es_backoffice());
CREATE POLICY configuracion_tablio_gestion ON public.configuracion_tablio FOR ALL TO authenticated
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

CREATE OR REPLACE FUNCTION public.firmar_configuracion_tablio()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.firmar_configuracion_tablio() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS firmar_configuracion_tablio ON public.configuracion_tablio;
CREATE TRIGGER firmar_configuracion_tablio BEFORE INSERT OR UPDATE ON public.configuracion_tablio
  FOR EACH ROW EXECUTE FUNCTION public.firmar_configuracion_tablio();

-- Gastos de Tablio (para costos y margen). Montos en pesos, enteros.
CREATE TABLE IF NOT EXISTS public.gastos_tablio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria text NOT NULL CHECK (char_length(categoria) BETWEEN 1 AND 40),
  descripcion text NOT NULL CHECK (char_length(descripcion) BETWEEN 1 AND 200),
  monto integer NOT NULL CHECK (monto > 0),
  fecha timestamptz NOT NULL DEFAULT now(),
  creado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.gastos_tablio ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gastos_tablio FROM anon;
REVOKE UPDATE ON public.gastos_tablio FROM authenticated;
CREATE POLICY gastos_tablio_finanzas ON public.gastos_tablio FOR ALL TO authenticated
  USING (public.is_platform_admin() OR public.es_rol_backoffice(ARRAY['finanzas']))
  WITH CHECK (public.is_platform_admin() OR public.es_rol_backoffice(ARRAY['finanzas']));

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Entrar al panel de un local o "ver como" otro miembro queda registrado (regla 7).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.registrar_acceso_soporte(_tipo text, _id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _tipo = 'local' THEN
    IF NOT public.is_platform_admin() THEN
      RAISE EXCEPTION 'No tienes permiso para este cambio' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
    VALUES (_id, auth.uid(), 'soporte_ingreso_local', 'tenant', _id, '{}'::jsonb);
  ELSIF _tipo = 'miembro' THEN
    IF NOT (public.is_platform_admin()
            OR (public.es_rol_backoffice(ARRAY['jefe_ventas'])
                AND EXISTS (SELECT 1 FROM public.backoffice_members WHERE id = _id AND role = 'vendedor'))) THEN
      RAISE EXCEPTION 'No tienes permiso para este cambio' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
    VALUES (auth.uid(), 'soporte_ver_como_miembro', 'backoffice_member', _id, '{}'::jsonb);
  ELSE
    RAISE EXCEPTION 'Tipo no válido' USING ERRCODE = '22023';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.registrar_acceso_soporte(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_acceso_soporte(text, uuid) TO authenticated;

-- El superadmin ve la auditoría de todo; el jefe de ventas, la de su equipo comercial.
DROP POLICY IF EXISTS audit_logs_lectura_jefe ON public.audit_logs;
CREATE POLICY audit_logs_lectura_jefe ON public.audit_logs FOR SELECT TO authenticated
  USING (tenant_id IS NULL AND entity_type = 'backoffice_member' AND public.es_rol_backoffice(ARRAY['jefe_ventas']));
