-- Propinas por pagar (decisión del fundador del 14 de octubre de 2026; art. 64 del Código del Trabajo).
-- La propina es íntegra del trabajador. Cuando se paga con la app, con POS o en efectivo a la caja, la
-- plata queda en el local, que debe entregársela al mozo (con tarjeta, a más tardar en 7 días hábiles).
-- Tablio no mueve esa plata: lleva la cuenta de cuánto se le debe a cada mozo, desde cuándo, cuándo vence
-- el plazo, y registra cuando el local se la paga (con quién, cómo y una nota).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Registro de pagos de propinas al equipo
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.liquidaciones_propina (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.staff_users(id) ON DELETE RESTRICT,
  monto integer NOT NULL CHECK (monto > 0),
  -- Los pagos (de clientes) cuyas propinas cubre: cada propina se paga una sola vez
  pagos uuid[] NOT NULL CHECK (cardinality(pagos) > 0),
  medio text NOT NULL CHECK (medio IN ('efectivo', 'transferencia', 'otro')),
  nota text CHECK (nota IS NULL OR char_length(nota) <= 300),
  pagado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  pagado_por_nombre text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS liquidaciones_propina_staff_idx ON public.liquidaciones_propina (staff_id, created_at DESC);
CREATE INDEX IF NOT EXISTS liquidaciones_propina_branch_idx ON public.liquidaciones_propina (branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS liquidaciones_propina_pagos_idx ON public.liquidaciones_propina USING gin (pagos);

ALTER TABLE public.liquidaciones_propina ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS liquidaciones_propina_lectura ON public.liquidaciones_propina;
-- La plata la ven dueño, administrador, encargado y caja; cada mozo ve las suyas
CREATE POLICY liquidaciones_propina_lectura ON public.liquidaciones_propina FOR SELECT TO authenticated
  USING (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager', 'cashier'])
         OR public.is_platform_admin()
         OR staff_id IN (SELECT s.id FROM public.staff_users s WHERE s.auth_user_id = (SELECT auth.uid())));
REVOKE INSERT, UPDATE, DELETE ON public.liquidaciones_propina FROM anon, authenticated;
GRANT SELECT ON public.liquidaciones_propina TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Cálculos
-- ─────────────────────────────────────────────────────────────────────────────
-- Fecha más N días hábiles (lunes a viernes). No descuenta feriados: el aviso llega antes, nunca tarde.
CREATE OR REPLACE FUNCTION public._mas_dias_habiles(_desde date, _dias integer)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  d date := _desde;
  n integer := 0;
BEGIN
  WHILE n < _dias LOOP
    d := d + 1;
    IF extract(isodow FROM d) < 6 THEN n := n + 1; END IF;
  END LOOP;
  RETURN d;
END;
$$;
REVOKE ALL ON FUNCTION public._mas_dias_habiles(date, integer) FROM PUBLIC, anon, authenticated;

-- Propinas que el local todavía no entrega, por pago (netas de lo reembolsado)
CREATE OR REPLACE FUNCTION public._propinas_pendientes(_branch_id uuid)
RETURNS TABLE (staff_id uuid, pago_id uuid, propina integer, pagada_at timestamptz, medio text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.staff_id, p.id,
         greatest(0, p.tip_amount - greatest(0, coalesce(p.refunded_amount, 0) - p.amount))::integer,
         p.created_at,
         CASE WHEN p.provider = 'local' THEN p.method ELSE 'app' END
    FROM public.payments p
   WHERE p.branch_id = _branch_id AND p.staff_id IS NOT NULL
     AND p.status IN ('approved', 'partially_refunded', 'refunded')
     AND greatest(0, p.tip_amount - greatest(0, coalesce(p.refunded_amount, 0) - p.amount)) > 0
     AND NOT EXISTS (SELECT 1 FROM public.liquidaciones_propina l WHERE l.pagos @> ARRAY[p.id])
$$;
REVOKE ALL ON FUNCTION public._propinas_pendientes(uuid) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Lo que ve el local (dueño, administrador, encargado, caja)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.propinas_por_pagar(_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  local uuid;
  hoy date := (now() AT TIME ZONE 'America/Santiago')::date;
BEGIN
  SELECT tenant_id INTO local FROM public.branches WHERE id = _branch_id;
  IF local IS NULL OR NOT (public.tiene_rol(local, ARRAY['owner', 'admin', 'manager', 'cashier']) OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'No tienes permiso para ver las propinas del equipo' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'pendientes', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'staff_id', x.staff_id, 'nombre', s.name, 'monto', x.monto, 'pagos', x.pagos,
               'desde', x.desde, 'vence', public._mas_dias_habiles(x.desde, 7),
               'vencida', public._mas_dias_habiles(x.desde, 7) < hoy) ORDER BY x.desde), '[]'::jsonb)
        FROM (SELECT pp.staff_id, sum(pp.propina) AS monto, count(*) AS pagos,
                     min((pp.pagada_at AT TIME ZONE 'America/Santiago')::date) AS desde
                FROM public._propinas_pendientes(_branch_id) pp GROUP BY pp.staff_id) x
        JOIN public.staff_users s ON s.id = x.staff_id),
    'pagadas', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'id', l.id, 'nombre', s.name, 'monto', l.monto, 'medio', l.medio, 'nota', l.nota,
               'pagado_por', l.pagado_por_nombre, 'created_at', l.created_at) ORDER BY l.created_at DESC), '[]'::jsonb)
        FROM (SELECT * FROM public.liquidaciones_propina WHERE branch_id = _branch_id ORDER BY created_at DESC LIMIT 20) l
        JOIN public.staff_users s ON s.id = l.staff_id));
