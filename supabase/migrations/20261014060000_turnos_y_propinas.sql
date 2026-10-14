-- Fase 3.1 — Turnos de mozo y propina para el mozo que tomó la mesa.
-- Decisión del fundador (14 de octubre de 2026): la propina es del mozo que tomó la mesa; el cliente no
-- elige. Antes:
--   · si el cliente pagaba con la app antes de que un mozo tomara la mesa, la propina quedaba sin dueño;
--   · si la caja cobraba en efectivo una mesa de un mozo, la propina quedaba a nombre de la caja;
--   · no existían los turnos (brief 6.1: cada mozo abre y cierra su turno, con inicio, fin y duración).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Turnos
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.turnos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.staff_users(id) ON DELETE CASCADE,
  inicio timestamptz NOT NULL DEFAULT now(),
  fin timestamptz,
  -- Quién lo abrió o cerró: el propio mozo, un encargado o el sistema (al tomar una mesa sin turno)
  abierto_por text NOT NULL DEFAULT 'mozo' CHECK (abierto_por IN ('mozo', 'automatico')),
  cerrado_por text CHECK (cerrado_por IS NULL OR cerrado_por IN ('mozo', 'encargado')),
  cerrado_por_user uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  nota text CHECK (nota IS NULL OR char_length(nota) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (fin IS NULL OR fin >= inicio)
);
-- Un solo turno abierto por persona
CREATE UNIQUE INDEX IF NOT EXISTS turnos_uno_abierto_uidx ON public.turnos (staff_id) WHERE fin IS NULL;
CREATE INDEX IF NOT EXISTS turnos_sucursal_inicio_idx ON public.turnos (branch_id, inicio DESC);

