-- Esquema public de Lovable Cloud, generado desde el catálogo de Postgres (equivalente a pg_dump --schema-only). Thu Oct  1 19:28:31 UTC 2026
-- 1. Funciones
CREATE OR REPLACE FUNCTION public.get_tenant_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT tenant_id FROM public.tenant_members
  WHERE user_id = auth.uid()
  AND is_active = true
  LIMIT 1
$function$
;
CREATE OR REPLACE FUNCTION public.has_backoffice_role(_user_id uuid, _role text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.backoffice_members
    WHERE user_id = _user_id
      AND role = _role
      AND is_active = true
  )
$function$
;
CREATE OR REPLACE FUNCTION public.has_staff_role(_user_id uuid, _role text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.staff_users
    WHERE auth_user_id = _user_id
      AND role = _role
      AND is_active = true
  )
$function$
;
CREATE OR REPLACE FUNCTION public.is_platform_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid()
  )
$function$
;
CREATE OR REPLACE FUNCTION public.is_tenant_member(_tenant_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE user_id = auth.uid()
    AND tenant_id = _tenant_id
  )
$function$
;
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;
-- 2. Tablas
CREATE TABLE public.audit_logs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid,
  user_id uuid,
  action text NOT NULL,
  entity_type text,
  entity_id uuid,
  metadata jsonb DEFAULT '{}'::jsonb,
  ip_address text,
  created_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.backoffice_invitations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  token text DEFAULT encode(extensions.gen_random_bytes(16), 'hex'::text) NOT NULL,
  role text DEFAULT 'vendedor'::text NOT NULL,
  zone text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  expires_at timestamp with time zone DEFAULT (now() + '7 days'::interval),
  used_at timestamp with time zone,
  used_by_member_id uuid
);
CREATE TABLE public.backoffice_members (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid,
  name text NOT NULL,
  email text NOT NULL,
  role text DEFAULT 'vendedor'::text NOT NULL,
  zone text,
  phone text,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  last_access_at timestamp with time zone,
  avatar_url text
);
CREATE TABLE public.bill_requests (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  session_id uuid NOT NULL,
  table_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  total_amount integer NOT NULL,
  tip_amount integer DEFAULT 0,
  tip_percentage integer DEFAULT 0,
  status text DEFAULT 'pending'::text,
  requested_at timestamp with time zone DEFAULT now(),
  attended_at timestamp with time zone
);
CREATE TABLE public.branches (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  restaurant_id uuid NOT NULL,
  name text NOT NULL,
  address text,
  city text DEFAULT 'Santiago'::text,
  phone text,
  is_open boolean DEFAULT true,
  opening_hours jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  payment_mode text DEFAULT 'open_tab'::text NOT NULL
);
CREATE TABLE public.categories (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  menu_id uuid NOT NULL,
  name text NOT NULL,
  emoji text DEFAULT '🍽'::text,
  description text,
  sort_order integer DEFAULT 0,
  is_visible boolean DEFAULT true,
  available_from time without time zone,
  available_until time without time zone,
  available_days integer[] DEFAULT '{0,1,2,3,4,5,6}'::integer[],
  created_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.feature_flags (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  key text NOT NULL,
  description text,
  default_enabled boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.lead_activities (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  lead_id uuid NOT NULL,
  user_id uuid,
  type text NOT NULL,
  description text,
  created_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.leads (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  restaurant_name text NOT NULL,
  owner_name text,
  phone text,
  email text,
  address text,
  zone text,
  stage text DEFAULT 'contactado'::text NOT NULL,
  source text DEFAULT 'terreno'::text,
  assigned_seller_id uuid,
  temperature text DEFAULT 'tibio'::text,
  notes text,
  next_action text,
  next_action_date date,
  demo_date timestamp with time zone,
  pilot_start_date date,
  pilot_end_date date,
  monthly_value integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  converted_tenant_id uuid,
  lost_reason text
);
CREATE TABLE public.loyalty_customers (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  email text NOT NULL,
  visits integer DEFAULT 0 NOT NULL,
  points integer DEFAULT 0 NOT NULL,
  total_spent integer DEFAULT 0 NOT NULL,
  last_visit_at timestamp with time zone,
  consent_at timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.loyalty_programs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  branch_id uuid,
  is_active boolean DEFAULT false NOT NULL,
  type text DEFAULT 'stamps'::text NOT NULL,
  goal_visits integer DEFAULT 5 NOT NULL,
  points_per_thousand integer DEFAULT 1 NOT NULL,
  points_goal integer DEFAULT 100 NOT NULL,
  reward_description text DEFAULT 'Bebida gratis'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.loyalty_rewards (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  description text NOT NULL,
  status text DEFAULT 'earned'::text NOT NULL,
  earned_at timestamp with time zone DEFAULT now() NOT NULL,
  redeemed_at timestamp with time zone,
  payment_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.menu_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  category_id uuid NOT NULL,
  name text NOT NULL,
  description_short text,
  description_long text,
  price integer NOT NULL,
  cost_price integer,
  image_url text,
  image_is_real boolean DEFAULT false,
  prep_time_minutes integer,
  status text DEFAULT 'available'::text,
  labels text[] DEFAULT '{}'::text[],
  allergens text[] DEFAULT '{}'::text[],
  sort_order integer DEFAULT 0,
  total_orders integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.menus (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  name text DEFAULT 'Menú Principal'::text NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.modifier_groups (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  menu_item_id uuid NOT NULL,
  name text NOT NULL,
  type text NOT NULL,
  required boolean DEFAULT false,
  min_selections integer DEFAULT 0,
  max_selections integer DEFAULT 1,
  sort_order integer DEFAULT 0
);
CREATE TABLE public.modifiers (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  group_id uuid NOT NULL,
  name text NOT NULL,
  extra_price integer DEFAULT 0,
  is_available boolean DEFAULT true,
  sort_order integer DEFAULT 0
);
CREATE TABLE public.order_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  order_id uuid NOT NULL,
  menu_item_id uuid NOT NULL,
  menu_item_name text NOT NULL,
  unit_price integer NOT NULL,
  quantity integer DEFAULT 1 NOT NULL,
  subtotal integer NOT NULL,
  selected_modifiers jsonb DEFAULT '[]'::jsonb,
  item_notes text,
  created_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.orders (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  session_id uuid NOT NULL,
  table_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  order_number integer NOT NULL,
  status text DEFAULT 'confirmed'::text,
  source text DEFAULT 'customer_qr'::text,
  total_amount integer NOT NULL,
  notes text,
  cancelled_reason text,
  confirmed_at timestamp with time zone DEFAULT now(),
  kitchen_accepted_at timestamp with time zone,
  ready_at timestamp with time zone,
  delivered_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  payment_status text DEFAULT 'unpaid'::text NOT NULL
);
CREATE TABLE public.payment_settlements (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  settlement_date date NOT NULL,
  provider text DEFAULT 'simulated'::text NOT NULL,
  expected_amount integer DEFAULT 0 NOT NULL,
  settled_amount integer DEFAULT 0 NOT NULL,
  difference integer DEFAULT 0 NOT NULL,
  payments_count integer DEFAULT 0 NOT NULL,
  status text DEFAULT 'open'::text NOT NULL,
  notes text,
  closed_by uuid,
  closed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.payments (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  session_id uuid,
  table_id uuid,
  order_id uuid,
  amount integer NOT NULL,
  tip_amount integer DEFAULT 0 NOT NULL,
  method text DEFAULT 'card'::text NOT NULL,
  wallet text,
  status text DEFAULT 'pending'::text NOT NULL,
  provider text DEFAULT 'simulated'::text NOT NULL,
  external_reference text,
  provider_payload jsonb,
  customer_email text,
  refunded_amount integer DEFAULT 0 NOT NULL,
  settlement_id uuid,
  idempotency_key text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.plans (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  display_name text NOT NULL,
  max_tables integer DEFAULT 10 NOT NULL,
  features jsonb DEFAULT '{}'::jsonb NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.platform_admins (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.refunds (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  payment_id uuid NOT NULL,
  amount integer NOT NULL,
  reason text NOT NULL,
  authorized_by uuid,
  authorized_by_name text,
  status text DEFAULT 'completed'::text NOT NULL,
  external_reference text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.restaurants (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.seller_goals (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  seller_id uuid NOT NULL,
  period text NOT NULL,
  visits_goal integer DEFAULT 0,
  demos_goal integer DEFAULT 0,
  pilots_goal integer DEFAULT 0,
  closes_goal integer DEFAULT 0,
  commission_per_close integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.staff_invitations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  token text DEFAULT encode(extensions.gen_random_bytes(16), 'hex'::text) NOT NULL,
  tenant_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  role text DEFAULT 'waiter'::text NOT NULL,
  expires_at timestamp with time zone DEFAULT (now() + '7 days'::interval) NOT NULL,
  used_at timestamp with time zone,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.staff_users (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  branch_id uuid,
  auth_user_id uuid,
  name text NOT NULL,
  role text NOT NULL,
  pin text,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.support_tickets (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  user_id uuid,
  subject text NOT NULL,
  message text NOT NULL,
  priority text DEFAULT 'medium'::text NOT NULL,
  status text DEFAULT 'open'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.table_sessions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  table_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  opened_at timestamp with time zone DEFAULT now(),
  closed_at timestamp with time zone,
  total_amount integer DEFAULT 0,
  tip_amount integer DEFAULT 0,
  is_active boolean DEFAULT true,
  rating smallint,
  paid_amount integer DEFAULT 0 NOT NULL
);
CREATE TABLE public.tables (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  number integer NOT NULL,
  name text,
  zone text DEFAULT 'interior'::text,
  capacity integer DEFAULT 4,
  qr_token text NOT NULL,
  status text DEFAULT 'free'::text,
  position_x double precision DEFAULT 0,
  position_y double precision DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  assigned_waiter_id uuid
);
CREATE TABLE public.tenant_feature_flags (
  tenant_id uuid NOT NULL,
  flag_key text NOT NULL,
  is_enabled boolean DEFAULT false
);
CREATE TABLE public.tenant_members (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  branch_id uuid,
  role text DEFAULT 'owner'::text NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.tenants (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  slug text NOT NULL,
  rut text,
  email text NOT NULL,
  phone text,
  plan_id uuid,
  plan_status text DEFAULT 'trial'::text,
  trial_ends_at timestamp with time zone DEFAULT (now() + '30 days'::interval),
  logo_url text,
  primary_color text DEFAULT '#E8531D'::text,
  secondary_color text DEFAULT '#1A1A2E'::text,
  cover_image_url text,
  welcome_message text,
  timezone text DEFAULT 'America/Santiago'::text,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.waiter_calls (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  table_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  session_id uuid,
  reason text DEFAULT 'help'::text,
  status text DEFAULT 'pending'::text,
  created_at timestamp with time zone DEFAULT now()
);
-- 3. Restricciones (PK, UNIQUE, CHECK, luego FK)
ALTER TABLE public.feature_flags ADD CONSTRAINT feature_flags_key_key UNIQUE (key);
ALTER TABLE public.platform_admins ADD CONSTRAINT platform_admins_user_id_key UNIQUE (user_id);
ALTER TABLE public.staff_invitations ADD CONSTRAINT staff_invitations_token_key UNIQUE (token);
ALTER TABLE public.tables ADD CONSTRAINT tables_qr_token_key UNIQUE (qr_token);
ALTER TABLE public.tenant_members ADD CONSTRAINT tenant_members_user_id_tenant_id_key UNIQUE (user_id, tenant_id);
ALTER TABLE public.tenants ADD CONSTRAINT tenants_slug_key UNIQUE (slug);
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);
ALTER TABLE public.backoffice_invitations ADD CONSTRAINT backoffice_invitations_pkey PRIMARY KEY (id);
ALTER TABLE public.backoffice_members ADD CONSTRAINT backoffice_members_pkey PRIMARY KEY (id);
ALTER TABLE public.bill_requests ADD CONSTRAINT bill_requests_pkey PRIMARY KEY (id);
ALTER TABLE public.branches ADD CONSTRAINT branches_pkey PRIMARY KEY (id);
ALTER TABLE public.categories ADD CONSTRAINT categories_pkey PRIMARY KEY (id);
ALTER TABLE public.feature_flags ADD CONSTRAINT feature_flags_pkey PRIMARY KEY (id);
ALTER TABLE public.lead_activities ADD CONSTRAINT lead_activities_pkey PRIMARY KEY (id);
ALTER TABLE public.leads ADD CONSTRAINT leads_pkey PRIMARY KEY (id);
ALTER TABLE public.loyalty_customers ADD CONSTRAINT loyalty_customers_pkey PRIMARY KEY (id);
ALTER TABLE public.loyalty_programs ADD CONSTRAINT loyalty_programs_pkey PRIMARY KEY (id);
ALTER TABLE public.loyalty_rewards ADD CONSTRAINT loyalty_rewards_pkey PRIMARY KEY (id);
ALTER TABLE public.menu_items ADD CONSTRAINT menu_items_pkey PRIMARY KEY (id);
ALTER TABLE public.menus ADD CONSTRAINT menus_pkey PRIMARY KEY (id);
ALTER TABLE public.modifier_groups ADD CONSTRAINT modifier_groups_pkey PRIMARY KEY (id);
ALTER TABLE public.modifiers ADD CONSTRAINT modifiers_pkey PRIMARY KEY (id);
ALTER TABLE public.order_items ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);
ALTER TABLE public.orders ADD CONSTRAINT orders_pkey PRIMARY KEY (id);
ALTER TABLE public.payment_settlements ADD CONSTRAINT payment_settlements_pkey PRIMARY KEY (id);
ALTER TABLE public.payments ADD CONSTRAINT payments_pkey PRIMARY KEY (id);
ALTER TABLE public.plans ADD CONSTRAINT plans_pkey PRIMARY KEY (id);
ALTER TABLE public.platform_admins ADD CONSTRAINT platform_admins_pkey PRIMARY KEY (id);
ALTER TABLE public.refunds ADD CONSTRAINT refunds_pkey PRIMARY KEY (id);
ALTER TABLE public.restaurants ADD CONSTRAINT restaurants_pkey PRIMARY KEY (id);
ALTER TABLE public.seller_goals ADD CONSTRAINT seller_goals_pkey PRIMARY KEY (id);
ALTER TABLE public.staff_invitations ADD CONSTRAINT staff_invitations_pkey PRIMARY KEY (id);
ALTER TABLE public.staff_users ADD CONSTRAINT staff_users_pkey PRIMARY KEY (id);
ALTER TABLE public.support_tickets ADD CONSTRAINT support_tickets_pkey PRIMARY KEY (id);
ALTER TABLE public.table_sessions ADD CONSTRAINT table_sessions_pkey PRIMARY KEY (id);
ALTER TABLE public.tables ADD CONSTRAINT tables_pkey PRIMARY KEY (id);
ALTER TABLE public.tenant_feature_flags ADD CONSTRAINT tenant_feature_flags_pkey PRIMARY KEY (tenant_id, flag_key);
ALTER TABLE public.tenant_members ADD CONSTRAINT tenant_members_pkey PRIMARY KEY (id);
ALTER TABLE public.tenants ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);
ALTER TABLE public.waiter_calls ADD CONSTRAINT waiter_calls_pkey PRIMARY KEY (id);
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
ALTER TABLE backoffice_invitations ADD CONSTRAINT backoffice_invitations_used_by_member_id_fkey FOREIGN KEY (used_by_member_id) REFERENCES backoffice_members(id);
ALTER TABLE bill_requests ADD CONSTRAINT bill_requests_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES branches(id);
ALTER TABLE bill_requests ADD CONSTRAINT bill_requests_session_id_fkey FOREIGN KEY (session_id) REFERENCES table_sessions(id);
ALTER TABLE bill_requests ADD CONSTRAINT bill_requests_table_id_fkey FOREIGN KEY (table_id) REFERENCES tables(id);
ALTER TABLE bill_requests ADD CONSTRAINT bill_requests_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE branches ADD CONSTRAINT branches_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE;
ALTER TABLE branches ADD CONSTRAINT branches_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE categories ADD CONSTRAINT categories_menu_id_fkey FOREIGN KEY (menu_id) REFERENCES menus(id) ON DELETE CASCADE;
ALTER TABLE categories ADD CONSTRAINT categories_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE lead_activities ADD CONSTRAINT lead_activities_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;
ALTER TABLE leads ADD CONSTRAINT leads_assigned_seller_id_fkey FOREIGN KEY (assigned_seller_id) REFERENCES backoffice_members(id);
ALTER TABLE leads ADD CONSTRAINT leads_converted_tenant_id_fkey FOREIGN KEY (converted_tenant_id) REFERENCES tenants(id);
ALTER TABLE loyalty_customers ADD CONSTRAINT loyalty_customers_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE loyalty_programs ADD CONSTRAINT loyalty_programs_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE;
ALTER TABLE loyalty_programs ADD CONSTRAINT loyalty_programs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE loyalty_rewards ADD CONSTRAINT loyalty_rewards_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES loyalty_customers(id) ON DELETE CASCADE;
ALTER TABLE loyalty_rewards ADD CONSTRAINT loyalty_rewards_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE SET NULL;
ALTER TABLE loyalty_rewards ADD CONSTRAINT loyalty_rewards_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE menu_items ADD CONSTRAINT menu_items_category_id_fkey FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE;
ALTER TABLE menu_items ADD CONSTRAINT menu_items_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE menus ADD CONSTRAINT menus_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE;
ALTER TABLE menus ADD CONSTRAINT menus_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE modifier_groups ADD CONSTRAINT modifier_groups_menu_item_id_fkey FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE;
ALTER TABLE modifier_groups ADD CONSTRAINT modifier_groups_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE modifiers ADD CONSTRAINT modifiers_group_id_fkey FOREIGN KEY (group_id) REFERENCES modifier_groups(id) ON DELETE CASCADE;
ALTER TABLE modifiers ADD CONSTRAINT modifiers_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE order_items ADD CONSTRAINT order_items_menu_item_id_fkey FOREIGN KEY (menu_item_id) REFERENCES menu_items(id);
ALTER TABLE order_items ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
ALTER TABLE order_items ADD CONSTRAINT order_items_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE orders ADD CONSTRAINT orders_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES branches(id);
ALTER TABLE orders ADD CONSTRAINT orders_session_id_fkey FOREIGN KEY (session_id) REFERENCES table_sessions(id);
ALTER TABLE orders ADD CONSTRAINT orders_table_id_fkey FOREIGN KEY (table_id) REFERENCES tables(id);
ALTER TABLE orders ADD CONSTRAINT orders_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE payment_settlements ADD CONSTRAINT payment_settlements_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE;
ALTER TABLE payment_settlements ADD CONSTRAINT payment_settlements_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE payments ADD CONSTRAINT payments_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE;
ALTER TABLE payments ADD CONSTRAINT payments_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;
ALTER TABLE payments ADD CONSTRAINT payments_session_id_fkey FOREIGN KEY (session_id) REFERENCES table_sessions(id) ON DELETE SET NULL;
ALTER TABLE payments ADD CONSTRAINT payments_table_id_fkey FOREIGN KEY (table_id) REFERENCES tables(id) ON DELETE SET NULL;
ALTER TABLE payments ADD CONSTRAINT payments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE refunds ADD CONSTRAINT refunds_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE;
ALTER TABLE refunds ADD CONSTRAINT refunds_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE restaurants ADD CONSTRAINT restaurants_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE seller_goals ADD CONSTRAINT seller_goals_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES backoffice_members(id) ON DELETE CASCADE;
ALTER TABLE staff_invitations ADD CONSTRAINT staff_invitations_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE;
ALTER TABLE staff_invitations ADD CONSTRAINT staff_invitations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE staff_users ADD CONSTRAINT staff_users_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id);
ALTER TABLE staff_users ADD CONSTRAINT staff_users_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES branches(id);
ALTER TABLE staff_users ADD CONSTRAINT staff_users_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE support_tickets ADD CONSTRAINT support_tickets_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE table_sessions ADD CONSTRAINT table_sessions_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES branches(id);
ALTER TABLE table_sessions ADD CONSTRAINT table_sessions_table_id_fkey FOREIGN KEY (table_id) REFERENCES tables(id);
ALTER TABLE table_sessions ADD CONSTRAINT table_sessions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE tables ADD CONSTRAINT tables_assigned_waiter_id_fkey FOREIGN KEY (assigned_waiter_id) REFERENCES staff_users(id) ON DELETE SET NULL;
ALTER TABLE tables ADD CONSTRAINT tables_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE;
ALTER TABLE tables ADD CONSTRAINT tables_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE tenant_feature_flags ADD CONSTRAINT tenant_feature_flags_flag_key_fkey FOREIGN KEY (flag_key) REFERENCES feature_flags(key);
ALTER TABLE tenant_feature_flags ADD CONSTRAINT tenant_feature_flags_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE tenant_members ADD CONSTRAINT tenant_members_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES branches(id);
ALTER TABLE tenant_members ADD CONSTRAINT tenant_members_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE tenant_members ADD CONSTRAINT tenant_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE tenants ADD CONSTRAINT tenants_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES plans(id);
ALTER TABLE waiter_calls ADD CONSTRAINT waiter_calls_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES branches(id);
ALTER TABLE waiter_calls ADD CONSTRAINT waiter_calls_session_id_fkey FOREIGN KEY (session_id) REFERENCES table_sessions(id);
ALTER TABLE waiter_calls ADD CONSTRAINT waiter_calls_table_id_fkey FOREIGN KEY (table_id) REFERENCES tables(id);
ALTER TABLE waiter_calls ADD CONSTRAINT waiter_calls_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
-- 4. Índices (no ligados a restricciones)
CREATE UNIQUE INDEX loyalty_customers_tenant_email_uidx ON public.loyalty_customers USING btree (tenant_id, lower(email));
CREATE UNIQUE INDEX loyalty_programs_tenant_branch_uidx ON public.loyalty_programs USING btree (tenant_id, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX loyalty_rewards_customer_idx ON public.loyalty_rewards USING btree (customer_id);
CREATE UNIQUE INDEX payment_settlements_branch_date_uidx ON public.payment_settlements USING btree (branch_id, settlement_date);
CREATE INDEX payments_branch_created_idx ON public.payments USING btree (branch_id, created_at DESC);
CREATE UNIQUE INDEX payments_idempotency_key_uidx ON public.payments USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);
CREATE INDEX payments_session_idx ON public.payments USING btree (session_id);
CREATE INDEX refunds_payment_idx ON public.refunds USING btree (payment_id);
-- 5. Triggers
CREATE TRIGGER update_loyalty_customers_updated_at BEFORE UPDATE ON public.loyalty_customers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_loyalty_programs_updated_at BEFORE UPDATE ON public.loyalty_programs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_menu_items_updated_at BEFORE UPDATE ON public.menu_items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_payment_settlements_updated_at BEFORE UPDATE ON public.payment_settlements FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_payments_updated_at BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_tenants_updated_at BEFORE UPDATE ON public.tenants FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
-- 6. RLS
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backoffice_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backoffice_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bill_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menus ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.modifier_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.modifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.table_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waiter_calls ENABLE ROW LEVEL SECURITY;
-- 7. Políticas
CREATE POLICY audit_logs_insert ON public.audit_logs AS PERMISSIVE FOR INSERT TO public WITH CHECK (true);
CREATE POLICY audit_logs_tenant_read ON public.audit_logs AS PERMISSIVE FOR SELECT TO public USING ((tenant_id = get_tenant_id()));
CREATE POLICY superadmin_delete_audit_logs ON public.audit_logs AS PERMISSIVE FOR DELETE TO authenticated USING (is_platform_admin());
CREATE POLICY backoffice_invitations_jefe_manage ON public.backoffice_invitations AS PERMISSIVE FOR ALL TO authenticated USING ((EXISTS ( SELECT 1
   FROM backoffice_members bm
  WHERE ((bm.user_id = auth.uid()) AND (bm.role = 'jefe_ventas'::text) AND (bm.is_active = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM backoffice_members bm
  WHERE ((bm.user_id = auth.uid()) AND (bm.role = 'jefe_ventas'::text) AND (bm.is_active = true)))));
CREATE POLICY backoffice_invitations_public_read ON public.backoffice_invitations AS PERMISSIVE FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY backoffice_invitations_public_update ON public.backoffice_invitations AS PERMISSIVE FOR UPDATE TO anon, authenticated USING (true);
CREATE POLICY backoffice_invitations_superadmin_all ON public.backoffice_invitations AS PERMISSIVE FOR ALL TO authenticated USING (is_platform_admin()) WITH CHECK (is_platform_admin());
CREATE POLICY backoffice_members_jefe_read ON public.backoffice_members AS PERMISSIVE FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR has_backoffice_role(auth.uid(), 'jefe_ventas'::text)));
CREATE POLICY backoffice_members_jefe_update ON public.backoffice_members AS PERMISSIVE FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM backoffice_members bm
  WHERE ((bm.user_id = auth.uid()) AND (bm.role = 'jefe_ventas'::text) AND (bm.is_active = true)))));
CREATE POLICY backoffice_members_own_read ON public.backoffice_members AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = auth.uid()));
CREATE POLICY backoffice_members_superadmin_all ON public.backoffice_members AS PERMISSIVE FOR ALL TO authenticated USING (is_platform_admin()) WITH CHECK (is_platform_admin());
CREATE POLICY bill_requests_public_insert ON public.bill_requests AS PERMISSIVE FOR INSERT TO public WITH CHECK ((EXISTS ( SELECT 1
   FROM table_sessions ts
  WHERE ((ts.table_id = bill_requests.table_id) AND (ts.is_active = true)))));
CREATE POLICY bill_requests_public_read ON public.bill_requests AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY bill_requests_staff_manage ON public.bill_requests AS PERMISSIVE FOR ALL TO public USING ((tenant_id = get_tenant_id()));
CREATE POLICY superadmin_delete_bill_requests ON public.bill_requests AS PERMISSIVE FOR DELETE TO authenticated USING (is_platform_admin());
CREATE POLICY branches_public_read ON public.branches AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY branches_staff_manage ON public.branches AS PERMISSIVE FOR ALL TO public USING ((tenant_id = get_tenant_id()));
CREATE POLICY superadmin_delete_branches ON public.branches AS PERMISSIVE FOR DELETE TO authenticated USING (is_platform_admin());
CREATE POLICY superadmin_insert_branches ON public.branches AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (is_platform_admin());
CREATE POLICY superadmin_update_branches ON public.branches AS PERMISSIVE FOR UPDATE TO authenticated USING (is_platform_admin());
CREATE POLICY categories_public_read ON public.categories AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY categories_staff_manage ON public.categories AS PERMISSIVE FOR ALL TO public USING ((tenant_id = get_tenant_id()));
CREATE POLICY superadmin_delete_categories ON public.categories AS PERMISSIVE FOR DELETE TO authenticated USING (is_platform_admin());
CREATE POLICY superadmin_insert_categories ON public.categories AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (is_platform_admin());
CREATE POLICY feature_flags_public_read ON public.feature_flags AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY feature_flags_superadmin_manage ON public.feature_flags AS PERMISSIVE FOR ALL TO authenticated USING (is_platform_admin()) WITH CHECK (is_platform_admin());
CREATE POLICY lead_activities_jefe_insert ON public.lead_activities AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM backoffice_members bm
  WHERE ((bm.user_id = auth.uid()) AND (bm.role = 'jefe_ventas'::text) AND (bm.is_active = true)))));
CREATE POLICY lead_activities_jefe_read ON public.lead_activities AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM backoffice_members bm
  WHERE ((bm.user_id = auth.uid()) AND (bm.role = 'jefe_ventas'::text) AND (bm.is_active = true)))));
CREATE POLICY lead_activities_seller_insert ON public.lead_activities AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((lead_id IN ( SELECT leads.id
   FROM leads
  WHERE (leads.assigned_seller_id IN ( SELECT backoffice_members.id
           FROM backoffice_members
          WHERE (backoffice_members.user_id = auth.uid()))))) OR is_platform_admin()));
