-- Fase 7.7 — Premio sorpresa al pagar (raspe y gana). El dueño lo activa en Lealtad con su premio, cada
-- cuánto se gana ("1 de cada 10") y un tope de premios al mes (su presupuesto). Funciona encima de los sellos:
--   · Cada cliente con cuenta verificada recibe un raspe por día de negocio en el local, al pagar desde la
--     compra mínima (con la app o con el mozo), igual que el sello.
--   · El resultado lo decide la base al guardarse el pago, nunca el navegador; el tope del mes nunca se pasa
--     (los ganadores se cuentan bajo un candado del local).
--   · Si gana, el premio queda creado con su código (como el de la tarjeta), pero el cliente lo ve recién al
--     raspar; el personal lo entrega con entregar_premio.
--   · Si el pago se reembolsa entero, el raspe y su premio (si no se entregó) se anulan.
--   · El premio no puede ser alcohol (nada que premie tomar más).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Configuración del dueño (en el programa de lealtad)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.loyalty_programs
  ADD COLUMN IF NOT EXISTS sorpresa_activa boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sorpresa_premio text,
  ADD COLUMN IF NOT EXISTS sorpresa_uno_de integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS sorpresa_tope_mes integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS sorpresa_monto_minimo integer NOT NULL DEFAULT 0;
ALTER TABLE public.loyalty_programs ADD CONSTRAINT loyalty_programs_sorpresa_check CHECK (
  sorpresa_uno_de BETWEEN 2 AND 100 AND sorpresa_tope_mes BETWEEN 1 AND 1000
  AND sorpresa_monto_minimo BETWEEN 0 AND 1000000
  AND (sorpresa_premio IS NULL OR char_length(sorpresa_premio) BETWEEN 2 AND 80)
  AND (NOT sorpresa_activa OR sorpresa_premio IS NOT NULL));

-- El premio sorpresa no puede ser alcohol
CREATE OR REPLACE FUNCTION public.revisar_premio_sorpresa()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.sorpresa_premio IS NOT NULL AND lower(NEW.sorpresa_premio) ~
     '\m(cervezas?|chelas?|schops?|shops?|tragos?|piscos?|piscolas?|vinos?|shots?|copetes?|ron|vodka|whisky|tequila|gin|terremotos?|micheladas?|mojitos?|spritz|sour|alcohol|chop)\M' THEN
    RAISE EXCEPTION 'El premio sorpresa no puede ser alcohol: elige un postre, un picoteo o una bebida sin alcohol' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.revisar_premio_sorpresa() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS revisar_premio_sorpresa ON public.loyalty_programs;
CREATE TRIGGER revisar_premio_sorpresa BEFORE INSERT OR UPDATE OF sorpresa_premio ON public.loyalty_programs
  FOR EACH ROW EXECUTE FUNCTION public.revisar_premio_sorpresa();

