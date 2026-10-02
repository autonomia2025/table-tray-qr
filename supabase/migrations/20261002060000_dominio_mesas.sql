-- Fase 1.5 — Dominio mesas y sesiones.
-- Abrir, tomar, transferir y cerrar una mesa pasan a funciones del servidor que validan el rol
-- y dejan registro. Nadie escribe directo el estado de una mesa ni su sesión desde el navegador.
-- La lectura pública de mesas (que exponía el código QR de todas las mesas de todos los locales)
-- se cierra: el comensal resuelve su mesa con ver_mesa(código).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Registro de lo que pasa en cada mesa (solo crece; nadie lo edita desde la app).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.table_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  table_id uuid NOT NULL REFERENCES public.tables(id) ON DELETE CASCADE,
  session_id uuid REFERENCES public.table_sessions(id) ON DELETE SET NULL,
  accion text NOT NULL CHECK (accion IN ('abrir', 'tomar', 'transferir', 'cerrar')),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_rol text,
  detalle jsonb NOT NULL DEFAULT '{}'::jsonb,
  motivo text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS table_events_mesa_idx ON public.table_events (table_id, created_at DESC);
CREATE INDEX IF NOT EXISTS table_events_local_idx ON public.table_events (tenant_id, created_at DESC);

ALTER TABLE public.table_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.table_events FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.table_events FROM authenticated;
GRANT SELECT ON public.table_events TO authenticated;

CREATE POLICY table_events_lectura_personal ON public.table_events FOR SELECT TO authenticated
  USING (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager', 'cashier', 'waiter']));
CREATE POLICY table_events_lectura_superadmin ON public.table_events FOR SELECT TO authenticated
  USING (public.is_platform_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Mesas: el código QR lo genera la base si no viene, y la sucursal debe ser del local.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.tables ALTER COLUMN qr_token SET DEFAULT replace(gen_random_uuid()::text, '-', '');
ALTER TABLE public.tables ALTER COLUMN status SET DEFAULT 'free';
UPDATE public.tables SET status = 'free' WHERE status IS NULL OR status NOT IN ('free', 'occupied', 'waiting_bill');
ALTER TABLE public.tables ALTER COLUMN status SET NOT NULL;
ALTER TABLE public.tables DROP CONSTRAINT IF EXISTS tables_status_check;
ALTER TABLE public.tables ADD CONSTRAINT tables_status_check CHECK (status IN ('free', 'occupied', 'waiting_bill'));
-- Un código adivinable permitiría entrar a mesas ajenas: mínimo 16 caracteres para las nuevas.
ALTER TABLE public.tables DROP CONSTRAINT IF EXISTS tables_qr_token_largo;
ALTER TABLE public.tables ADD CONSTRAINT tables_qr_token_largo CHECK (char_length(qr_token) >= 16) NOT VALID;

CREATE OR REPLACE FUNCTION public.validar_mesa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.branches b WHERE b.id = NEW.branch_id AND b.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'La sucursal no es de este local' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.tenant_id <> OLD.tenant_id OR NEW.branch_id <> OLD.branch_id) THEN
    RAISE EXCEPTION 'Una mesa no se cambia de local ni de sucursal' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validar_mesa ON public.tables;
CREATE TRIGGER validar_mesa BEFORE INSERT OR UPDATE ON public.tables
  FOR EACH ROW EXECUTE FUNCTION public.validar_mesa();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Reglas de acceso de mesas.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "tables_public_read" ON public.tables;
DROP POLICY IF EXISTS "tables_public_update_status" ON public.tables;
DROP POLICY IF EXISTS "tables_staff_manage" ON public.tables;

REVOKE ALL ON public.tables FROM anon;
REVOKE INSERT, UPDATE ON public.tables FROM authenticated;
GRANT SELECT, DELETE ON public.tables TO authenticated;
-- Solo la configuración de la mesa se escribe directo; estado y mozo asignado, solo por funciones.
GRANT INSERT (tenant_id, branch_id, number, name, zone, capacity, position_x, position_y, qr_token)
  ON public.tables TO authenticated;
GRANT UPDATE (number, name, zone, capacity, position_x, position_y) ON public.tables TO authenticated;

CREATE POLICY tables_lectura_personal ON public.tables FOR SELECT TO authenticated
  USING (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager', 'cashier', 'waiter', 'kitchen']));
-- El comensal ve solo la mesa donde tiene una sesión abierta.
CREATE POLICY tables_lectura_comensal ON public.tables FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.comensales_mesa cm
                   JOIN public.table_sessions ts ON ts.id = cm.session_id AND ts.is_active
                  WHERE cm.table_id = tables.id AND cm.user_id = auth.uid()));
