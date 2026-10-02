-- Fase 1.6 — Acciones del comensal sin cámara.
-- Llamar al mozo y pedir la cuenta ya no piden escanear el QR con la cámara: el comensal
-- ya está registrado en su mesa (unirse_a_mesa) y eso es lo que valida el servidor.
-- Contra el abuso a distancia: solo quien está en la sesión abierta de la mesa, sin duplicados
-- y con un límite de llamadas. El total de la cuenta lo calcula la base, no el navegador.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Quién llamó y quién atendió.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.waiter_calls
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attended_at timestamptz,
  ADD COLUMN IF NOT EXISTS attended_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.bill_requests
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attended_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

UPDATE public.waiter_calls SET status = 'attended' WHERE status IS NULL OR status NOT IN ('pending', 'attended', 'cancelled');
UPDATE public.bill_requests SET status = 'paid' WHERE status IS NULL OR status NOT IN ('pending', 'attending', 'paid', 'cancelled');
ALTER TABLE public.waiter_calls DROP CONSTRAINT IF EXISTS waiter_calls_status_check;
ALTER TABLE public.waiter_calls ADD CONSTRAINT waiter_calls_status_check CHECK (status IN ('pending', 'attended', 'cancelled'));
ALTER TABLE public.bill_requests DROP CONSTRAINT IF EXISTS bill_requests_status_check;
ALTER TABLE public.bill_requests ADD CONSTRAINT bill_requests_status_check CHECK (status IN ('pending', 'attending', 'paid', 'cancelled'));

CREATE INDEX IF NOT EXISTS waiter_calls_sesion_idx ON public.waiter_calls (session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bill_requests_sesion_idx ON public.bill_requests (session_id, requested_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Reglas de acceso: nadie escribe directo; leen el personal y el comensal de esa sesión.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "waiter_calls_public_insert" ON public.waiter_calls;
DROP POLICY IF EXISTS "waiter_calls_public_read" ON public.waiter_calls;
DROP POLICY IF EXISTS "waiter_calls_staff_manage" ON public.waiter_calls;
DROP POLICY IF EXISTS "bill_requests_public_insert" ON public.bill_requests;
DROP POLICY IF EXISTS "bill_requests_public_read" ON public.bill_requests;
DROP POLICY IF EXISTS "bill_requests_staff_manage" ON public.bill_requests;

REVOKE ALL ON public.waiter_calls FROM anon;
REVOKE ALL ON public.bill_requests FROM anon;
REVOKE INSERT, UPDATE ON public.waiter_calls FROM authenticated;
REVOKE INSERT, UPDATE ON public.bill_requests FROM authenticated;
GRANT SELECT, DELETE ON public.waiter_calls TO authenticated;  -- borrar: solo superadmin (política existente)
GRANT SELECT, DELETE ON public.bill_requests TO authenticated;

CREATE POLICY waiter_calls_lectura_personal ON public.waiter_calls FOR SELECT TO authenticated
  USING (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager', 'cashier', 'waiter']));
CREATE POLICY waiter_calls_lectura_comensal ON public.waiter_calls FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.comensales_mesa cm
                  WHERE cm.session_id = waiter_calls.session_id AND cm.user_id = auth.uid()));
CREATE POLICY waiter_calls_lectura_superadmin ON public.waiter_calls FOR SELECT TO authenticated
  USING (public.is_platform_admin());

CREATE POLICY bill_requests_lectura_personal ON public.bill_requests FOR SELECT TO authenticated
  USING (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager', 'cashier', 'waiter']));
CREATE POLICY bill_requests_lectura_comensal ON public.bill_requests FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.comensales_mesa cm
                  WHERE cm.session_id = bill_requests.session_id AND cm.user_id = auth.uid()));
