-- Fase 2.D — Día de negocio y cierre de caja con conciliación automática.
-- Antes: la "conciliación" (edge function reconcile-payments) contaba el día en UTC (en Chile, de
-- 21:00 a 20:59), dejaba fuera el efectivo, no restaba bien los reembolsos y no cuadraba nada con lo
-- contado en el cajón.
-- Ahora:
--   · Cada sucursal tiene su hora de corte (por defecto 06:00, hora de Chile): todo lo que pasa entre
--     las 06:00 y las 05:59 del día siguiente es un mismo "día de negocio" (un bar que cierra a las
--     3 AM no parte su noche en dos).
--   · Cada pago y cada reembolso queda anotado en su día de negocio al ocurrir.
--   · resumen_caja(): la conciliación en vivo, calculada por la base: app, efectivo, POS, reembolsos,
--     devoluciones automáticas, propinas por mozo y avisos (pedidos por cobrar, pagos sin confirmar).
--   · cerrar_caja(): la caja anota lo contado (efectivo y POS), la base cuadra sola y marca las
--     diferencias, y el cierre queda bloqueado: nadie lo cambia después (brief 5.4).
--   · Lo que llega después de cerrar (un pago tardío, un reembolso) cae en el día siguiente.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Hora de corte y día de negocio
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS corte_dia time NOT NULL DEFAULT '06:00';
ALTER TABLE public.branches DROP CONSTRAINT IF EXISTS branches_corte_dia_check;
ALTER TABLE public.branches ADD CONSTRAINT branches_corte_dia_check CHECK (corte_dia <= '12:00');

CREATE OR REPLACE FUNCTION public.dia_negocio(_branch_id uuid, _ts timestamptz)
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ((_ts AT TIME ZONE 'America/Santiago') - coalesce(b.corte_dia, '06:00'::time))::date
    FROM public.branches b WHERE b.id = _branch_id
$$;
REVOKE ALL ON FUNCTION public.dia_negocio(uuid, timestamptz) FROM PUBLIC, anon, authenticated;

-- El primer día de negocio todavía abierto, desde _dia en adelante (si ese día ya se cerró, lo nuevo
-- cae en el siguiente).
CREATE OR REPLACE FUNCTION public.dia_abierto(_branch_id uuid, _dia date)
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d date := _dia;
BEGIN
  WHILE EXISTS (SELECT 1 FROM public.payment_settlements
                 WHERE branch_id = _branch_id AND settlement_date = d AND status = 'closed') LOOP
    d := d + 1;
  END LOOP;
  RETURN d;
END;
$$;
REVOKE ALL ON FUNCTION public.dia_abierto(uuid, date) FROM PUBLIC, anon, authenticated;

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS dia_negocio date;
ALTER TABLE public.refunds ADD COLUMN IF NOT EXISTS dia_negocio date;

UPDATE public.payments p SET dia_negocio = public.dia_negocio(p.branch_id, p.created_at)
 WHERE p.dia_negocio IS NULL;
UPDATE public.refunds r SET dia_negocio = public.dia_negocio(p.branch_id, coalesce(r.resuelto_at, r.created_at))
  FROM public.payments p
 WHERE p.id = r.payment_id AND r.dia_negocio IS NULL AND r.status = 'completed';

CREATE INDEX IF NOT EXISTS payments_sucursal_dia_idx ON public.payments (branch_id, dia_negocio);
CREATE INDEX IF NOT EXISTS refunds_dia_idx ON public.refunds (dia_negocio);

-- Cada pago nuevo queda en su día. El candado compartido sobre la sucursal hace que un pago y un
-- cierre al mismo tiempo se ordenen: o el pago entra antes del cierre, o cae en el día siguiente.
CREATE OR REPLACE FUNCTION public.anotar_dia_pago()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM 1 FROM public.branches WHERE id = NEW.branch_id FOR SHARE;
  NEW.dia_negocio := public.dia_abierto(NEW.branch_id, public.dia_negocio(NEW.branch_id, now()));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.anotar_dia_pago() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS anotar_dia_pago ON public.payments;
CREATE TRIGGER anotar_dia_pago BEFORE INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.anotar_dia_pago();

-- El reembolso cuenta el día en que se devolvió la plata (no el día del pago).
CREATE OR REPLACE FUNCTION public.anotar_dia_reembolso()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sucursal uuid;
BEGIN
  IF NEW.status = 'completed' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'completed') THEN
    SELECT branch_id INTO sucursal FROM public.payments WHERE id = NEW.payment_id;
    PERFORM 1 FROM public.branches WHERE id = sucursal FOR SHARE;
    NEW.dia_negocio := public.dia_abierto(sucursal, public.dia_negocio(sucursal, now()));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.anotar_dia_reembolso() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS anotar_dia_reembolso ON public.refunds;
