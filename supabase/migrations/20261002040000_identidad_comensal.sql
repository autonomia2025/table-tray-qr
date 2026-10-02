-- Fase 1.3 — Identidad del comensal.
-- Cada comensal tiene una identidad propia: anónima (invitado) o registrada (cliente).
-- El invitado puede convertirse en cliente sin perder lo que hizo (Supabase une la cuenta).
-- Brief, regla 8: la mesa es un lugar; cada persona paga lo suyo.

-- 1. Una sola sesión abierta por mesa: si dos comensales escanean a la vez, comparten la misma.
CREATE UNIQUE INDEX IF NOT EXISTS table_sessions_una_activa_por_mesa
  ON public.table_sessions (table_id) WHERE is_active = true;

-- 2. Comensales de cada sesión de mesa.
CREATE TABLE IF NOT EXISTS public.comensales_mesa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  table_id uuid NOT NULL REFERENCES public.tables(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.table_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  alias text CHECK (alias IS NULL OR char_length(alias) BETWEEN 1 AND 30),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, user_id)
);
CREATE INDEX IF NOT EXISTS comensales_mesa_user_idx ON public.comensales_mesa (user_id);

ALTER TABLE public.comensales_mesa ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.comensales_mesa FROM anon;
GRANT SELECT ON public.comensales_mesa TO authenticated;

-- El comensal ve solo sus propias filas; el personal del local ve a los comensales de su local.
CREATE POLICY comensales_mesa_propios ON public.comensales_mesa
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY comensales_mesa_personal ON public.comensales_mesa
  FOR SELECT TO authenticated
  USING (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager', 'cashier', 'waiter', 'kitchen']));
-- Sin políticas de escritura: solo se entra a una mesa con unirse_a_mesa().

-- 3. Quién hizo cada pedido (para "mis pedidos" y para que cada uno pague lo suyo).
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS orders_user_idx ON public.orders (user_id);

-- 4. Sellos ligados a la cuenta del cliente (no a un correo escrito a mano: DIAGNOSTICO N4).
ALTER TABLE public.loyalty_customers
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS loyalty_customers_tenant_user_uidx
  ON public.loyalty_customers (tenant_id, user_id) WHERE user_id IS NOT NULL;

-- 5. Entrar a una mesa con su QR: valida el código, abre o reutiliza la sesión de la mesa
--    y registra al comensal. Funciona para invitados (anónimos) y clientes.
CREATE OR REPLACE FUNCTION public.unirse_a_mesa(_qr_token text, _alias text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  usuario uuid := auth.uid();
  mesa record;
  sesion uuid;
  alias_limpio text := nullif(btrim(coalesce(_alias, '')), '');
BEGIN
  IF usuario IS NULL THEN
    RAISE EXCEPTION 'Hace falta una sesión para entrar a la mesa' USING ERRCODE = '42501';
  END IF;

  SELECT t.id, t.number, t.tenant_id, t.branch_id
    INTO mesa
    FROM public.tables t
    JOIN public.tenants te ON te.id = t.tenant_id AND te.is_active = true
   WHERE t.qr_token = _qr_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Código de mesa no válido' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.table_sessions (tenant_id, table_id, branch_id, opened_at, is_active, total_amount)
  VALUES (mesa.tenant_id, mesa.id, mesa.branch_id, now(), true, 0)
  ON CONFLICT (table_id) WHERE is_active = true DO NOTHING;

  SELECT id INTO sesion FROM public.table_sessions WHERE table_id = mesa.id AND is_active = true;

  INSERT INTO public.comensales_mesa (tenant_id, branch_id, table_id, session_id, user_id, alias)
  VALUES (mesa.tenant_id, mesa.branch_id, mesa.id, sesion, usuario, left(alias_limpio, 30))
  ON CONFLICT (session_id, user_id)
  DO UPDATE SET alias = coalesce(left(alias_limpio, 30), public.comensales_mesa.alias);

  RETURN jsonb_build_object(
    'session_id', sesion,
    'table_id', mesa.id,
    'table_number', mesa.number,
    'tenant_id', mesa.tenant_id,
    'branch_id', mesa.branch_id,
    'alias', (SELECT alias FROM public.comensales_mesa WHERE session_id = sesion AND user_id = usuario)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.unirse_a_mesa(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unirse_a_mesa(text, text) TO authenticated;

-- 6. mi_perfil: ahora dice si la sesión es de un invitado (anónimo).
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
    'es_anonimo', coalesce((SELECT is_anonymous FROM auth.users WHERE id = auth.uid()), false),
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
