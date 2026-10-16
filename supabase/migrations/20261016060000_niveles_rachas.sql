-- Fase 7.5 — Niveles y rachas, por local, encima de los sellos (fase 3.7):
--   · Niveles: Bronce, Plata y Oro según las visitas (días con sello) de los últimos 90 días. Al llegar por
--     primera vez a Plata o a Oro, el cliente gana el premio que definió el dueño.
--   · Rachas: N semanas seguidas viniendo (o el mismo día de la semana, por ejemplo "3 viernes seguidos").
--     Al completarla, gana el premio de la racha.
-- Los premios son los mismos de siempre (loyalty_rewards con código): el cliente los ve en su tarjeta y el
-- personal los entrega con entregar_premio. Los calcula la base al sumar un sello (_sellos_pago), nunca el
-- navegador; si la visita que lo ganó se reembolsa entera, el premio se anula (como el de la tarjeta). Solo
-- cuentan las visitas con cuenta verificada (las que suman sello). Nada que premie tomar más alcohol: se
-- premian visitas, no cantidades.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Configuración del dueño
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.loyalty_programs
  ADD COLUMN IF NOT EXISTS niveles_activos boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS nivel_plata integer NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS nivel_oro integer NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS premio_plata text,
  ADD COLUMN IF NOT EXISTS premio_oro text,
  ADD COLUMN IF NOT EXISTS racha_semanas integer,
  ADD COLUMN IF NOT EXISTS racha_dia smallint,
  ADD COLUMN IF NOT EXISTS racha_premio text;
ALTER TABLE public.loyalty_programs ADD CONSTRAINT loyalty_programs_niveles_check CHECK (
  nivel_plata BETWEEN 2 AND 60 AND nivel_oro BETWEEN 3 AND 90 AND nivel_oro > nivel_plata
  AND (premio_plata IS NULL OR char_length(premio_plata) BETWEEN 2 AND 80)
  AND (premio_oro IS NULL OR char_length(premio_oro) BETWEEN 2 AND 80)
  AND (racha_semanas IS NULL OR racha_semanas BETWEEN 2 AND 12)
  AND (racha_dia IS NULL OR racha_dia BETWEEN 0 AND 6)
  AND (racha_premio IS NULL OR char_length(racha_premio) BETWEEN 2 AND 80)
  AND (racha_semanas IS NULL OR racha_premio IS NOT NULL));

-- Cada premio dice de dónde viene; un logro (subir a Plata, una racha de cierta semana) se premia una vez
ALTER TABLE public.loyalty_rewards
  ADD COLUMN IF NOT EXISTS motivo text NOT NULL DEFAULT 'tarjeta' CHECK (motivo IN ('tarjeta', 'nivel', 'racha')),
  ADD COLUMN IF NOT EXISTS logro text;
CREATE UNIQUE INDEX IF NOT EXISTS loyalty_rewards_logro_uidx ON public.loyalty_rewards (customer_id, logro)
  WHERE logro IS NOT NULL AND status <> 'anulado';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Cálculo (lo usa _sellos_pago al sumar un sello y mis_sellos para mostrarlo)
-- ─────────────────────────────────────────────────────────────────────────────
-- Nivel y racha de un cliente en un día dado
CREATE OR REPLACE FUNCTION public._nivel_y_racha(_customer_id uuid, _dia date, _prog public.loyalty_programs)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_visitas integer;
  v_nivel text;
  v_semanas integer := 0;
  v_semana date := date_trunc('week', _dia)::date;
BEGIN
  SELECT count(DISTINCT m.dia_negocio) INTO v_visitas
    FROM public.movimientos_lealtad m
   WHERE m.customer_id = _customer_id AND m.sello AND m.anulado_at IS NULL
     AND m.dia_negocio > _dia - 90 AND m.dia_negocio <= _dia;
  v_nivel := CASE WHEN v_visitas >= _prog.nivel_oro THEN 'oro' WHEN v_visitas >= _prog.nivel_plata THEN 'plata' ELSE 'bronce' END;

  -- Semanas seguidas (hasta la de _dia) con al menos una visita (del día de la semana elegido, si hay)
  IF _prog.racha_semanas IS NOT NULL THEN
    LOOP
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.movimientos_lealtad m
         WHERE m.customer_id = _customer_id AND m.sello AND m.anulado_at IS NULL
           AND m.dia_negocio >= v_semana AND m.dia_negocio < v_semana + 7 AND m.dia_negocio <= _dia
           AND (_prog.racha_dia IS NULL OR extract(dow FROM m.dia_negocio) = _prog.racha_dia));
      v_semanas := v_semanas + 1;
      v_semana := v_semana - 7;
      EXIT WHEN v_semanas >= 52;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'nivel', v_nivel, 'visitas', v_visitas,
    'siguiente', CASE v_nivel WHEN 'bronce' THEN 'plata' WHEN 'plata' THEN 'oro' END,
    'faltan', CASE v_nivel WHEN 'bronce' THEN _prog.nivel_plata - v_visitas WHEN 'plata' THEN _prog.nivel_oro - v_visitas END,
    'racha', v_semanas, 'racha_meta', _prog.racha_semanas, 'racha_dia', _prog.racha_dia);
END;
$$;
REVOKE ALL ON FUNCTION public._nivel_y_racha(uuid, date, public.loyalty_programs) FROM PUBLIC, anon, authenticated;

