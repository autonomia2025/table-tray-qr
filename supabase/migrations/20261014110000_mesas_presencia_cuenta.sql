-- Fase 3.5 — Código de presencia, cuenta abierta controlada y unir mesas.
--
-- 1. Código de presencia (brief 5.1): cada mesa tiene un código de 4 números impreso en la mesa, que
--    prueba que el comensal está ahí y no en su casa con una foto del QR. Por defecto se pide solo
--    para lo que no se paga al pedir (pagar al mozo, agregar a mi cuenta): lo pagado con la app no
--    tiene riesgo y no se le agrega fricción. El local puede pedirlo siempre o nunca. 5 intentos
--    fallidos bloquean 10 minutos (no se puede adivinar probando).
-- 2. Cuenta abierta controlada (brief 4): límite de lo que cada persona puede deber; lo que queda sin
--    pagar al cerrar una mesa se marca como perdido (orders.perdido_at) y queda en la auditoría; el
--    dueño ve cuánto arriesga ahora y cuánto perdió (riesgo_cuenta_abierta).
-- 3. Unir mesas (brief 5.2): un grupo grande junta dos mesas. La secundaria pasa a la sesión de la
--    principal (sus comensales, pedidos y pagos) y su QR lleva a la principal hasta que se separan o se
--    cierra la principal.

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Columnas nuevas
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._codigo_presencia()
RETURNS text LANGUAGE sql VOLATILE SET search_path = public AS $$
  SELECT lpad((floor(random() * 10000))::integer::text, 4, '0')
$$;
REVOKE ALL ON FUNCTION public._codigo_presencia() FROM PUBLIC, anon, authenticated;

