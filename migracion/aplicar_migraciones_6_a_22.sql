-- Migraciones 6 a 22 de Tablio, copia fiel de supabase/migrations/ (en orden).
-- Se aplica en el proyecto iznwvklzmyhzalabgfxl. Las 1 a 5 ya están aplicadas.
-- Todo o nada: si algo falla, no queda nada a medias.
-- Incluye a propósito las reglas inseguras de Lovable (migrar tal cual). Se cierran en la fase 3.
BEGIN;

-- ===== Migración 6 de 22: 20260308182620_51128b51-b4d9-43b7-9a78-f2ec9eb80bc4.sql =====
-- Fix tenants: allow platform admins to manage tenants
DROP POLICY IF EXISTS "superadmin_tenants_all" ON public.tenants;
CREATE POLICY "superadmin_tenants_all" ON public.tenants
  FOR ALL TO authenticated
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

-- Fix tenant_members: remove recursive policy and use security definer function
DROP POLICY IF EXISTS "tenant_members_tenant_read" ON public.tenant_members;

-- Create a security definer function to check tenant membership
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
  )
$$;

-- Recreate tenant_members_tenant_read without recursion
CREATE POLICY "tenant_members_tenant_read" ON public.tenant_members
  FOR SELECT TO authenticated
  USING (is_tenant_member(tenant_id));

-- Fix feature_flags superadmin policy
DROP POLICY IF EXISTS "feature_flags_superadmin_manage" ON public.feature_flags;
CREATE POLICY "feature_flags_superadmin_manage" ON public.feature_flags
  FOR ALL TO authenticated
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

-- Fix tenant_feature_flags superadmin policy
DROP POLICY IF EXISTS "tenant_ff_superadmin_manage" ON public.tenant_feature_flags;
CREATE POLICY "tenant_ff_superadmin_manage" ON public.tenant_feature_flags
  FOR ALL TO authenticated
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

-- Also fix superadmin_tenants_all for tenant_members
DROP POLICY IF EXISTS "tenant_members_superadmin_all" ON public.tenant_members;
CREATE POLICY "tenant_members_superadmin_all" ON public.tenant_members
  FOR ALL TO authenticated
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

-- ===== Migración 7 de 22: 20260308182843_2d2bc575-91ec-4cb3-8d45-4fd8298e150f.sql =====
-- Allow platform admins to delete tenants and cascade related data
-- Add DELETE policies for tables that reference tenant_id

CREATE POLICY "superadmin_delete_restaurants" ON public.restaurants
  FOR DELETE TO authenticated
  USING (is_platform_admin());

CREATE POLICY "superadmin_delete_branches" ON public.branches
  FOR DELETE TO authenticated
  USING (is_platform_admin());

CREATE POLICY "superadmin_delete_menus" ON public.menus
  FOR DELETE TO authenticated
  USING (is_platform_admin());

CREATE POLICY "superadmin_delete_categories" ON public.categories
  FOR DELETE TO authenticated
  USING (is_platform_admin());

CREATE POLICY "superadmin_delete_menu_items" ON public.menu_items
  FOR DELETE TO authenticated
  USING (is_platform_admin());

CREATE POLICY "superadmin_delete_tables" ON public.tables
  FOR DELETE TO authenticated
  USING (is_platform_admin());

CREATE POLICY "superadmin_delete_staff_users" ON public.staff_users
  FOR DELETE TO authenticated
  USING (is_platform_admin());

CREATE POLICY "superadmin_delete_tenant_members" ON public.tenant_members
  FOR DELETE TO authenticated
  USING (is_platform_admin());

CREATE POLICY "superadmin_delete_orders" ON public.orders
  FOR DELETE TO authenticated
  USING (is_platform_admin());

CREATE POLICY "superadmin_delete_order_items" ON public.order_items
  FOR DELETE TO authenticated
  USING (is_platform_admin());

CREATE POLICY "superadmin_delete_table_sessions" ON public.table_sessions
  FOR DELETE TO authenticated
  USING (is_platform_admin());

CREATE POLICY "superadmin_delete_bill_requests" ON public.bill_requests
  FOR DELETE TO authenticated
  USING (is_platform_admin());

