-- Fase 3.3 — Control del equipo (brief 6.1).
--   · Tiempos objetivo por sucursal (responder un llamado, llevar lo listo, el pedido completo), con
--     semáforo en las pantallas.
--   · Quién entregó cada producto (order_items.delivered_by) y qué mozo tenía la mesa al cerrarla
--     (table_sessions.staff_id): la calificación del cliente se atribuye a ese mozo.
--   · Metas por mozo (o para todos), con avance visible en su propio panel.
--   · ranking_equipo(): mesas, pedidos entregados, ventas, ticket promedio, propinas, tiempos de
--     respuesta y de entrega con su cumplimiento, y calificación. mi_desempeno(): lo mismo, para el mozo.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Tiempos objetivo (minutos)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS objetivo_llamado_min integer NOT NULL DEFAULT 2;
ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS objetivo_retiro_min integer NOT NULL DEFAULT 5;
ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS objetivo_pedido_min integer NOT NULL DEFAULT 20;
ALTER TABLE public.branches DROP CONSTRAINT IF EXISTS branches_objetivos_check;
ALTER TABLE public.branches ADD CONSTRAINT branches_objetivos_check CHECK (
  objetivo_llamado_min BETWEEN 1 AND 60 AND objetivo_retiro_min BETWEEN 1 AND 60 AND objetivo_pedido_min BETWEEN 5 AND 180);
