-- Fase 6.2 — Varios cierres de caja al día ("cortes de turno"). Un local con turno de mañana y de noche
-- quiere contar la caja al cambio de turno, no solo al final del día. Cada corte cuenta el efectivo (y el POS,
-- si se quiere) de su tramo, con su diferencia y su nota; el cierre del día hace el último corte y suma todos.
--
-- Para que nada caiga en un tramo ya contado, cada pago y cada reembolso quedan anotados en su tramo
-- (corte_numero) al guardarse, con el mismo candado sobre la sucursal que ya separa un día del siguiente:
-- o el pago entra antes del corte, o cae en el tramo siguiente. Los cortes no se pueden cambiar.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Los cortes y el tramo de cada pago y reembolso
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cortes_caja (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  dia date NOT NULL,
  numero integer NOT NULL CHECK (numero >= 1),
  nombre text NOT NULL CHECK (char_length(nombre) BETWEEN 1 AND 40),
  efectivo_esperado integer NOT NULL,
  efectivo_contado integer NOT NULL CHECK (efectivo_contado >= 0),
  diferencia_efectivo integer NOT NULL,
  pos_esperado integer NOT NULL,
  pos_contado integer CHECK (pos_contado IS NULL OR pos_contado >= 0),
  diferencia_pos integer,
  transferencia_esperada integer NOT NULL DEFAULT 0,
  app_esperado integer NOT NULL DEFAULT 0,
  pagos integer NOT NULL DEFAULT 0,
  notas text CHECK (notas IS NULL OR char_length(notas) <= 500),
  final boolean NOT NULL DEFAULT false,
  hecho_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  hecho_por_nombre text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, dia, numero)
);
CREATE INDEX IF NOT EXISTS cortes_caja_tenant ON public.cortes_caja (tenant_id);
CREATE INDEX IF NOT EXISTS cortes_caja_hecho_por ON public.cortes_caja (hecho_por) WHERE hecho_por IS NOT NULL;
ALTER TABLE public.cortes_caja ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cortes_caja_plata ON public.cortes_caja;
CREATE POLICY cortes_caja_plata ON public.cortes_caja FOR SELECT TO authenticated
  USING (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager', 'cashier']));
REVOKE ALL ON public.cortes_caja FROM anon, authenticated;
GRANT SELECT ON public.cortes_caja TO authenticated;

-- Un corte no se cambia (como el cierre del día)
CREATE OR REPLACE FUNCTION public.proteger_corte()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Un corte de caja no se puede cambiar' USING ERRCODE = 'P0001';
END;
$$;
REVOKE ALL ON FUNCTION public.proteger_corte() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS proteger_corte ON public.cortes_caja;
CREATE TRIGGER proteger_corte BEFORE UPDATE ON public.cortes_caja
  FOR EACH ROW EXECUTE FUNCTION public.proteger_corte();

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS corte_numero integer;
ALTER TABLE public.refunds ADD COLUMN IF NOT EXISTS corte_numero integer;
CREATE INDEX IF NOT EXISTS payments_sucursal_dia_corte ON public.payments (branch_id, dia_negocio, corte_numero);

-- El tramo abierto de un día: el siguiente al último corte
CREATE OR REPLACE FUNCTION public._tramo_abierto(_branch_id uuid, _dia date)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(max(numero), 0) + 1 FROM public.cortes_caja WHERE branch_id = _branch_id AND dia = _dia
$$;
REVOKE ALL ON FUNCTION public._tramo_abierto(uuid, date) FROM PUBLIC, anon, authenticated;

-- Cada pago nuevo queda en su día y en su tramo (bajo el candado compartido de la sucursal)
CREATE OR REPLACE FUNCTION public.anotar_dia_pago()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM 1 FROM public.branches WHERE id = NEW.branch_id FOR SHARE;
  NEW.dia_negocio := public.dia_abierto(NEW.branch_id, public.dia_negocio(NEW.branch_id, now()));
  NEW.corte_numero := public._tramo_abierto(NEW.branch_id, NEW.dia_negocio);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.anotar_dia_pago() FROM PUBLIC, anon, authenticated;

-- El reembolso cuenta en el día y el tramo en que se devolvió la plata
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
    NEW.corte_numero := public._tramo_abierto(sucursal, NEW.dia_negocio);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.anotar_dia_reembolso() FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Lo que debería haber en un tramo (los pagos y reembolsos de antes de este cambio son del tramo 1)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._conciliar_tramo(_branch_id uuid, _dia date, _numero integer)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH pagos AS (
    SELECT * FROM public.payments
     WHERE branch_id = _branch_id AND dia_negocio = _dia AND coalesce(corte_numero, 1) = _numero
       AND status IN ('approved', 'partially_refunded', 'refunded')
  ), devoluciones AS (
    SELECT r.amount, p.provider, p.method FROM public.refunds r JOIN public.payments p ON p.id = r.payment_id
     WHERE p.branch_id = _branch_id AND r.status = 'completed' AND r.dia_negocio = _dia AND coalesce(r.corte_numero, 1) = _numero
  )
  SELECT jsonb_build_object(
    'numero', _numero,
    'pagos', (SELECT count(*) FROM pagos),
    'efectivo', (SELECT coalesce(sum(amount + tip_amount), 0) FROM pagos WHERE provider = 'local' AND method = 'cash')
              - (SELECT coalesce(sum(amount), 0) FROM devoluciones WHERE provider = 'local' AND method = 'cash'),
    'pos', (SELECT coalesce(sum(amount + tip_amount), 0) FROM pagos WHERE provider = 'local' AND method = 'pos')
         - (SELECT coalesce(sum(amount), 0) FROM devoluciones WHERE provider = 'local' AND method = 'pos'),
    'transferencia', (SELECT coalesce(sum(amount + tip_amount), 0) FROM pagos WHERE provider = 'local' AND method = 'transfer')
                   - (SELECT coalesce(sum(amount), 0) FROM devoluciones WHERE provider = 'local' AND method = 'transfer'),
    'app', (SELECT coalesce(sum(amount + tip_amount), 0) FROM pagos WHERE provider <> 'local')
         - (SELECT coalesce(sum(amount), 0) FROM devoluciones WHERE provider <> 'local'))
$$;
REVOKE ALL ON FUNCTION public._conciliar_tramo(uuid, date, integer) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Hacer un corte de turno (caja, encargado, administrador o dueño)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._registrar_corte(
  _local uuid, _branch_id uuid, _dia date, _efectivo integer, _pos integer, _nombre text, _notas text, _final boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  numero integer := public._tramo_abierto(_branch_id, _dia);
  t jsonb := public._conciliar_tramo(_branch_id, _dia, numero);
  dif_ef integer := _efectivo - (t ->> 'efectivo')::integer;
  dif_pos integer := CASE WHEN _pos IS NULL THEN NULL ELSE _pos - (t ->> 'pos')::integer END;
  notas text := nullif(btrim(coalesce(_notas, '')), '');
  quien text := (SELECT coalesce(email, 'Tablio') FROM auth.users WHERE id = auth.uid());
  corte uuid;
BEGIN
  IF (dif_ef <> 0 OR coalesce(dif_pos, 0) <> 0) AND (notas IS NULL OR char_length(notas) < 5) THEN
    RAISE EXCEPTION 'La caja no cuadra: explica la diferencia en las notas' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.cortes_caja (tenant_id, branch_id, dia, numero, nombre, efectivo_esperado, efectivo_contado, diferencia_efectivo,
                                  pos_esperado, pos_contado, diferencia_pos, transferencia_esperada, app_esperado, pagos,
                                  notas, final, hecho_por, hecho_por_nombre)
  VALUES (_local, _branch_id, _dia, numero, coalesce(nullif(left(btrim(coalesce(_nombre, '')), 40), ''), CASE WHEN _final THEN 'Cierre del día' ELSE 'Turno ' || numero END),
          (t ->> 'efectivo')::integer, _efectivo, dif_ef, (t ->> 'pos')::integer, _pos, dif_pos,
          (t ->> 'transferencia')::integer, (t ->> 'app')::integer, (t ->> 'pagos')::integer,
          notas, _final, auth.uid(), quien)
  RETURNING id INTO corte;
  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (_local, auth.uid(), 'corte_caja', 'corte_caja', corte,
          jsonb_build_object('dia', _dia, 'numero', numero, 'final', _final, 'efectivo_esperado', t -> 'efectivo',
                             'efectivo_contado', _efectivo, 'diferencia_efectivo', dif_ef, 'notas', notas));
  RETURN t || jsonb_build_object('id', corte, 'diferencia_efectivo', dif_ef, 'diferencia_pos', dif_pos);
END;
$$;
REVOKE ALL ON FUNCTION public._registrar_corte(uuid, uuid, date, integer, integer, text, text, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.hacer_corte_caja(
  _branch_id uuid, _efectivo_contado integer, _pos_contado integer DEFAULT NULL, _nombre text DEFAULT NULL, _notas text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  local uuid := public._tenant_caja(_branch_id);
  dia date;
BEGIN
  IF _efectivo_contado IS NULL OR _efectivo_contado < 0 OR (_pos_contado IS NOT NULL AND _pos_contado < 0) THEN
    RAISE EXCEPTION 'Anota cuánto efectivo contaste (0 si no hubo)' USING ERRCODE = 'P0001';
  END IF;
  IF _notas IS NOT NULL AND char_length(_notas) > 500 THEN
    RAISE EXCEPTION 'Las notas pueden tener hasta 500 letras' USING ERRCODE = 'P0001';
  END IF;
  -- Un corte a la vez, y los pagos que estén entrando terminan antes (ver anotar_dia_pago)
  PERFORM 1 FROM public.branches WHERE id = _branch_id FOR UPDATE;
  dia := public.dia_abierto(_branch_id, public.dia_negocio(_branch_id, now()));
  IF public._tramo_abierto(_branch_id, dia) > 20 THEN
    RAISE EXCEPTION 'Ya hay 20 cortes este día: cierra la caja del día' USING ERRCODE = 'P0001';
  END IF;
  RETURN public._registrar_corte(local, _branch_id, dia, _efectivo_contado, _pos_contado, _nombre, _notas, false)
         || jsonb_build_object('dia', dia);
END;
$$;
REVOKE ALL ON FUNCTION public.hacer_corte_caja(uuid, integer, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hacer_corte_caja(uuid, integer, integer, text, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. El cierre del día: si hubo cortes, lo contado es solo el último tramo; el cierre suma todos
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
  contado_ef integer;
  contado_pos integer;
  dif_ef integer;
  dif_pos integer;
  notas text := nullif(btrim(coalesce(_notas, '')), '');
  quien text;
  cierre_id uuid;
  hubo_cortes boolean;
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
  PERFORM 1 FROM public.branches WHERE id = _branch_id FOR UPDATE;

  IF EXISTS (SELECT 1 FROM public.payment_settlements
              WHERE branch_id = _branch_id AND settlement_date = _dia AND status = 'closed') THEN
    RAISE EXCEPTION 'La caja de ese día ya está cerrada y no se puede cambiar' USING ERRCODE = 'P0001';
  END IF;
  hoy := public.dia_negocio(_branch_id, now());
  IF _dia > hoy THEN
    RAISE EXCEPTION 'No se puede cerrar un día que todavía no empieza' USING ERRCODE = 'P0001';
  END IF;

  r := public._conciliar_dia(_branch_id, _dia);
  esperado_ef := (r -> 'efectivo' ->> 'esperado')::integer;
  esperado_pos := (r -> 'pos' ->> 'esperado')::integer;
  hubo_cortes := EXISTS (SELECT 1 FROM public.cortes_caja WHERE branch_id = _branch_id AND dia = _dia);

  IF hubo_cortes THEN
    -- El último corte (lo contado ahora es solo el último tramo) y el día suma todos los cortes
    PERFORM public._registrar_corte(local, _branch_id, _dia, _efectivo_contado, _pos_contado, 'Cierre del día', notas, true);
    SELECT sum(efectivo_contado), CASE WHEN bool_and(pos_contado IS NOT NULL) THEN sum(pos_contado) END
      INTO contado_ef, contado_pos
      FROM public.cortes_caja WHERE branch_id = _branch_id AND dia = _dia;
  ELSE
    contado_ef := _efectivo_contado;
    contado_pos := _pos_contado;
  END IF;
  dif_ef := contado_ef - esperado_ef;
  dif_pos := CASE WHEN contado_pos IS NULL THEN NULL ELSE contado_pos - esperado_pos END;

  IF NOT hubo_cortes AND (dif_ef <> 0 OR coalesce(dif_pos, 0) <> 0) AND (notas IS NULL OR char_length(notas) < 5) THEN
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
    (r -> 'app' ->> 'esperado')::integer, (r -> 'app' ->> 'esperado')::integer, 0, (r ->> 'pagos')::integer,
    (r ->> 'total_neto')::integer, esperado_ef, contado_ef, dif_ef,
    esperado_pos, contado_pos, dif_pos, r,
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
          jsonb_build_object('dia', _dia, 'total_neto', r -> 'total_neto', 'cortes', hubo_cortes,
                             'efectivo_esperado', esperado_ef, 'efectivo_contado', contado_ef,
                             'diferencia_efectivo', dif_ef, 'pos_esperado', esperado_pos,
                             'pos_contado', contado_pos, 'diferencia_pos', dif_pos, 'notas', notas));

  RETURN r || jsonb_build_object(
    'hoy', public.dia_abierto(_branch_id, hoy), 'cerrado', true,
    'cierre', jsonb_build_object(
      'efectivo_contado', contado_ef, 'diferencia_efectivo', dif_ef,
      'pos_contado', contado_pos, 'diferencia_pos', dif_pos,
      'notas', notas, 'cerrado_por', quien, 'cerrado_at', now()));
END;
$$;
REVOKE ALL ON FUNCTION public.cerrar_caja(uuid, date, integer, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cerrar_caja(uuid, date, integer, integer, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. La caja del día muestra sus cortes y lo que debería haber en el tramo abierto
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
  v_dia date;
  cierre record;
  cortes jsonb;
BEGIN
  PERFORM public._tenant_caja(_branch_id);
  hoy := public.dia_abierto(_branch_id, public.dia_negocio(_branch_id, now()));
  v_dia := coalesce(_dia, hoy);
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'numero', c.numero, 'nombre', c.nombre, 'hora', c.created_at, 'final', c.final,
           'efectivo_esperado', c.efectivo_esperado, 'efectivo_contado', c.efectivo_contado, 'diferencia_efectivo', c.diferencia_efectivo,
           'pos_esperado', c.pos_esperado, 'pos_contado', c.pos_contado, 'diferencia_pos', c.diferencia_pos,
           'transferencia_esperada', c.transferencia_esperada, 'pagos', c.pagos, 'notas', c.notas, 'hecho_por', c.hecho_por_nombre)
         ORDER BY c.numero), '[]'::jsonb)
    INTO cortes
    FROM public.cortes_caja c WHERE c.branch_id = _branch_id AND c.dia = v_dia;

  SELECT * INTO cierre FROM public.payment_settlements
   WHERE branch_id = _branch_id AND settlement_date = v_dia AND status = 'closed';
  IF FOUND THEN
    RETURN cierre.detalle || jsonb_build_object(
      'hoy', hoy, 'cerrado', true, 'cortes', cortes,
      'cierre', jsonb_build_object(
        'efectivo_contado', cierre.efectivo_contado, 'diferencia_efectivo', cierre.diferencia_efectivo,
        'pos_contado', cierre.pos_contado, 'diferencia_pos', cierre.diferencia_pos,
        'notas', cierre.notes, 'cerrado_por', cierre.closed_by_name, 'cerrado_at', cierre.closed_at));
  END IF;

  RETURN public._conciliar_dia(_branch_id, v_dia) || jsonb_build_object(
    'hoy', hoy, 'cerrado', false, 'cortes', cortes,
    'tramo_abierto', public._conciliar_tramo(_branch_id, v_dia, public._tramo_abierto(_branch_id, v_dia)));
END;
$$;
REVOKE ALL ON FUNCTION public.resumen_caja(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resumen_caja(uuid, date) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. El demo y la auditoría de la plata
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  def text;
BEGIN
  SELECT pg_get_functiondef('public.reiniciar_demo()'::regprocedure) INTO def;
  IF position('cortes_caja' IN def) = 0 THEN
    def := replace(def, 'DELETE FROM public.payments WHERE tenant_id = demo;',
                   'DELETE FROM public.cortes_caja WHERE tenant_id = demo;
  DELETE FROM public.payments WHERE tenant_id = demo;');
    IF position('cortes_caja' IN def) = 0 THEN
      RAISE EXCEPTION 'No se pudieron agregar los cortes al reinicio del demo';
    END IF;
    EXECUTE def;
  END IF;
END;
$$;

DO $$
DECLARE
  def text;
  anclaje text;
BEGIN
  SELECT pg_get_functiondef('public.auditoria_plata()'::regprocedure) INTO def;
  IF position('corte_cambio' IN def) = 0 THEN
    anclaje := substring(def FROM '\n(\s*END;\s*\$function\$)');
    def := replace(def, anclaje,
'  -- Cortes de caja (fase 6.2): un corte no cambia, y el cierre del día suma lo contado en sus cortes
  RETURN QUERY
  SELECT ''corte_cambio''::text, c.id::text,
         format(''El corte %s del %s guardó efectivo %s y hoy da %s'', c.numero, c.dia, c.efectivo_esperado, (t.r ->> ''efectivo''))
    FROM public.cortes_caja c
    CROSS JOIN LATERAL (SELECT public._conciliar_tramo(c.branch_id, c.dia, c.numero) AS r) t
   WHERE (t.r ->> ''efectivo'')::integer <> c.efectivo_esperado OR (t.r ->> ''pos'')::integer <> c.pos_esperado;

  RETURN QUERY
  SELECT ''cortes_no_suman''::text, s.id::text,
         format(''El cierre del %s guardó %s contado y sus cortes suman %s'', s.settlement_date, s.efectivo_contado, x.contado)
    FROM public.payment_settlements s
    JOIN LATERAL (SELECT sum(efectivo_contado) AS contado, count(*) FILTER (WHERE final) AS finales
                    FROM public.cortes_caja WHERE branch_id = s.branch_id AND dia = s.settlement_date) x ON x.contado IS NOT NULL
   WHERE s.status = ''closed'' AND (s.efectivo_contado <> x.contado OR x.finales <> 1);
' || anclaje);
    IF position('corte_cambio' IN def) = 0 THEN
      RAISE EXCEPTION 'No se pudo agregar la revisión de cortes a auditoria_plata';
    END IF;
    EXECUTE def;
  END IF;
END;
$$;