-- Los códigos viven en su propia tabla: el comensal puede leer la fila de su mesa (fase 1.5), así que
-- el código no puede estar ahí. Solo el personal del local lo lee (el mozo se lo dice al cliente).
CREATE TABLE IF NOT EXISTS public.codigos_mesa (
  table_id uuid PRIMARY KEY REFERENCES public.tables(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  codigo text NOT NULL DEFAULT public._codigo_presencia() CHECK (codigo ~ '^[0-9]{4}$'),
  cambiado_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.codigos_mesa ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.codigos_mesa FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.codigos_mesa FROM authenticated;
GRANT SELECT ON public.codigos_mesa TO authenticated;
GRANT ALL ON public.codigos_mesa TO service_role;
DROP POLICY IF EXISTS codigos_mesa_personal ON public.codigos_mesa;
CREATE POLICY codigos_mesa_personal ON public.codigos_mesa FOR SELECT TO authenticated
  USING (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager', 'cashier', 'waiter']) OR public.is_platform_admin());
INSERT INTO public.codigos_mesa (table_id, tenant_id, branch_id)
SELECT id, tenant_id, branch_id FROM public.tables ON CONFLICT (table_id) DO NOTHING;

-- Cada mesa nueva recibe su código
CREATE OR REPLACE FUNCTION public.crear_codigo_mesa()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.codigos_mesa (table_id, tenant_id, branch_id) VALUES (NEW.id, NEW.tenant_id, NEW.branch_id)
  ON CONFLICT (table_id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.crear_codigo_mesa() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS crear_codigo_mesa ON public.tables;
CREATE TRIGGER crear_codigo_mesa AFTER INSERT ON public.tables
  FOR EACH ROW EXECUTE FUNCTION public.crear_codigo_mesa();

ALTER TABLE public.tables ADD COLUMN IF NOT EXISTS unida_a uuid REFERENCES public.tables(id) ON DELETE SET NULL;
ALTER TABLE public.tables DROP CONSTRAINT IF EXISTS tables_unida_a_check;
ALTER TABLE public.tables ADD CONSTRAINT tables_unida_a_check CHECK (unida_a IS NULL OR unida_a <> id);

ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS pedir_codigo text NOT NULL DEFAULT 'sin_pagar';
ALTER TABLE public.branches DROP CONSTRAINT IF EXISTS branches_pedir_codigo_check;
ALTER TABLE public.branches ADD CONSTRAINT branches_pedir_codigo_check CHECK (pedir_codigo IN ('nunca', 'sin_pagar', 'siempre'));
ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS limite_cuenta_persona integer NOT NULL DEFAULT 30000;
ALTER TABLE public.branches DROP CONSTRAINT IF EXISTS branches_limite_cuenta_check;
ALTER TABLE public.branches ADD CONSTRAINT branches_limite_cuenta_check CHECK (limite_cuenta_persona BETWEEN 0 AND 2000000);
-- Los cambia el dueño o el administrador (la sucursal solo deja cambiar columnas listadas)
GRANT UPDATE (pedir_codigo, limite_cuenta_persona) ON public.branches TO authenticated;

ALTER TABLE public.comensales_mesa ADD COLUMN IF NOT EXISTS presencia_ok_at timestamptz;
ALTER TABLE public.comensales_mesa ADD COLUMN IF NOT EXISTS intentos_codigo integer NOT NULL DEFAULT 0;
ALTER TABLE public.comensales_mesa ADD COLUMN IF NOT EXISTS codigo_bloqueado_hasta timestamptz;

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS perdido_at timestamptz;

-- El registro de la mesa también anota uniones y separaciones
ALTER TABLE public.table_events DROP CONSTRAINT IF EXISTS table_events_accion_check;
ALTER TABLE public.table_events ADD CONSTRAINT table_events_accion_check
  CHECK (accion IN ('abrir', 'tomar', 'transferir', 'cerrar', 'unir', 'separar'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. La mesa de un QR (si está unida a otra, la principal)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._mesa_del_qr(_qr_token text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(t.unida_a, t.id) FROM public.tables t WHERE t.qr_token = _qr_token
$$;
REVOKE ALL ON FUNCTION public._mesa_del_qr(text) FROM PUBLIC, anon, authenticated;

-- Las entradas del comensal (ver la mesa, unirse, actuar en ella y cotizar) pasan por la mesa
-- principal. Todas buscaban la mesa con el mismo filtro; se cambia en un solo paso y se comprueba.
DO $$
DECLARE
  f text;
  def text;
  nuevo text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.ver_mesa(text)', 'public.unirse_a_mesa(text,text)', 'public._comensal_en_mesa(text)',
    'public.crear_cotizacion(uuid,text,jsonb,uuid[],text)'
  ] LOOP
    SELECT pg_get_functiondef(f::regprocedure) INTO def;
    nuevo := replace(def, 't.qr_token = _qr_token', 't.id = public._mesa_del_qr(_qr_token)');
    IF nuevo = def THEN
      RAISE EXCEPTION 'No se encontró el filtro de mesa en %', f;
    END IF;
    EXECUTE nuevo;
  END LOOP;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Código de presencia
-- ─────────────────────────────────────────────────────────────────────────────
-- Qué pide este local y si yo ya lo ingresé
CREATE OR REPLACE FUNCTION public.estado_presencia(_qr_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  pide text;
BEGIN
  SELECT * INTO c FROM public._comensal_en_mesa(_qr_token);
  SELECT pedir_codigo INTO pide FROM public.branches WHERE id = (c.mesa).branch_id;
  RETURN jsonb_build_object(
    'pide', pide,
    'confirmado', EXISTS (SELECT 1 FROM public.comensales_mesa
                           WHERE session_id = c.sesion AND user_id = auth.uid() AND presencia_ok_at IS NOT NULL));
END;
$$;
REVOKE ALL ON FUNCTION public.estado_presencia(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.estado_presencia(text) TO authenticated;

-- Ingresar el código impreso en la mesa (la mesa física que escaneó, aunque esté unida a otra)
CREATE OR REPLACE FUNCTION public.confirmar_presencia(_qr_token text, _codigo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  codigo_mesa text;
  cm public.comensales_mesa;
BEGIN
  SELECT * INTO c FROM public._comensal_en_mesa(_qr_token);
  SELECT cmz.codigo INTO codigo_mesa FROM public.codigos_mesa cmz JOIN public.tables t ON t.id = cmz.table_id
   WHERE t.qr_token = _qr_token;
  SELECT * INTO cm FROM public.comensales_mesa WHERE session_id = c.sesion AND user_id = auth.uid() FOR UPDATE;

  IF cm.codigo_bloqueado_hasta > now() THEN
    RETURN jsonb_build_object('ok', false, 'bloqueado', true,
      'mensaje', 'Demasiados intentos. Espera unos minutos o pídele el código al mozo.');
  END IF;

  IF btrim(coalesce(_codigo, '')) = codigo_mesa THEN
    UPDATE public.comensales_mesa SET presencia_ok_at = now(), intentos_codigo = 0, codigo_bloqueado_hasta = NULL
     WHERE id = cm.id;
    RETURN jsonb_build_object('ok', true);
  END IF;

  -- Fallido: se cuenta (sin lanzar error, para que el conteo quede guardado)
  UPDATE public.comensales_mesa
     SET intentos_codigo = CASE WHEN cm.intentos_codigo + 1 >= 5 THEN 0 ELSE cm.intentos_codigo + 1 END,
         codigo_bloqueado_hasta = CASE WHEN cm.intentos_codigo + 1 >= 5 THEN now() + interval '10 minutes' END
   WHERE id = cm.id;
  RETURN jsonb_build_object('ok', false, 'bloqueado', cm.intentos_codigo + 1 >= 5,
    'mensaje', CASE WHEN cm.intentos_codigo + 1 >= 5
                    THEN 'Demasiados intentos. Espera unos minutos o pídele el código al mozo.'
                    ELSE 'Ese no es el código de tu mesa. Está impreso en la mesa, junto al QR.' END);
END;
$$;
REVOKE ALL ON FUNCTION public.confirmar_presencia(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirmar_presencia(text, text) TO authenticated;

-- ¿Esta persona ya probó que está en la mesa?
CREATE OR REPLACE FUNCTION public._presente(_session_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.comensales_mesa
                  WHERE session_id = _session_id AND user_id = _user_id AND presencia_ok_at IS NOT NULL)
$$;
REVOKE ALL ON FUNCTION public._presente(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Pedidos del comensal sin pagar (pagar al mozo, agregar a mi cuenta): código y límite de la cuenta
CREATE OR REPLACE FUNCTION public.controlar_pedido_sin_pagar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b public.branches;
  debe integer;
BEGIN
  -- Solo pedidos del comensal sin pagar (los pagados con la app llegan sin forma_pago: la anota otro disparador)
  IF coalesce(NEW.source, '') <> 'customer_qr' OR coalesce(NEW.forma_pago, 'app') NOT IN ('mozo', 'cuenta') OR NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO b FROM public.branches WHERE id = NEW.branch_id;
  IF b.pedir_codigo IN ('sin_pagar', 'siempre') AND NOT public._presente(NEW.session_id, NEW.user_id) THEN
    RAISE EXCEPTION 'Ingresa el código de 4 números que está en tu mesa' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.forma_pago = 'cuenta' AND b.limite_cuenta_persona > 0 THEN
    SELECT coalesce(sum(total_amount), 0) INTO debe FROM public.orders
     WHERE session_id = NEW.session_id AND user_id = NEW.user_id AND forma_pago = 'cuenta'
       AND coalesce(payment_status, 'unpaid') = 'unpaid' AND status <> 'cancelled';
    IF debe + coalesce(NEW.total_amount, 0) > b.limite_cuenta_persona THEN
      RAISE EXCEPTION 'Tu cuenta llegó al máximo de $% para esta visita: paga lo que llevas para seguir pidiendo',
        to_char(b.limite_cuenta_persona, 'FM999G999G999') USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.controlar_pedido_sin_pagar() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS controlar_pedido_sin_pagar ON public.orders;
CREATE TRIGGER controlar_pedido_sin_pagar BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.controlar_pedido_sin_pagar();

-- Si el local pide el código siempre, también para pagar con la app
CREATE OR REPLACE FUNCTION public.controlar_presencia_cotizacion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sesion uuid;
BEGIN
  IF (SELECT pedir_codigo FROM public.branches WHERE id = NEW.branch_id) = 'siempre' THEN
    SELECT id INTO sesion FROM public.table_sessions WHERE table_id = NEW.table_id AND is_active;
    IF NOT public._presente(sesion, NEW.user_id) THEN
      RAISE EXCEPTION 'Ingresa el código de 4 números que está en tu mesa' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.controlar_presencia_cotizacion() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS controlar_presencia_cotizacion ON public.cotizaciones;
CREATE TRIGGER controlar_presencia_cotizacion BEFORE INSERT ON public.cotizaciones
  FOR EACH ROW EXECUTE FUNCTION public.controlar_presencia_cotizacion();

-- El encargado cambia los códigos (por ejemplo, al reimprimir las tarjetas)
CREATE OR REPLACE FUNCTION public.cambiar_codigos_mesa(_branch_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  local uuid;
  n integer;
BEGIN
  SELECT tenant_id INTO local FROM public.branches WHERE id = _branch_id;
  IF local IS NULL OR NOT (public.tiene_rol(local, ARRAY['owner', 'admin', 'manager']) OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'No tienes permiso para este cambio' USING ERRCODE = '42501';
  END IF;
  UPDATE public.codigos_mesa SET codigo = public._codigo_presencia(), cambiado_at = now() WHERE branch_id = _branch_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (local, auth.uid(), 'cambiar_codigos_mesa', 'branch', _branch_id, jsonb_build_object('mesas', n));
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.cambiar_codigos_mesa(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cambiar_codigos_mesa(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Cuenta abierta: lo que queda sin pagar al cerrar es una pérdida, y queda registrado
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.marcar_perdidas()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
  monto integer;
BEGIN
  IF OLD.is_active AND NOT NEW.is_active THEN
    WITH m AS (
      UPDATE public.orders SET perdido_at = now()
       WHERE session_id = NEW.id AND status <> 'cancelled' AND perdido_at IS NULL
         AND coalesce(payment_status, 'unpaid') NOT IN ('paid', 'refunded')
      RETURNING total_amount)
    SELECT count(*), coalesce(sum(total_amount), 0) INTO n, monto FROM m;
    IF n > 0 THEN
      INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
      VALUES (NEW.tenant_id, auth.uid(), 'mesa_sin_pagar', 'table_session', NEW.id,
              jsonb_build_object('pedidos', n, 'monto', monto, 'table_id', NEW.table_id));
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.marcar_perdidas() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS marcar_perdidas ON public.table_sessions;
CREATE TRIGGER marcar_perdidas AFTER UPDATE OF is_active ON public.table_sessions
  FOR EACH ROW EXECUTE FUNCTION public.marcar_perdidas();

-- Cuánto arriesga el local ahora y cuánto perdió (dueño, administrador, encargado, caja)
CREATE OR REPLACE FUNCTION public.riesgo_cuenta_abierta(_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  hoy date;
  v record;
BEGIN
  PERFORM public._tenant_caja(_branch_id);
  hoy := public.dia_negocio(_branch_id, now());
  SELECT * INTO v FROM public._ventana_dias(_branch_id, hoy - 29, hoy);
  RETURN jsonb_build_object(
    'modo', (SELECT payment_mode FROM public.branches WHERE id = _branch_id),
    'limite_persona', (SELECT limite_cuenta_persona FROM public.branches WHERE id = _branch_id),
    'en_riesgo', (
      SELECT jsonb_build_object('monto', coalesce(sum(o.total_amount), 0), 'pedidos', count(*),
                                'mesas', count(DISTINCT o.session_id))
        FROM public.orders o JOIN public.table_sessions s ON s.id = o.session_id AND s.is_active
       WHERE o.branch_id = _branch_id AND o.status <> 'cancelled'
         AND coalesce(o.payment_status, 'unpaid') = 'unpaid' AND o.forma_pago IN ('cuenta', 'mozo')),
    'perdido_30_dias', (
      SELECT jsonb_build_object('monto', coalesce(sum(total_amount), 0), 'pedidos', count(*), 'mesas', count(DISTINCT session_id))
        FROM public.orders WHERE branch_id = _branch_id AND perdido_at >= v.desde AND perdido_at < v.hasta),
    'ultimas_perdidas', coalesce((
      SELECT jsonb_agg(x ORDER BY x.cuando DESC) FROM (
        SELECT max(o.perdido_at) AS cuando, t.number AS mesa, sum(o.total_amount) AS monto, count(*) AS pedidos,
               (SELECT e.motivo FROM public.table_events e WHERE e.session_id = o.session_id AND e.accion = 'cerrar'
                 ORDER BY e.created_at DESC LIMIT 1) AS motivo
          FROM public.orders o JOIN public.tables t ON t.id = o.table_id
         WHERE o.branch_id = _branch_id AND o.perdido_at >= v.desde AND o.perdido_at < v.hasta
         GROUP BY o.session_id, t.number
         ORDER BY max(o.perdido_at) DESC LIMIT 10) x), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.riesgo_cuenta_abierta(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.riesgo_cuenta_abierta(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Unir y separar mesas
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.unir_mesas(_principal uuid, _secundaria uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a record;
  p public.tables;
  s public.tables;
  s1 uuid;
  s2 record;
BEGIN
  IF _principal = _secundaria THEN
    RAISE EXCEPTION 'Elige otra mesa para unir' USING ERRCODE = 'P0001';
  END IF;
  -- Bloqueo en orden fijo (evita que dos uniones cruzadas se traben)
  PERFORM 1 FROM public.tables WHERE id IN (_principal, _secundaria) ORDER BY id FOR UPDATE;
  SELECT * INTO a FROM public._mesa_y_actor(_principal);
  p := a.mesa;
  SELECT * INTO s FROM public.tables WHERE id = _secundaria;
  IF NOT FOUND OR s.branch_id <> p.branch_id THEN
    RAISE EXCEPTION 'Las mesas tienen que ser de la misma sucursal' USING ERRCODE = 'P0001';
  END IF;
  IF a.rol NOT IN ('owner', 'admin', 'manager', 'waiter')
     OR (a.rol = 'waiter' AND ((p.assigned_waiter_id IS NOT NULL AND p.assigned_waiter_id IS DISTINCT FROM a.staff_id)
                            OR (s.assigned_waiter_id IS NOT NULL AND s.assigned_waiter_id IS DISTINCT FROM a.staff_id))) THEN
    RAISE EXCEPTION 'Solo el mozo a cargo de las dos mesas o un encargado puede unirlas' USING ERRCODE = '42501';
  END IF;
  IF p.unida_a IS NOT NULL OR s.unida_a IS NOT NULL THEN
    RAISE EXCEPTION 'Una de las mesas ya está unida a otra' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tables WHERE unida_a = _secundaria) THEN
    RAISE EXCEPTION 'La mesa % tiene otras mesas unidas: únelas a la principal directamente', s.number USING ERRCODE = 'P0001';
  END IF;

  -- La sesión de la principal (se abre si no había)
  SELECT id INTO s1 FROM public.table_sessions WHERE table_id = p.id AND is_active;
  IF s1 IS NULL THEN
    INSERT INTO public.table_sessions (tenant_id, table_id, branch_id, opened_at, is_active, total_amount)
    VALUES (p.tenant_id, p.id, p.branch_id, now(), true, 0) RETURNING id INTO s1;
  END IF;

  -- Lo que ya pasaba en la secundaria se muda a la principal
  SELECT * INTO s2 FROM public.table_sessions WHERE table_id = s.id AND is_active FOR UPDATE;
  IF FOUND THEN
    INSERT INTO public.comensales_mesa (tenant_id, branch_id, table_id, session_id, user_id, alias, presencia_ok_at)
    SELECT tenant_id, branch_id, p.id, s1, user_id, alias, presencia_ok_at FROM public.comensales_mesa WHERE session_id = s2.id
    ON CONFLICT (session_id, user_id) DO NOTHING;
    UPDATE public.orders SET session_id = s1 WHERE session_id = s2.id;
    UPDATE public.payments SET session_id = s1 WHERE session_id = s2.id;
    UPDATE public.waiter_calls SET session_id = s1 WHERE session_id = s2.id;
    UPDATE public.bill_requests SET session_id = s1 WHERE session_id = s2.id;
    UPDATE public.table_sessions
       SET paid_amount = coalesce(paid_amount, 0) + coalesce(s2.paid_amount, 0),
           tip_amount = coalesce(tip_amount, 0) + coalesce(s2.tip_amount, 0)
     WHERE id = s1;
    UPDATE public.table_sessions SET is_active = false, closed_at = now() WHERE id = s2.id;
  END IF;

  UPDATE public.tables SET status = CASE WHEN status = 'free' THEN 'occupied' ELSE status END,
         assigned_waiter_id = coalesce(assigned_waiter_id, s.assigned_waiter_id, CASE WHEN a.rol = 'waiter' THEN a.staff_id END)
   WHERE id = p.id;
  UPDATE public.tables SET unida_a = p.id, status = 'occupied',
         assigned_waiter_id = (SELECT assigned_waiter_id FROM public.tables WHERE id = p.id)
   WHERE id = s.id;

  INSERT INTO public.table_events (tenant_id, branch_id, table_id, session_id, accion, actor_user_id, actor_rol, detalle)
  VALUES (p.tenant_id, p.branch_id, p.id, s1, 'unir', auth.uid(), a.rol, jsonb_build_object('principal', p.number, 'secundaria', s.number)),
         (p.tenant_id, p.branch_id, s.id, s1, 'unir', auth.uid(), a.rol, jsonb_build_object('principal', p.number, 'secundaria', s.number));
  RETURN jsonb_build_object('session_id', s1, 'principal', p.number, 'secundaria', s.number);
END;
$$;
REVOKE ALL ON FUNCTION public.unir_mesas(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unir_mesas(uuid, uuid) TO authenticated;

-- Separar: la secundaria vuelve a ser una mesa libre (lo ya pedido queda en la cuenta de la principal)
CREATE OR REPLACE FUNCTION public.separar_mesa(_secundaria uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a record;
  principal public.tables;
BEGIN
  SELECT * INTO a FROM public._mesa_y_actor(_secundaria);
  IF (a.mesa).unida_a IS NULL THEN
    RAISE EXCEPTION 'Esta mesa no está unida a otra' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO principal FROM public.tables WHERE id = (a.mesa).unida_a;
  IF a.rol NOT IN ('owner', 'admin', 'manager', 'waiter')
     OR (a.rol = 'waiter' AND principal.assigned_waiter_id IS NOT NULL AND principal.assigned_waiter_id IS DISTINCT FROM a.staff_id) THEN
    RAISE EXCEPTION 'Solo el mozo a cargo o un encargado puede separar la mesa' USING ERRCODE = '42501';
  END IF;
  UPDATE public.tables SET unida_a = NULL, status = 'free', assigned_waiter_id = NULL WHERE id = _secundaria;
  INSERT INTO public.table_events (tenant_id, branch_id, table_id, accion, actor_user_id, actor_rol, detalle)
  VALUES ((a.mesa).tenant_id, (a.mesa).branch_id, _secundaria, 'separar', auth.uid(), a.rol,
          jsonb_build_object('principal', principal.number, 'secundaria', (a.mesa).number));
  RETURN jsonb_build_object('separada', (a.mesa).number);
END;
$$;
REVOKE ALL ON FUNCTION public.separar_mesa(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.separar_mesa(uuid) TO authenticated;

-- Al liberar la principal (se cierra la mesa), sus mesas unidas también quedan libres
CREATE OR REPLACE FUNCTION public.liberar_unidas()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'free' AND OLD.status IS DISTINCT FROM 'free' THEN
    UPDATE public.tables SET unida_a = NULL, status = 'free', assigned_waiter_id = NULL WHERE unida_a = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.liberar_unidas() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS liberar_unidas ON public.tables;
CREATE TRIGGER liberar_unidas AFTER UPDATE OF status ON public.tables
  FOR EACH ROW EXECUTE FUNCTION public.liberar_unidas();

-- Una mesa unida que se cierra por su cuenta se separa
CREATE OR REPLACE FUNCTION public.separar_al_liberar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'free' THEN
    NEW.unida_a := NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.separar_al_liberar() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS separar_al_liberar ON public.tables;
CREATE TRIGGER separar_al_liberar BEFORE UPDATE OF status ON public.tables
  FOR EACH ROW EXECUTE FUNCTION public.separar_al_liberar();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Reinicio del demo: separa las mesas unidas
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  def text;
BEGIN
  SELECT pg_get_functiondef('public.reiniciar_demo()'::regprocedure) INTO def;
  IF position('unida_a' IN def) = 0 THEN
    def := replace(def, 'DELETE FROM public.turnos WHERE tenant_id = demo;',
                   'DELETE FROM public.turnos WHERE tenant_id = demo;
  UPDATE public.tables SET unida_a = NULL WHERE tenant_id = demo;');
    EXECUTE def;
  END IF;
END;
$$;