CREATE POLICY "superadmin_delete_waiter_calls" ON public.waiter_calls
  FOR DELETE TO authenticated
  USING (is_platform_admin());

CREATE POLICY "superadmin_delete_staff_invitations" ON public.staff_invitations
  FOR DELETE TO authenticated
  USING (is_platform_admin());

CREATE POLICY "superadmin_delete_modifier_groups" ON public.modifier_groups
  FOR DELETE TO authenticated
  USING (is_platform_admin());

CREATE POLICY "superadmin_delete_modifiers" ON public.modifiers
  FOR DELETE TO authenticated
  USING (is_platform_admin());

CREATE POLICY "superadmin_delete_audit_logs" ON public.audit_logs
  FOR DELETE TO authenticated
  USING (is_platform_admin());

CREATE POLICY "superadmin_delete_tenant_feature_flags" ON public.tenant_feature_flags
  FOR DELETE TO authenticated
  USING (is_platform_admin());

-- Allow platform admins to delete tenants
CREATE POLICY "superadmin_delete_tenants" ON public.tenants
  FOR DELETE TO authenticated
  USING (is_platform_admin());

-- ===== Migración 8 de 22: 20260308183152_c11e2a33-2214-44c3-bf53-511bf6546eba.sql =====
-- Allow platform admins to INSERT into restaurants, branches, menus, categories, menu_items, tables, staff_users, table_sessions
CREATE POLICY "superadmin_insert_restaurants" ON public.restaurants
  FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin());

CREATE POLICY "superadmin_insert_branches" ON public.branches
  FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin());

CREATE POLICY "superadmin_insert_menus" ON public.menus
  FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin());

CREATE POLICY "superadmin_insert_categories" ON public.categories
  FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin());

CREATE POLICY "superadmin_insert_menu_items" ON public.menu_items
  FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin());

CREATE POLICY "superadmin_insert_tables" ON public.tables
  FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin());

CREATE POLICY "superadmin_insert_staff_users" ON public.staff_users
  FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin());

CREATE POLICY "superadmin_insert_table_sessions" ON public.table_sessions
  FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin());

-- Also allow UPDATE for superadmins on key tables
CREATE POLICY "superadmin_update_restaurants" ON public.restaurants
  FOR UPDATE TO authenticated
  USING (is_platform_admin());

CREATE POLICY "superadmin_update_branches" ON public.branches
  FOR UPDATE TO authenticated
  USING (is_platform_admin());

CREATE POLICY "superadmin_update_menus" ON public.menus
  FOR UPDATE TO authenticated
  USING (is_platform_admin());

-- ===== Migración 9 de 22: 20260309003422_c1bdacf3-960d-4649-a2e5-8f52cc390801.sql =====
-- Create storage bucket for menu item images
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('menu-images', 'menu-images', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

-- RLS policies for menu-images bucket
-- Allow public read access
CREATE POLICY "menu_images_public_read" ON storage.objects FOR SELECT
USING (bucket_id = 'menu-images');

-- Allow authenticated tenant members to upload
CREATE POLICY "menu_images_tenant_upload" ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'menu-images' AND
  (storage.foldername(name))[1] = get_tenant_id()::text
);

-- Allow tenant members to update their own images
CREATE POLICY "menu_images_tenant_update" ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'menu-images' AND
  (storage.foldername(name))[1] = get_tenant_id()::text
);

-- Allow tenant members to delete their own images
CREATE POLICY "menu_images_tenant_delete" ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'menu-images' AND
  (storage.foldername(name))[1] = get_tenant_id()::text
);

-- ===== Migración 10 de 22: 20260309045023_f02fef96-0df9-4226-9917-72199ef0378c.sql =====
CREATE OR REPLACE FUNCTION public.get_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT tenant_id FROM public.tenant_members
  WHERE user_id = auth.uid()
  AND is_active = true
  LIMIT 1
$$;

-- ===== Migración 11 de 22: 20260309050435_2192bbd1-e0ae-41c9-b3dd-c16570518cb0.sql =====
-- Clean up all test orders and related data
DELETE FROM order_items;
DELETE FROM orders;
DELETE FROM table_sessions;

