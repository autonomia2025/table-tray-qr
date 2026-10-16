-- Fase 7.8 — Juegos en la mesa, mientras esperan:
--   · Trivia: 5 preguntas al azar de un banco de Tablio (cultura chilena, comida, geografía, general; nada de
--     alcohol). El servidor corrige (las respuestas correctas nunca llegan al celular) y la mesa ve el ranking.
--   · Ruleta "¿quién invita la próxima?": el servidor elige al azar entre los de la mesa y todos ven a quién le
--     tocó. Es solo diversión: no mueve plata ni crea pedidos.
-- Solo para quien está registrado en la mesa (_comensal_en_mesa). Sin premios por ahora: un sello extra choca
-- con la regla de un sello por día (fase 3.7) y se decidirá aparte.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Tablas
-- ─────────────────────────────────────────────────────────────────────────────
-- Banco de preguntas de Tablio (contenido de la plataforma, igual para todos los locales)
CREATE TABLE IF NOT EXISTS public.preguntas_trivia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pregunta text NOT NULL UNIQUE CHECK (char_length(pregunta) BETWEEN 10 AND 200),
  opciones text[] NOT NULL CHECK (cardinality(opciones) = 4),
  correcta smallint NOT NULL CHECK (correcta BETWEEN 0 AND 3),
  tema text NOT NULL,
  activa boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.partidas_trivia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.table_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  preguntas uuid[] NOT NULL,
  puntaje integer CHECK (puntaje BETWEEN 0 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  terminada_at timestamptz
);
CREATE INDEX IF NOT EXISTS partidas_trivia_sesion ON public.partidas_trivia (session_id);
CREATE INDEX IF NOT EXISTS partidas_trivia_usuario ON public.partidas_trivia (user_id);
CREATE INDEX IF NOT EXISTS partidas_trivia_tenant ON public.partidas_trivia (tenant_id);