END;
$$;
REVOKE ALL ON FUNCTION public.propinas_por_pagar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.propinas_por_pagar(uuid) TO authenticated;

-- El local registra que le pagó al mozo todo lo que le debía hasta ahora
CREATE OR REPLACE FUNCTION public.pagar_propinas(_branch_id uuid, _staff_id uuid, _medio text, _nota text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  local uuid;
  mozo public.staff_users;
  ids uuid[];
  total integer;
  quien text;
  nueva uuid;
BEGIN
  SELECT tenant_id INTO local FROM public.branches WHERE id = _branch_id;
  IF local IS NULL OR NOT public.tiene_rol(local, ARRAY['owner', 'admin', 'manager', 'cashier']) THEN
    RAISE EXCEPTION 'No tienes permiso para registrar pagos de propinas' USING ERRCODE = '42501';
  END IF;
  IF _medio NOT IN ('efectivo', 'transferencia', 'otro') THEN
    RAISE EXCEPTION 'Elige cómo le pagaste (efectivo, transferencia u otro)' USING ERRCODE = 'P0001';
  END IF;
  IF _nota IS NOT NULL AND char_length(btrim(_nota)) > 300 THEN
    RAISE EXCEPTION 'La nota puede tener hasta 300 letras' USING ERRCODE = 'P0001';
  END IF;
  -- Bloquea al mozo: dos personas registrando el mismo pago al mismo tiempo no pagan dos veces
  SELECT * INTO mozo FROM public.staff_users WHERE id = _staff_id AND tenant_id = local FOR UPDATE;
  IF mozo.id IS NULL THEN
    RAISE EXCEPTION 'Esa persona no es del equipo de este local' USING ERRCODE = 'P0001';
  END IF;

  SELECT array_agg(pp.pago_id), sum(pp.propina) INTO ids, total
    FROM public._propinas_pendientes(_branch_id) pp WHERE pp.staff_id = _staff_id;
  IF coalesce(total, 0) <= 0 THEN
    RAISE EXCEPTION 'No hay propinas por pagar a % en este momento', mozo.name USING ERRCODE = 'P0001';
  END IF;

  SELECT coalesce(s.name, u.email, 'Local') INTO quien
    FROM auth.users u LEFT JOIN public.staff_users s ON s.auth_user_id = u.id AND s.tenant_id = local
   WHERE u.id = auth.uid();
  INSERT INTO public.liquidaciones_propina (tenant_id, branch_id, staff_id, monto, pagos, medio, nota, pagado_por, pagado_por_nombre)
  VALUES (local, _branch_id, _staff_id, total, ids, _medio, nullif(btrim(coalesce(_nota, '')), ''), auth.uid(), quien)
  RETURNING id INTO nueva;
  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (local, auth.uid(), 'propinas_pagadas', 'liquidacion_propina', nueva,
          jsonb_build_object('mozo', mozo.name, 'staff_id', _staff_id, 'monto', total, 'pagos', cardinality(ids), 'medio', _medio));
  RETURN jsonb_build_object('id', nueva, 'monto', total, 'pagos', cardinality(ids), 'nombre', mozo.name);
END;
$$;
REVOKE ALL ON FUNCTION public.pagar_propinas(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pagar_propinas(uuid, uuid, text, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Lo que ve el mozo: cuánto le deben y lo que ya le pagaron
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mis_propinas_por_cobrar(_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  yo public.staff_users;
  desde date;
  monto integer;
BEGIN
  SELECT s.* INTO yo FROM public.staff_users s JOIN public.branches b ON b.tenant_id = s.tenant_id
   WHERE s.auth_user_id = auth.uid() AND b.id = _branch_id AND s.is_active LIMIT 1;
  IF yo.id IS NULL THEN
    RAISE EXCEPTION 'Solo el equipo del local ve sus propinas' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(sum(pp.propina), 0), min((pp.pagada_at AT TIME ZONE 'America/Santiago')::date) INTO monto, desde
    FROM public._propinas_pendientes(_branch_id) pp WHERE pp.staff_id = yo.id;
  RETURN jsonb_build_object(
    'por_cobrar', monto,
    'desde', desde,
    'vence', CASE WHEN desde IS NULL THEN NULL ELSE public._mas_dias_habiles(desde, 7) END,
    'pagadas', (SELECT coalesce(jsonb_agg(jsonb_build_object('monto', l.monto, 'medio', l.medio, 'created_at', l.created_at,
                                                            'pagado_por', l.pagado_por_nombre) ORDER BY l.created_at DESC), '[]'::jsonb)
                  FROM (SELECT * FROM public.liquidaciones_propina WHERE staff_id = yo.id ORDER BY created_at DESC LIMIT 10) l));
END;
$$;
REVOKE ALL ON FUNCTION public.mis_propinas_por_cobrar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mis_propinas_por_cobrar(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Demo: lo de semanas anteriores ya se pagó; quedan por pagar los últimos días
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._sembrar_propinas_pagadas_demo()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  demo constant uuid := '651c363f-0084-50af-9873-be98cfeaaf47';
  sucursal uuid;
  g record;
  n integer := 0;
BEGIN
  SELECT id INTO sucursal FROM public.branches WHERE tenant_id = demo ORDER BY created_at LIMIT 1;
  IF sucursal IS NULL THEN RETURN 0; END IF;
  -- Un pago por mozo y semana (cada lunes se paga la semana anterior), salvo los últimos 4 días
  FOR g IN
    SELECT pp.staff_id, date_trunc('week', pp.pagada_at AT TIME ZONE 'America/Santiago')::date AS semana,
           array_agg(pp.pago_id) AS ids, sum(pp.propina)::integer AS total
      FROM public._propinas_pendientes(sucursal) pp
     WHERE pp.pagada_at < now() - interval '4 days'
     GROUP BY 1, 2
  LOOP
    INSERT INTO public.liquidaciones_propina (tenant_id, branch_id, staff_id, monto, pagos, medio, nota, pagado_por_nombre, created_at)
    VALUES (demo, sucursal, g.staff_id, g.total, g.ids, 'transferencia', 'Propinas de la semana (ejemplo)', 'Dueño Demo',
            ((g.semana + 7)::timestamp + interval '12 hours') AT TIME ZONE 'America/Santiago');
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public._sembrar_propinas_pagadas_demo() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  def text;
BEGIN
  SELECT pg_get_functiondef('public.reiniciar_demo()'::regprocedure) INTO def;
  IF position('liquidaciones_propina' IN def) = 0 THEN
    def := replace(def, 'DELETE FROM public.payments WHERE tenant_id = demo;',
                   'DELETE FROM public.liquidaciones_propina WHERE tenant_id = demo;
  DELETE FROM public.payments WHERE tenant_id = demo;');
    def := replace(def, 'PERFORM public._sembrar_cliente_demo();',
                   'PERFORM public._sembrar_cliente_demo();
  PERFORM public._sembrar_propinas_pagadas_demo();');
    IF position('_sembrar_propinas_pagadas_demo' IN def) = 0 OR position('liquidaciones_propina' IN def) = 0 THEN
      RAISE EXCEPTION 'No se pudieron agregar las propinas pagadas al reinicio del demo';
    END IF;
    EXECUTE def;
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. La auditoría de la operación también revisa los pagos de propinas
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  def text;
BEGIN
  SELECT pg_get_functiondef('public.auditoria_operacion()'::regprocedure) INTO def;
  IF position('propina_pagada_dos_veces' IN def) = 0 THEN
    def := replace(def, '  -- Sellos ───',
'  -- Pagos de propinas ──────────────────────────────────────────────────────
  -- Cada propina se le paga al mozo una sola vez, y a quien corresponde.
  RETURN QUERY
  SELECT ''propina_pagada_dos_veces'', p.id::text, format(''La propina del pago está en %s pagos al equipo'', count(*))
    FROM public.payments p JOIN public.liquidaciones_propina l ON l.pagos @> ARRAY[p.id]
   GROUP BY p.id HAVING count(*) > 1;

  RETURN QUERY
  SELECT ''propina_pagada_a_otro'', l.id::text, ''El pago de propinas incluye propinas de otro mozo o de otro local''
    FROM public.liquidaciones_propina l
   WHERE EXISTS (SELECT 1 FROM public.payments p WHERE p.id = ANY (l.pagos)
                  AND (p.staff_id IS DISTINCT FROM l.staff_id OR p.tenant_id <> l.tenant_id));

  -- Sellos ───');
    IF position('propina_pagada_dos_veces' IN def) = 0 THEN
      RAISE EXCEPTION 'No se pudo agregar la revisión de propinas a la auditoría';
    END IF;
    EXECUTE def;
  END IF;
END;
$$;