CREATE TRIGGER anotar_dia_reembolso BEFORE INSERT OR UPDATE ON public.refunds
  FOR EACH ROW EXECUTE FUNCTION public.anotar_dia_reembolso();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. El cierre guarda todo lo que se cuadró y queda bloqueado
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.payment_settlements ADD COLUMN IF NOT EXISTS total_neto integer NOT NULL DEFAULT 0;
ALTER TABLE public.payment_settlements ADD COLUMN IF NOT EXISTS efectivo_esperado integer NOT NULL DEFAULT 0;
ALTER TABLE public.payment_settlements ADD COLUMN IF NOT EXISTS efectivo_contado integer;
ALTER TABLE public.payment_settlements ADD COLUMN IF NOT EXISTS diferencia_efectivo integer;
ALTER TABLE public.payment_settlements ADD COLUMN IF NOT EXISTS pos_esperado integer NOT NULL DEFAULT 0;
ALTER TABLE public.payment_settlements ADD COLUMN IF NOT EXISTS pos_contado integer;
ALTER TABLE public.payment_settlements ADD COLUMN IF NOT EXISTS diferencia_pos integer;
ALTER TABLE public.payment_settlements ADD COLUMN IF NOT EXISTS detalle jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.payment_settlements ADD COLUMN IF NOT EXISTS closed_by_name text;

CREATE OR REPLACE FUNCTION public.proteger_cierre()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'closed' THEN
    RAISE EXCEPTION 'La caja de ese día ya está cerrada y no se puede cambiar' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.proteger_cierre() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS proteger_cierre ON public.payment_settlements;