-- Reset tables to free status
UPDATE tables SET status = 'free', assigned_waiter_id = NULL;

-- Reset menu item counters
UPDATE menu_items SET total_orders = 0;

-- ===== Migración 12 de 22: 20260313143718_29c5866c-5035-4347-99fc-42958cc6fc2e.sql =====
CREATE POLICY "tables_public_update_status"
ON public.tables
FOR UPDATE
TO public
USING (true)
WITH CHECK (true);

-- ===== Migración 13 de 22: 20260318050805_3bf66a0b-5d89-4e6a-b125-ed4cf65473f3.sql =====
-- Backoffice members (vendedores, jefes, etc.)
CREATE TABLE public.backoffice_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  name text NOT NULL,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'vendedor',
  zone text,
  phone text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  last_access_at timestamptz,
  avatar_url text
);

ALTER TABLE public.backoffice_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "backoffice_members_superadmin_all" ON public.backoffice_members
  FOR ALL TO authenticated
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

CREATE POLICY "backoffice_members_own_read" ON public.backoffice_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Leads table
CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_name text NOT NULL,
  owner_name text,
  phone text,
  email text,
  address text,
  zone text,
  stage text NOT NULL DEFAULT 'contactado',
  source text DEFAULT 'terreno',
  assigned_seller_id uuid REFERENCES public.backoffice_members(id),
  temperature text DEFAULT 'tibio',
  notes text,
  next_action text,
  next_action_date date,
  demo_date timestamptz,
  pilot_start_date date,
  pilot_end_date date,
  monthly_value integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  converted_tenant_id uuid REFERENCES public.tenants(id),
  lost_reason text
);

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leads_superadmin_all" ON public.leads
  FOR ALL TO authenticated
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

CREATE POLICY "leads_seller_read_own" ON public.leads
  FOR SELECT TO authenticated
  USING (assigned_seller_id IN (
    SELECT id FROM public.backoffice_members WHERE user_id = auth.uid()
  ));

-- Lead activities
CREATE TABLE public.lead_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  user_id uuid,
  type text NOT NULL,
  description text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.lead_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lead_activities_superadmin_all" ON public.lead_activities
  FOR ALL TO authenticated
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

CREATE POLICY "lead_activities_seller_read" ON public.lead_activities
  FOR SELECT TO authenticated
  USING (lead_id IN (
    SELECT id FROM public.leads WHERE assigned_seller_id IN (
      SELECT id FROM public.backoffice_members WHERE user_id = auth.uid()
    )
  ));

-- ===== Migración 14 de 22: 20260318051715_b558b558-5055-41b0-8a78-c2f39d081a1d.sql =====
-- Backoffice invitations for sellers
CREATE TABLE public.backoffice_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL DEFAULT encode(extensions.gen_random_bytes(16), 'hex'),
  role text NOT NULL DEFAULT 'vendedor',
  zone text,
  created_by uuid,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz DEFAULT (now() + interval '7 days'),
  used_at timestamptz,
  used_by_member_id uuid REFERENCES public.backoffice_members(id)
);

ALTER TABLE public.backoffice_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "backoffice_invitations_superadmin_all" ON public.backoffice_invitations
  FOR ALL TO authenticated
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

CREATE POLICY "backoffice_invitations_public_read" ON public.backoffice_invitations
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "backoffice_invitations_public_update" ON public.backoffice_invitations
  FOR UPDATE TO anon, authenticated
  USING (true);

-- Seller goals/metas
CREATE TABLE public.seller_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES public.backoffice_members(id) ON DELETE CASCADE,
  period text NOT NULL,
  visits_goal integer DEFAULT 0,
  demos_goal integer DEFAULT 0,
  pilots_goal integer DEFAULT 0,
  closes_goal integer DEFAULT 0,
  commission_per_close integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.seller_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "seller_goals_superadmin_all" ON public.seller_goals
  FOR ALL TO authenticated
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

CREATE POLICY "seller_goals_own_read" ON public.seller_goals
  FOR SELECT TO authenticated
  USING (seller_id IN (
    SELECT id FROM public.backoffice_members WHERE user_id = auth.uid()
  ));