CREATE POLICY lead_activities_seller_read ON public.lead_activities AS PERMISSIVE FOR SELECT TO authenticated USING ((lead_id IN ( SELECT leads.id
   FROM leads
  WHERE (leads.assigned_seller_id IN ( SELECT backoffice_members.id
           FROM backoffice_members
          WHERE (backoffice_members.user_id = auth.uid()))))));
CREATE POLICY lead_activities_superadmin_all ON public.lead_activities AS PERMISSIVE FOR ALL TO authenticated USING (is_platform_admin()) WITH CHECK (is_platform_admin());
CREATE POLICY leads_jefe_manage ON public.leads AS PERMISSIVE FOR ALL TO authenticated USING ((EXISTS ( SELECT 1
   FROM backoffice_members bm
  WHERE ((bm.user_id = auth.uid()) AND (bm.role = 'jefe_ventas'::text) AND (bm.is_active = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM backoffice_members bm
  WHERE ((bm.user_id = auth.uid()) AND (bm.role = 'jefe_ventas'::text) AND (bm.is_active = true)))));
CREATE POLICY leads_jefe_read ON public.leads AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM backoffice_members bm
  WHERE ((bm.user_id = auth.uid()) AND (bm.role = 'jefe_ventas'::text) AND (bm.is_active = true)))));