-- Los premios sorpresa son premios como los demás, con su motivo
ALTER TABLE public.loyalty_rewards DROP CONSTRAINT IF EXISTS loyalty_rewards_motivo_check;
ALTER TABLE public.loyalty_rewards ADD CONSTRAINT loyalty_rewards_motivo_check
  CHECK (motivo IN ('tarjeta', 'nivel', 'racha', 'sorpresa'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Los raspes
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.raspes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  customer_id uuid NOT NULL REFERENCES public.loyalty_customers(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  movimiento_id uuid NOT NULL REFERENCES public.movimientos_lealtad(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  dia_negocio date NOT NULL,
  mes date NOT NULL,                 -- primer día del mes del día de negocio (para el tope)
  gano boolean NOT NULL,
  premio text,                       -- lo que ganó (copia de la configuración de ese momento)
  tope integer NOT NULL,             -- el tope del mes en ese momento
  premio_id uuid REFERENCES public.loyalty_rewards(id) ON DELETE SET NULL,
  raspado_at timestamptz,
  anulado_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS raspes_movimiento_uidx ON public.raspes (movimiento_id);
CREATE UNIQUE INDEX IF NOT EXISTS raspes_cliente_dia_uidx ON public.raspes (customer_id, dia_negocio) WHERE anulado_at IS NULL;
CREATE INDEX IF NOT EXISTS raspes_mes_idx ON public.raspes (tenant_id, mes) WHERE gano AND anulado_at IS NULL;
CREATE INDEX IF NOT EXISTS raspes_usuario_idx ON public.raspes (user_id) WHERE raspado_at IS NULL;

ALTER TABLE public.raspes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS raspes_lectura ON public.raspes;
CREATE POLICY raspes_lectura ON public.raspes FOR SELECT TO authenticated
  USING (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager', 'cashier']) OR public.is_platform_admin());
REVOKE INSERT, UPDATE, DELETE ON public.raspes FROM anon, authenticated;
GRANT SELECT ON public.raspes TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. El sorteo: al sumar la visita (_sellos_pago), una vez por cliente y día
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._raspe_visita(_movimiento_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m public.movimientos_lealtad;
  prog public.loyalty_programs;
  v_mes date;
  v_gano boolean;
  v_premio uuid;
  v_raspe uuid;
BEGIN
  SELECT * INTO m FROM public.movimientos_lealtad WHERE id = _movimiento_id;
  IF m.id IS NULL OR m.anulado_at IS NOT NULL THEN RETURN false; END IF;
  prog := public._programa_lealtad(m.tenant_id, m.branch_id);
  IF prog.id IS NULL OR NOT prog.sorpresa_activa OR prog.sorpresa_premio IS NULL THEN RETURN false; END IF;
  IF m.monto < prog.sorpresa_monto_minimo THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.raspes WHERE customer_id = m.customer_id AND dia_negocio = m.dia_negocio AND anulado_at IS NULL) THEN
    RETURN false;
  END IF;
  v_mes := date_trunc('month', m.dia_negocio)::date;

  -- La suerte primero; si ganó, el tope del mes se revisa bajo un candado del local (dos ganadores a la vez
  -- no pasan el tope). Solo los ganadores esperan el candado.
  v_gano := random() < 1.0 / prog.sorpresa_uno_de;
  IF v_gano THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('raspe:' || m.tenant_id::text, 0));
    v_gano := (SELECT count(*) FROM public.raspes
                WHERE tenant_id = m.tenant_id AND mes = v_mes AND gano AND anulado_at IS NULL) < prog.sorpresa_tope_mes;
  END IF;

  INSERT INTO public.raspes (tenant_id, branch_id, customer_id, user_id, movimiento_id, payment_id, dia_negocio, mes,
                             gano, premio, tope)
  VALUES (m.tenant_id, m.branch_id, m.customer_id, m.user_id, m.id, m.payment_id, m.dia_negocio, v_mes,
          v_gano, CASE WHEN v_gano THEN prog.sorpresa_premio END, prog.sorpresa_tope_mes)
  RETURNING id INTO v_raspe;

  IF v_gano THEN
    INSERT INTO public.loyalty_rewards (tenant_id, customer_id, description, codigo, movimiento_id, payment_id, motivo, logro)
    VALUES (m.tenant_id, m.customer_id, prog.sorpresa_premio, public._codigo_premio(m.tenant_id), m.id, m.payment_id,
            'sorpresa', 'sorpresa:' || v_raspe::text)
    RETURNING id INTO v_premio;
    UPDATE public.raspes SET premio_id = v_premio WHERE id = v_raspe;
  END IF;
  RETURN v_gano;
END;
$$;
REVOKE ALL ON FUNCTION public._raspe_visita(uuid) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Lo que hace el cliente: ver sus raspes sin raspar y raspar uno
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mis_raspes(_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  yo uuid := (SELECT auth.uid());
  prog public.loyalty_programs;
BEGIN
  IF yo IS NULL THEN
    RAISE EXCEPTION 'Tienes que entrar desde el QR de tu mesa' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO prog FROM public.loyalty_programs WHERE tenant_id = _tenant_id AND is_active ORDER BY branch_id NULLS LAST LIMIT 1;
  RETURN jsonb_build_object(
    'activo', coalesce(prog.sorpresa_activa, false),
    'premio', CASE WHEN prog.sorpresa_activa THEN prog.sorpresa_premio END,
    'uno_de', CASE WHEN prog.sorpresa_activa THEN prog.sorpresa_uno_de END,
    'monto_minimo', CASE WHEN prog.sorpresa_activa THEN prog.sorpresa_monto_minimo END,
    -- Sin el resultado: se sabe recién al raspar
    'pendientes', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'fecha', r.created_at) ORDER BY r.created_at), '[]'::jsonb)
                     FROM public.raspes r
                     JOIN public.loyalty_customers lc ON lc.id = r.customer_id
                    WHERE r.tenant_id = _tenant_id AND r.raspado_at IS NULL AND r.anulado_at IS NULL
                      AND (r.user_id = yo OR lc.user_id = yo)));
END;
$$;
REVOKE ALL ON FUNCTION public.mis_raspes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mis_raspes(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.raspar(_raspe_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  yo uuid := (SELECT auth.uid());
  r public.raspes;
  v_codigo text;
BEGIN
  SELECT x.* INTO r FROM public.raspes x JOIN public.loyalty_customers lc ON lc.id = x.customer_id
   WHERE x.id = _raspe_id AND x.anulado_at IS NULL AND yo IS NOT NULL AND (x.user_id = yo OR lc.user_id = yo)
   FOR UPDATE OF x;
  IF r.id IS NULL THEN
    RAISE EXCEPTION 'Este raspe ya no está disponible' USING ERRCODE = 'P0001';
  END IF;
  IF r.raspado_at IS NULL THEN
    UPDATE public.raspes SET raspado_at = now() WHERE id = r.id;
  END IF;
  SELECT codigo INTO v_codigo FROM public.loyalty_rewards WHERE id = r.premio_id AND status = 'earned';
  RETURN jsonb_build_object('gano', r.gano, 'premio', r.premio, 'codigo', v_codigo);
END;
$$;
REVOKE ALL ON FUNCTION public.raspar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.raspar(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Encajes: al sumar la visita, al anularla, lo que ve el cliente, privacidad, auditoría y demo
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  def text;
  nuevo text;
BEGIN
  -- Al sumar la visita: el raspe del día (fuera del bloque de sellos: vale también con puntos)
  def := pg_get_functiondef('public._sellos_pago'::regproc);
  nuevo := replace(def, $q$    -- Niveles y rachas (fase 7.5)
    IF da_sello THEN
      PERFORM public._logros_visita(mov);
    END IF;$q$,
    $q$    -- Niveles y rachas (fase 7.5)
    IF da_sello THEN
      PERFORM public._logros_visita(mov);
    END IF;
    -- Premio sorpresa (fase 7.7)
    PERFORM public._raspe_visita(mov);$q$);
  IF nuevo = def THEN RAISE EXCEPTION '_sellos_pago: no se encontró dónde'; END IF;
  EXECUTE nuevo;

  -- Reembolso total: el raspe se anula y su premio también (si no se entregó)
  def := pg_get_functiondef('public._anular_sellos_pago'::regproc);
  nuevo := replace(def, $q$     WHERE movimiento_id = m.id AND motivo IN ('nivel', 'racha') AND status = 'earned';$q$,
    $q$     WHERE movimiento_id = m.id AND motivo IN ('nivel', 'racha', 'sorpresa') AND status = 'earned';
    UPDATE public.raspes SET anulado_at = now() WHERE movimiento_id = m.id AND anulado_at IS NULL;$q$);
  IF nuevo = def THEN RAISE EXCEPTION '_anular_sellos_pago: no se encontró dónde'; END IF;
  EXECUTE nuevo;

  -- El premio sorpresa aparece en la tarjeta recién cuando el cliente raspó
  def := pg_get_functiondef('public.mis_sellos'::regproc);
  nuevo := replace(def, $q$FROM public.loyalty_rewards r WHERE r.customer_id = cliente.id AND r.status = 'earned'));$q$,
    $q$FROM public.loyalty_rewards r WHERE r.customer_id = cliente.id AND r.status = 'earned'
                   AND NOT EXISTS (SELECT 1 FROM public.raspes x WHERE x.premio_id = r.id AND x.raspado_at IS NULL)));$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'mis_sellos: no se encontró dónde'; END IF;
  EXECUTE nuevo;

  -- Privacidad: sus raspes aparecen en sus datos (se borran con su ficha del local)
  def := pg_get_functiondef('public.mis_datos()'::regprocedure);
  nuevo := replace(def, $q$                 'ultima_visita', lc.last_visit_at,$q$,
    $q$                 'ultima_visita', lc.last_visit_at,
                 'raspes', (SELECT count(*) FROM public.raspes x WHERE x.customer_id = lc.id),$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'mis_datos: no se encontró dónde'; END IF;
  EXECUTE nuevo;

  -- La auditoría de la operación revisa los raspes
  def := pg_get_functiondef('public.auditoria_operacion()'::regprocedure);
  nuevo := regexp_replace(def, '\n(\s*END;\s*\$function\$)', $q$

  -- Fase 7.7: un raspe ganador tiene su premio sorpresa (y uno perdedor no); nadie tiene dos raspes vigentes
  -- el mismo día; ningún local pasa su tope de premios del mes.
  RETURN QUERY
  SELECT 'raspe_incoherente', x.id::text,
         CASE WHEN x.gano AND x.premio_id IS NULL THEN 'Raspe ganador sin premio'
              WHEN NOT x.gano AND x.premio_id IS NOT NULL THEN 'Raspe perdedor con premio'
              WHEN x.tenant_id <> lc.tenant_id THEN 'Raspe de un local distinto al de su cliente'
              WHEN x.anulado_at IS NOT NULL AND r.status = 'earned' THEN 'Raspe anulado con su premio vigente'
              ELSE 'El premio no calza con el raspe' END
    FROM public.raspes x
    JOIN public.loyalty_customers lc ON lc.id = x.customer_id
    LEFT JOIN public.loyalty_rewards r ON r.id = x.premio_id
   WHERE (x.gano AND x.premio_id IS NULL AND x.anulado_at IS NULL)
      OR (NOT x.gano AND x.premio_id IS NOT NULL)
      OR x.tenant_id <> lc.tenant_id
      OR (r.id IS NOT NULL AND (r.motivo <> 'sorpresa' OR r.customer_id <> x.customer_id OR r.description <> x.premio
                                OR (x.anulado_at IS NULL AND r.status = 'anulado')
                                OR (x.anulado_at IS NOT NULL AND r.status = 'earned')));

  RETURN QUERY
  SELECT 'raspe_sobre_tope', x.tenant_id::text || ' ' || x.mes::text, count(*)::text || ' premios sorpresa con tope ' || max(x.tope)
    FROM public.raspes x
   WHERE x.gano AND x.anulado_at IS NULL
   GROUP BY x.tenant_id, x.mes
  HAVING count(*) > max(x.tope);
\1$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'auditoria_operacion: no se encontró el final'; END IF;
  EXECUTE nuevo;
END;
$$;