CREATE POLICY tables_lectura_superadmin ON public.tables FOR SELECT TO authenticated
  USING (public.is_platform_admin());
CREATE POLICY tables_alta ON public.tables FOR INSERT TO authenticated
  WITH CHECK (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager']));
CREATE POLICY tables_edicion ON public.tables FOR UPDATE TO authenticated
  USING (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager']))
  WITH CHECK (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager']));
CREATE POLICY tables_baja ON public.tables FOR DELETE TO authenticated
  USING (public.tiene_rol(tenant_id, ARRAY['owner', 'admin']));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Reglas de acceso de sesiones de mesa: nadie las escribe directo.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "table_sessions_public_insert" ON public.table_sessions;
DROP POLICY IF EXISTS "table_sessions_public_read" ON public.table_sessions;
DROP POLICY IF EXISTS "table_sessions_public_update" ON public.table_sessions;
DROP POLICY IF EXISTS "table_sessions_staff_manage" ON public.table_sessions;
DROP POLICY IF EXISTS "superadmin_insert_table_sessions" ON public.table_sessions;

REVOKE ALL ON public.table_sessions FROM anon;
REVOKE INSERT, UPDATE ON public.table_sessions FROM authenticated;
GRANT SELECT, DELETE ON public.table_sessions TO authenticated; -- borrar: solo superadmin (política existente)

CREATE POLICY table_sessions_lectura_personal ON public.table_sessions FOR SELECT TO authenticated
  USING (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager', 'cashier', 'waiter', 'kitchen']));
CREATE POLICY table_sessions_lectura_comensal ON public.table_sessions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.comensales_mesa cm
                  WHERE cm.session_id = table_sessions.id AND cm.user_id = auth.uid()));
CREATE POLICY table_sessions_lectura_superadmin ON public.table_sessions FOR SELECT TO authenticated
  USING (public.is_platform_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. El total de la sesión lo calcula la base: la suma de sus pedidos no cancelados.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.recalcular_total_sesion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sesiones uuid[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    sesiones := ARRAY[NEW.session_id];
  ELSIF TG_OP = 'DELETE' THEN
    sesiones := ARRAY[OLD.session_id];
  ELSE
    sesiones := ARRAY[NEW.session_id, OLD.session_id];
  END IF;
  UPDATE public.table_sessions ts
     SET total_amount = coalesce((SELECT sum(o.total_amount) FROM public.orders o
                                   WHERE o.session_id = ts.id AND o.status <> 'cancelled'), 0)
   WHERE ts.id = ANY (sesiones);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS recalcular_total_sesion ON public.orders;
CREATE TRIGGER recalcular_total_sesion
  AFTER INSERT OR DELETE OR UPDATE OF total_amount, status, session_id ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.recalcular_total_sesion();

-- Pedir la cuenta deja la mesa "esperando la cuenta" (antes lo escribía el navegador).
CREATE OR REPLACE FUNCTION public.mesa_esperando_cuenta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'pending' THEN
    UPDATE public.tables SET status = 'waiting_bill' WHERE id = NEW.table_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS mesa_esperando_cuenta ON public.bill_requests;
CREATE TRIGGER mesa_esperando_cuenta AFTER INSERT ON public.bill_requests
  FOR EACH ROW EXECUTE FUNCTION public.mesa_esperando_cuenta();

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. El comensal ve su mesa con el código del QR (sin exponer las demás).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ver_mesa(_qr_token text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', t.id,
    'number', t.number,
    'name', t.name,
    'zone', t.zone,
    'tenant_id', t.tenant_id,
    'branch_id', t.branch_id,
    'status', t.status,
    'sesion', (
      SELECT jsonb_build_object(
        'id', ts.id, 'opened_at', ts.opened_at, 'total_amount', ts.total_amount,
        'paid_amount', ts.paid_amount, 'tip_amount', ts.tip_amount)
        FROM public.table_sessions ts
       WHERE ts.table_id = t.id AND ts.is_active
    )
  )
    FROM public.tables t
    JOIN public.tenants te ON te.id = t.tenant_id AND te.is_active
   WHERE t.qr_token = _qr_token
     AND char_length(coalesce(_qr_token, '')) > 0
$$;

REVOKE ALL ON FUNCTION public.ver_mesa(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ver_mesa(text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Acciones del personal sobre una mesa.
-- ─────────────────────────────────────────────────────────────────────────────

-- Datos comunes: la mesa (bloqueada), el rol de quien llama y su ficha de personal en ese local.
CREATE OR REPLACE FUNCTION public._mesa_y_actor(_table_id uuid, OUT mesa public.tables, OUT rol text, OUT staff_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Tienes que iniciar sesión' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO mesa FROM public.tables WHERE id = _table_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mesa no encontrada' USING ERRCODE = 'P0002';
  END IF;
  SELECT tm.role INTO rol FROM public.tenant_members tm
   WHERE tm.user_id = auth.uid() AND tm.tenant_id = mesa.tenant_id AND tm.is_active;
  IF rol IS NULL THEN
    RAISE EXCEPTION 'No tienes permiso para este cambio' USING ERRCODE = '42501';
  END IF;
  SELECT s.id INTO staff_id FROM public.staff_users s
   WHERE s.auth_user_id = auth.uid() AND s.tenant_id = mesa.tenant_id AND s.is_active
   ORDER BY s.created_at LIMIT 1;
END;
$$;
REVOKE ALL ON FUNCTION public._mesa_y_actor(uuid) FROM PUBLIC, anon, authenticated;

-- Abrir la mesa (por ejemplo, para un pedido tomado por el mozo). Si ya está abierta, la reutiliza.
CREATE OR REPLACE FUNCTION public.abrir_mesa(_table_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a record;
  sesion uuid;
  nueva boolean := false;
BEGIN
  SELECT * INTO a FROM public._mesa_y_actor(_table_id);
  IF a.rol NOT IN ('owner', 'admin', 'manager', 'cashier', 'waiter') THEN
    RAISE EXCEPTION 'No tienes permiso para este cambio' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO sesion FROM public.table_sessions WHERE table_id = _table_id AND is_active;
  IF sesion IS NULL THEN
    INSERT INTO public.table_sessions (tenant_id, table_id, branch_id, opened_at, is_active, total_amount)
    VALUES ((a.mesa).tenant_id, _table_id, (a.mesa).branch_id, now(), true, 0)
    RETURNING id INTO sesion;
    nueva := true;
  END IF;

  UPDATE public.tables
     SET status = CASE WHEN status = 'free' THEN 'occupied' ELSE status END,
         -- El mozo que abre una mesa sin dueño queda a cargo de ella.
         assigned_waiter_id = CASE WHEN assigned_waiter_id IS NULL AND a.rol = 'waiter' THEN a.staff_id ELSE assigned_waiter_id END
   WHERE id = _table_id;

  IF nueva THEN
    INSERT INTO public.table_events (tenant_id, branch_id, table_id, session_id, accion, actor_user_id, actor_rol)
    VALUES ((a.mesa).tenant_id, (a.mesa).branch_id, _table_id, sesion, 'abrir', auth.uid(), a.rol);
  END IF;

  RETURN jsonb_build_object('session_id', sesion, 'nueva', nueva);
END;
$$;

-- El mozo toma una mesa sin mozo. Una mesa de otro mozo solo se cambia transfiriéndola.
CREATE OR REPLACE FUNCTION public.tomar_mesa(_table_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a record;
  actual text;
BEGIN
  SELECT * INTO a FROM public._mesa_y_actor(_table_id);
  IF a.rol NOT IN ('owner', 'admin', 'manager', 'waiter') OR a.staff_id IS NULL THEN
    RAISE EXCEPTION 'No tienes permiso para este cambio' USING ERRCODE = '42501';
  END IF;
  IF (a.mesa).assigned_waiter_id = a.staff_id THEN
    RETURN jsonb_build_object('assigned_waiter_id', a.staff_id, 'cambio', false);
  END IF;
  IF (a.mesa).assigned_waiter_id IS NOT NULL THEN
    SELECT name INTO actual FROM public.staff_users WHERE id = (a.mesa).assigned_waiter_id;
    RAISE EXCEPTION 'Esta mesa ya la atiende %. Pídele que te la transfiera.', coalesce(actual, 'otro mozo')
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.tables SET assigned_waiter_id = a.staff_id WHERE id = _table_id;
  INSERT INTO public.table_events (tenant_id, branch_id, table_id, session_id, accion, actor_user_id, actor_rol, detalle)
  VALUES ((a.mesa).tenant_id, (a.mesa).branch_id, _table_id,
          (SELECT id FROM public.table_sessions WHERE table_id = _table_id AND is_active),
          'tomar', auth.uid(), a.rol, jsonb_build_object('mozo', a.staff_id));
  RETURN jsonb_build_object('assigned_waiter_id', a.staff_id, 'cambio', true);
END;
$$;

-- Transferir la mesa a otro mozo de la misma sucursal: lo hace el mozo a cargo o un encargado.
CREATE OR REPLACE FUNCTION public.transferir_mesa(_table_id uuid, _staff_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a record;
  destino record;
BEGIN
  SELECT * INTO a FROM public._mesa_y_actor(_table_id);
  IF NOT (a.rol IN ('owner', 'admin', 'manager')
          OR (a.rol = 'waiter' AND a.staff_id IS NOT NULL
              AND ((a.mesa).assigned_waiter_id = a.staff_id OR (a.mesa).assigned_waiter_id IS NULL))) THEN
    RAISE EXCEPTION 'Solo el mozo a cargo o un encargado puede transferir esta mesa' USING ERRCODE = '42501';
  END IF;

  SELECT s.id, s.name INTO destino FROM public.staff_users s
   WHERE s.id = _staff_id AND s.tenant_id = (a.mesa).tenant_id AND s.is_active
     AND s.role IN ('owner', 'admin', 'manager', 'waiter')
     AND (s.branch_id IS NULL OR s.branch_id = (a.mesa).branch_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esa persona no puede atender mesas en esta sucursal' USING ERRCODE = '22023';
  END IF;
  IF (a.mesa).assigned_waiter_id = _staff_id THEN
    RETURN jsonb_build_object('assigned_waiter_id', _staff_id, 'cambio', false);
  END IF;

  UPDATE public.tables SET assigned_waiter_id = _staff_id WHERE id = _table_id;
  INSERT INTO public.table_events (tenant_id, branch_id, table_id, session_id, accion, actor_user_id, actor_rol, detalle)
  VALUES ((a.mesa).tenant_id, (a.mesa).branch_id, _table_id,
          (SELECT id FROM public.table_sessions WHERE table_id = _table_id AND is_active),
          'transferir', auth.uid(), a.rol,
          jsonb_build_object('desde', (a.mesa).assigned_waiter_id, 'hacia', _staff_id));
  RETURN jsonb_build_object('assigned_waiter_id', _staff_id, 'cambio', true, 'nombre', destino.name);
END;
$$;

-- Cerrar la mesa: termina la sesión, entrega lo que ya está listo y deja la mesa libre.
-- Si quedan pedidos sin pagar, solo un encargado (o más) puede cerrar, y con motivo.
CREATE OR REPLACE FUNCTION public.cerrar_mesa(_table_id uuid, _motivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a record;
  sesion uuid;
  sin_pagar integer := 0;
  monto_sin_pagar integer := 0;
  entregados integer := 0;
  pedido record;
  motivo_limpio text := nullif(btrim(coalesce(_motivo, '')), '');
BEGIN
  SELECT * INTO a FROM public._mesa_y_actor(_table_id);
  IF a.rol NOT IN ('owner', 'admin', 'manager', 'cashier', 'waiter') THEN
    RAISE EXCEPTION 'No tienes permiso para este cambio' USING ERRCODE = '42501';
  END IF;
  IF a.rol = 'waiter' AND (a.mesa).assigned_waiter_id IS NOT NULL
     AND (a.mesa).assigned_waiter_id IS DISTINCT FROM a.staff_id THEN
    RAISE EXCEPTION 'Esta mesa la atiende otro mozo' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO sesion FROM public.table_sessions WHERE table_id = _table_id AND is_active FOR UPDATE;

  IF sesion IS NOT NULL THEN
    SELECT count(*), coalesce(sum(total_amount), 0) INTO sin_pagar, monto_sin_pagar
      FROM public.orders
     WHERE session_id = sesion AND status <> 'cancelled'
       AND coalesce(payment_status, 'pending') NOT IN ('paid', 'refunded');

    IF sin_pagar > 0 THEN
      IF a.rol NOT IN ('owner', 'admin', 'manager') THEN
        RAISE EXCEPTION 'La mesa tiene % pedido(s) sin pagar. Cóbralos o pide a un encargado que la cierre.', sin_pagar
          USING ERRCODE = 'P0001';
      END IF;
      IF motivo_limpio IS NULL OR char_length(motivo_limpio) < 3 THEN
        RAISE EXCEPTION 'La mesa tiene pedidos sin pagar: indica el motivo para cerrarla' USING ERRCODE = '22023';
      END IF;
    END IF;

    -- Lo que ya está listo se da por entregado; lo que sigue en cocina, sigue en cocina.
    IF a.rol IN ('owner', 'admin', 'manager', 'waiter') THEN
      FOR pedido IN SELECT id FROM public.orders WHERE session_id = sesion AND status = 'ready' LOOP
        BEGIN
          PERFORM public.cambiar_estado_pedido(pedido.id, 'delivered');
          entregados := entregados + 1;
        EXCEPTION WHEN OTHERS THEN
          NULL; -- si un pedido no se puede entregar, la mesa igual se cierra
        END;
      END LOOP;
    END IF;

    UPDATE public.bill_requests SET status = 'paid', attended_at = coalesce(attended_at, now())
     WHERE session_id = sesion AND status IN ('pending', 'attending');
    UPDATE public.waiter_calls SET status = 'attended'
     WHERE session_id = sesion AND status = 'pending';
    UPDATE public.table_sessions SET is_active = false, closed_at = now() WHERE id = sesion;
  END IF;

  UPDATE public.tables SET status = 'free', assigned_waiter_id = NULL WHERE id = _table_id;

  INSERT INTO public.table_events (tenant_id, branch_id, table_id, session_id, accion, actor_user_id, actor_rol, detalle, motivo)
  VALUES ((a.mesa).tenant_id, (a.mesa).branch_id, _table_id, sesion, 'cerrar', auth.uid(), a.rol,
          jsonb_build_object('pedidos_sin_pagar', sin_pagar, 'monto_sin_pagar', monto_sin_pagar,
                             'pedidos_entregados', entregados),
          motivo_limpio);

  RETURN jsonb_build_object('session_id', sesion, 'pedidos_sin_pagar', sin_pagar,
                            'monto_sin_pagar', monto_sin_pagar, 'pedidos_entregados', entregados);
END;
$$;

-- El comensal califica la mesa donde estuvo (la sesión abierta o una cerrada hace menos de 3 horas).
CREATE OR REPLACE FUNCTION public.calificar_mesa(_qr_token text, _estrellas integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sesion uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Tienes que iniciar sesión' USING ERRCODE = '42501';
  END IF;
  IF _estrellas IS NULL OR _estrellas NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'La calificación va de 1 a 5' USING ERRCODE = '22023';
  END IF;
  SELECT ts.id INTO sesion
    FROM public.comensales_mesa cm
    JOIN public.tables t ON t.id = cm.table_id AND t.qr_token = _qr_token
    JOIN public.table_sessions ts ON ts.id = cm.session_id
   WHERE cm.user_id = auth.uid()
     AND (ts.is_active OR ts.closed_at > now() - interval '3 hours')
   ORDER BY ts.opened_at DESC
   LIMIT 1;
  IF sesion IS NULL THEN
    RAISE EXCEPTION 'No encontramos tu visita a esta mesa' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.table_sessions SET rating = _estrellas WHERE id = sesion;
END;
$$;

REVOKE ALL ON FUNCTION public.abrir_mesa(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tomar_mesa(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.transferir_mesa(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cerrar_mesa(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.calificar_mesa(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.abrir_mesa(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tomar_mesa(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transferir_mesa(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cerrar_mesa(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calificar_mesa(text, integer) TO authenticated;