CREATE POLICY leads_seller_insert ON public.leads AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((assigned_seller_id IN ( SELECT backoffice_members.id
   FROM backoffice_members
  WHERE (backoffice_members.user_id = auth.uid()))) OR is_platform_admin()));
CREATE POLICY leads_seller_read_own ON public.leads AS PERMISSIVE FOR SELECT TO authenticated USING ((assigned_seller_id IN ( SELECT backoffice_members.id
   FROM backoffice_members
  WHERE (backoffice_members.user_id = auth.uid()))));
CREATE POLICY leads_seller_update_own ON public.leads AS PERMISSIVE FOR UPDATE TO authenticated USING ((assigned_seller_id IN ( SELECT backoffice_members.id
   FROM backoffice_members
  WHERE (backoffice_members.user_id = auth.uid()))));
CREATE POLICY leads_superadmin_all ON public.leads AS PERMISSIVE FOR ALL TO authenticated USING (is_platform_admin()) WITH CHECK (is_platform_admin());
CREATE POLICY "Tenant members can view loyalty customers" ON public.loyalty_customers AS PERMISSIVE FOR SELECT TO authenticated USING ((is_tenant_member(tenant_id) OR is_platform_admin()));
CREATE POLICY "Public can view active loyalty programs" ON public.loyalty_programs AS PERMISSIVE FOR SELECT TO anon USING ((is_active = true));
CREATE POLICY "Tenant members can create loyalty programs" ON public.loyalty_programs AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY "Tenant members can update loyalty programs" ON public.loyalty_programs AS PERMISSIVE FOR UPDATE TO authenticated USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY "Tenant members can view loyalty programs" ON public.loyalty_programs AS PERMISSIVE FOR SELECT TO authenticated USING ((is_tenant_member(tenant_id) OR is_platform_admin()));
CREATE POLICY "Tenant members can view loyalty rewards" ON public.loyalty_rewards AS PERMISSIVE FOR SELECT TO authenticated USING ((is_tenant_member(tenant_id) OR is_platform_admin()));
CREATE POLICY menu_items_public_read ON public.menu_items AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY menu_items_staff_manage ON public.menu_items AS PERMISSIVE FOR ALL TO public USING ((tenant_id = get_tenant_id()));
CREATE POLICY superadmin_delete_menu_items ON public.menu_items AS PERMISSIVE FOR DELETE TO authenticated USING (is_platform_admin());
CREATE POLICY superadmin_insert_menu_items ON public.menu_items AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (is_platform_admin());
CREATE POLICY menus_public_read ON public.menus AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY menus_staff_manage ON public.menus AS PERMISSIVE FOR ALL TO public USING ((tenant_id = get_tenant_id()));
CREATE POLICY superadmin_delete_menus ON public.menus AS PERMISSIVE FOR DELETE TO authenticated USING (is_platform_admin());
CREATE POLICY superadmin_insert_menus ON public.menus AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (is_platform_admin());
CREATE POLICY superadmin_update_menus ON public.menus AS PERMISSIVE FOR UPDATE TO authenticated USING (is_platform_admin());
CREATE POLICY modifier_groups_public_read ON public.modifier_groups AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY modifier_groups_staff_manage ON public.modifier_groups AS PERMISSIVE FOR ALL TO public USING ((tenant_id = get_tenant_id()));
CREATE POLICY superadmin_delete_modifier_groups ON public.modifier_groups AS PERMISSIVE FOR DELETE TO authenticated USING (is_platform_admin());
CREATE POLICY modifiers_public_read ON public.modifiers AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY modifiers_staff_manage ON public.modifiers AS PERMISSIVE FOR ALL TO public USING ((tenant_id = get_tenant_id()));
CREATE POLICY superadmin_delete_modifiers ON public.modifiers AS PERMISSIVE FOR DELETE TO authenticated USING (is_platform_admin());
CREATE POLICY order_items_public_insert ON public.order_items AS PERMISSIVE FOR INSERT TO public WITH CHECK ((EXISTS ( SELECT 1
   FROM (orders o
     JOIN table_sessions ts ON ((ts.table_id = o.table_id)))
  WHERE ((o.id = order_items.order_id) AND (ts.is_active = true)))));