CREATE TRIGGER proteger_cierre BEFORE UPDATE ON public.payment_settlements
  FOR EACH ROW EXECUTE FUNCTION public.proteger_cierre();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. La conciliación (interna: sin revisar permisos; la llaman resumen_caja y cerrar_caja)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._conciliar_dia(_branch_id uuid, _dia date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  corte time;
  desde timestamptz;
  hasta timestamptz;
  canales jsonb;
  devoluciones jsonb;
  automaticos jsonb;
  propinas jsonb;
  avisos jsonb;
  app_cobrado integer; app_devuelto integer;
  ef_cobrado integer; ef_devuelto integer;
  pos_cobrado integer; pos_devuelto integer;
  n_pagos integer;
  propina_total integer;
BEGIN
  SELECT corte_dia INTO corte FROM public.branches WHERE id = _branch_id;
  desde := (_dia + corte) AT TIME ZONE 'America/Santiago';
  hasta := desde + interval '1 day';

  -- Lo cobrado en el día, por canal (lo reembolsado se resta aparte, el día en que se devuelve).
  SELECT count(*),
         coalesce(sum(amount + tip_amount) FILTER (WHERE provider <> 'local'), 0),
         coalesce(sum(amount + tip_amount) FILTER (WHERE provider = 'local' AND method = 'cash'), 0),
         coalesce(sum(amount + tip_amount) FILTER (WHERE provider = 'local' AND method = 'pos'), 0),
         coalesce(sum(tip_amount), 0),
         jsonb_build_object(
           'app', jsonb_build_object('pagos', count(*) FILTER (WHERE provider <> 'local'),
                                     'consumo', coalesce(sum(amount) FILTER (WHERE provider <> 'local'), 0),
                                     'propina', coalesce(sum(tip_amount) FILTER (WHERE provider <> 'local'), 0)),
           'efectivo', jsonb_build_object('pagos', count(*) FILTER (WHERE provider = 'local' AND method = 'cash'),
                                     'consumo', coalesce(sum(amount) FILTER (WHERE provider = 'local' AND method = 'cash'), 0),
                                     'propina', coalesce(sum(tip_amount) FILTER (WHERE provider = 'local' AND method = 'cash'), 0)),
           'pos', jsonb_build_object('pagos', count(*) FILTER (WHERE provider = 'local' AND method = 'pos'),
                                     'consumo', coalesce(sum(amount) FILTER (WHERE provider = 'local' AND method = 'pos'), 0),
                                     'propina', coalesce(sum(tip_amount) FILTER (WHERE provider = 'local' AND method = 'pos'), 0)))
    INTO n_pagos, app_cobrado, ef_cobrado, pos_cobrado, propina_total, canales
    FROM public.payments
   WHERE branch_id = _branch_id AND dia_negocio = _dia
     AND status IN ('approved', 'partially_refunded', 'refunded');

  -- Reembolsos hechos en el día, según por dónde se devolvió la plata.
  SELECT coalesce(sum(r.amount) FILTER (WHERE p.provider <> 'local'), 0),
         coalesce(sum(r.amount) FILTER (WHERE p.provider = 'local' AND p.method = 'cash'), 0),
         coalesce(sum(r.amount) FILTER (WHERE p.provider = 'local' AND p.method = 'pos'), 0),
         jsonb_build_object('cantidad', count(*), 'monto', coalesce(sum(r.amount), 0))
    INTO app_devuelto, ef_devuelto, pos_devuelto, devoluciones
    FROM public.refunds r JOIN public.payments p ON p.id = r.payment_id
   WHERE p.branch_id = _branch_id AND r.status = 'completed' AND r.dia_negocio = _dia;

  -- Cobros que la app devolvió sola (el precio no calzaba, otro ya había pagado lo mismo...).
  SELECT jsonb_build_object('cantidad', count(*), 'monto', coalesce(sum(i.monto + i.propina), 0))
    INTO automaticos
    FROM public.intentos_pago i JOIN public.cotizaciones c ON c.id = i.cotizacion_id
   WHERE c.branch_id = _branch_id AND i.estado = 'reembolsado'
     AND i.resuelto_at >= desde AND i.resuelto_at < hasta;

  -- Propinas por mozo (Tablio informa; la plata es de los trabajadores). Netas de lo reembolsado.
  SELECT coalesce(jsonb_agg(to_jsonb(x) - 'propina_efectivo_raw'
                              || jsonb_build_object('propina_efectivo', coalesce(x.propina_efectivo_raw, 0))
                            ORDER BY x.propina DESC, x.nombre), '[]'::jsonb) INTO propinas
    FROM (
      SELECT coalesce(s.name, 'Sin mozo asignado') AS nombre,
             p.staff_id,
             count(*) AS pagos,
             sum(p.amount) AS ventas,
             sum(greatest(0, p.tip_amount - greatest(0, p.refunded_amount - p.amount))) AS propina,
             sum(greatest(0, p.tip_amount - greatest(0, p.refunded_amount - p.amount)))
               FILTER (WHERE p.provider = 'local' AND p.method = 'cash') AS propina_efectivo_raw
        FROM public.payments p LEFT JOIN public.staff_users s ON s.id = p.staff_id
       WHERE p.branch_id = _branch_id AND p.dia_negocio = _dia
         AND p.status IN ('approved', 'partially_refunded', 'refunded')
       GROUP BY s.name, p.staff_id
    ) x;

  -- Lo que conviene revisar antes de cerrar.
  avisos := jsonb_build_object(
    'por_cobrar', (SELECT jsonb_build_object('cantidad', count(*), 'monto', coalesce(sum(total_amount), 0))
                     FROM public.orders
                    WHERE branch_id = _branch_id AND created_at >= desde AND created_at < hasta
                      AND coalesce(payment_status, 'unpaid') = 'unpaid' AND status <> 'cancelled'),
    'sin_confirmar', (SELECT jsonb_build_object('cantidad', count(*), 'monto', coalesce(sum(i.monto + i.propina), 0))
                        FROM public.intentos_pago i JOIN public.cotizaciones c ON c.id = i.cotizacion_id
                       WHERE c.branch_id = _branch_id AND i.estado = 'reservado'
                         AND i.created_at >= desde AND i.created_at < hasta
                         AND i.created_at < now() - interval '15 minutes'),
    'con_alerta', (SELECT count(*) FROM public.orders
                    WHERE branch_id = _branch_id AND created_at >= desde AND created_at < hasta
                      AND alerta IS NOT NULL),
    'mesas_abiertas', (SELECT count(*) FROM public.table_sessions
                        WHERE branch_id = _branch_id AND is_active)
  );

  RETURN jsonb_build_object(
    'dia', _dia, 'desde', desde, 'hasta', hasta,
    'pagos', n_pagos,
    'canales', canales,
    'app', jsonb_build_object('cobrado', app_cobrado, 'devuelto', app_devuelto, 'esperado', app_cobrado - app_devuelto),
    'efectivo', jsonb_build_object('cobrado', ef_cobrado, 'devuelto', ef_devuelto, 'esperado', ef_cobrado - ef_devuelto),
    'pos', jsonb_build_object('cobrado', pos_cobrado, 'devuelto', pos_devuelto, 'esperado', pos_cobrado - pos_devuelto),
    'reembolsos', devoluciones,
    'automaticos', automaticos,
    'propina_total', propina_total,
    'propinas', propinas,
    'avisos', avisos,
    'total_neto', (app_cobrado - app_devuelto) + (ef_cobrado - ef_devuelto) + (pos_cobrado - pos_devuelto)
  );
END;
$$;
REVOKE ALL ON FUNCTION public._conciliar_dia(uuid, date) FROM PUBLIC, anon, authenticated;

-- Quién puede ver y cerrar la caja de una sucursal: dueño, administrador, encargado, caja o superadmin.
CREATE OR REPLACE FUNCTION public._tenant_caja(_branch_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  local uuid;
BEGIN
  SELECT tenant_id INTO local FROM public.branches WHERE id = _branch_id;
  IF local IS NULL THEN
    RAISE EXCEPTION 'Sucursal no encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (public.tiene_rol(local, ARRAY['owner', 'admin', 'manager', 'cashier']) OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Solo la caja, el encargado o el dueño pueden ver la caja' USING ERRCODE = '42501';
  END IF;
  RETURN local;
END;
$$;
REVOKE ALL ON FUNCTION public._tenant_caja(uuid) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Ver la caja de un día (en vivo; si ya se cerró, lo que quedó guardado al cerrar)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resumen_caja(_branch_id uuid, _dia date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  hoy date;
  dia date;
  cierre record;
BEGIN
  PERFORM public._tenant_caja(_branch_id);
  hoy := public.dia_abierto(_branch_id, public.dia_negocio(_branch_id, now()));
  dia := coalesce(_dia, hoy);

  SELECT * INTO cierre FROM public.payment_settlements
   WHERE branch_id = _branch_id AND settlement_date = dia AND status = 'closed';
  IF FOUND THEN
    RETURN cierre.detalle || jsonb_build_object(
      'hoy', hoy, 'cerrado', true,
      'cierre', jsonb_build_object(
        'efectivo_contado', cierre.efectivo_contado, 'diferencia_efectivo', cierre.diferencia_efectivo,
        'pos_contado', cierre.pos_contado, 'diferencia_pos', cierre.diferencia_pos,
        'notas', cierre.notes, 'cerrado_por', cierre.closed_by_name, 'cerrado_at', cierre.closed_at));
  END IF;

  RETURN public._conciliar_dia(_branch_id, dia) || jsonb_build_object('hoy', hoy, 'cerrado', false);
END;
$$;
REVOKE ALL ON FUNCTION public.resumen_caja(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resumen_caja(uuid, date) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Cerrar la caja: se anota lo contado, la base cuadra y el día queda bloqueado
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cerrar_caja(
  _branch_id uuid,
  _dia date,
  _efectivo_contado integer,
  _pos_contado integer DEFAULT NULL,
  _notas text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  local uuid;
  hoy date;
  r jsonb;
  esperado_ef integer;
  esperado_pos integer;
  dif_ef integer;
  dif_pos integer;
  notas text := nullif(btrim(coalesce(_notas, '')), '');
  quien text;
  cierre_id uuid;
BEGIN
  local := public._tenant_caja(_branch_id);
  IF _dia IS NULL THEN
    RAISE EXCEPTION 'Indica el día que vas a cerrar' USING ERRCODE = 'P0001';
  END IF;
  IF _efectivo_contado IS NULL OR _efectivo_contado < 0 OR (_pos_contado IS NOT NULL AND _pos_contado < 0) THEN
    RAISE EXCEPTION 'Anota cuánto efectivo contaste (0 si no hubo)' USING ERRCODE = 'P0001';
  END IF;
  IF notas IS NOT NULL AND char_length(notas) > 500 THEN
    RAISE EXCEPTION 'Las notas pueden tener hasta 500 letras' USING ERRCODE = 'P0001';
  END IF;

  -- Un cierre a la vez por sucursal, y los pagos y reembolsos que estén entrando terminan antes (ver
  -- anotar_dia_pago). El cierre no toca filas de pagos: así nunca se traba con un reembolso en curso.
  -- Los pagos de un cierre son los de su sucursal con dia_negocio = settlement_date.
  PERFORM 1 FROM public.branches WHERE id = _branch_id FOR UPDATE;

  IF EXISTS (SELECT 1 FROM public.payment_settlements
              WHERE branch_id = _branch_id AND settlement_date = _dia AND status = 'closed') THEN
    RAISE EXCEPTION 'La caja de ese día ya está cerrada y no se puede cambiar' USING ERRCODE = 'P0001';
  END IF;
  -- Se puede cerrar el día en curso (un bar cierra antes del corte) o uno pasado, nunca uno que por
  -- reloj todavía no empieza (aunque el anterior ya esté cerrado y lo nuevo caiga en él).
  hoy := public.dia_negocio(_branch_id, now());
  IF _dia > hoy THEN
    RAISE EXCEPTION 'No se puede cerrar un día que todavía no empieza' USING ERRCODE = 'P0001';
  END IF;

  r := public._conciliar_dia(_branch_id, _dia);
  esperado_ef := (r -> 'efectivo' ->> 'esperado')::integer;
  esperado_pos := (r -> 'pos' ->> 'esperado')::integer;
  dif_ef := _efectivo_contado - esperado_ef;
  dif_pos := CASE WHEN _pos_contado IS NULL THEN NULL ELSE _pos_contado - esperado_pos END;

  IF (dif_ef <> 0 OR coalesce(dif_pos, 0) <> 0) AND (notas IS NULL OR char_length(notas) < 5) THEN
    RAISE EXCEPTION 'La caja no cuadra: explica la diferencia en las notas antes de cerrar' USING ERRCODE = 'P0001';
  END IF;

  SELECT coalesce(email, 'Tablio') INTO quien FROM auth.users WHERE id = auth.uid();

  INSERT INTO public.payment_settlements AS s (
    tenant_id, branch_id, settlement_date, provider,
    expected_amount, settled_amount, difference, payments_count,
    total_neto, efectivo_esperado, efectivo_contado, diferencia_efectivo,
    pos_esperado, pos_contado, diferencia_pos, detalle,
    status, notes, closed_by, closed_by_name, closed_at)
  VALUES (
    local, _branch_id, _dia, 'simulated',
    -- App contra la pasarela: con el proveedor simulado, la pasarela liquida lo mismo (fase 4: real).
    (r -> 'app' ->> 'esperado')::integer, (r -> 'app' ->> 'esperado')::integer, 0, (r ->> 'pagos')::integer,
    (r ->> 'total_neto')::integer, esperado_ef, _efectivo_contado, dif_ef,
    esperado_pos, _pos_contado, dif_pos, r,
    'closed', notas, auth.uid(), quien, now())
  ON CONFLICT (branch_id, settlement_date) DO UPDATE SET
    expected_amount = EXCLUDED.expected_amount, settled_amount = EXCLUDED.settled_amount,
    difference = EXCLUDED.difference, payments_count = EXCLUDED.payments_count,
    total_neto = EXCLUDED.total_neto, efectivo_esperado = EXCLUDED.efectivo_esperado,
    efectivo_contado = EXCLUDED.efectivo_contado, diferencia_efectivo = EXCLUDED.diferencia_efectivo,
    pos_esperado = EXCLUDED.pos_esperado, pos_contado = EXCLUDED.pos_contado,
    diferencia_pos = EXCLUDED.diferencia_pos, detalle = EXCLUDED.detalle,
    status = 'closed', notes = EXCLUDED.notes, closed_by = EXCLUDED.closed_by,
    closed_by_name = EXCLUDED.closed_by_name, closed_at = EXCLUDED.closed_at
  RETURNING id INTO cierre_id;

  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (local, auth.uid(), 'cierre_caja', 'payment_settlement', cierre_id,
          jsonb_build_object('dia', _dia, 'total_neto', r -> 'total_neto',
                             'efectivo_esperado', esperado_ef, 'efectivo_contado', _efectivo_contado,
                             'diferencia_efectivo', dif_ef, 'pos_esperado', esperado_pos,
                             'pos_contado', _pos_contado, 'diferencia_pos', dif_pos, 'notas', notas));

  RETURN r || jsonb_build_object(
    'hoy', public.dia_abierto(_branch_id, hoy), 'cerrado', true,
    'cierre', jsonb_build_object(
      'efectivo_contado', _efectivo_contado, 'diferencia_efectivo', dif_ef,
      'pos_contado', _pos_contado, 'diferencia_pos', dif_pos,
      'notas', notas, 'cerrado_por', quien, 'cerrado_at', now()));
END;
$$;
REVOKE ALL ON FUNCTION public.cerrar_caja(uuid, date, integer, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cerrar_caja(uuid, date, integer, integer, text) TO authenticated;
