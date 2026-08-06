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