CREATE POLICY order_items_public_read ON public.order_items AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY order_items_staff_manage ON public.order_items AS PERMISSIVE FOR ALL TO public USING ((tenant_id = get_tenant_id()));
CREATE POLICY superadmin_delete_order_items ON public.order_items AS PERMISSIVE FOR DELETE TO authenticated USING (is_platform_admin());
CREATE POLICY orders_public_insert ON public.orders AS PERMISSIVE FOR INSERT TO public WITH CHECK ((EXISTS ( SELECT 1
   FROM table_sessions ts
  WHERE ((ts.table_id = orders.table_id) AND (ts.is_active = true)))));
CREATE POLICY orders_public_read ON public.orders AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY orders_public_update_status ON public.orders AS PERMISSIVE FOR UPDATE TO public USING (true) WITH CHECK (true);
CREATE POLICY orders_staff_manage ON public.orders AS PERMISSIVE FOR ALL TO public USING ((tenant_id = get_tenant_id()));
CREATE POLICY superadmin_delete_orders ON public.orders AS PERMISSIVE FOR DELETE TO authenticated USING (is_platform_admin());
CREATE POLICY "Tenant members can view settlements" ON public.payment_settlements AS PERMISSIVE FOR SELECT TO authenticated USING ((is_tenant_member(tenant_id) OR is_platform_admin()));
CREATE POLICY "Public can view payments of active sessions" ON public.payments AS PERMISSIVE FOR SELECT TO anon USING ((EXISTS ( SELECT 1
   FROM table_sessions s
  WHERE ((s.id = payments.session_id) AND (s.is_active = true)))));
