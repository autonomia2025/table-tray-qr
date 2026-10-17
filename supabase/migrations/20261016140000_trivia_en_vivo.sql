-- Fase 8.4 — Noche de trivia en vivo. El local la lanza en su pantalla (un computador conectado a la tele):
-- todos los que están en una mesa juegan la misma pregunta al mismo tiempo desde su celular, y el ranking se
-- ve en vivo en la pantalla y en los celulares.
--   · El encargado (dueño, administrador o encargado) crea la noche y avanza las preguntas desde la pantalla.
--   · Las preguntas salen del banco de Tablio (preguntas_trivia: nada de alcohol). La correcta nunca llega a
--     los celulares antes de que termine la pregunta.
--   · Cada persona responde una vez por pregunta, dentro del tiempo; el puntaje lo calcula la base
--     (100 por acertar, más hasta 50 por rapidez).
--   · Solo diversión: no da sellos, descuentos ni premios (nada que mueva plata). Es del módulo "juegos".

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Tablas
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.trivias_vivo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  preguntas uuid[] NOT NULL,
  segundos smallint NOT NULL DEFAULT 20 CHECK (segundos BETWEEN 10 AND 60),
  estado text NOT NULL DEFAULT 'esperando' CHECK (estado IN ('esperando', 'pregunta', 'resultado', 'terminada')),
  actual smallint NOT NULL DEFAULT 0,          -- número de la pregunta en curso (1, 2, …); 0 antes de empezar
  pregunta_desde timestamptz,                  -- cuándo empezó la pregunta en curso
  creada_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  terminada_at timestamptz,
  CHECK (cardinality(preguntas) BETWEEN 3 AND 20),
  CHECK (actual BETWEEN 0 AND cardinality(preguntas))
);
-- Una noche de trivia a la vez por sucursal
CREATE UNIQUE INDEX IF NOT EXISTS trivias_vivo_activa_uidx ON public.trivias_vivo (branch_id) WHERE estado <> 'terminada';
CREATE INDEX IF NOT EXISTS trivias_vivo_tenant_idx ON public.trivias_vivo (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.respuestas_trivia_vivo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trivia_id uuid NOT NULL REFERENCES public.trivias_vivo(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  alias text NOT NULL,
  mesa integer,
  numero smallint NOT NULL,                    -- qué pregunta (1, 2, …)
  opcion smallint NOT NULL,
  correcta boolean NOT NULL,
  puntos integer NOT NULL CHECK (puntos BETWEEN 0 AND 150),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (correcta OR puntos = 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS respuestas_trivia_vivo_uidx ON public.respuestas_trivia_vivo (trivia_id, user_id, numero);
CREATE INDEX IF NOT EXISTS respuestas_trivia_vivo_user_idx ON public.respuestas_trivia_vivo (user_id);

ALTER TABLE public.trivias_vivo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.respuestas_trivia_vivo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trivias_vivo_lectura ON public.trivias_vivo;
CREATE POLICY trivias_vivo_lectura ON public.trivias_vivo FOR SELECT TO authenticated
  USING (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager']) OR public.is_platform_admin());
DROP POLICY IF EXISTS respuestas_trivia_vivo_lectura ON public.respuestas_trivia_vivo;
CREATE POLICY respuestas_trivia_vivo_lectura ON public.respuestas_trivia_vivo FOR SELECT TO authenticated
  USING (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager']) OR public.is_platform_admin());
REVOKE INSERT, UPDATE, DELETE ON public.trivias_vivo, public.respuestas_trivia_vivo FROM anon, authenticated;
GRANT SELECT ON public.trivias_vivo, public.respuestas_trivia_vivo TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Lo que comparten la pantalla y los celulares
-- ─────────────────────────────────────────────────────────────────────────────
-- Estado público de una noche: la pregunta en curso (la correcta solo cuando ya se mostró el resultado) y el ranking
CREATE OR REPLACE FUNCTION public._estado_trivia_vivo(_trivia_id uuid, _user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH t AS (SELECT * FROM public.trivias_vivo WHERE id = _trivia_id),
       q AS (SELECT p.* FROM t JOIN public.preguntas_trivia p ON p.id = t.preguntas[t.actual] WHERE t.actual > 0),
       ranking AS (
         SELECT r.user_id, max(r.alias) AS alias, max(r.mesa) AS mesa, sum(r.puntos)::integer AS puntos, count(*) FILTER (WHERE r.correcta)::integer AS aciertos
           FROM public.respuestas_trivia_vivo r JOIN t ON t.id = r.trivia_id
          -- La pregunta en curso no cuenta hasta que se muestra el resultado (así nadie deduce la correcta)
          WHERE r.numero < t.actual OR t.estado IN ('resultado', 'terminada')
          GROUP BY r.user_id)
  SELECT jsonb_build_object(
    'id', t.id, 'estado', t.estado, 'actual', t.actual, 'total', cardinality(t.preguntas), 'segundos', t.segundos,
    'quedan', CASE WHEN t.estado = 'pregunta' THEN greatest(0, t.segundos - extract(epoch FROM now() - t.pregunta_desde))::integer END,
    'pregunta', (SELECT jsonb_build_object('texto', q.pregunta, 'opciones', to_jsonb(q.opciones), 'tema', q.tema,
                                           'correcta', CASE WHEN t.estado IN ('resultado', 'terminada') THEN q.correcta END) FROM q),
    'respondieron', (SELECT count(*) FROM public.respuestas_trivia_vivo r WHERE r.trivia_id = t.id AND r.numero = t.actual),
    'ranking', (SELECT coalesce(jsonb_agg(jsonb_build_object('alias', x.alias, 'mesa', x.mesa, 'puntos', x.puntos, 'aciertos', x.aciertos,
                                                            'yo', x.user_id = _user_id) ORDER BY x.puntos DESC, x.alias), '[]'::jsonb)
                  FROM (SELECT * FROM ranking ORDER BY puntos DESC, alias LIMIT 10) x),
    'mi_respuesta', CASE WHEN _user_id IS NOT NULL THEN
                      (SELECT jsonb_build_object('opcion', r.opcion,
                                                 'correcta', CASE WHEN t.estado IN ('resultado', 'terminada') THEN r.correcta END,
                                                 'puntos', CASE WHEN t.estado IN ('resultado', 'terminada') THEN r.puntos END)
                         FROM public.respuestas_trivia_vivo r WHERE r.trivia_id = t.id AND r.user_id = _user_id AND r.numero = t.actual) END,
    'mis_puntos', CASE WHEN _user_id IS NOT NULL THEN (SELECT puntos FROM ranking WHERE user_id = _user_id) END)
    FROM t
$$;
REVOKE ALL ON FUNCTION public._estado_trivia_vivo(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. El encargado: crear, avanzar y terminar (desde la pantalla)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._exigir_encargado_trivia(_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _tenant_id IS NULL OR NOT public.tiene_rol(_tenant_id, ARRAY['owner', 'admin', 'manager']) THEN
    RAISE EXCEPTION 'Solo el dueño, el administrador o el encargado manejan la trivia en vivo' USING ERRCODE = '42501';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public._exigir_encargado_trivia(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.crear_trivia_vivo(_branch_id uuid, _preguntas integer DEFAULT 10, _segundos integer DEFAULT 20)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  local uuid := (SELECT tenant_id FROM public.branches WHERE id = _branch_id);
  ids uuid[];
  nuevo uuid;
BEGIN
  PERFORM public._exigir_encargado_trivia(local);
  PERFORM public._exigir_funcion(local, 'juegos');
  IF _preguntas IS NULL OR _preguntas NOT BETWEEN 3 AND 20 THEN
    RAISE EXCEPTION 'Elige entre 3 y 20 preguntas' USING ERRCODE = 'P0001';
  END IF;
  IF _segundos IS NULL OR _segundos NOT BETWEEN 10 AND 60 THEN
    RAISE EXCEPTION 'Cada pregunta dura entre 10 y 60 segundos' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.trivias_vivo WHERE branch_id = _branch_id AND estado <> 'terminada') THEN
    RAISE EXCEPTION 'Ya hay una trivia en vivo en esta sucursal: termínala antes de empezar otra' USING ERRCODE = 'P0001';
  END IF;
  SELECT array_agg(q.id) INTO ids FROM (SELECT id FROM public.preguntas_trivia WHERE activa ORDER BY random() LIMIT _preguntas) q;
  IF coalesce(cardinality(ids), 0) < _preguntas THEN
    RAISE EXCEPTION 'No hay suficientes preguntas en el banco' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.trivias_vivo (tenant_id, branch_id, preguntas, segundos, creada_por)
  VALUES (local, _branch_id, ids, _segundos, (SELECT auth.uid()))
  RETURNING id INTO nuevo;
  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (local, (SELECT auth.uid()), 'trivia_vivo_creada', 'trivia_vivo', nuevo, jsonb_build_object('preguntas', _preguntas, 'segundos', _segundos));
  RETURN nuevo;
END;
$$;
REVOKE ALL ON FUNCTION public.crear_trivia_vivo(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crear_trivia_vivo(uuid, integer, integer) TO authenticated;

-- Avanza un paso: esperando → pregunta 1 → resultado → pregunta 2 → … → terminada
CREATE OR REPLACE FUNCTION public.avanzar_trivia_vivo(_trivia_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.trivias_vivo;
BEGIN
  SELECT * INTO t FROM public.trivias_vivo WHERE id = _trivia_id FOR UPDATE;
  PERFORM public._exigir_encargado_trivia(t.tenant_id);
  IF t.estado = 'terminada' THEN
    RAISE EXCEPTION 'Esta trivia ya terminó' USING ERRCODE = 'P0001';
  ELSIF t.estado = 'pregunta' THEN
    UPDATE public.trivias_vivo SET estado = 'resultado' WHERE id = t.id;
  ELSIF t.actual >= cardinality(t.preguntas) THEN
    UPDATE public.trivias_vivo SET estado = 'terminada', terminada_at = now() WHERE id = t.id;
  ELSE
    UPDATE public.trivias_vivo SET estado = 'pregunta', actual = t.actual + 1, pregunta_desde = now() WHERE id = t.id;
  END IF;
  RETURN public._estado_trivia_vivo(t.id);
END;
$$;
REVOKE ALL ON FUNCTION public.avanzar_trivia_vivo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.avanzar_trivia_vivo(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.terminar_trivia_vivo(_trivia_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.trivias_vivo;
BEGIN
  SELECT * INTO t FROM public.trivias_vivo WHERE id = _trivia_id FOR UPDATE;
  PERFORM public._exigir_encargado_trivia(t.tenant_id);
  UPDATE public.trivias_vivo SET estado = 'terminada', terminada_at = coalesce(terminada_at, now()) WHERE id = t.id;
END;
$$;
REVOKE ALL ON FUNCTION public.terminar_trivia_vivo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.terminar_trivia_vivo(uuid) TO authenticated;

-- La pantalla del local: la noche en curso de la sucursal (o una en particular)
CREATE OR REPLACE FUNCTION public.pantalla_trivia_vivo(_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  local uuid := (SELECT tenant_id FROM public.branches WHERE id = _branch_id);
  v_id uuid;
BEGIN
  PERFORM public._exigir_encargado_trivia(local);
  SELECT id INTO v_id FROM public.trivias_vivo WHERE branch_id = _branch_id ORDER BY (estado <> 'terminada') DESC, created_at DESC LIMIT 1;
  IF v_id IS NULL THEN RETURN NULL; END IF;
  RETURN public._estado_trivia_vivo(v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.pantalla_trivia_vivo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pantalla_trivia_vivo(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. El comensal (desde su mesa)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trivia_vivo_mesa(_qr_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  v_id uuid;
BEGIN
  SELECT * INTO c FROM public._comensal_en_mesa(_qr_token);
  SELECT id INTO v_id FROM public.trivias_vivo
   WHERE branch_id = (c.mesa).branch_id AND (estado <> 'terminada' OR terminada_at > now() - interval '15 minutes')
   ORDER BY (estado <> 'terminada') DESC, created_at DESC LIMIT 1;
  IF v_id IS NULL OR NOT public.tiene_funcion((c.mesa).tenant_id, 'juegos') THEN RETURN NULL; END IF;
  RETURN public._estado_trivia_vivo(v_id, (SELECT auth.uid()));
END;
$$;
REVOKE ALL ON FUNCTION public.trivia_vivo_mesa(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trivia_vivo_mesa(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.responder_trivia_vivo(_qr_token text, _trivia_id uuid, _numero integer, _opcion integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  t public.trivias_vivo;
  q public.preguntas_trivia;
  v_alias text;
  v_quedan numeric;
  v_correcta boolean;
BEGIN
  SELECT * INTO c FROM public._comensal_en_mesa(_qr_token);
  SELECT * INTO t FROM public.trivias_vivo WHERE id = _trivia_id;
  IF t.id IS NULL OR t.branch_id <> (c.mesa).branch_id THEN
    RAISE EXCEPTION 'Esa trivia no es de este local' USING ERRCODE = 'P0001';
  END IF;
  IF t.estado <> 'pregunta' OR t.actual <> _numero THEN
    RAISE EXCEPTION 'Esa pregunta ya cerró' USING ERRCODE = 'P0001';
  END IF;
  v_quedan := t.segundos - extract(epoch FROM now() - t.pregunta_desde);
  IF v_quedan < 0 THEN
    RAISE EXCEPTION 'Se acabó el tiempo de esta pregunta' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO q FROM public.preguntas_trivia WHERE id = t.preguntas[t.actual];
  IF _opcion IS NULL OR _opcion < 0 OR _opcion >= cardinality(q.opciones) THEN
    RAISE EXCEPTION 'Elige una de las opciones' USING ERRCODE = 'P0001';
  END IF;
  SELECT coalesce(nullif(btrim(cm.alias), ''), 'Alguien de la mesa ' || (c.mesa).number) INTO v_alias
    FROM public.comensales_mesa cm WHERE cm.session_id = c.sesion AND cm.user_id = (SELECT auth.uid());
  v_correcta := _opcion = q.correcta;
  INSERT INTO public.respuestas_trivia_vivo (trivia_id, tenant_id, user_id, alias, mesa, numero, opcion, correcta, puntos)
  VALUES (t.id, t.tenant_id, (SELECT auth.uid()), left(v_alias, 30), (c.mesa).number, t.actual, _opcion, v_correcta,
          CASE WHEN v_correcta THEN 100 + round(50 * least(1, greatest(0, v_quedan / t.segundos)))::integer ELSE 0 END)
  ON CONFLICT (trivia_id, user_id, numero) DO NOTHING;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ya respondiste esta pregunta' USING ERRCODE = 'P0001';
  END IF;
  RETURN jsonb_build_object('ok', true); -- sin decir si acertó: se sabe con el resultado
END;
$$;
REVOKE ALL ON FUNCTION public.responder_trivia_vivo(text, uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.responder_trivia_vivo(text, uuid, integer, integer) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Privacidad, auditoría y demo
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  def text;
  nuevo text;
BEGIN
  -- Sus respuestas aparecen en sus datos (y se borran con su cuenta: ON DELETE CASCADE)
  def := pg_get_functiondef('public.mis_datos()'::regprocedure);
  nuevo := replace(def, $q$'avisos_al_celular', (SELECT count(*) FROM public.suscripciones_push s WHERE s.user_id = yo),$q$,
    $q$'avisos_al_celular', (SELECT count(*) FROM public.suscripciones_push s WHERE s.user_id = yo),
    'trivia_en_vivo', (SELECT count(*) FROM public.respuestas_trivia_vivo r WHERE r.user_id = yo),$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'mis_datos: no se encontró dónde'; END IF;
  EXECUTE nuevo;

  -- La auditoría de la operación revisa la trivia en vivo
  def := pg_get_functiondef('public.auditoria_operacion()'::regprocedure);
  nuevo := regexp_replace(def, '\n(\s*END;\s*\$function\$)', $q$

  -- Fase 8.4: cada respuesta calza con su pregunta (correcta y puntos), es del mismo local que su trivia y llegó a tiempo
  RETURN QUERY
  SELECT 'trivia_vivo_incoherente', r.id::text,
         CASE WHEN r.tenant_id <> t.tenant_id THEN 'Respuesta de otro local'
              WHEN r.correcta <> (r.opcion = q.correcta) THEN 'Respuesta marcada correcta (o no) sin serlo'
              WHEN r.puntos > 0 AND NOT r.correcta THEN 'Puntos por una respuesta incorrecta'
              ELSE 'Respuesta a una pregunta que no existe' END
    FROM public.respuestas_trivia_vivo r
    JOIN public.trivias_vivo t ON t.id = r.trivia_id
    LEFT JOIN public.preguntas_trivia q ON q.id = t.preguntas[r.numero]
   WHERE r.tenant_id <> t.tenant_id OR q.id IS NULL OR r.correcta <> (r.opcion = q.correcta) OR (r.puntos > 0 AND NOT r.correcta);
\1$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'auditoria_operacion: no se encontró el final'; END IF;
  EXECUTE nuevo;

  -- El reinicio del demo borra sus noches de trivia
  def := pg_get_functiondef('public.reiniciar_demo()'::regprocedure);
  nuevo := replace(def, '  DELETE FROM public.campanas WHERE tenant_id = demo;',
    '  DELETE FROM public.campanas WHERE tenant_id = demo;
  DELETE FROM public.trivias_vivo WHERE tenant_id = demo;');
  IF nuevo = def THEN RAISE EXCEPTION 'reiniciar_demo: no se encontró dónde'; END IF;
  EXECUTE nuevo;
END;
$$;