-- Los cambia el dueño o el administrador (la sucursal solo permite cambiar columnas listadas: fase 1.7)
GRANT UPDATE (objetivo_llamado_min, objetivo_retiro_min, objetivo_pedido_min) ON public.branches TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Quién entregó y quién atendía la mesa
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS delivered_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.table_sessions ADD COLUMN IF NOT EXISTS staff_id uuid REFERENCES public.staff_users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.anotar_quien_entrega()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'delivered' AND OLD.status IS DISTINCT FROM 'delivered' THEN
    NEW.delivered_by := coalesce(NEW.delivered_by, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.anotar_quien_entrega() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS anotar_quien_entrega ON public.order_items;
CREATE TRIGGER anotar_quien_entrega BEFORE UPDATE OF status ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.anotar_quien_entrega();

-- Al cerrar la visita queda anotado el mozo a cargo (cerrar_mesa cierra la sesión antes de liberar la mesa).
CREATE OR REPLACE FUNCTION public.anotar_mozo_sesion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.is_active AND NOT NEW.is_active AND NEW.staff_id IS NULL THEN
    SELECT assigned_waiter_id INTO NEW.staff_id FROM public.tables WHERE id = NEW.table_id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.anotar_mozo_sesion() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS anotar_mozo_sesion ON public.table_sessions;
CREATE TRIGGER anotar_mozo_sesion BEFORE UPDATE OF is_active ON public.table_sessions
  FOR EACH ROW EXECUTE FUNCTION public.anotar_mozo_sesion();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Metas por mozo
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.metas_mozo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  staff_id uuid REFERENCES public.staff_users(id) ON DELETE CASCADE, -- vacío = para todos los mozos
  tipo text NOT NULL CHECK (tipo IN ('ventas', 'mesas')),
  periodo text NOT NULL CHECK (periodo IN ('dia', 'semana', 'mes')),
  objetivo integer NOT NULL CHECK (objetivo > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Una meta por mozo, tipo y período (y una general)
CREATE UNIQUE INDEX IF NOT EXISTS metas_mozo_unica_uidx
  ON public.metas_mozo (branch_id, coalesce(staff_id, '00000000-0000-0000-0000-000000000000'::uuid), tipo, periodo);
ALTER TABLE public.metas_mozo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.metas_mozo FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.metas_mozo TO authenticated;
DROP POLICY IF EXISTS metas_lectura ON public.metas_mozo;
CREATE POLICY metas_lectura ON public.metas_mozo FOR SELECT TO authenticated
  USING (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager'])
         OR public.is_platform_admin()
         OR (public.tiene_rol(tenant_id, ARRAY['waiter'])
             AND (staff_id IS NULL OR EXISTS (SELECT 1 FROM public.staff_users s WHERE s.id = metas_mozo.staff_id AND s.auth_user_id = auth.uid()))));
DROP POLICY IF EXISTS metas_gestion ON public.metas_mozo;
CREATE POLICY metas_gestion ON public.metas_mozo FOR ALL TO authenticated
  USING (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager']))
  WITH CHECK (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager']));

-- La meta, el mozo y la sucursal tienen que ser del mismo local
CREATE OR REPLACE FUNCTION public.validar_meta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE id = NEW.branch_id AND tenant_id = NEW.tenant_id)
     OR (NEW.staff_id IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM public.staff_users WHERE id = NEW.staff_id AND tenant_id = NEW.tenant_id)) THEN
    RAISE EXCEPTION 'La meta tiene que ser de un mozo de este local' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validar_meta() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS validar_meta ON public.metas_mozo;
CREATE TRIGGER validar_meta BEFORE INSERT OR UPDATE ON public.metas_mozo
  FOR EACH ROW EXECUTE FUNCTION public.validar_meta();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Desempeño de cada mozo entre dos momentos (interna)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._desempeno_mozo(_staff_id uuid, _branch_id uuid, _desde timestamptz, _hasta timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH s AS (SELECT * FROM public.staff_users WHERE id = _staff_id),
  b AS (SELECT * FROM public.branches WHERE id = _branch_id),
  pagos AS (
    SELECT p.* FROM public.payments p
     WHERE p.staff_id = _staff_id AND p.branch_id = _branch_id AND p.status <> 'failed'
       AND p.created_at >= _desde AND p.created_at < _hasta),
  llamados AS (
    SELECT extract(epoch FROM (w.attended_at - w.created_at)) / 60.0 AS min
      FROM public.waiter_calls w, s
     WHERE w.branch_id = _branch_id AND w.attended_by = s.auth_user_id AND w.attended_at IS NOT NULL
       AND w.created_at >= _desde AND w.created_at < _hasta),
  entregas AS (
    SELECT oi.order_id, extract(epoch FROM (oi.delivered_at - oi.ready_at)) / 60.0 AS min
      FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id, s
     WHERE o.branch_id = _branch_id AND oi.delivered_by = s.auth_user_id
       AND oi.delivered_at >= _desde AND oi.delivered_at < _hasta AND oi.ready_at IS NOT NULL),
  sesiones AS (
    SELECT ts.* FROM public.table_sessions ts
     WHERE ts.staff_id = _staff_id AND ts.branch_id = _branch_id
       AND ts.closed_at >= _desde AND ts.closed_at < _hasta)
  SELECT jsonb_build_object(
    'staff_id', s.id, 'nombre', s.name,
    'mesas', (SELECT count(*) FROM sesiones),
    'pedidos_entregados', (SELECT count(DISTINCT order_id) FROM entregas),
    'pagos', (SELECT count(*) FROM pagos),
    'ventas', (SELECT coalesce(sum(amount), 0) FROM pagos),
    'ticket_promedio', (SELECT coalesce(round(avg(amount)), 0) FROM pagos),
    'propinas', (SELECT coalesce(sum(greatest(0, tip_amount - greatest(0, coalesce(refunded_amount, 0) - amount))), 0) FROM pagos),
    'llamados', (SELECT count(*) FROM llamados),
    'llamado_promedio_min', (SELECT round(avg(min)::numeric, 1) FROM llamados),
    'llamados_a_tiempo', (SELECT count(*) FILTER (WHERE min <= b.objetivo_llamado_min) FROM llamados, b),
    'entregas', (SELECT count(*) FROM entregas),
    'retiro_promedio_min', (SELECT round(avg(min)::numeric, 1) FROM entregas),
    'entregas_a_tiempo', (SELECT count(*) FILTER (WHERE min <= b.objetivo_retiro_min) FROM entregas, b),
    'calificaciones', (SELECT count(rating) FROM sesiones),
    'calificacion_promedio', (SELECT round(avg(rating)::numeric, 1) FROM sesiones WHERE rating IS NOT NULL))
  FROM s
$$;
REVOKE ALL ON FUNCTION public._desempeno_mozo(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;

-- Inicio y fin (en hora de Chile, con la hora de corte de la sucursal) de un período de días de negocio.
CREATE OR REPLACE FUNCTION public._ventana_dias(_branch_id uuid, _desde date, _hasta date, OUT desde timestamptz, OUT hasta timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (_desde + b.corte_dia) AT TIME ZONE 'America/Santiago',
         (_hasta + 1 + b.corte_dia) AT TIME ZONE 'America/Santiago'
    FROM public.branches b WHERE b.id = _branch_id
$$;
REVOKE ALL ON FUNCTION public._ventana_dias(uuid, date, date) FROM PUBLIC, anon, authenticated;

-- Ranking del equipo (dueño, administrador, encargado).
CREATE OR REPLACE FUNCTION public.ranking_equipo(_branch_id uuid, _desde date, _hasta date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  local uuid;
  v record;
  b public.branches;
BEGIN
  SELECT * INTO b FROM public.branches WHERE id = _branch_id;
  local := b.tenant_id;
  IF local IS NULL OR NOT (public.tiene_rol(local, ARRAY['owner', 'admin', 'manager']) OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Solo el dueño o el encargado ven el desempeño del equipo' USING ERRCODE = '42501';
  END IF;
  IF _hasta < _desde OR _hasta - _desde > 92 THEN
    RAISE EXCEPTION 'Elige un período de hasta tres meses' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v FROM public._ventana_dias(_branch_id, _desde, _hasta);
  RETURN jsonb_build_object(
    'objetivos', jsonb_build_object('llamado', b.objetivo_llamado_min, 'retiro', b.objetivo_retiro_min, 'pedido', b.objetivo_pedido_min),
    'mozos', coalesce((
      SELECT jsonb_agg(d ORDER BY (d ->> 'ventas')::integer DESC, d ->> 'nombre')
        FROM (SELECT public._desempeno_mozo(s.id, _branch_id, v.desde, v.hasta) AS d
                FROM public.staff_users s
               WHERE s.tenant_id = local AND s.role = 'waiter'
                 AND (s.is_active OR EXISTS (SELECT 1 FROM public.payments p WHERE p.staff_id = s.id
                                               AND p.created_at >= v.desde AND p.created_at < v.hasta))) x
    ), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.ranking_equipo(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ranking_equipo(uuid, date, date) TO authenticated;

-- Mi desempeño (el mozo): hoy, esta semana y este mes, con el avance de mis metas.
CREATE OR REPLACE FUNCTION public.mi_desempeno(_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ficha public.staff_users;
  b public.branches;
  hoy date;
  dia record; semana record; mes record;
  d_dia jsonb; d_semana jsonb; d_mes jsonb;
BEGIN
  SELECT * INTO b FROM public.branches WHERE id = _branch_id;
  ficha := public._mi_ficha(b.tenant_id);
  IF ficha.id IS NULL THEN
    RAISE EXCEPTION 'No tienes permiso para este cambio' USING ERRCODE = '42501';
  END IF;
  hoy := public.dia_negocio(_branch_id, now());
  SELECT * INTO dia FROM public._ventana_dias(_branch_id, hoy, hoy);
  SELECT * INTO semana FROM public._ventana_dias(_branch_id, date_trunc('week', hoy)::date, hoy);
  SELECT * INTO mes FROM public._ventana_dias(_branch_id, date_trunc('month', hoy)::date, hoy);
  d_dia := public._desempeno_mozo(ficha.id, _branch_id, dia.desde, dia.hasta);
  d_semana := public._desempeno_mozo(ficha.id, _branch_id, semana.desde, semana.hasta);
  d_mes := public._desempeno_mozo(ficha.id, _branch_id, mes.desde, mes.hasta);

  RETURN jsonb_build_object(
    'objetivos', jsonb_build_object('llamado', b.objetivo_llamado_min, 'retiro', b.objetivo_retiro_min, 'pedido', b.objetivo_pedido_min),
    'hoy', d_dia, 'semana', d_semana, 'mes', d_mes,
    -- La meta propia gana a la general
    'metas', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'tipo', m.tipo, 'periodo', m.periodo, 'objetivo', m.objetivo,
               'avance', ((CASE m.periodo WHEN 'dia' THEN d_dia WHEN 'semana' THEN d_semana ELSE d_mes END) ->> m.tipo)::integer)
             ORDER BY m.periodo, m.tipo)
        FROM (SELECT DISTINCT ON (tipo, periodo) * FROM public.metas_mozo
               WHERE branch_id = _branch_id AND (staff_id = ficha.id OR staff_id IS NULL)
               ORDER BY tipo, periodo, staff_id NULLS LAST) m
    ), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.mi_desempeno(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mi_desempeno(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. El demo trae una meta general de ejemplo (las metas son configuración: el reinicio no las borra)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.metas_mozo (tenant_id, branch_id, tipo, periodo, objetivo)
SELECT b.tenant_id, b.id, 'ventas', 'dia', 150000
  FROM public.branches b
 WHERE b.tenant_id = '651c363f-0084-50af-9873-be98cfeaaf47'
   AND NOT EXISTS (SELECT 1 FROM public.metas_mozo m WHERE m.branch_id = b.id);