CREATE POLICY "Tenant members can view payments" ON public.payments AS PERMISSIVE FOR SELECT TO authenticated USING ((is_tenant_member(tenant_id) OR is_platform_admin()));
CREATE POLICY plans_public_read ON public.plans AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY platform_admins_own_read ON public.platform_admins AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = auth.uid()));
CREATE POLICY "Tenant members can view refunds" ON public.refunds AS PERMISSIVE FOR SELECT TO authenticated USING ((is_tenant_member(tenant_id) OR is_platform_admin()));
CREATE POLICY restaurants_public_read ON public.restaurants AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY restaurants_staff_manage ON public.restaurants AS PERMISSIVE FOR ALL TO public USING ((tenant_id = get_tenant_id()));
CREATE POLICY superadmin_delete_restaurants ON public.restaurants AS PERMISSIVE FOR DELETE TO authenticated USING (is_platform_admin());
CREATE POLICY superadmin_insert_restaurants ON public.restaurants AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (is_platform_admin());
CREATE POLICY superadmin_update_restaurants ON public.restaurants AS PERMISSIVE FOR UPDATE TO authenticated USING (is_platform_admin());
CREATE POLICY seller_goals_jefe_manage ON public.seller_goals AS PERMISSIVE FOR ALL TO authenticated USING (has_backoffice_role(auth.uid(), 'jefe_ventas'::text)) WITH CHECK (has_backoffice_role(auth.uid(), 'jefe_ventas'::text));
CREATE POLICY seller_goals_own_read ON public.seller_goals AS PERMISSIVE FOR SELECT TO authenticated USING ((seller_id IN ( SELECT backoffice_members.id
   FROM backoffice_members
  WHERE (backoffice_members.user_id = auth.uid()))));