CREATE POLICY bill_requests_lectura_superadmin ON public.bill_requests FOR SELECT TO authenticated
  USING (public.is_platform_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. El comensal en su mesa: la sesión abierta de la mesa del código, si está registrado en ella.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._comensal_en_mesa(_qr_token text, OUT mesa public.tables, OUT sesion uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Tienes que entrar desde el QR de tu mesa' USING ERRCODE = '42501';
  END IF;
  SELECT t.* INTO mesa FROM public.tables t
    JOIN public.tenants te ON te.id = t.tenant_id AND te.is_active
   WHERE t.qr_token = _qr_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Código de mesa no válido' USING ERRCODE = 'P0002';
  END IF;
  SELECT ts.id INTO sesion
    FROM public.table_sessions ts
    JOIN public.comensales_mesa cm ON cm.session_id = ts.id AND cm.user_id = auth.uid()
   WHERE ts.table_id = mesa.id AND ts.is_active;
  IF sesion IS NULL THEN
    RAISE EXCEPTION 'Tienes que estar en la mesa para hacer esto' USING ERRCODE = '42501';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public._comensal_en_mesa(text) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Llamar al mozo. Si ya hay una llamada pendiente en la mesa, se reutiliza.
--    Límite: 6 llamadas por persona cada 10 minutos.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.llamar_mozo(_qr_token text, _motivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  llamada uuid;
  motivo_limpio text := left(nullif(btrim(coalesce(_motivo, '')), ''), 60);
BEGIN
  SELECT * INTO c FROM public._comensal_en_mesa(_qr_token);
  PERFORM 1 FROM public.table_sessions WHERE id = c.sesion FOR UPDATE; -- una llamada a la vez por mesa

  SELECT id INTO llamada FROM public.waiter_calls
   WHERE session_id = c.sesion AND status = 'pending'
   ORDER BY created_at DESC LIMIT 1;
  IF llamada IS NOT NULL THEN
    RETURN jsonb_build_object('id', llamada, 'status', 'pending', 'nueva', false);
  END IF;

  IF (SELECT count(*) FROM public.waiter_calls
       WHERE user_id = auth.uid() AND created_at > now() - interval '10 minutes') >= 6 THEN
    RAISE EXCEPTION 'Ya llamaste al mozo varias veces. Espera un momento, viene en camino.' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.waiter_calls (tenant_id, branch_id, table_id, session_id, reason, status, user_id)
  VALUES ((c.mesa).tenant_id, (c.mesa).branch_id, (c.mesa).id, c.sesion, coalesce(motivo_limpio, 'help'), 'pending', auth.uid())
  RETURNING id INTO llamada;

  RETURN jsonb_build_object('id', llamada, 'status', 'pending', 'nueva', true);
END;
$$;

-- El comensal de esa mesa cancela una llamada pendiente.
CREATE OR REPLACE FUNCTION public.cancelar_llamado(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.waiter_calls wc SET status = 'cancelled'
   WHERE wc.id = _id AND wc.status = 'pending'
     AND EXISTS (SELECT 1 FROM public.comensales_mesa cm
                  WHERE cm.session_id = wc.session_id AND cm.user_id = auth.uid());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se pudo cancelar la llamada' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Pedir la cuenta: el total es lo que la mesa tiene sin pagar, calculado por la base.
--    Si ya hay una cuenta pedida, se actualiza (propina incluida) en vez de duplicarla.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pedir_cuenta(_qr_token text, _propina integer DEFAULT 0, _porcentaje integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  pendiente integer;
  cuenta uuid;
  propina integer := greatest(coalesce(_propina, 0), 0);
  porcentaje integer := greatest(coalesce(_porcentaje, 0), 0);
BEGIN
  SELECT * INTO c FROM public._comensal_en_mesa(_qr_token);
  PERFORM 1 FROM public.table_sessions WHERE id = c.sesion FOR UPDATE;

  SELECT coalesce(sum(total_amount), 0) INTO pendiente
    FROM public.orders
   WHERE session_id = c.sesion AND status <> 'cancelled'
     AND coalesce(payment_status, 'pending') NOT IN ('paid', 'refunded');
  IF pendiente <= 0 THEN
    RAISE EXCEPTION 'Tu mesa no tiene nada pendiente de pago 🎉' USING ERRCODE = 'P0001';
  END IF;
  IF porcentaje > 100 OR propina > pendiente THEN
    RAISE EXCEPTION 'La propina no puede ser mayor que la cuenta' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO cuenta FROM public.bill_requests
   WHERE session_id = c.sesion AND status IN ('pending', 'attending')
   ORDER BY requested_at DESC LIMIT 1;

  IF cuenta IS NULL THEN
    INSERT INTO public.bill_requests (tenant_id, branch_id, table_id, session_id, total_amount, tip_amount, tip_percentage, status, requested_at, user_id)
    VALUES ((c.mesa).tenant_id, (c.mesa).branch_id, (c.mesa).id, c.sesion, pendiente, propina, porcentaje, 'pending', now(), auth.uid())
    RETURNING id INTO cuenta;
  ELSE
    UPDATE public.bill_requests
       SET total_amount = pendiente, tip_amount = propina, tip_percentage = porcentaje
     WHERE id = cuenta;
  END IF;
  UPDATE public.tables SET status = 'waiting_bill' WHERE id = (c.mesa).id;

  RETURN jsonb_build_object('id', cuenta, 'total', pendiente, 'propina', propina, 'a_pagar', pendiente + propina);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. El personal atiende llamadas y cuentas (cerrar la cuenta va con cerrar_mesa).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.atender_llamado(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  local uuid;
BEGIN
  SELECT tenant_id INTO local FROM public.waiter_calls WHERE id = _id;
  IF local IS NULL OR NOT public.tiene_rol(local, ARRAY['owner', 'admin', 'manager', 'cashier', 'waiter']) THEN
    RAISE EXCEPTION 'No tienes permiso para este cambio' USING ERRCODE = '42501';
  END IF;
  UPDATE public.waiter_calls SET status = 'attended', attended_at = now(), attended_by = auth.uid()
   WHERE id = _id AND status = 'pending';
END;
$$;

CREATE OR REPLACE FUNCTION public.atender_cuenta(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  local uuid;
BEGIN
  SELECT tenant_id INTO local FROM public.bill_requests WHERE id = _id;
  IF local IS NULL OR NOT public.tiene_rol(local, ARRAY['owner', 'admin', 'manager', 'cashier', 'waiter']) THEN
    RAISE EXCEPTION 'No tienes permiso para este cambio' USING ERRCODE = '42501';
  END IF;
  UPDATE public.bill_requests SET status = 'attending', attended_at = now(), attended_by = auth.uid()
   WHERE id = _id AND status = 'pending';
END;
$$;

-- cerrar_mesa ya marca 'attended' las llamadas pendientes; ahora también deja quién y cuándo.
CREATE OR REPLACE FUNCTION public.registrar_atencion_llamado()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'attended' AND OLD.status = 'pending' THEN
    NEW.attended_at := coalesce(NEW.attended_at, now());
    NEW.attended_by := coalesce(NEW.attended_by, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS registrar_atencion_llamado ON public.waiter_calls;
CREATE TRIGGER registrar_atencion_llamado BEFORE UPDATE OF status ON public.waiter_calls
  FOR EACH ROW EXECUTE FUNCTION public.registrar_atencion_llamado();

REVOKE ALL ON FUNCTION public.llamar_mozo(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancelar_llamado(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pedir_cuenta(text, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.atender_llamado(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.atender_cuenta(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.llamar_mozo(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancelar_llamado(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pedir_cuenta(text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.atender_llamado(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.atender_cuenta(uuid) TO authenticated;
