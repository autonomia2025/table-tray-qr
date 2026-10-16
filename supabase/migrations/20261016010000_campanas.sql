-- Fase 7.1 — Campañas: el local le escribe a sus propios clientes, por aviso al celular (el correo se suma
-- cuando haya dominio y Resend).
--
-- A quién: solo a quien guardó su cuenta (verificada), aceptó "novedades y promociones de los locales donde
-- junto sellos" (consentimientos_comensal) y juntó sellos en ESTE local, y no se dio de baja de él.
-- Públicos listos: todos, los que no vienen hace 30 días, los frecuentes (3 visitas en 90 días) y los que
-- pidieron un plato. Límites: hasta 4 campañas por local en 30 días, una persona recibe a lo más una por
-- local cada 7 días, y solo entre las 10:00 y las 22:00 de Chile. Nada que premie tomar más alcohol y sin
-- enlaces en el mensaje. Cada aviso trae su propio enlace (token): abre la promoción y permite darse de baja.
-- Se mide: a cuántos llegó, cuántos la abrieron, cuántos volvieron a pagar en 7 días y cuánto gastaron.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Permiso nuevo en el catálogo (fase 6.3): de fábrica solo dueño y administrador; se le puede dar al
--    encargado.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._catalogo_permisos()
RETURNS TABLE (permiso text, nombre text, accion text, descripcion text, por_defecto text[], posibles text[], orden integer)
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  VALUES
    ('cobrar',          'Cobrar en el local',        'cobrar en el local',           'Registrar cobros en efectivo, POS o transferencia.',          ARRAY['manager', 'cashier', 'waiter'], ARRAY['manager', 'cashier', 'waiter'], 1),
    ('tomar_pedidos',   'Tomar pedidos a mano',      'tomar pedidos a mano',         'Crear pedidos desde la pantalla del mozo.',                   ARRAY['manager', 'waiter'],            ARRAY['manager', 'waiter'],            2),
    ('anular_pedidos',  'Anular pedidos',            'anular pedidos',               'Anular un pedido, con motivo.',                               ARRAY['manager'],                      ARRAY['manager', 'cashier'],           3),
    ('reembolsar',      'Devolver plata',            'devolver plata',               'Reembolsar un pago, con motivo.',                             ARRAY['manager', 'cashier'],           ARRAY['manager', 'cashier'],           4),
    ('cerrar_caja',     'Cortes y cierre de caja',   'hacer cortes y cerrar la caja','Hacer cortes de turno y cerrar la caja del día.',             ARRAY['manager', 'cashier'],           ARRAY['manager', 'cashier'],           5),
    ('ver_reportes',    'Ver reportes',              'ver los reportes',             'Inicio, reportes de ventas y desempeño del equipo.',          ARRAY['manager'],                      ARRAY['manager', 'cashier'],           6),
    ('editar_carta',    'Editar la carta',           'editar la carta',              'Platos, precios, fotos y categorías.',                        ARRAY['manager'],                      ARRAY['manager', 'cashier'],           7),
    ('marcar_agotado',  'Marcar agotados',           'marcar productos agotados',    'Marcar un producto agotado desde la cocina.',                 ARRAY['manager', 'kitchen'],           ARRAY['manager', 'kitchen'],           8),
    ('enviar_campanas', 'Enviar campañas',           'enviar campañas',              'Promociones a los clientes que aceptaron recibirlas.',        ARRAY[]::text[],                       ARRAY['manager'],                      9)