-- Add seller insert+update policies for their own leads
CREATE POLICY "leads_seller_update_own" ON public.leads
  FOR UPDATE TO authenticated
  USING (assigned_seller_id IN (
    SELECT id FROM public.backoffice_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "leads_seller_insert" ON public.leads
  FOR INSERT TO authenticated
  WITH CHECK (assigned_seller_id IN (
    SELECT id FROM public.backoffice_members WHERE user_id = auth.uid()
  ) OR is_platform_admin());

-- Allow sellers to insert activities for their leads
CREATE POLICY "lead_activities_seller_insert" ON public.lead_activities
  FOR INSERT TO authenticated
  WITH CHECK (lead_id IN (
    SELECT id FROM public.leads WHERE assigned_seller_id IN (
      SELECT id FROM public.backoffice_members WHERE user_id = auth.uid()
    )
  ) OR is_platform_admin());

-- ===== Migración 15 de 22: 20260319151617_03aac1f8-c3c1-4fe6-8d09-d39dfb90365a.sql =====
-- Add existing staff_users to tenant_members if not already there
INSERT INTO public.tenant_members (user_id, tenant_id, branch_id, role, is_active)
SELECT su.auth_user_id, su.tenant_id, su.branch_id, su.role, true
FROM public.staff_users su
WHERE su.auth_user_id IS NOT NULL
  AND su.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.user_id = su.auth_user_id
      AND tm.tenant_id = su.tenant_id
  );

-- ===== Migración 16 de 22: 20260319160810_23888e35-967a-4258-813f-fdf88aea6c10.sql =====
-- Allow public UPDATE on orders for status transitions (waiter flow uses sessionStorage, not Supabase Auth)
CREATE POLICY "orders_public_update_status"
ON public.orders
FOR UPDATE
TO public
USING (true)
WITH CHECK (true);

-- Allow public UPDATE on table_sessions (for closing sessions from waiter flow)
CREATE POLICY "table_sessions_public_update"
ON public.table_sessions
FOR UPDATE
TO public
USING (true)
WITH CHECK (true);

-- ===== Migración 17 de 22: 20260320030541_78686505-e819-4330-a77d-9f71efb3eef1.sql =====
-- Fix orders insert policy: only allow if table has an active session
DROP POLICY IF EXISTS "orders_public_insert" ON public.orders;
CREATE POLICY "orders_public_insert" ON public.orders
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.table_sessions ts
      WHERE ts.table_id = orders.table_id
        AND ts.is_active = true
    )
  );

-- Fix order_items insert policy: only allow if the order exists and belongs to an active session
DROP POLICY IF EXISTS "order_items_public_insert" ON public.order_items;
CREATE POLICY "order_items_public_insert" ON public.order_items
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.orders o
      JOIN public.table_sessions ts ON ts.table_id = o.table_id
      WHERE o.id = order_items.order_id
        AND ts.is_active = true
    )
  );

-- Fix bill_requests insert policy: only allow if table has an active session
DROP POLICY IF EXISTS "bill_requests_public_insert" ON public.bill_requests;
CREATE POLICY "bill_requests_public_insert" ON public.bill_requests
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.table_sessions ts
      WHERE ts.table_id = bill_requests.table_id
        AND ts.is_active = true
    )
  );

-- ===== Migración 18 de 22: 20260323023544_da5e5a57-9d25-4b3d-93d0-3bb4af0c0daa.sql =====
ALTER TABLE public.table_sessions ADD COLUMN rating smallint NULL;

-- ===== Migración 19 de 22: 20260324162444_d04f11c6-430d-47b8-8f2e-d88ba961023d.sql =====
CREATE TABLE public.support_tickets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  user_id UUID,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "support_tickets_tenant_insert" ON public.support_tickets
  FOR INSERT WITH CHECK (is_tenant_member(tenant_id));

CREATE POLICY "support_tickets_tenant_read" ON public.support_tickets
  FOR SELECT USING (is_tenant_member(tenant_id));

CREATE POLICY "support_tickets_superadmin_all" ON public.support_tickets
  FOR ALL USING (is_platform_admin()) WITH CHECK (is_platform_admin());

