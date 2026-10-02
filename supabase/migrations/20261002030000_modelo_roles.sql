-- Fase 1.2 — Un solo modelo de roles y una sola forma de saber quién es el usuario.
--
-- tenant_members es la fuente de verdad del rol de cada persona en cada local.
-- staff_users queda como perfil del personal (nombre visible, mesas asignadas).
--
-- Roles del local:
--   owner    dueño              admin   administrador
--   manager  encargado          cashier cajero
--   waiter   mozo               kitchen cocina / barra

-- 1. Normalizar los roles que existen hoy.
--    'staff' lo creaba create-tenant-user sin rol real: se toma el rol del perfil de personal.
UPDATE public.tenant_members tm
   SET role = coalesce(
     (SELECT CASE WHEN su.role = 'host' THEN 'waiter' ELSE su.role END
        FROM public.staff_users su
       WHERE su.auth_user_id = tm.user_id AND su.tenant_id = tm.tenant_id
       ORDER BY su.created_at
       LIMIT 1),
     'waiter')
 WHERE tm.role NOT IN ('owner', 'admin', 'manager', 'cashier', 'waiter', 'kitchen');

UPDATE public.staff_users SET role = 'waiter'
 WHERE role NOT IN ('owner', 'admin', 'manager', 'cashier', 'waiter', 'kitchen');

UPDATE public.staff_invitations SET role = 'waiter'
 WHERE role NOT IN ('manager', 'cashier', 'waiter', 'kitchen');

-- 2. Lista cerrada de roles.
ALTER TABLE public.tenant_members
  ADD CONSTRAINT tenant_members_role_check
  CHECK (role IN ('owner', 'admin', 'manager', 'cashier', 'waiter', 'kitchen'));

ALTER TABLE public.staff_users
  ADD CONSTRAINT staff_users_role_check
  CHECK (role IN ('owner', 'admin', 'manager', 'cashier', 'waiter', 'kitchen'));

-- Las invitaciones son para personal, nunca para dueño o administrador.
ALTER TABLE public.staff_invitations
  ADD CONSTRAINT staff_invitations_role_check
  CHECK (role IN ('manager', 'cashier', 'waiter', 'kitchen'));

-- 3. Membresía activa: un miembro desactivado deja de contar (DIAGNOSTICO problema 1, agravante).
CREATE OR REPLACE FUNCTION public.is_tenant_member(_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE user_id = auth.uid()
      AND tenant_id = _tenant_id
      AND is_active = true
  )
$$;

-- 4. get_tenant_id deja de elegir un local al azar (N11): toma la membresía activa más antigua.
CREATE OR REPLACE FUNCTION public.get_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id FROM public.tenant_members
  WHERE user_id = auth.uid()
    AND is_active = true
  ORDER BY created_at, id
  LIMIT 1
$$;

-- 5. ¿La persona conectada tiene alguno de estos roles en este local?
--    Base de las reglas de acceso por rol (fases 1.4 a 1.8).
CREATE OR REPLACE FUNCTION public.tiene_rol(_tenant_id uuid, _roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE user_id = auth.uid()
      AND tenant_id = _tenant_id
      AND is_active = true
      AND role = ANY (_roles)
  )
$$;

REVOKE ALL ON FUNCTION public.tiene_rol(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tiene_rol(uuid, text[]) TO authenticated;

-- 6. Quién soy y a dónde voy: la única fuente que usa la app para resolver el rol.
CREATE OR REPLACE FUNCTION public.mi_perfil()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN auth.uid() IS NULL THEN NULL ELSE jsonb_build_object(
    'user_id', auth.uid(),
    'email', (SELECT email FROM auth.users WHERE id = auth.uid()),
    'es_superadmin', EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid()),
    'backoffice', (
      SELECT jsonb_build_object('id', bm.id, 'rol', bm.role, 'nombre', bm.name)
        FROM public.backoffice_members bm
       WHERE bm.user_id = auth.uid() AND bm.is_active = true
       ORDER BY bm.created_at
       LIMIT 1
    ),
    'locales', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'tenant_id', t.id,
               'slug', t.slug,
               'nombre', t.name,
               'color', t.primary_color,
               'rol', tm.role,
               'branch_id', coalesce(tm.branch_id, (
                 SELECT b.id FROM public.branches b WHERE b.tenant_id = t.id ORDER BY b.created_at, b.id LIMIT 1)),
               'staff_id', su.id,
               'staff_nombre', su.name
             ) ORDER BY tm.created_at, tm.id)
        FROM public.tenant_members tm
        JOIN public.tenants t ON t.id = tm.tenant_id AND t.is_active = true
        LEFT JOIN LATERAL (
          SELECT s.id, s.name FROM public.staff_users s
           WHERE s.auth_user_id = tm.user_id AND s.tenant_id = tm.tenant_id AND s.is_active = true
           ORDER BY s.created_at LIMIT 1
        ) su ON true
       WHERE tm.user_id = auth.uid() AND tm.is_active = true
    ), '[]'::jsonb)
  ) END
$$;

REVOKE ALL ON FUNCTION public.mi_perfil() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mi_perfil() TO authenticated;