-- Premios de nivel y racha que gana una visita (una vez por logro)
CREATE OR REPLACE FUNCTION public._logros_visita(_movimiento_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m public.movimientos_lealtad;
  prog public.loyalty_programs;
  estado jsonb;
  hechos integer := 0;
  v_logro text;
  v_desc text;
BEGIN
  SELECT * INTO m FROM public.movimientos_lealtad WHERE id = _movimiento_id;
  IF m.id IS NULL OR NOT m.sello OR m.anulado_at IS NOT NULL THEN RETURN 0; END IF;
  prog := public._programa_lealtad(m.tenant_id, m.branch_id); -- el mismo programa que dio el sello
  IF prog.id IS NULL THEN RETURN 0; END IF;
  estado := public._nivel_y_racha(m.customer_id, m.dia_negocio, prog);

  -- Subir de nivel (la primera vez que llega a Plata y a Oro)
  IF prog.niveles_activos THEN
    FOR v_logro, v_desc IN
      SELECT x.logro, x.premio FROM (VALUES ('nivel:plata', prog.premio_plata, 1), ('nivel:oro', prog.premio_oro, 2)) x(logro, premio, orden)
       WHERE x.premio IS NOT NULL
         AND ((x.logro = 'nivel:plata' AND estado ->> 'nivel' IN ('plata', 'oro')) OR (x.logro = 'nivel:oro' AND estado ->> 'nivel' = 'oro'))
       ORDER BY x.orden
    LOOP
      INSERT INTO public.loyalty_rewards (tenant_id, customer_id, description, codigo, movimiento_id, payment_id, motivo, logro)
      SELECT m.tenant_id, m.customer_id, v_desc, public._codigo_premio(m.tenant_id), m.id, m.payment_id, 'nivel', v_logro
       WHERE NOT EXISTS (SELECT 1 FROM public.loyalty_rewards r WHERE r.customer_id = m.customer_id AND r.logro = v_logro AND r.status <> 'anulado');
      IF FOUND THEN hechos := hechos + 1; END IF;
    END LOOP;
  END IF;

  -- Completar una racha (cada vez que llega a la meta: 3, 6, 9... semanas)
  IF prog.racha_semanas IS NOT NULL AND (estado ->> 'racha')::integer > 0
     AND (estado ->> 'racha')::integer % prog.racha_semanas = 0 THEN
    v_logro := 'racha:' || to_char(m.dia_negocio, 'IYYY-IW');
    INSERT INTO public.loyalty_rewards (tenant_id, customer_id, description, codigo, movimiento_id, payment_id, motivo, logro)
    SELECT m.tenant_id, m.customer_id, prog.racha_premio, public._codigo_premio(m.tenant_id), m.id, m.payment_id, 'racha', v_logro
     WHERE NOT EXISTS (SELECT 1 FROM public.loyalty_rewards r WHERE r.customer_id = m.customer_id AND r.logro = v_logro AND r.status <> 'anulado');
    IF FOUND THEN hechos := hechos + 1; END IF;
  END IF;
  RETURN hechos;
END;
$$;
REVOKE ALL ON FUNCTION public._logros_visita(uuid) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Encajes: al sumar un sello, al anularlo y lo que ve el cliente
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  def text;
  nuevo text;
BEGIN
  -- Al sumar un sello: también niveles y rachas
  def := pg_get_functiondef('public._sellos_pago'::regproc);
  nuevo := replace(def, $q$    IF premio IS NOT NULL THEN
      UPDATE public.movimientos_lealtad SET premio_id = premio WHERE id = mov;
    END IF;$q$,
    $q$    IF premio IS NOT NULL THEN
      UPDATE public.movimientos_lealtad SET premio_id = premio WHERE id = mov;
    END IF;
    -- Niveles y rachas (fase 7.5)
    IF da_sello THEN
      PERFORM public._logros_visita(mov);
    END IF;$q$);
  IF nuevo = def THEN RAISE EXCEPTION '_sellos_pago: no se encontró dónde'; END IF;
  EXECUTE nuevo;

  -- Al anular la visita (reembolso total): también los premios de nivel y racha que ganó (si no se entregaron)
  def := pg_get_functiondef('public._anular_sellos_pago'::regproc);
  nuevo := replace(def, $q$    UPDATE public.movimientos_lealtad SET anulado_at = now(), premio_id = NULL WHERE id = m.id;$q$,
    $q$    UPDATE public.loyalty_rewards SET status = 'anulado', anulado_at = now()
     WHERE movimiento_id = m.id AND motivo IN ('nivel', 'racha') AND status = 'earned';
    UPDATE public.movimientos_lealtad SET anulado_at = now(), premio_id = NULL WHERE id = m.id;$q$);
  IF nuevo = def THEN RAISE EXCEPTION '_anular_sellos_pago: no se encontró dónde'; END IF;
  EXECUTE nuevo;

  -- El cliente ve su nivel, su racha y de dónde viene cada premio
  def := pg_get_functiondef('public.mis_sellos'::regproc);
  nuevo := replace(def, $q$    'premios', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'descripcion', r.description,$q$,
    $q$    'nivel', CASE WHEN prog.niveles_activos OR prog.racha_semanas IS NOT NULL THEN
               public._nivel_y_racha(cliente.id, public.dia_negocio(coalesce(_branch_id, (SELECT b.id FROM public.branches b WHERE b.tenant_id = _tenant_id ORDER BY b.created_at LIMIT 1)), now()), prog)
               || jsonb_build_object('niveles_activos', prog.niveles_activos, 'premio_plata', prog.premio_plata, 'premio_oro', prog.premio_oro,
                                     'racha_premio', prog.racha_premio) END,
    'premios', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'descripcion', r.description, 'motivo', r.motivo,$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'mis_sellos: no se encontró dónde'; END IF;
  EXECUTE nuevo;
END;
$$;