-- ===== Migración 20 de 22: 20260327024211_daea9dcd-d5aa-4f7c-800d-d90884ade3d4.sql =====
-- Allow jefe_ventas to read all backoffice members
CREATE POLICY "backoffice_members_jefe_read" ON public.backoffice_members
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.backoffice_members bm
    WHERE bm.user_id = auth.uid() AND bm.role = 'jefe_ventas' AND bm.is_active = true
  )
);

-- Allow jefe_ventas to update backoffice members (activate/deactivate)
CREATE POLICY "backoffice_members_jefe_update" ON public.backoffice_members
FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.backoffice_members bm
    WHERE bm.user_id = auth.uid() AND bm.role = 'jefe_ventas' AND bm.is_active = true
  )
);

-- Allow jefe_ventas to manage invitations
CREATE POLICY "backoffice_invitations_jefe_manage" ON public.backoffice_invitations
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.backoffice_members bm
    WHERE bm.user_id = auth.uid() AND bm.role = 'jefe_ventas' AND bm.is_active = true
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.backoffice_members bm
    WHERE bm.user_id = auth.uid() AND bm.role = 'jefe_ventas' AND bm.is_active = true
  )
);

-- Allow jefe_ventas to read all leads
CREATE POLICY "leads_jefe_read" ON public.leads
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.backoffice_members bm
    WHERE bm.user_id = auth.uid() AND bm.role = 'jefe_ventas' AND bm.is_active = true
  )
);

-- Allow jefe_ventas to manage leads
CREATE POLICY "leads_jefe_manage" ON public.leads
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.backoffice_members bm
    WHERE bm.user_id = auth.uid() AND bm.role = 'jefe_ventas' AND bm.is_active = true
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.backoffice_members bm
    WHERE bm.user_id = auth.uid() AND bm.role = 'jefe_ventas' AND bm.is_active = true
  )
);

-- Allow jefe_ventas to read lead activities
CREATE POLICY "lead_activities_jefe_read" ON public.lead_activities
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.backoffice_members bm
    WHERE bm.user_id = auth.uid() AND bm.role = 'jefe_ventas' AND bm.is_active = true
  )
);

-- Allow jefe_ventas to insert lead activities
CREATE POLICY "lead_activities_jefe_insert" ON public.lead_activities
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.backoffice_members bm
    WHERE bm.user_id = auth.uid() AND bm.role = 'jefe_ventas' AND bm.is_active = true
  )
);

-- ===== Migración 21 de 22: 20260328030145_25b52364-48fc-48a3-8b62-8d55b13ea4cb.sql =====
-- Fix RLS recursion on backoffice_members: replace self-referencing policy with security definer function

-- Create helper function to check backoffice role without recursion
CREATE OR REPLACE FUNCTION public.has_backoffice_role(_user_id uuid, _role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.backoffice_members
    WHERE user_id = _user_id
      AND role = _role
      AND is_active = true
  )
$$;

-- Drop the recursive policy
DROP POLICY IF EXISTS "backoffice_members_jefe_read_v2" ON public.backoffice_members;

-- Recreate without recursion using security definer function
CREATE POLICY "backoffice_members_jefe_read"
ON public.backoffice_members
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR public.has_backoffice_role(auth.uid(), 'jefe_ventas')
);

-- Also ensure jefe_ventas can manage seller_goals
DROP POLICY IF EXISTS "seller_goals_jefe_manage" ON public.seller_goals;
CREATE POLICY "seller_goals_jefe_manage"
ON public.seller_goals
FOR ALL
TO authenticated
USING (public.has_backoffice_role(auth.uid(), 'jefe_ventas'))
WITH CHECK (public.has_backoffice_role(auth.uid(), 'jefe_ventas'));

-- ===== Migración 22 de 22: 20260806075142_b882a4db-aca0-4f7d-9a0b-2a46757d8330.sql =====
-- ============ Columns on existing tables ============
ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS payment_mode text NOT NULL DEFAULT 'open_tab';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'unpaid';
ALTER TABLE public.table_sessions ADD COLUMN IF NOT EXISTS paid_amount integer NOT NULL DEFAULT 0;