ALTER TABLE public.turnos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.turnos FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.turnos FROM authenticated;
GRANT SELECT ON public.turnos TO authenticated;
GRANT ALL ON public.turnos TO service_role;
DROP POLICY IF EXISTS turnos_lectura ON public.turnos;
CREATE POLICY turnos_lectura ON public.turnos FOR SELECT TO authenticated
  USING (
    public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager', 'cashier'])
    OR public.is_platform_admin()
    OR EXISTS (SELECT 1 FROM public.staff_users s WHERE s.id = turnos.staff_id AND s.auth_user_id = auth.uid())
  );

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS turno_id uuid REFERENCES public.turnos(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS payments_turno_idx ON public.payments (turno_id);

CREATE OR REPLACE FUNCTION public._turno_abierto(_staff_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.turnos WHERE staff_id = _staff_id AND fin IS NULL
$$;
REVOKE ALL ON FUNCTION public._turno_abierto(uuid) FROM PUBLIC, anon, authenticated;

-- Mi ficha de personal en un local (la más antigua si hubiera varias).
CREATE OR REPLACE FUNCTION public._mi_ficha(_tenant_id uuid)
RETURNS public.staff_users
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.* FROM public.staff_users s
   WHERE s.auth_user_id = auth.uid() AND s.tenant_id = _tenant_id AND s.is_active
   ORDER BY s.created_at LIMIT 1
$$;
REVOKE ALL ON FUNCTION public._mi_ficha(uuid) FROM PUBLIC, anon, authenticated;

-- Empezar mi turno. Si ya tengo uno abierto, lo devuelve (un doble toque no abre dos).
CREATE OR REPLACE FUNCTION public.abrir_turno(_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  local uuid;
  ficha public.staff_users;
  turno uuid;
BEGIN
  SELECT tenant_id INTO local FROM public.branches WHERE id = _branch_id;
  IF local IS NULL THEN
    RAISE EXCEPTION 'Sucursal no encontrada' USING ERRCODE = 'P0002';
  END IF;
  ficha := public._mi_ficha(local);
  IF ficha.id IS NULL OR NOT public.tiene_rol(local, ARRAY['owner', 'admin', 'manager', 'cashier', 'waiter']) THEN
    RAISE EXCEPTION 'No tienes permiso para este cambio' USING ERRCODE = '42501';
  END IF;
  turno := public._turno_abierto(ficha.id);
  IF turno IS NOT NULL THEN
    RETURN jsonb_build_object('turno_id', turno, 'nuevo', false);
  END IF;
  BEGIN
    INSERT INTO public.turnos (tenant_id, branch_id, staff_id) VALUES (local, _branch_id, ficha.id)
    RETURNING id INTO turno;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('turno_id', public._turno_abierto(ficha.id), 'nuevo', false);
  END;
  RETURN jsonb_build_object('turno_id', turno, 'nuevo', true);
END;
$$;
REVOKE ALL ON FUNCTION public.abrir_turno(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.abrir_turno(uuid) TO authenticated;

-- Terminar un turno. Sin id: el mío (no puedo dejar mesas a mi nombre). Con id: un encargado cierra el
-- turno de otra persona (por ejemplo, si se olvidó), con nota; queda en la auditoría.
CREATE OR REPLACE FUNCTION public.cerrar_turno(_turno_id uuid DEFAULT NULL, _nota text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.turnos;
  propio boolean;
  mesas integer;
  nota_limpia text := nullif(btrim(coalesce(_nota, '')), '');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Tienes que iniciar sesión' USING ERRCODE = '42501';
  END IF;
  IF _turno_id IS NULL THEN
    SELECT tu.* INTO t FROM public.turnos tu JOIN public.staff_users s ON s.id = tu.staff_id
     WHERE s.auth_user_id = auth.uid() AND tu.fin IS NULL
     ORDER BY tu.inicio LIMIT 1 FOR UPDATE OF tu;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'No tienes un turno abierto' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    SELECT * INTO t FROM public.turnos WHERE id = _turno_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Turno no encontrado' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  propio := EXISTS (SELECT 1 FROM public.staff_users s WHERE s.id = t.staff_id AND s.auth_user_id = auth.uid());
  IF NOT propio AND NOT (public.tiene_rol(t.tenant_id, ARRAY['owner', 'admin', 'manager']) OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Solo un encargado puede cerrar el turno de otra persona' USING ERRCODE = '42501';
  END IF;
  IF t.fin IS NOT NULL THEN
    RAISE EXCEPTION 'Ese turno ya está cerrado' USING ERRCODE = 'P0001';
  END IF;

  IF propio THEN
    SELECT count(*) INTO mesas FROM public.tables WHERE assigned_waiter_id = t.staff_id AND status <> 'free';
    IF mesas > 0 THEN
      RAISE EXCEPTION 'Todavía tienes % a tu cargo: transfiérelas o ciérralas antes de terminar tu turno',
        CASE WHEN mesas = 1 THEN '1 mesa' ELSE mesas || ' mesas' END USING ERRCODE = 'P0001';
    END IF;
  ELSIF nota_limpia IS NULL OR char_length(nota_limpia) < 5 THEN
    RAISE EXCEPTION 'Indica por qué cierras el turno de otra persona' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.turnos
     SET fin = now(), cerrado_por = CASE WHEN propio THEN 'mozo' ELSE 'encargado' END,
         cerrado_por_user = auth.uid(), nota = left(nota_limpia, 300)
   WHERE id = t.id;

  IF NOT propio THEN
    INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
    VALUES (t.tenant_id, auth.uid(), 'cerrar_turno_ajeno', 'turno', t.id,
            jsonb_build_object('staff_id', t.staff_id, 'nota', nota_limpia));
  END IF;

  RETURN public._resumen_turno(t.id);
END;
$$;

-- Lo que hizo un turno: duración, mesas tomadas, pagos, ventas y propinas (netas de reembolsos).
CREATE OR REPLACE FUNCTION public._resumen_turno(_turno_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'turno_id', t.id, 'staff_id', t.staff_id, 'nombre', s.name, 'branch_id', t.branch_id,
    'inicio', t.inicio, 'fin', t.fin, 'abierto_por', t.abierto_por, 'cerrado_por', t.cerrado_por, 'nota', t.nota,
    'minutos', floor(extract(epoch FROM (coalesce(t.fin, now()) - t.inicio)) / 60)::integer,
    'mesas', (SELECT count(DISTINCT e.session_id) FROM public.table_events e
               WHERE e.accion IN ('tomar', 'abrir', 'transferir') AND e.table_id IN (SELECT id FROM public.tables WHERE branch_id = t.branch_id)
                 AND e.created_at >= t.inicio AND e.created_at < coalesce(t.fin, now())
                 AND (e.detalle ->> 'mozo' = t.staff_id::text OR e.detalle ->> 'hacia' = t.staff_id::text
                      OR (e.accion = 'abrir' AND e.actor_user_id = s.auth_user_id))),
    'pagos', (SELECT count(*) FROM public.payments p WHERE p.turno_id = t.id AND p.status <> 'failed'),
    'ventas', (SELECT coalesce(sum(p.amount), 0) FROM public.payments p WHERE p.turno_id = t.id AND p.status <> 'failed'),
    'propinas', (SELECT coalesce(sum(greatest(0, p.tip_amount - greatest(0, coalesce(p.refunded_amount, 0) - p.amount))), 0)
                   FROM public.payments p WHERE p.turno_id = t.id AND p.status <> 'failed'),
    'propinas_efectivo', (SELECT coalesce(sum(greatest(0, p.tip_amount - greatest(0, coalesce(p.refunded_amount, 0) - p.amount))), 0)
                   FROM public.payments p WHERE p.turno_id = t.id AND p.status <> 'failed' AND p.provider = 'local' AND p.method = 'cash'))
  FROM public.turnos t JOIN public.staff_users s ON s.id = t.staff_id
  WHERE t.id = _turno_id
$$;
REVOKE ALL ON FUNCTION public._resumen_turno(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cerrar_turno(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cerrar_turno(uuid, text) TO authenticated;

-- Mi turno ahora (para la pantalla del mozo): null si no tengo uno abierto.
CREATE OR REPLACE FUNCTION public.mi_turno(_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ficha public.staff_users;
  turno uuid;
BEGIN
  ficha := public._mi_ficha((SELECT tenant_id FROM public.branches WHERE id = _branch_id));
  IF ficha.id IS NULL THEN
    RETURN NULL;
  END IF;
  turno := public._turno_abierto(ficha.id);
  RETURN CASE WHEN turno IS NULL THEN NULL ELSE public._resumen_turno(turno) END;
END;
$$;
REVOKE ALL ON FUNCTION public.mi_turno(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mi_turno(uuid) TO authenticated;

-- Turnos de una sucursal entre dos días de negocio (dueño, administrador, encargado, caja).
CREATE OR REPLACE FUNCTION public.turnos_sucursal(_branch_id uuid, _desde date, _hasta date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  corte time;
BEGIN
  PERFORM public._tenant_caja(_branch_id);
  IF _hasta < _desde OR _hasta - _desde > 62 THEN
    RAISE EXCEPTION 'Elige un período de hasta dos meses' USING ERRCODE = 'P0001';
  END IF;
  SELECT corte_dia INTO corte FROM public.branches WHERE id = _branch_id;
  RETURN coalesce((
    SELECT jsonb_agg(public._resumen_turno(t.id) ORDER BY t.inicio DESC)
      FROM public.turnos t
     WHERE t.branch_id = _branch_id
       AND t.inicio >= (_desde + corte) AT TIME ZONE 'America/Santiago'
       AND t.inicio < (_hasta + 1 + corte) AT TIME ZONE 'America/Santiago'
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.turnos_sucursal(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.turnos_sucursal(uuid, date, date) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. La propina es del mozo que tomó la mesa
-- ─────────────────────────────────────────────────────────────────────────────
-- Al guardar un pago: el mozo de la mesa (aunque cobre la caja). Si la mesa no tiene mozo, solo queda
-- a nombre de quien cobró si es mozo; si cobró la caja o pagó el cliente con la app, queda pendiente y
-- se asigna al primer mozo que tome la mesa (ver al_asignar_mozo).
CREATE OR REPLACE FUNCTION public.atribuir_propina()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  mozo uuid;
BEGIN
  IF NEW.table_id IS NOT NULL THEN
    SELECT assigned_waiter_id INTO mozo FROM public.tables WHERE id = NEW.table_id;
  END IF;
  IF mozo IS NOT NULL THEN
    NEW.staff_id := mozo;
  ELSIF NEW.staff_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.staff_users WHERE id = NEW.staff_id AND role = 'waiter') THEN
    NEW.staff_id := NULL;
  END IF;
  NEW.turno_id := CASE WHEN NEW.staff_id IS NULL THEN NULL ELSE public._turno_abierto(NEW.staff_id) END;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.atribuir_propina() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS atribuir_propina ON public.payments;
CREATE TRIGGER atribuir_propina BEFORE INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.atribuir_propina();

-- Cuando un mozo queda a cargo de una mesa:
--   · si fue él mismo (tomar o abrir) y no tenía turno, se le abre uno solo;
--   · los pagos de esta visita que no tenían mozo pasan a ser suyos (en una transferencia, lo que ya
--     tenía dueño queda con el mozo anterior). No se toca lo de un día de caja ya cerrado.
CREATE OR REPLACE FUNCTION public.al_asignar_mozo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ficha public.staff_users;
  turno uuid;
  sesion uuid;
BEGIN
  SELECT * INTO ficha FROM public.staff_users WHERE id = NEW.assigned_waiter_id;
  turno := public._turno_abierto(NEW.assigned_waiter_id);
  IF turno IS NULL AND ficha.auth_user_id = auth.uid() AND ficha.role = 'waiter' THEN
    BEGIN
      INSERT INTO public.turnos (tenant_id, branch_id, staff_id, abierto_por)
      VALUES (NEW.tenant_id, NEW.branch_id, NEW.assigned_waiter_id, 'automatico')
      RETURNING id INTO turno;
    EXCEPTION WHEN unique_violation THEN
      turno := public._turno_abierto(NEW.assigned_waiter_id);
    END;
  END IF;

  SELECT id INTO sesion FROM public.table_sessions WHERE table_id = NEW.id AND is_active;
  IF sesion IS NOT NULL AND ficha.role = 'waiter' THEN
    UPDATE public.payments p
       SET staff_id = NEW.assigned_waiter_id, turno_id = turno
     WHERE p.session_id = sesion AND p.staff_id IS NULL AND p.status <> 'failed'
       AND NOT EXISTS (SELECT 1 FROM public.payment_settlements s
                        WHERE s.branch_id = p.branch_id AND s.settlement_date = p.dia_negocio AND s.status = 'closed');
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.al_asignar_mozo() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS al_asignar_mozo ON public.tables;
CREATE TRIGGER al_asignar_mozo AFTER UPDATE OF assigned_waiter_id ON public.tables
  FOR EACH ROW
  WHEN (NEW.assigned_waiter_id IS NOT NULL AND NEW.assigned_waiter_id IS DISTINCT FROM OLD.assigned_waiter_id)
  EXECUTE FUNCTION public.al_asignar_mozo();

-- Los pagos de hoy que quedaron a nombre de la caja pasan al mozo de la mesa si lo hay; si no, sin dueño.
UPDATE public.payments p
   SET staff_id = NULL
 WHERE p.staff_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.staff_users s WHERE s.id = p.staff_id AND s.role = 'waiter')
   AND NOT EXISTS (SELECT 1 FROM public.payment_settlements st
                    WHERE st.branch_id = p.branch_id AND st.settlement_date = p.dia_negocio AND st.status = 'closed');

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Reinicio del demo: también borra los turnos
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  def text;
BEGIN
  SELECT pg_get_functiondef('public.reiniciar_demo()'::regprocedure) INTO def;
  IF position('public.turnos' IN def) = 0 THEN
    def := replace(def, 'DELETE FROM public.payment_settlements WHERE tenant_id = demo;',
                   'DELETE FROM public.payment_settlements WHERE tenant_id = demo;
  DELETE FROM public.turnos WHERE tenant_id = demo;');
    EXECUTE def;
  END IF;
END;
$$;