CREATE TABLE IF NOT EXISTS public.ruletas_mesa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.table_sessions(id) ON DELETE CASCADE,
  giro_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  elegido_id uuid REFERENCES public.comensales_mesa(id) ON DELETE SET NULL,
  elegido_alias text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ruletas_mesa_sesion ON public.ruletas_mesa (session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ruletas_mesa_giro ON public.ruletas_mesa (giro_user_id) WHERE giro_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ruletas_mesa_elegido ON public.ruletas_mesa (elegido_id) WHERE elegido_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ruletas_mesa_tenant ON public.ruletas_mesa (tenant_id);

-- Nada se lee ni escribe directo desde el navegador: todo va por las funciones de abajo
ALTER TABLE public.preguntas_trivia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partidas_trivia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ruletas_mesa ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.preguntas_trivia, public.partidas_trivia, public.ruletas_mesa FROM anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Trivia
-- ─────────────────────────────────────────────────────────────────────────────
-- Empieza una partida: 5 preguntas al azar, sin la respuesta correcta. Hasta 3 partidas por persona y visita.
CREATE OR REPLACE FUNCTION public.empezar_trivia(_qr_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  v_ids uuid[];
  v_partida uuid;
BEGIN
  SELECT * INTO c FROM public._comensal_en_mesa(_qr_token);
  IF (SELECT count(*) FROM public.partidas_trivia p WHERE p.session_id = c.sesion AND p.user_id = (SELECT auth.uid())) >= 3 THEN
    RAISE EXCEPTION 'Ya jugaste 3 trivias en esta visita. ¡La próxima vez hay más!' USING ERRCODE = 'P0001';
  END IF;
  SELECT array_agg(q.id) INTO v_ids
    FROM (SELECT id FROM public.preguntas_trivia WHERE activa ORDER BY random() LIMIT 5) q;
  IF coalesce(cardinality(v_ids), 0) < 5 THEN
    RAISE EXCEPTION 'La trivia no está disponible por ahora' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.partidas_trivia (tenant_id, session_id, user_id, preguntas)
  VALUES ((c.mesa).tenant_id, c.sesion, (SELECT auth.uid()), v_ids)
  RETURNING id INTO v_partida;
  RETURN jsonb_build_object('partida', v_partida, 'preguntas', (
    SELECT jsonb_agg(jsonb_build_object('id', q.id, 'pregunta', q.pregunta, 'opciones', to_jsonb(q.opciones)) ORDER BY x.n)
      FROM unnest(v_ids) WITH ORDINALITY AS x(id, n) JOIN public.preguntas_trivia q ON q.id = x.id));
END;
$$;
REVOKE ALL ON FUNCTION public.empezar_trivia(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.empezar_trivia(text) TO authenticated;

-- Corrige la partida (una sola vez) y devuelve el puntaje y las respuestas correctas
CREATE OR REPLACE FUNCTION public.responder_trivia(_qr_token text, _partida uuid, _respuestas integer[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  p public.partidas_trivia;
  v_puntaje integer;
BEGIN
  SELECT * INTO c FROM public._comensal_en_mesa(_qr_token);
  SELECT * INTO p FROM public.partidas_trivia WHERE id = _partida FOR UPDATE;
  IF p.id IS NULL OR p.user_id <> (SELECT auth.uid()) OR p.session_id <> c.sesion THEN
    RAISE EXCEPTION 'No encontramos tu partida' USING ERRCODE = 'P0002';
  END IF;
  IF p.terminada_at IS NOT NULL THEN
    RAISE EXCEPTION 'Esa partida ya terminó' USING ERRCODE = 'P0001';
  END IF;
  IF _respuestas IS NULL OR cardinality(_respuestas) <> cardinality(p.preguntas) THEN
    RAISE EXCEPTION 'Responde todas las preguntas' USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_puntaje
    FROM unnest(p.preguntas, _respuestas) AS x(pregunta, respuesta)
    JOIN public.preguntas_trivia q ON q.id = x.pregunta AND q.correcta = x.respuesta;
  UPDATE public.partidas_trivia SET puntaje = v_puntaje, terminada_at = now() WHERE id = p.id;
  RETURN jsonb_build_object('puntaje', v_puntaje, 'de', cardinality(p.preguntas), 'correctas', (
    SELECT jsonb_agg(q.correcta ORDER BY x.n)
      FROM unnest(p.preguntas) WITH ORDINALITY AS x(id, n) JOIN public.preguntas_trivia q ON q.id = x.id));
END;
$$;
REVOKE ALL ON FUNCTION public.responder_trivia(text, uuid, integer[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.responder_trivia(text, uuid, integer[]) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Ruleta "¿quién invita la próxima?"
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.girar_ruleta(_qr_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  elegido public.comensales_mesa;
  v_alias text;
BEGIN
  SELECT * INTO c FROM public._comensal_en_mesa(_qr_token);
  -- Una vuelta a la vez por mesa (y como mucho una cada 20 segundos)
  PERFORM 1 FROM public.table_sessions WHERE id = c.sesion FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.ruletas_mesa r WHERE r.session_id = c.sesion AND r.created_at > now() - interval '20 seconds') THEN
    RAISE EXCEPTION 'La ruleta recién giró. Espera un momento.' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.comensales_mesa cm WHERE cm.session_id = c.sesion) < 2 THEN
    RAISE EXCEPTION 'Para girar la ruleta tiene que haber al menos dos personas en la mesa' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO elegido FROM public.comensales_mesa cm WHERE cm.session_id = c.sesion ORDER BY random() LIMIT 1;
  v_alias := coalesce(nullif(btrim(elegido.alias), ''), 'Alguien sin nombre');
  INSERT INTO public.ruletas_mesa (tenant_id, session_id, giro_user_id, elegido_id, elegido_alias)
  VALUES ((c.mesa).tenant_id, c.sesion, (SELECT auth.uid()), elegido.id, v_alias);
  RETURN jsonb_build_object('elegido', v_alias, 'soy_yo', elegido.user_id = (SELECT auth.uid()));
END;
$$;
REVOKE ALL ON FUNCTION public.girar_ruleta(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.girar_ruleta(text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. La mesa en vivo muestra el ranking de la trivia y la última vuelta de la ruleta
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  def text := pg_get_functiondef('public.mi_mesa_en_vivo(text)'::regprocedure);
  nuevo text;
BEGIN
  nuevo := replace(def, $q$    'rondas', (SELECT coalesce(jsonb_agg(jsonb_build_object($q$,
    $q$    'trivia', (SELECT coalesce(jsonb_agg(jsonb_build_object('quien', t.quien, 'puntaje', t.puntaje, 'yo', t.yo)
                                         ORDER BY t.puntaje DESC, t.terminada_at), '[]'::jsonb)
                 FROM (SELECT DISTINCT ON (p.user_id) p.user_id, p.puntaje, p.terminada_at,
                              p.user_id = auth.uid() AS yo,
                              coalesce((SELECT cm.alias FROM public.comensales_mesa cm
                                         WHERE cm.session_id = c.sesion AND cm.user_id = p.user_id LIMIT 1), 'Alguien de la mesa') AS quien
                         FROM public.partidas_trivia p
                        WHERE p.session_id = c.sesion AND p.terminada_at IS NOT NULL
                        ORDER BY p.user_id, p.puntaje DESC, p.terminada_at) t),
    'ruleta', (SELECT jsonb_build_object('elegido', r.elegido_alias, 'cuando', r.created_at,
                                         'soy_yo', EXISTS (SELECT 1 FROM public.comensales_mesa cm WHERE cm.id = r.elegido_id AND cm.user_id = auth.uid()))
                 FROM public.ruletas_mesa r WHERE r.session_id = c.sesion ORDER BY r.created_at DESC LIMIT 1),
    'rondas', (SELECT coalesce(jsonb_agg(jsonb_build_object($q$);
  IF nuevo = def THEN RAISE EXCEPTION 'mi_mesa_en_vivo: no se encontró dónde'; END IF;
  EXECUTE nuevo;
END;
$$;

-- Privacidad: lo que jugó el comensal está en sus datos y se borra con su cuenta (la tabla también tiene
-- borrado en cascada desde auth.users).
DO $$
DECLARE
  def text;
  nuevo text;
BEGIN
  def := pg_get_functiondef('public.mis_datos()'::regprocedure);
  nuevo := replace(def, $q$    'sin_promociones_de', (SELECT coalesce(jsonb_agg(t.name), '[]'::jsonb)$q$,
    $q$    'trivias', (SELECT coalesce(jsonb_agg(jsonb_build_object('local', t.name, 'fecha', pt.created_at, 'puntaje', pt.puntaje)), '[]'::jsonb)
                  FROM public.partidas_trivia pt JOIN public.tenants t ON t.id = pt.tenant_id WHERE pt.user_id = yo),
    'sin_promociones_de', (SELECT coalesce(jsonb_agg(t.name), '[]'::jsonb)$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'mis_datos: no se encontró dónde'; END IF;
  EXECUTE nuevo;

  def := pg_get_functiondef('public._borrar_datos_comensal(uuid)'::regprocedure);
  nuevo := replace(def, '  DELETE FROM public.bajas_campanas WHERE user_id = _user_id;',
    '  DELETE FROM public.bajas_campanas WHERE user_id = _user_id;
  DELETE FROM public.partidas_trivia WHERE user_id = _user_id;
  UPDATE public.ruletas_mesa SET giro_user_id = NULL WHERE giro_user_id = _user_id;');
  IF nuevo = def THEN RAISE EXCEPTION '_borrar_datos_comensal: no se encontró dónde'; END IF;
  EXECUTE nuevo;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. El banco de preguntas (Tablio lo amplía con el tiempo)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.preguntas_trivia (pregunta, opciones, correcta, tema) VALUES
  ('¿Cuál es la capital de Chile?', ARRAY['Valparaíso', 'Santiago', 'Concepción', 'La Serena'], 1, 'geografía'),
  ('¿Cuál es el desierto más árido del mundo?', ARRAY['Sahara', 'Gobi', 'Atacama', 'Kalahari'], 2, 'geografía'),
  ('¿Qué isla chilena es famosa por sus moái?', ARRAY['Chiloé', 'Isla de Pascua', 'Juan Fernández', 'Isla Mocha'], 1, 'geografía'),
  ('¿Cuál es el cerro más visitado de Santiago?', ARRAY['Cerro San Cristóbal', 'Cerro Santa Lucía', 'Cerro Manquehue', 'Cerro El Plomo'], 0, 'geografía'),
  ('¿En qué región está Puerto Natales?', ARRAY['Los Lagos', 'Aysén', 'Magallanes', 'Los Ríos'], 2, 'geografía'),
  ('¿Qué parque nacional es famoso por las Torres?', ARRAY['Torres del Paine', 'Conguillío', 'Vicente Pérez Rosales', 'Lauca'], 0, 'geografía'),
  ('¿Cuántas regiones tiene Chile hoy?', ARRAY['13', '15', '16', '18'], 2, 'geografía'),
  ('¿Qué océano baña las costas de Chile?', ARRAY['Atlántico', 'Índico', 'Pacífico', 'Ártico'], 2, 'geografía'),
  ('¿Cómo se llama el volcán activo cerca de Pucón?', ARRAY['Osorno', 'Villarrica', 'Llaima', 'Calbuco'], 1, 'geografía'),
  ('¿Qué ciudad chilena es conocida como "la Perla del Pacífico"?', ARRAY['Antofagasta', 'Iquique', 'Valparaíso', 'Arica'], 2, 'geografía'),
  ('¿Qué lleva el sándwich Barros Luco?', ARRAY['Carne y queso', 'Pollo y palta', 'Lomo y tomate', 'Jamón y queso'], 0, 'comida'),
  ('¿Con qué se hace el pastel de choclo?', ARRAY['Papa', 'Maíz', 'Zapallo', 'Arroz'], 1, 'comida'),
  ('¿Qué fruta va en el mote con huesillo?', ARRAY['Ciruela', 'Durazno deshidratado', 'Damasco fresco', 'Manzana'], 1, 'comida'),
  ('El completo italiano lleva palta, tomate y...', ARRAY['Chucrut', 'Mayonesa', 'Queso', 'Salsa verde'], 1, 'comida'),
  ('¿Cómo se llama el guiso chilote cocinado en un hoyo con piedras calientes?', ARRAY['Paila marina', 'Curanto', 'Charquicán', 'Cazuela'], 1, 'comida'),
  ('¿Qué es el pebre?', ARRAY['Un postre', 'Un pan', 'Una salsa de tomate, cebolla y cilantro', 'Una sopa'], 2, 'comida'),
  ('¿Qué lleva la chorrillana además de papas fritas?', ARRAY['Carne, cebolla y huevo', 'Pollo y arroz', 'Mariscos', 'Verduras al vapor'], 0, 'comida'),
  ('¿Qué pan es típico en Chile y se llama también "pan batido"?', ARRAY['Hallulla', 'Marraqueta', 'Dobladita', 'Colisa'], 1, 'comida'),
  ('¿Qué lleva el pino de las empanadas?', ARRAY['Carne, cebolla, huevo y aceituna', 'Solo queso', 'Mariscos', 'Verduras salteadas'], 0, 'comida'),
  ('¿Qué dulce chileno se rellena con manjar y se cubre de chocolate?', ARRAY['Calzones rotos', 'Sopaipilla', 'Alfajor', 'Picarones'], 2, 'comida'),
  ('¿Qué baile es el baile nacional de Chile?', ARRAY['La cumbia', 'La cueca', 'El tango', 'La salsa'], 1, 'cultura'),
  ('¿Qué poeta chilena ganó el Premio Nobel en 1945?', ARRAY['Violeta Parra', 'Gabriela Mistral', 'Isabel Allende', 'Marcela Paz'], 1, 'cultura'),
  ('¿Qué poeta escribió "Veinte poemas de amor y una canción desesperada"?', ARRAY['Pablo Neruda', 'Nicanor Parra', 'Vicente Huidobro', 'Gonzalo Rojas'], 0, 'cultura'),
  ('¿Quién escribió "Papelucho"?', ARRAY['Marcela Paz', 'Gabriela Mistral', 'Isabel Allende', 'Alberto Fuguet'], 0, 'cultura'),
  ('¿Qué cantautora chilena compuso "Gracias a la vida"?', ARRAY['Mon Laferte', 'Violeta Parra', 'Javiera Mena', 'Francisca Valenzuela'], 1, 'cultura'),
  ('¿En qué mes se celebran las Fiestas Patrias en Chile?', ARRAY['Julio', 'Agosto', 'Septiembre', 'Octubre'], 2, 'cultura'),
  ('¿Qué instrumento andino se toca soplando cañas de distinto largo?', ARRAY['Charango', 'Zampoña', 'Bombo', 'Guitarra'], 1, 'cultura'),
  ('¿Cuál es la flor nacional de Chile?', ARRAY['Copihue', 'Rosa', 'Añañuca', 'Clavel'], 0, 'cultura'),
  ('¿Qué animal aparece en el escudo de Chile junto al huemul?', ARRAY['Puma', 'Cóndor', 'Zorro', 'Pudú'], 1, 'cultura'),
  ('¿Qué selección ganó la Copa América 2015 y 2016?', ARRAY['Argentina', 'Brasil', 'Chile', 'Uruguay'], 2, 'deportes'),
  ('¿Cuántos jugadores tiene un equipo de fútbol en la cancha?', ARRAY['9', '10', '11', '12'], 2, 'deportes'),
  ('¿En qué deporte destacó Marcelo Ríos?', ARRAY['Fútbol', 'Tenis', 'Básquetbol', 'Natación'], 1, 'deportes'),
  ('¿Cuántos minutos dura un partido de fútbol sin alargue?', ARRAY['60', '80', '90', '120'], 2, 'deportes'),
  ('¿Cuál es el planeta más grande del sistema solar?', ARRAY['Saturno', 'Júpiter', 'Neptuno', 'Tierra'], 1, 'general'),
  ('¿Cuántos días tiene un año bisiesto?', ARRAY['364', '365', '366', '367'], 2, 'general'),
  ('¿Qué gas respiran las plantas para hacer la fotosíntesis?', ARRAY['Oxígeno', 'Dióxido de carbono', 'Nitrógeno', 'Helio'], 1, 'general'),
  ('¿Cuántos lados tiene un hexágono?', ARRAY['5', '6', '7', '8'], 1, 'general'),
  ('¿Cuál es el animal terrestre más rápido?', ARRAY['León', 'Guepardo', 'Caballo', 'Antílope'], 1, 'general'),
  ('¿Qué color resulta de mezclar azul y amarillo?', ARRAY['Morado', 'Naranjo', 'Verde', 'Café'], 2, 'general'),
  ('¿Cuántas patas tiene una araña?', ARRAY['6', '8', '10', '12'], 1, 'general')
ON CONFLICT (pregunta) DO NOTHING;