-- ============ payments ============
CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  session_id uuid REFERENCES public.table_sessions(id) ON DELETE SET NULL,
  table_id uuid REFERENCES public.tables(id) ON DELETE SET NULL,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  amount integer NOT NULL,
  tip_amount integer NOT NULL DEFAULT 0,
  method text NOT NULL DEFAULT 'card',
  wallet text,
  status text NOT NULL DEFAULT 'pending',
  provider text NOT NULL DEFAULT 'simulated',
  external_reference text,
  provider_payload jsonb,
  customer_email text,
  refunded_amount integer NOT NULL DEFAULT 0,
  settlement_id uuid,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payments_idempotency_key_uidx ON public.payments (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX payments_session_idx ON public.payments (session_id);
CREATE INDEX payments_branch_created_idx ON public.payments (branch_id, created_at DESC);

GRANT SELECT ON public.payments TO anon;
GRANT SELECT ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view payments"
ON public.payments FOR SELECT TO authenticated
USING (public.is_tenant_member(tenant_id) OR public.is_platform_admin());

CREATE POLICY "Public can view payments of active sessions"
ON public.payments FOR SELECT TO anon
USING (EXISTS (
  SELECT 1 FROM public.table_sessions s
  WHERE s.id = payments.session_id AND s.is_active = true
));

-- ============ refunds ============
CREATE TABLE public.refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  amount integer NOT NULL,
  reason text NOT NULL,
  authorized_by uuid,
  authorized_by_name text,
  status text NOT NULL DEFAULT 'completed',
  external_reference text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refunds_payment_idx ON public.refunds (payment_id);

GRANT SELECT ON public.refunds TO authenticated;
GRANT ALL ON public.refunds TO service_role;
ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view refunds"
ON public.refunds FOR SELECT TO authenticated
USING (public.is_tenant_member(tenant_id) OR public.is_platform_admin());

-- ============ payment_settlements ============
CREATE TABLE public.payment_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  settlement_date date NOT NULL,
  provider text NOT NULL DEFAULT 'simulated',
  expected_amount integer NOT NULL DEFAULT 0,
  settled_amount integer NOT NULL DEFAULT 0,
  difference integer NOT NULL DEFAULT 0,
  payments_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open',
  notes text,
  closed_by uuid,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payment_settlements_branch_date_uidx ON public.payment_settlements (branch_id, settlement_date);

GRANT SELECT ON public.payment_settlements TO authenticated;
GRANT ALL ON public.payment_settlements TO service_role;
ALTER TABLE public.payment_settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view settlements"
ON public.payment_settlements FOR SELECT TO authenticated
USING (public.is_tenant_member(tenant_id) OR public.is_platform_admin());

-- ============ loyalty_programs ============
CREATE TABLE public.loyalty_programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT false,
  type text NOT NULL DEFAULT 'stamps',
  goal_visits integer NOT NULL DEFAULT 5,
  points_per_thousand integer NOT NULL DEFAULT 1,
  points_goal integer NOT NULL DEFAULT 100,
  reward_description text NOT NULL DEFAULT 'Bebida gratis',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX loyalty_programs_tenant_branch_uidx ON public.loyalty_programs (tenant_id, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid));

GRANT SELECT ON public.loyalty_programs TO anon;
GRANT SELECT, INSERT, UPDATE ON public.loyalty_programs TO authenticated;
GRANT ALL ON public.loyalty_programs TO service_role;
ALTER TABLE public.loyalty_programs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view active loyalty programs"
ON public.loyalty_programs FOR SELECT TO anon
USING (is_active = true);

CREATE POLICY "Tenant members can view loyalty programs"
ON public.loyalty_programs FOR SELECT TO authenticated
USING (public.is_tenant_member(tenant_id) OR public.is_platform_admin());

CREATE POLICY "Tenant members can create loyalty programs"
ON public.loyalty_programs FOR INSERT TO authenticated
WITH CHECK (public.is_tenant_member(tenant_id));

CREATE POLICY "Tenant members can update loyalty programs"
ON public.loyalty_programs FOR UPDATE TO authenticated
USING (public.is_tenant_member(tenant_id))
WITH CHECK (public.is_tenant_member(tenant_id));