CREATE POLICY seller_goals_superadmin_all ON public.seller_goals AS PERMISSIVE FOR ALL TO authenticated USING (is_platform_admin()) WITH CHECK (is_platform_admin());
CREATE POLICY staff_invitations_public_read ON public.staff_invitations AS PERMISSIVE FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY staff_invitations_public_update ON public.staff_invitations AS PERMISSIVE FOR UPDATE TO anon, authenticated USING (true);
CREATE POLICY staff_invitations_staff_manage ON public.staff_invitations AS PERMISSIVE FOR ALL TO authenticated USING ((tenant_id = get_tenant_id()));
CREATE POLICY superadmin_delete_staff_invitations ON public.staff_invitations AS PERMISSIVE FOR DELETE TO authenticated USING (is_platform_admin());
CREATE POLICY staff_users_public_read ON public.staff_users AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY staff_users_tenant_manage ON public.staff_users AS PERMISSIVE FOR ALL TO public USING ((tenant_id = get_tenant_id()));
CREATE POLICY staff_users_tenant_read ON public.staff_users AS PERMISSIVE FOR SELECT TO public USING ((tenant_id = get_tenant_id()));
CREATE POLICY superadmin_delete_staff_users ON public.staff_users AS PERMISSIVE FOR DELETE TO authenticated USING (is_platform_admin());
CREATE POLICY superadmin_insert_staff_users ON public.staff_users AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (is_platform_admin());
CREATE POLICY support_tickets_superadmin_all ON public.support_tickets AS PERMISSIVE FOR ALL TO public USING (is_platform_admin()) WITH CHECK (is_platform_admin());
CREATE POLICY support_tickets_tenant_insert ON public.support_tickets AS PERMISSIVE FOR INSERT TO public WITH CHECK (is_tenant_member(tenant_id));
CREATE POLICY support_tickets_tenant_read ON public.support_tickets AS PERMISSIVE FOR SELECT TO public USING (is_tenant_member(tenant_id));
CREATE POLICY superadmin_delete_table_sessions ON public.table_sessions AS PERMISSIVE FOR DELETE TO authenticated USING (is_platform_admin());
CREATE POLICY superadmin_insert_table_sessions ON public.table_sessions AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (is_platform_admin());
CREATE POLICY table_sessions_public_insert ON public.table_sessions AS PERMISSIVE FOR INSERT TO public WITH CHECK (true);
CREATE POLICY table_sessions_public_read ON public.table_sessions AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY table_sessions_public_update ON public.table_sessions AS PERMISSIVE FOR UPDATE TO public USING (true) WITH CHECK (true);
CREATE POLICY table_sessions_staff_manage ON public.table_sessions AS PERMISSIVE FOR ALL TO public USING ((tenant_id = get_tenant_id()));
CREATE POLICY superadmin_delete_tables ON public.tables AS PERMISSIVE FOR DELETE TO authenticated USING (is_platform_admin());
CREATE POLICY superadmin_insert_tables ON public.tables AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (is_platform_admin());
CREATE POLICY tables_public_read ON public.tables AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY tables_public_update_status ON public.tables AS PERMISSIVE FOR UPDATE TO public USING (true) WITH CHECK (true);
CREATE POLICY tables_staff_manage ON public.tables AS PERMISSIVE FOR ALL TO public USING ((tenant_id = get_tenant_id()));
CREATE POLICY superadmin_delete_tenant_feature_flags ON public.tenant_feature_flags AS PERMISSIVE FOR DELETE TO authenticated USING (is_platform_admin());
CREATE POLICY tenant_ff_superadmin_manage ON public.tenant_feature_flags AS PERMISSIVE FOR ALL TO authenticated USING (is_platform_admin()) WITH CHECK (is_platform_admin());
CREATE POLICY tenant_ff_tenant_read ON public.tenant_feature_flags AS PERMISSIVE FOR SELECT TO public USING ((tenant_id = get_tenant_id()));
CREATE POLICY superadmin_delete_tenant_members ON public.tenant_members AS PERMISSIVE FOR DELETE TO authenticated USING (is_platform_admin());
CREATE POLICY tenant_members_own_read ON public.tenant_members AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = auth.uid()));
CREATE POLICY tenant_members_public_insert ON public.tenant_members AS PERMISSIVE FOR INSERT TO public WITH CHECK (true);
CREATE POLICY tenant_members_superadmin_all ON public.tenant_members AS PERMISSIVE FOR ALL TO authenticated USING (is_platform_admin()) WITH CHECK (is_platform_admin());
CREATE POLICY tenant_members_tenant_read ON public.tenant_members AS PERMISSIVE FOR SELECT TO authenticated USING (is_tenant_member(tenant_id));
CREATE POLICY superadmin_delete_tenants ON public.tenants AS PERMISSIVE FOR DELETE TO authenticated USING (is_platform_admin());
CREATE POLICY superadmin_tenants_all ON public.tenants AS PERMISSIVE FOR ALL TO authenticated USING (is_platform_admin()) WITH CHECK (is_platform_admin());
CREATE POLICY tenants_public_read ON public.tenants AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY tenants_staff_update ON public.tenants AS PERMISSIVE FOR UPDATE TO public USING ((id = get_tenant_id()));
CREATE POLICY superadmin_delete_waiter_calls ON public.waiter_calls AS PERMISSIVE FOR DELETE TO authenticated USING (is_platform_admin());
CREATE POLICY waiter_calls_public_insert ON public.waiter_calls AS PERMISSIVE FOR INSERT TO public WITH CHECK (true);
CREATE POLICY waiter_calls_public_read ON public.waiter_calls AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY waiter_calls_staff_manage ON public.waiter_calls AS PERMISSIVE FOR ALL TO public USING ((tenant_id = get_tenant_id()));
-- 8. Políticas de storage.objects
CREATE POLICY menu_images_public_read ON storage.objects AS PERMISSIVE FOR SELECT TO public USING ((bucket_id = 'menu-images'::text));
CREATE POLICY menu_images_tenant_delete ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated USING (((bucket_id = 'menu-images'::text) AND ((storage.foldername(name))[1] = (get_tenant_id())::text)));
CREATE POLICY menu_images_tenant_update ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated USING (((bucket_id = 'menu-images'::text) AND ((storage.foldername(name))[1] = (get_tenant_id())::text)));
CREATE POLICY menu_images_tenant_upload ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'menu-images'::text) AND ((storage.foldername(name))[1] = (get_tenant_id())::text)));
-- 9. GRANT
-- 10. Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.bill_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE public.order_items;
ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.table_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.tables;
ALTER PUBLICATION supabase_realtime ADD TABLE public.waiter_calls;