$$;
REVOKE ALL ON FUNCTION public._catalogo_permisos() FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Tablas
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.campanas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  titulo text NOT NULL CHECK (char_length(titulo) BETWEEN 3 AND 50),
  mensaje text NOT NULL CHECK (char_length(mensaje) BETWEEN 10 AND 180),
  publico text NOT NULL CHECK (publico IN ('todos', 'dormidos', 'frecuentes', 'por_plato')),
  menu_item_id uuid REFERENCES public.menu_items(id) ON DELETE SET NULL,
  estado text NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'enviada')),
  creada_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  enviada_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  enviada_at timestamptz,
  -- Lo que se mide queda guardado (no cambia si después alguien borra su cuenta)
  destinatarios integer NOT NULL DEFAULT 0,
  con_aviso integer NOT NULL DEFAULT 0,
  entregados integer NOT NULL DEFAULT 0,
  fallidos integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS campanas_tenant ON public.campanas (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS campanas_enviadas ON public.campanas (tenant_id, enviada_at) WHERE estado = 'enviada';
CREATE INDEX IF NOT EXISTS campanas_menu_item ON public.campanas (menu_item_id) WHERE menu_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS campanas_creada_por ON public.campanas (creada_por) WHERE creada_por IS NOT NULL;
CREATE INDEX IF NOT EXISTS campanas_enviada_por ON public.campanas (enviada_por) WHERE enviada_por IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.envios_campana (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campana_id uuid NOT NULL REFERENCES public.campanas(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- El enlace de cada aviso: abre la promoción y permite darse de baja (sin iniciar sesión)
  token text NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(16), 'hex'),
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'enviado', 'fallido', 'sin_aviso')),
  created_at timestamptz NOT NULL DEFAULT now(),
  enviado_at timestamptz,
  abierto_at timestamptz,
  UNIQUE (campana_id, user_id)
);
CREATE INDEX IF NOT EXISTS envios_campana_persona ON public.envios_campana (tenant_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS envios_campana_usuario ON public.envios_campana (user_id) WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.bajas_campanas (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
CREATE INDEX IF NOT EXISTS bajas_campanas_usuario ON public.bajas_campanas (user_id);

ALTER TABLE public.campanas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.envios_campana ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bajas_campanas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.campanas, public.envios_campana, public.bajas_campanas FROM anon, authenticated;
-- Las campañas se leen por resultados_campanas; los envíos y las bajas, nunca desde el navegador (tienen
-- a quién se le escribió). Todo se escribe con funciones.
GRANT SELECT ON public.campanas TO authenticated;
CREATE POLICY campanas_lectura ON public.campanas FOR SELECT TO authenticated
  USING (public.tiene_permiso(tenant_id, 'enviar_campanas'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. A quién le llega
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._destinatarios_campana(_tenant_id uuid, _publico text, _plato uuid)
RETURNS TABLE (user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH clientes AS (
    SELECT m.user_id, max(m.created_at) AS ultima,
           count(DISTINCT m.dia_negocio) FILTER (WHERE m.created_at > now() - interval '90 days') AS visitas
      FROM public.movimientos_lealtad m
     WHERE m.tenant_id = _tenant_id AND m.user_id IS NOT NULL AND m.anulado_at IS NULL
     GROUP BY m.user_id)
  SELECT c.user_id
    FROM clientes c
    JOIN public.consentimientos_comensal k ON k.user_id = c.user_id AND k.promociones
    JOIN auth.users u ON u.id = c.user_id AND NOT coalesce(u.is_anonymous, false)
   WHERE NOT EXISTS (SELECT 1 FROM public.bajas_campanas b WHERE b.tenant_id = _tenant_id AND b.user_id = c.user_id)
     AND CASE _publico
           WHEN 'todos' THEN true
           WHEN 'dormidos' THEN c.ultima < now() - interval '30 days'
           WHEN 'frecuentes' THEN c.visitas >= 3
           WHEN 'por_plato' THEN EXISTS (
             SELECT 1 FROM public.orders o JOIN public.order_items oi ON oi.order_id = o.id
              WHERE o.tenant_id = _tenant_id AND o.user_id = c.user_id AND oi.menu_item_id = _plato
                AND o.payment_status = 'paid' AND o.created_at > now() - interval '90 days')
           ELSE false
         END
$$;
REVOKE ALL ON FUNCTION public._destinatarios_campana(uuid, text, uuid) FROM PUBLIC, anon, authenticated;

-- Quien recibió una campaña de este local hace menos de 7 días descansa
CREATE OR REPLACE FUNCTION public._descansando(_tenant_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.envios_campana e
                  WHERE e.tenant_id = _tenant_id AND e.user_id = _user_id AND e.created_at > now() - interval '7 days')
$$;
REVOKE ALL ON FUNCTION public._descansando(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.publico_campana(_tenant_id uuid, _publico text, _plato uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r jsonb;
BEGIN
  PERFORM public._exigir_permiso(_tenant_id, 'enviar_campanas');
  SELECT jsonb_build_object(
           'total', count(*),
           'descansando', count(*) FILTER (WHERE public._descansando(_tenant_id, d.user_id)),
           'con_aviso', count(*) FILTER (WHERE NOT public._descansando(_tenant_id, d.user_id)
                                          AND EXISTS (SELECT 1 FROM public.suscripciones_push s
                                                       WHERE s.tenant_id = _tenant_id AND s.user_id = d.user_id)))
    INTO r
    FROM public._destinatarios_campana(_tenant_id, _publico, _plato) d;
  RETURN r;
END;
$$;
REVOKE ALL ON FUNCTION public.publico_campana(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publico_campana(uuid, text, uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Escribir, guardar y enviar
-- ─────────────────────────────────────────────────────────────────────────────
-- Revisa el texto: sin enlaces (nadie se hace pasar por el local) y nada que premie tomar más alcohol
CREATE OR REPLACE FUNCTION public._revisar_texto_campana(_texto text)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  t text := lower(coalesce(_texto, ''));
BEGIN
  IF t ~ '(https?://|www\.|\.(cl|com|net|org|app|ly)(\M|/))' THEN
    RAISE EXCEPTION 'El mensaje no puede llevar enlaces: el aviso ya abre la promoción del local' USING ERRCODE = 'P0001';
  END IF;
  IF t ~ '(barra libre|happy hour|al seco|hasta que (te )?(caigas|aguantes))'
     OR (t ~ '\m(cervezas?|chelas?|schops?|shops?|tragos?|piscos?|piscolas?|vinos?|shots?|copetes?|ron|vodka|whisky|tequila|gin|terremotos?|micheladas?|mojitos?|alcohol)\M'
         AND t ~ '(gratis|2 ?x ?1|3 ?x ?2|dos por uno|ilimitad|doble|la segunda)') THEN
    RAISE EXCEPTION 'Las campañas no pueden premiar tomar más alcohol (por ejemplo, 2x1 o gratis en tragos). Cambia el mensaje.' USING ERRCODE = 'P0001';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public._revisar_texto_campana(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guardar_campana(
  _tenant_id uuid, _titulo text, _mensaje text, _publico text, _plato uuid DEFAULT NULL, _campana_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_titulo text := btrim(coalesce(_titulo, ''));
  v_mensaje text := btrim(coalesce(_mensaje, ''));
  v_id uuid;
BEGIN
  PERFORM public._exigir_permiso(_tenant_id, 'enviar_campanas');
  IF char_length(v_titulo) NOT BETWEEN 3 AND 50 THEN
    RAISE EXCEPTION 'El título va de 3 a 50 letras' USING ERRCODE = 'P0001';
  END IF;
  IF char_length(v_mensaje) NOT BETWEEN 10 AND 180 THEN
    RAISE EXCEPTION 'El mensaje va de 10 a 180 letras' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public._revisar_texto_campana(v_titulo || ' ' || v_mensaje);
  IF _publico NOT IN ('todos', 'dormidos', 'frecuentes', 'por_plato') THEN
    RAISE EXCEPTION 'Elige a quién le llega' USING ERRCODE = 'P0001';
  END IF;
  IF _publico = 'por_plato' AND NOT EXISTS (SELECT 1 FROM public.menu_items m WHERE m.id = _plato AND m.tenant_id = _tenant_id) THEN
    RAISE EXCEPTION 'Elige el plato' USING ERRCODE = 'P0001';
  END IF;

  IF _campana_id IS NULL THEN
    INSERT INTO public.campanas (tenant_id, titulo, mensaje, publico, menu_item_id, creada_por)
    VALUES (_tenant_id, v_titulo, v_mensaje, _publico, CASE WHEN _publico = 'por_plato' THEN _plato END, (SELECT auth.uid()))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.campanas
       SET titulo = v_titulo, mensaje = v_mensaje, publico = _publico,
           menu_item_id = CASE WHEN _publico = 'por_plato' THEN _plato END, updated_at = now()
     WHERE id = _campana_id AND tenant_id = _tenant_id AND estado = 'borrador'
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Esa campaña ya se envió y no se puede cambiar' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.guardar_campana(uuid, text, text, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_campana(uuid, text, text, text, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.borrar_campana(_campana_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.campanas;
BEGIN
  SELECT * INTO c FROM public.campanas WHERE id = _campana_id;
  PERFORM public._exigir_permiso(c.tenant_id, 'enviar_campanas');
  IF c.estado <> 'borrador' THEN
    RAISE EXCEPTION 'Una campaña enviada no se borra: queda para medir sus resultados' USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM public.campanas WHERE id = _campana_id;
END;
$$;
REVOKE ALL ON FUNCTION public.borrar_campana(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.borrar_campana(uuid) TO authenticated;

-- Los límites viven en la configuración de la plataforma (configuracion_tablio, clave "campanas")
CREATE OR REPLACE FUNCTION public._reglas_campanas()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object('limite_30_dias', 4, 'desde_hora', 10, 'hasta_hora', 22)
         || coalesce((SELECT valor FROM public.configuracion_tablio WHERE clave = 'campanas'), '{}'::jsonb)
$$;
REVOKE ALL ON FUNCTION public._reglas_campanas() FROM PUBLIC, anon, authenticated;

-- Reserva el envío: deja la campaña como enviada y anota a quién le va (idempotente: si ya se envió,
-- devuelve lo que quedó). Los avisos los manda la función enviar-campana, que nunca le muestra al
-- navegador las direcciones de los celulares.
CREATE OR REPLACE FUNCTION public.enviar_campana(_campana_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.campanas;
  reglas jsonb := public._reglas_campanas();
  hora numeric := extract(hour FROM now() AT TIME ZONE 'America/Santiago') + extract(minute FROM now() AT TIME ZONE 'America/Santiago') / 60.0;
  enviadas integer;
BEGIN
  SELECT * INTO c FROM public.campanas WHERE id = _campana_id;
  PERFORM public._exigir_permiso(c.tenant_id, 'enviar_campanas');
  -- Una campaña a la vez por local: así el límite de 30 días no se pasa con dos clics al mismo tiempo
  PERFORM 1 FROM public.tenants WHERE id = c.tenant_id FOR UPDATE;
  SELECT * INTO c FROM public.campanas WHERE id = _campana_id;
  IF c.estado = 'enviada' THEN
    RETURN jsonb_build_object('id', c.id, 'destinatarios', c.destinatarios, 'con_aviso', c.con_aviso, 'ya_enviada', true);
  END IF;

  IF hora < (reglas ->> 'desde_hora')::numeric OR hora >= (reglas ->> 'hasta_hora')::numeric THEN
    RAISE EXCEPTION 'Los avisos se mandan entre las % y las % horas, para no molestar. Guárdala y mándala en ese horario.',
      reglas ->> 'desde_hora', reglas ->> 'hasta_hora' USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO enviadas FROM public.campanas
   WHERE tenant_id = c.tenant_id AND estado = 'enviada' AND enviada_at > now() - interval '30 days';
  IF enviadas >= (reglas ->> 'limite_30_dias')::integer THEN
    RAISE EXCEPTION 'Ya mandaste % campañas en los últimos 30 días. Así tus clientes no se cansan: espera unos días.',
      enviadas USING ERRCODE = 'P0001';
  END IF;
  IF c.publico = 'por_plato' AND c.menu_item_id IS NULL THEN
    RAISE EXCEPTION 'El plato de esta campaña ya no está en la carta: elige otro' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public._revisar_texto_campana(c.titulo || ' ' || c.mensaje);

  INSERT INTO public.envios_campana (campana_id, tenant_id, user_id, estado)
  SELECT c.id, c.tenant_id, d.user_id,
         CASE WHEN EXISTS (SELECT 1 FROM public.suscripciones_push s WHERE s.tenant_id = c.tenant_id AND s.user_id = d.user_id)
              THEN 'pendiente' ELSE 'sin_aviso' END
    FROM public._destinatarios_campana(c.tenant_id, c.publico, c.menu_item_id) d
   WHERE NOT public._descansando(c.tenant_id, d.user_id);

  UPDATE public.campanas
     SET estado = 'enviada', enviada_at = now(), enviada_por = (SELECT auth.uid()), updated_at = now(),
         destinatarios = (SELECT count(*) FROM public.envios_campana e WHERE e.campana_id = c.id),
         con_aviso = (SELECT count(*) FROM public.envios_campana e WHERE e.campana_id = c.id AND e.estado = 'pendiente')
   WHERE id = c.id
  RETURNING * INTO c;

  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (c.tenant_id, (SELECT auth.uid()), 'campana_enviada', 'campana', c.id,
          jsonb_build_object('titulo', c.titulo, 'publico', c.publico, 'destinatarios', c.destinatarios, 'con_aviso', c.con_aviso));
  RETURN jsonb_build_object('id', c.id, 'destinatarios', c.destinatarios, 'con_aviso', c.con_aviso, 'ya_enviada', false);
END;
$$;
REVOKE ALL ON FUNCTION public.enviar_campana(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enviar_campana(uuid) TO authenticated;

-- Solo para la función enviar-campana (service_role): los avisos pendientes con sus celulares
CREATE OR REPLACE FUNCTION public._avisos_por_mandar(_campana_id uuid)
RETURNS TABLE (envio_id uuid, token text, suscripcion_id uuid, endpoint text, p256dh text, auth text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.id, e.token, s.id, s.endpoint, s.p256dh, s.auth
    FROM public.envios_campana e
    JOIN public.suscripciones_push s ON s.tenant_id = e.tenant_id AND s.user_id = e.user_id
   WHERE e.campana_id = _campana_id AND e.estado = 'pendiente'
$$;
REVOKE ALL ON FUNCTION public._avisos_por_mandar(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._avisos_por_mandar(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public._anotar_aviso_campana(_envio_id uuid, _llego boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campana uuid;
BEGIN
  -- Una persona con dos celulares: basta que llegue a uno
  UPDATE public.envios_campana
     SET estado = CASE WHEN _llego OR estado = 'enviado' THEN 'enviado' ELSE 'fallido' END,
         enviado_at = CASE WHEN _llego THEN coalesce(enviado_at, now()) ELSE enviado_at END
   WHERE id = _envio_id
  RETURNING campana_id INTO v_campana;
  UPDATE public.campanas
     SET entregados = (SELECT count(*) FROM public.envios_campana e WHERE e.campana_id = v_campana AND e.estado = 'enviado'),
         fallidos = (SELECT count(*) FROM public.envios_campana e WHERE e.campana_id = v_campana AND e.estado = 'fallido')
   WHERE id = v_campana;
END;
$$;
REVOKE ALL ON FUNCTION public._anotar_aviso_campana(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._anotar_aviso_campana(uuid, boolean) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Resultados: a cuántos llegó, cuántos la abrieron, cuántos volvieron en 7 días y cuánto gastaron
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resultados_campanas(_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._exigir_permiso(_tenant_id, 'enviar_campanas');
  RETURN (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'id', c.id, 'titulo', c.titulo, 'mensaje', c.mensaje, 'publico', c.publico,
             'plato', c.menu_item_id, 'plato_nombre', (SELECT m.name FROM public.menu_items m WHERE m.id = c.menu_item_id),
             'estado', c.estado, 'creada_at', c.created_at, 'enviada_at', c.enviada_at,
             'destinatarios', c.destinatarios, 'con_aviso', c.con_aviso, 'entregados', c.entregados, 'fallidos', c.fallidos,
             'abiertos', (SELECT count(*) FROM public.envios_campana e WHERE e.campana_id = c.id AND e.abierto_at IS NOT NULL),
             'volvieron', r.volvieron, 'ventas', r.ventas,
             'medicion_abierta', c.enviada_at > now() - interval '7 days'
           ) ORDER BY coalesce(c.enviada_at, c.created_at) DESC), '[]'::jsonb)
      FROM public.campanas c
      LEFT JOIN LATERAL (
        SELECT count(DISTINCT p.user_id) AS volvieron, coalesce(sum(p.amount - p.refunded_amount), 0) AS ventas
          FROM public.payments p
         WHERE c.estado = 'enviada' AND p.tenant_id = c.tenant_id
           AND p.status IN ('approved', 'partially_refunded')
           AND p.created_at > c.enviada_at AND p.created_at <= c.enviada_at + interval '7 days'
           AND p.user_id IN (SELECT e.user_id FROM public.envios_campana e WHERE e.campana_id = c.id AND e.user_id IS NOT NULL)
      ) r ON true
     WHERE c.tenant_id = _tenant_id);
END;
$$;
REVOKE ALL ON FUNCTION public.resultados_campanas(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resultados_campanas(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Del lado del cliente: el enlace de cada aviso (públicas a propósito: el token es secreto, de una
--    persona y de una campaña; no muestran nada de quién lo recibió)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ver_promo(_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e public.envios_campana;
BEGIN
  IF _token IS NULL OR _token !~ '^[0-9a-f]{32}$' THEN RETURN NULL; END IF;
  UPDATE public.envios_campana SET abierto_at = coalesce(abierto_at, now()) WHERE token = _token RETURNING * INTO e;
  IF e.id IS NULL THEN RETURN NULL; END IF;
  RETURN (
    SELECT jsonb_build_object('local', t.name, 'slug', t.slug, 'color', t.primary_color, 'logo', t.logo_url,
             'titulo', c.titulo, 'mensaje', c.mensaje, 'enviada_at', c.enviada_at,
             'de_baja', EXISTS (SELECT 1 FROM public.bajas_campanas b WHERE b.tenant_id = e.tenant_id AND b.user_id = e.user_id))
      FROM public.campanas c JOIN public.tenants t ON t.id = c.tenant_id
     WHERE c.id = e.campana_id);
END;
$$;
REVOKE ALL ON FUNCTION public.ver_promo(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ver_promo(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.baja_promo(_token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e public.envios_campana;
BEGIN
  IF _token IS NULL OR _token !~ '^[0-9a-f]{32}$' THEN RETURN false; END IF;
  SELECT * INTO e FROM public.envios_campana WHERE token = _token;
  IF e.id IS NULL THEN RETURN false; END IF;
  IF e.user_id IS NOT NULL THEN
    INSERT INTO public.bajas_campanas (tenant_id, user_id) VALUES (e.tenant_id, e.user_id) ON CONFLICT DO NOTHING;
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.baja_promo(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.baja_promo(text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Encajes con lo existente
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  def text;
  nuevo text;
BEGIN
  -- Funciones públicas a propósito (auditoria_seguridad)
  def := pg_get_functiondef('public.auditoria_seguridad()'::regprocedure);
  nuevo := replace(def, $q$'equipo_de_tablet', 'rango_estado'];$q$,
                        $q$'equipo_de_tablet', 'rango_estado', 'ver_promo', 'baja_promo'];$q$);
  nuevo := replace(nuevo, '  -- rango_estado es una tabla de equivalencias sin datos.',
    '  -- rango_estado es una tabla de equivalencias sin datos.
  -- ver_promo y baja_promo abren el enlace de un aviso de campaña: el token es secreto y de una sola persona.');
  IF nuevo = def THEN RAISE EXCEPTION 'auditoria_seguridad: no se encontró la lista de funciones públicas'; END IF;
  EXECUTE nuevo;

  -- Privacidad: lo que el comensal ve de sí mismo
  def := pg_get_functiondef('public.mis_datos()'::regprocedure);
  nuevo := replace(def, $q$'avisos_al_celular', (SELECT count(*) FROM public.suscripciones_push s WHERE s.user_id = yo));$q$,
    $q$'avisos_al_celular', (SELECT count(*) FROM public.suscripciones_push s WHERE s.user_id = yo),
    'campanas_recibidas', (SELECT coalesce(jsonb_agg(jsonb_build_object('local', t.name, 'titulo', c.titulo, 'fecha', e.created_at,
                                                                         'abierta', e.abierto_at IS NOT NULL) ORDER BY e.created_at DESC), '[]'::jsonb)
                             FROM public.envios_campana e JOIN public.campanas c ON c.id = e.campana_id
                             JOIN public.tenants t ON t.id = e.tenant_id WHERE e.user_id = yo),
    'sin_promociones_de', (SELECT coalesce(jsonb_agg(t.name), '[]'::jsonb)
                             FROM public.bajas_campanas b JOIN public.tenants t ON t.id = b.tenant_id WHERE b.user_id = yo));$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'mis_datos: no se encontró el final'; END IF;
  EXECUTE nuevo;

  -- Privacidad: al borrar una persona
  def := pg_get_functiondef('public._borrar_datos_comensal(uuid)'::regprocedure);
  nuevo := replace(def, '  DELETE FROM public.consentimientos_comensal WHERE user_id = _user_id;',
    '  DELETE FROM public.consentimientos_comensal WHERE user_id = _user_id;
  DELETE FROM public.envios_campana WHERE user_id = _user_id;
  DELETE FROM public.bajas_campanas WHERE user_id = _user_id;');
  IF nuevo = def THEN RAISE EXCEPTION '_borrar_datos_comensal: no se encontró dónde'; END IF;
  EXECUTE nuevo;

  -- El reinicio del demo borra sus campañas y deja al cliente de ejemplo aceptando promociones (es ficticio)
  def := pg_get_functiondef('public.reiniciar_demo()'::regprocedure);
  nuevo := replace(def, '  DELETE FROM public.permisos_rol WHERE tenant_id = demo;',
    '  DELETE FROM public.permisos_rol WHERE tenant_id = demo;
  DELETE FROM public.campanas WHERE tenant_id = demo;
  DELETE FROM public.bajas_campanas WHERE tenant_id = demo;
  INSERT INTO public.consentimientos_comensal (user_id, promociones, politica_version)
    SELECT u.id, true, ''demo'' FROM auth.users u WHERE u.email = ''cliente@demo.tablio.test''
    ON CONFLICT (user_id) DO UPDATE SET promociones = true, actualizado_at = now();');
  IF nuevo = def THEN RAISE EXCEPTION 'reiniciar_demo: no se encontró dónde'; END IF;
  EXECUTE nuevo;

  -- La auditoría de la operación revisa las campañas
  def := pg_get_functiondef('public.auditoria_operacion()'::regprocedure);
  nuevo := regexp_replace(def, '\n(\s*END;\s*\$function\$)', $q$

  -- Fase 7.1: un aviso es del mismo local que su campaña; nadie recibe una campaña de un local del que se
  -- dio de baja; ningún local pasa el límite de campañas.
  RETURN QUERY
  SELECT 'envio_campana_incoherente', e.id::text,
         CASE WHEN e.tenant_id <> c.tenant_id THEN 'Aviso de un local distinto al de su campaña'
              ELSE 'Aviso a alguien que se había dado de baja de ese local' END
    FROM public.envios_campana e JOIN public.campanas c ON c.id = e.campana_id
   WHERE e.tenant_id <> c.tenant_id
      OR EXISTS (SELECT 1 FROM public.bajas_campanas b
                  WHERE b.tenant_id = e.tenant_id AND b.user_id = e.user_id AND b.created_at < e.created_at);

  RETURN QUERY
  SELECT 'campanas_sobre_limite', c.tenant_id::text, count(*)::text || ' campañas en 30 días'
    FROM public.campanas c
   WHERE c.estado = 'enviada' AND c.enviada_at > now() - interval '30 days'
   GROUP BY c.tenant_id
  HAVING count(*) > (public._reglas_campanas() ->> 'limite_30_dias')::integer;
\1$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'auditoria_operacion: no se encontró el final'; END IF;
  EXECUTE nuevo;
END;
$$;

-- El cliente de ejemplo del demo acepta promociones (cuenta ficticia), para que el demo tenga a quién escribirle
INSERT INTO public.consentimientos_comensal (user_id, promociones, politica_version)
  SELECT u.id, true, 'demo' FROM auth.users u WHERE u.email = 'cliente@demo.tablio.test'
  ON CONFLICT (user_id) DO UPDATE SET promociones = true, actualizado_at = now();