-- ============ loyalty_customers ============
CREATE TABLE public.loyalty_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email text NOT NULL,
  visits integer NOT NULL DEFAULT 0,
  points integer NOT NULL DEFAULT 0,
  total_spent integer NOT NULL DEFAULT 0,
  last_visit_at timestamptz,
  consent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX loyalty_customers_tenant_email_uidx ON public.loyalty_customers (tenant_id, lower(email));

GRANT SELECT ON public.loyalty_customers TO authenticated;
GRANT ALL ON public.loyalty_customers TO service_role;
ALTER TABLE public.loyalty_customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view loyalty customers"
ON public.loyalty_customers FOR SELECT TO authenticated
USING (public.is_tenant_member(tenant_id) OR public.is_platform_admin());

-- ============ loyalty_rewards ============
CREATE TABLE public.loyalty_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.loyalty_customers(id) ON DELETE CASCADE,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'earned',
  earned_at timestamptz NOT NULL DEFAULT now(),
  redeemed_at timestamptz,
  payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX loyalty_rewards_customer_idx ON public.loyalty_rewards (customer_id);

GRANT SELECT ON public.loyalty_rewards TO authenticated;
GRANT ALL ON public.loyalty_rewards TO service_role;
ALTER TABLE public.loyalty_rewards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view loyalty rewards"
ON public.loyalty_rewards FOR SELECT TO authenticated
USING (public.is_tenant_member(tenant_id) OR public.is_platform_admin());

-- ============ updated_at triggers ============
CREATE TRIGGER update_payments_updated_at BEFORE UPDATE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_payment_settlements_updated_at BEFORE UPDATE ON public.payment_settlements
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_loyalty_programs_updated_at BEFORE UPDATE ON public.loyalty_programs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_loyalty_customers_updated_at BEFORE UPDATE ON public.loyalty_customers
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ===== Historial de migraciones: que coincida con los nombres del repositorio =====
DELETE FROM supabase_migrations.schema_migrations;
INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES
  ('20260307214709', '13612dc1-627e-4ee4-b7db-40f5bbaaea6a'),
  ('20260308151352', '6ee566b8-25f5-4294-b3aa-5e99cc42310f'),
  ('20260308171228', 'a744b79c-9fcc-4e74-81fd-45e3009d60c5'),
  ('20260308175039', '80e8047c-ee67-43ec-8b02-948a67eeb7f3'),
  ('20260308175521', '60e67ffc-f3d8-41ac-82c5-bea53c3908d1'),
  ('20260308182620', '51128b51-b4d9-43b7-9a78-f2ec9eb80bc4'),
  ('20260308182843', '2d2bc575-91ec-4cb3-8d45-4fd8298e150f'),
  ('20260308183152', 'c11e2a33-2214-44c3-bf53-511bf6546eba'),
  ('20260309003422', 'c1bdacf3-960d-4649-a2e5-8f52cc390801'),
  ('20260309045023', 'f02fef96-0df9-4226-9917-72199ef0378c'),
  ('20260309050435', '2192bbd1-e0ae-41c9-b3dd-c16570518cb0'),
  ('20260313143718', '29c5866c-5035-4347-99fc-42958cc6fc2e'),
  ('20260318050805', '3bf66a0b-5d89-4e6a-b125-ed4cf65473f3'),
  ('20260318051715', 'b558b558-5055-41b0-8a78-c2f39d081a1d'),
  ('20260319151617', '03aac1f8-c3c1-4fe6-8d09-d39dfb90365a'),
  ('20260319160810', '23888e35-967a-4258-813f-fdf88aea6c10'),
  ('20260320030541', '78686505-e819-4330-a77d-9f71efb3eef1'),
  ('20260323023544', 'da5e5a57-9d25-4b3d-93d0-3bb4af0c0daa'),
  ('20260324162444', 'd04f11c6-430d-47b8-8f2e-d88ba961023d'),
  ('20260327024211', 'daea9dcd-d5aa-4f7c-800d-d90884ade3d4'),
  ('20260328030145', '25b52364-48fc-48a3-8b62-8d55b13ea4cb'),
  ('20260806075142', 'b882a4db-aca0-4f7d-9a0b-2a46757d8330');

COMMIT;
