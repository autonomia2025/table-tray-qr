-- Fase 3.7 — Sellos que se sienten (brief 6.2: "a la quinta visita, un schop gratis; se cuenta una
-- visita solo con pago confirmado; límites para evitar abuso").
-- Antes los sumaba process-payment en el navegador del servidor, leyendo y escribiendo por separado:
--   · un sello por PAGO (tres rondas = tres sellos), y dos pagos simultáneos podían pisarse;
--   · pagar al mozo no sumaba;
--   · el premio "se canjeaba" en el pago, pero nadie del local se enteraba de que había que entregarlo;
--   · un invitado que guardaba su cuenta después de pagar perdía el sello de esa visita.
-- Ahora la base lleva un libro de movimientos (movimientos_lealtad) y suma sola al guardarse un pago:
--   · un sello por cliente y día de negocio (índice único), desde un monto mínimo que pone el dueño;
--   · vale para la app y para el cobro del mozo o la caja (cada persona, por lo suyo);
--   · solo con cuenta verificada; quien guarda su cuenta recibe el sello de lo que pagó las últimas 48 horas;
--   · un reembolso total anula el sello (si ese día hubo otro pago, el sello pasa a ese);
--   · el premio trae un código; el mozo lo ve en la mesa y lo entrega (queda quién y cuándo).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Estructura
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.loyalty_programs
  ADD COLUMN IF NOT EXISTS monto_minimo integer NOT NULL DEFAULT 0;
ALTER TABLE public.loyalty_programs DROP CONSTRAINT IF EXISTS loyalty_programs_valores_check;
ALTER TABLE public.loyalty_programs ADD CONSTRAINT loyalty_programs_valores_check
  CHECK (type IN ('stamps', 'points') AND goal_visits BETWEEN 2 AND 30 AND points_goal > 0
         AND points_per_thousand BETWEEN 1 AND 100 AND monto_minimo BETWEEN 0 AND 1000000
         AND char_length(reward_description) BETWEEN 2 AND 80) NOT VALID;

ALTER TABLE public.loyalty_rewards
  ADD COLUMN IF NOT EXISTS codigo text,
  ADD COLUMN IF NOT EXISTS movimiento_id uuid,
  ADD COLUMN IF NOT EXISTS entregado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS entregado_por_nombre text,
  ADD COLUMN IF NOT EXISTS anulado_at timestamptz;
ALTER TABLE public.loyalty_rewards DROP CONSTRAINT IF EXISTS loyalty_rewards_status_check;
ALTER TABLE public.loyalty_rewards ADD CONSTRAINT loyalty_rewards_status_check
  CHECK (status IN ('earned', 'redeemed', 'anulado')) NOT VALID;
-- Los premios que todavía se pueden entregar no repiten código dentro del local
CREATE UNIQUE INDEX IF NOT EXISTS loyalty_rewards_codigo_uidx
  ON public.loyalty_rewards (tenant_id, codigo) WHERE status = 'earned' AND codigo IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.movimientos_lealtad (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  customer_id uuid NOT NULL REFERENCES public.loyalty_customers(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  dia_negocio date NOT NULL,
  monto integer NOT NULL DEFAULT 0,
  sello boolean NOT NULL DEFAULT false,
  puntos integer NOT NULL DEFAULT 0,
  premio_id uuid REFERENCES public.loyalty_rewards(id) ON DELETE SET NULL,
  retroactivo boolean NOT NULL DEFAULT false,
  anulado_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Cada pago cuenta una sola vez por persona, y hay un solo sello por persona y día de negocio
CREATE UNIQUE INDEX IF NOT EXISTS movimientos_lealtad_pago_uidx ON public.movimientos_lealtad (payment_id, customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS movimientos_lealtad_sello_dia_uidx
  ON public.movimientos_lealtad (customer_id, dia_negocio) WHERE sello AND anulado_at IS NULL;
CREATE INDEX IF NOT EXISTS movimientos_lealtad_cliente_idx ON public.movimientos_lealtad (customer_id, created_at DESC);
ALTER TABLE public.loyalty_rewards DROP CONSTRAINT IF EXISTS loyalty_rewards_movimiento_fkey;
ALTER TABLE public.loyalty_rewards ADD CONSTRAINT loyalty_rewards_movimiento_fkey
  FOREIGN KEY (movimiento_id) REFERENCES public.movimientos_lealtad(id) ON DELETE SET NULL;

ALTER TABLE public.movimientos_lealtad ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS movimientos_lealtad_lectura ON public.movimientos_lealtad;
CREATE POLICY movimientos_lealtad_lectura ON public.movimientos_lealtad FOR SELECT TO authenticated
  USING (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager', 'cashier']) OR public.is_platform_admin());
-- Nadie escribe desde el navegador: lo hacen los disparadores de payments
REVOKE INSERT, UPDATE, DELETE ON public.movimientos_lealtad FROM anon, authenticated;
GRANT SELECT ON public.movimientos_lealtad TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Sumar sellos y puntos de un pago (idempotente)
-- ─────────────────────────────────────────────────────────────────────────────
-- Código corto para mostrarle al mozo (sin letras que se confunden: 0/O, 1/I/L)
CREATE OR REPLACE FUNCTION public._codigo_premio(_tenant_id uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  letras constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  c text;
BEGIN
  LOOP
    c := '';
    FOR i IN 1..4 LOOP
      c := c || substr(letras, 1 + floor(random() * length(letras))::integer, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.loyalty_rewards WHERE tenant_id = _tenant_id AND codigo = c AND status = 'earned');
  END LOOP;
  RETURN c;
END;
$$;
REVOKE ALL ON FUNCTION public._codigo_premio(uuid) FROM PUBLIC, anon, authenticated;

-- El programa que rige en una sucursal: el suyo o, si no tiene, el de todo el local
CREATE OR REPLACE FUNCTION public._programa_lealtad(_tenant_id uuid, _branch_id uuid)
RETURNS public.loyalty_programs
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.loyalty_programs
   WHERE tenant_id = _tenant_id AND is_active AND (branch_id = _branch_id OR branch_id IS NULL)
   ORDER BY (branch_id IS NULL) LIMIT 1
$$;
REVOKE ALL ON FUNCTION public._programa_lealtad(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._sellos_pago(_payment_id uuid, _solo_usuario uuid DEFAULT NULL, _retroactivo boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.payments;
  prog public.loyalty_programs;
  persona record;
  cliente public.loyalty_customers;
  mov uuid;
  da_sello boolean;
  pts integer;
  premio uuid;
  hechos integer := 0;
BEGIN
  SELECT * INTO p FROM public.payments WHERE id = _payment_id;
  IF p.id IS NULL OR p.status NOT IN ('approved', 'partially_refunded') THEN RETURN 0; END IF;
  prog := public._programa_lealtad(p.tenant_id, p.branch_id);
  IF prog.id IS NULL THEN RETURN 0; END IF;

  -- Cada persona con cuenta verificada que pagó (app) o cuyos pedidos cubre el pago (mozo o caja),
  -- por el monto de lo suyo
  FOR persona IN
    SELECT u.id AS user_id, lower(u.email) AS correo,
           coalesce(nullif((SELECT sum(o.total_amount) FROM public.orders o
                             WHERE o.id = ANY (coalesce(p.pedidos, ARRAY[]::uuid[])) AND o.user_id = u.id), 0),
                    CASE WHEN u.id = p.user_id THEN p.amount ELSE 0 END)::integer AS monto
      FROM auth.users u
     WHERE u.id IN (SELECT p.user_id
                    UNION SELECT o.user_id FROM public.orders o WHERE o.id = ANY (coalesce(p.pedidos, ARRAY[]::uuid[])))
       AND (_solo_usuario IS NULL OR u.id = _solo_usuario)
       AND NOT coalesce(u.is_anonymous, false) AND u.email IS NOT NULL AND u.email_confirmed_at IS NOT NULL
  LOOP
    CONTINUE WHEN persona.monto <= 0;
    -- La ficha del cliente en el local (por cuenta o, si venía de antes, por correo), bloqueada
    SELECT * INTO cliente FROM public.loyalty_customers
     WHERE tenant_id = p.tenant_id AND (user_id = persona.user_id OR lower(email) = persona.correo)
     ORDER BY (user_id = persona.user_id) DESC NULLS LAST LIMIT 1 FOR UPDATE;
    IF cliente.id IS NULL THEN
      INSERT INTO public.loyalty_customers (tenant_id, email, user_id)
      VALUES (p.tenant_id, persona.correo, persona.user_id)
      ON CONFLICT DO NOTHING;
      SELECT * INTO cliente FROM public.loyalty_customers
       WHERE tenant_id = p.tenant_id AND (user_id = persona.user_id OR lower(email) = persona.correo)
       LIMIT 1 FOR UPDATE;
    END IF;
    CONTINUE WHEN cliente.id IS NULL;
    -- Este pago ya contó para esta persona
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.movimientos_lealtad WHERE payment_id = p.id AND customer_id = cliente.id);

    da_sello := prog.type = 'stamps' AND persona.monto >= prog.monto_minimo
                AND NOT EXISTS (SELECT 1 FROM public.movimientos_lealtad
                                 WHERE customer_id = cliente.id AND dia_negocio = p.dia_negocio AND sello AND anulado_at IS NULL);
    pts := CASE WHEN prog.type = 'points' THEN (persona.monto / 1000) * prog.points_per_thousand ELSE 0 END;

    INSERT INTO public.movimientos_lealtad (tenant_id, branch_id, customer_id, user_id, payment_id, dia_negocio,
                                            monto, sello, puntos, retroactivo)
    VALUES (p.tenant_id, p.branch_id, cliente.id, persona.user_id, p.id, p.dia_negocio,
            persona.monto, da_sello, pts, _retroactivo)
    RETURNING id INTO mov;

    UPDATE public.loyalty_customers
       SET visits = visits + CASE WHEN da_sello THEN 1 ELSE 0 END,
           points = points + pts,
           total_spent = total_spent + persona.monto,
           last_visit_at = greatest(coalesce(last_visit_at, p.created_at), p.created_at),
           user_id = coalesce(user_id, persona.user_id),
           updated_at = now()
     WHERE id = cliente.id
    RETURNING * INTO cliente;

    -- ¿Completó la tarjeta?
    premio := NULL;
    IF da_sello AND cliente.visits % prog.goal_visits = 0 THEN
      INSERT INTO public.loyalty_rewards (tenant_id, customer_id, description, codigo, movimiento_id, payment_id)
      VALUES (p.tenant_id, cliente.id, prog.reward_description, public._codigo_premio(p.tenant_id), mov, p.id)
      RETURNING id INTO premio;
    ELSIF prog.type = 'points' AND cliente.points >= prog.points_goal THEN
      UPDATE public.loyalty_customers SET points = points - prog.points_goal WHERE id = cliente.id;
      INSERT INTO public.loyalty_rewards (tenant_id, customer_id, description, codigo, movimiento_id, payment_id)
      VALUES (p.tenant_id, cliente.id, prog.reward_description, public._codigo_premio(p.tenant_id), mov, p.id)
      RETURNING id INTO premio;
    END IF;
    IF premio IS NOT NULL THEN
      UPDATE public.movimientos_lealtad SET premio_id = premio WHERE id = mov;
    END IF;
    hechos := hechos + 1;
  END LOOP;
  RETURN hechos;
END;
$$;
REVOKE ALL ON FUNCTION public._sellos_pago(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;

-- Al guardarse un pago. Un problema con los sellos nunca puede tumbar un pago: se anota y sigue.
CREATE OR REPLACE FUNCTION public.al_pagar_sellos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    PERFORM public._sellos_pago(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'sellos del pago % no se sumaron: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.al_pagar_sellos() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS sumar_sellos ON public.payments;
CREATE TRIGGER sumar_sellos AFTER INSERT ON public.payments
  FOR EACH ROW WHEN (NEW.status = 'approved') EXECUTE FUNCTION public.al_pagar_sellos();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Reembolso total: se anula lo que dio ese pago
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._anular_sellos_pago(_payment_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m public.movimientos_lealtad;
  premio public.loyalty_rewards;
  otro uuid;
BEGIN
  FOR m IN SELECT * FROM public.movimientos_lealtad WHERE payment_id = _payment_id AND anulado_at IS NULL FOR UPDATE LOOP
    PERFORM 1 FROM public.loyalty_customers WHERE id = m.customer_id FOR UPDATE;
    SELECT * INTO premio FROM public.loyalty_rewards WHERE id = m.premio_id;
    -- Un premio ya entregado no se puede devolver: el sello que lo ganó queda consumido
    CONTINUE WHEN premio.id IS NOT NULL AND premio.status = 'redeemed';
    IF premio.id IS NOT NULL THEN
      UPDATE public.loyalty_rewards SET status = 'anulado', anulado_at = now() WHERE id = premio.id;
    END IF;
    UPDATE public.movimientos_lealtad SET anulado_at = now(), premio_id = NULL WHERE id = m.id;
    UPDATE public.loyalty_customers
       SET visits = greatest(0, visits - CASE WHEN m.sello THEN 1 ELSE 0 END),
           points = greatest(0, points - m.puntos),
           total_spent = greatest(0, total_spent - m.monto),
           updated_at = now()
     WHERE id = m.customer_id;
    -- Si ese día pagó otra cosa que sigue vigente, el sello del día pasa a ese pago
    IF m.sello THEN
      SELECT x.id INTO otro FROM public.movimientos_lealtad x
        JOIN public.payments pg ON pg.id = x.payment_id
        JOIN public.loyalty_programs pr ON pr.tenant_id = x.tenant_id AND pr.is_active
       WHERE x.customer_id = m.customer_id AND x.dia_negocio = m.dia_negocio AND x.id <> m.id
         AND x.anulado_at IS NULL AND NOT x.sello AND pg.status IN ('approved', 'partially_refunded')
         AND x.monto >= pr.monto_minimo
       ORDER BY x.created_at LIMIT 1;
      IF otro IS NOT NULL THEN
        UPDATE public.movimientos_lealtad SET sello = true WHERE id = otro;
        UPDATE public.loyalty_customers SET visits = visits + 1 WHERE id = m.customer_id;
      END IF;
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public._anular_sellos_pago(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.al_reembolsar_sellos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    PERFORM public._anular_sellos_pago(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'sellos del pago % no se anularon: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.al_reembolsar_sellos() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS anular_sellos ON public.payments;
CREATE TRIGGER anular_sellos AFTER UPDATE OF status ON public.payments
  FOR EACH ROW WHEN (NEW.status = 'refunded' AND OLD.status IS DISTINCT FROM 'refunded')
  EXECUTE FUNCTION public.al_reembolsar_sellos();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Lo que ve el comensal: su tarjeta
-- ─────────────────────────────────────────────────────────────────────────────
-- Con cuenta verificada: primero recibe lo que pagó como invitado las últimas 48 horas (sellos
-- retroactivos), después ve su tarjeta. Sin cuenta: el programa y si hoy pagó algo (para invitarlo
-- a guardar su cuenta: "este sello es tuyo").
CREATE OR REPLACE FUNCTION public.mis_sellos(_tenant_id uuid, _branch_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  yo uuid := auth.uid();
  u auth.users;
  prog public.loyalty_programs;
  cliente public.loyalty_customers;
  pago record;
  ultimo record;
  base jsonb;
BEGIN
  IF yo IS NULL THEN
    RAISE EXCEPTION 'Entra a la mesa para ver tus sellos' USING ERRCODE = '42501';
  END IF;
  prog := public._programa_lealtad(_tenant_id, _branch_id);
  IF prog.id IS NULL THEN
    RETURN jsonb_build_object('programa', NULL);
  END IF;
  base := jsonb_build_object('programa', jsonb_build_object(
    'tipo', prog.type, 'meta', prog.goal_visits, 'puntos_meta', prog.points_goal,
    'puntos_por_mil', prog.points_per_thousand, 'premio', prog.reward_description, 'monto_minimo', prog.monto_minimo));

  SELECT * INTO u FROM auth.users WHERE id = yo;
  IF coalesce(u.is_anonymous, false) OR u.email IS NULL OR u.email_confirmed_at IS NULL THEN
    RETURN base || jsonb_build_object(
      'registrado', false,
      -- Pagó algo en este local las últimas 48 horas: si guarda su cuenta, ese sello es suyo
      'pendiente', EXISTS (
        SELECT 1 FROM public.payments p
         WHERE p.tenant_id = _tenant_id AND p.status IN ('approved', 'partially_refunded')
           AND p.created_at > now() - interval '48 hours'
           AND (p.user_id = yo OR EXISTS (SELECT 1 FROM public.orders o WHERE o.id = ANY (coalesce(p.pedidos, ARRAY[]::uuid[])) AND o.user_id = yo))));
  END IF;

  -- Sellos retroactivos de lo que pagó (como invitado o antes de verificar) en las últimas 48 horas
  FOR pago IN
    SELECT p.id FROM public.payments p
     WHERE p.tenant_id = _tenant_id AND p.status IN ('approved', 'partially_refunded')
       AND p.created_at > now() - interval '48 hours'
       AND (p.user_id = yo OR EXISTS (SELECT 1 FROM public.orders o WHERE o.id = ANY (coalesce(p.pedidos, ARRAY[]::uuid[])) AND o.user_id = yo))
       AND NOT EXISTS (SELECT 1 FROM public.movimientos_lealtad m JOIN public.loyalty_customers c ON c.id = m.customer_id
                        WHERE m.payment_id = p.id AND c.user_id = yo)
     ORDER BY p.created_at
  LOOP
    PERFORM public._sellos_pago(pago.id, yo, true);
  END LOOP;

  SELECT * INTO cliente FROM public.loyalty_customers
   WHERE tenant_id = _tenant_id AND (user_id = yo OR lower(email) = lower(u.email))
   ORDER BY (user_id = yo) DESC NULLS LAST LIMIT 1;
  SELECT m.payment_id, m.created_at, m.sello, m.puntos, m.premio_id, m.retroactivo INTO ultimo
    FROM public.movimientos_lealtad m
   WHERE m.customer_id = cliente.id AND m.anulado_at IS NULL
   ORDER BY m.created_at DESC LIMIT 1;

  RETURN base || jsonb_build_object(
    'registrado', true,
    'correo', u.email,
    'total', coalesce(cliente.visits, 0),
    'sellos', CASE WHEN prog.type = 'stamps' THEN coalesce(cliente.visits, 0) % prog.goal_visits ELSE 0 END,
    'puntos', coalesce(cliente.points, 0),
    'hoy_sumado', EXISTS (SELECT 1 FROM public.movimientos_lealtad m
                           WHERE m.customer_id = cliente.id AND m.sello AND m.anulado_at IS NULL
                             AND m.dia_negocio = public.dia_negocio(coalesce(_branch_id, m.branch_id), now())),
    'ultimo', CASE WHEN ultimo.payment_id IS NULL THEN NULL ELSE jsonb_build_object(
      'payment_id', ultimo.payment_id, 'at', ultimo.created_at, 'sello', ultimo.sello, 'puntos', ultimo.puntos,
      'premio', ultimo.premio_id IS NOT NULL, 'retroactivo', ultimo.retroactivo) END,
    'premios', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'descripcion', r.description,
                                                              'codigo', r.codigo, 'ganado_at', r.earned_at) ORDER BY r.earned_at), '[]'::jsonb)
                  FROM public.loyalty_rewards r WHERE r.customer_id = cliente.id AND r.status = 'earned'));
END;
$$;
REVOKE ALL ON FUNCTION public.mis_sellos(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mis_sellos(uuid, uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. El personal entrega los premios
-- ─────────────────────────────────────────────────────────────────────────────
-- Premios por entregar de los clientes que están en una mesa (el mozo los ve en el detalle)
CREATE OR REPLACE FUNCTION public.premios_en_mesa(_table_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  mesa public.tables;
BEGIN
  SELECT * INTO mesa FROM public.tables WHERE id = _table_id;
  IF mesa.id IS NULL OR NOT public.tiene_rol(mesa.tenant_id, ARRAY['owner', 'admin', 'manager', 'cashier', 'waiter']) THEN
    RAISE EXCEPTION 'No tienes permiso para ver esta mesa' USING ERRCODE = '42501';
  END IF;
  RETURN (
    -- Sin el código: lo muestra el cliente en su celular y el mozo lo escribe al entregar
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'descripcion', r.description,
                                                 'alias', cm.alias) ORDER BY r.earned_at), '[]'::jsonb)
      FROM public.table_sessions ts
      JOIN public.comensales_mesa cm ON cm.session_id = ts.id
      JOIN public.loyalty_customers c ON c.tenant_id = mesa.tenant_id AND c.user_id = cm.user_id
      JOIN public.loyalty_rewards r ON r.customer_id = c.id AND r.status = 'earned'
     WHERE ts.is_active AND ts.table_id IN (SELECT id FROM public.tables WHERE id = mesa.id OR unida_a = mesa.id));
END;
$$;
REVOKE ALL ON FUNCTION public.premios_en_mesa(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.premios_en_mesa(uuid) TO authenticated;

-- Premios por entregar de todo el local (para la caja y el dueño)
CREATE OR REPLACE FUNCTION public.premios_por_entregar(_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.tiene_rol(_tenant_id, ARRAY['owner', 'admin', 'manager', 'cashier']) OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'No tienes permiso para ver los premios' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'por_entregar', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'descripcion', r.description,
                                                                   'correo', c.email, 'ganado_at', r.earned_at) ORDER BY r.earned_at), '[]'::jsonb)
                       FROM public.loyalty_rewards r JOIN public.loyalty_customers c ON c.id = r.customer_id
                      WHERE r.tenant_id = _tenant_id AND r.status = 'earned'),
    'entregados', (SELECT coalesce(jsonb_agg(x ORDER BY x.entregado_at DESC), '[]'::jsonb) FROM (
                     SELECT r.id, r.description AS descripcion, c.email AS correo, r.redeemed_at AS entregado_at,
                            r.entregado_por_nombre AS entregado_por
                       FROM public.loyalty_rewards r JOIN public.loyalty_customers c ON c.id = r.customer_id
                      WHERE r.tenant_id = _tenant_id AND r.status = 'redeemed'
                      ORDER BY r.redeemed_at DESC LIMIT 30) x));
END;
$$;
REVOKE ALL ON FUNCTION public.premios_por_entregar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.premios_por_entregar(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.entregar_premio(_premio_id uuid, _codigo text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.loyalty_rewards;
  quien text;
BEGIN
  SELECT * INTO r FROM public.loyalty_rewards WHERE id = _premio_id FOR UPDATE;
  IF r.id IS NULL OR NOT public.tiene_rol(r.tenant_id, ARRAY['owner', 'admin', 'manager', 'cashier', 'waiter']) THEN
    RAISE EXCEPTION 'No tienes permiso para entregar este premio' USING ERRCODE = '42501';
  END IF;
  IF r.status = 'redeemed' THEN
    RAISE EXCEPTION 'Este premio ya se entregó' USING ERRCODE = 'P0001';
  END IF;
  IF r.status <> 'earned' THEN
    RAISE EXCEPTION 'Este premio ya no está vigente' USING ERRCODE = 'P0001';
  END IF;
  -- El código que muestra el cliente en su celular prueba que el premio es suyo
  IF upper(btrim(coalesce(_codigo, ''))) <> r.codigo THEN
    RAISE EXCEPTION 'El código no corresponde a este premio' USING ERRCODE = 'P0001';
  END IF;
  SELECT coalesce(s.name, u.email, 'Personal') INTO quien
    FROM auth.users u LEFT JOIN public.staff_users s ON s.auth_user_id = u.id AND s.tenant_id = r.tenant_id
   WHERE u.id = auth.uid();
  UPDATE public.loyalty_rewards
     SET status = 'redeemed', redeemed_at = now(), entregado_por = auth.uid(), entregado_por_nombre = quien
   WHERE id = r.id;
  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (r.tenant_id, auth.uid(), 'premio_entregado', 'loyalty_reward', r.id,
          jsonb_build_object('descripcion', r.description, 'codigo', r.codigo));
  RETURN jsonb_build_object('ok', true, 'descripcion', r.description);
END;
$$;
REVOKE ALL ON FUNCTION public.entregar_premio(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.entregar_premio(uuid, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. El reinicio del demo borra los movimientos
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  def text;
BEGIN
  SELECT pg_get_functiondef('public.reiniciar_demo()'::regprocedure) INTO def;
  IF position('movimientos_lealtad' IN def) = 0 THEN
    def := replace(def, 'DELETE FROM public.loyalty_rewards WHERE tenant_id = demo;',
                   'DELETE FROM public.movimientos_lealtad WHERE tenant_id = demo;
  DELETE FROM public.loyalty_rewards WHERE tenant_id = demo;');
    IF position('movimientos_lealtad' IN def) = 0 THEN
      RAISE EXCEPTION 'No se pudo agregar movimientos_lealtad al reinicio del demo';
    END IF;
    EXECUTE def;
  END IF;
END;
$$;

-- El demo cuenta un sello desde $3.000 (un café o una bebida sola no suman)
UPDATE public.loyalty_programs SET monto_minimo = 3000
 WHERE tenant_id = '651c363f-0084-50af-9873-be98cfeaaf47' AND monto_minimo = 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. El cliente del demo llega con 4 sellos (de la historia de ejemplo)
-- ─────────────────────────────────────────────────────────────────────────────
-- Así, al pagar hoy, se ve completarse la tarjeta, aparecer el premio y al mozo entregarlo. Usa 4 pagos
-- de la historia de ejemplo (días distintos, sobre el monto mínimo) y los pone a su nombre.
CREATE OR REPLACE FUNCTION public._sembrar_cliente_demo()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  demo constant uuid := '651c363f-0084-50af-9873-be98cfeaaf47';
  cliente uuid;
  pago record;
  n integer := 0;
BEGIN
  SELECT id INTO cliente FROM auth.users WHERE email = 'cliente@demo.tablio.test';
  IF cliente IS NULL THEN RETURN 0; END IF;
  FOR pago IN
    SELECT DISTINCT ON (p.dia_negocio) p.id, p.order_id
      FROM public.payments p
     WHERE p.tenant_id = demo AND p.status = 'approved' AND p.amount >= 3000 AND p.user_id IS NULL
       AND p.dia_negocio IN (SELECT public.dia_negocio(p.branch_id, now()) - d FROM unnest(ARRAY[3, 8, 13, 19]) d)
     ORDER BY p.dia_negocio, p.created_at
  LOOP
    UPDATE public.payments SET user_id = cliente WHERE id = pago.id;
    UPDATE public.orders SET user_id = cliente WHERE id = pago.order_id;
    n := n + public._sellos_pago(pago.id);
    -- Con la fecha de esa visita: un sello de ejemplo no "cae" al abrir la app
    UPDATE public.movimientos_lealtad m SET created_at = p.created_at
      FROM public.payments p WHERE p.id = pago.id AND m.payment_id = p.id;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public._sembrar_cliente_demo() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  def text;
BEGIN
  SELECT pg_get_functiondef('public.reiniciar_demo()'::regprocedure) INTO def;
  IF position('_sembrar_cliente_demo' IN def) = 0 THEN
    def := replace(def, 'PERFORM public._sembrar_historia_demo();',
                   'PERFORM public._sembrar_historia_demo();
  PERFORM public._sembrar_cliente_demo();');
    IF position('_sembrar_cliente_demo' IN def) = 0 THEN
      RAISE EXCEPTION 'No se pudo agregar el cliente del demo al reinicio';
    END IF;
    EXECUTE def;
  END IF;
END;
$$;
