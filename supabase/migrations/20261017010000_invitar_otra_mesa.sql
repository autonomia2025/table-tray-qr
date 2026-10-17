-- Fase 9.1 — Invitar un trago a otra mesa (brief 6.2). Alguien elige un producto y una mesa del local; esa
-- mesa lo ve y decide si lo acepta. Recién cuando acepta, quien invita paga (con su cotización de siempre) y el
-- producto va a cocina para la otra mesa. Así se cumple lo que pide el brief ("si nadie lo reclama, la plata
-- vuelve; quien invita puede cancelar antes") sin cobrar nada que haya que devolver: nunca se cobra una
-- invitación que nadie aceptó.
--   · El dueño lo activa por sucursal (branches.invitar_mesas; viene apagado) y es un módulo (invitar).
--   · Cuidado con las personas: solo se ve el número de mesa (y el nombre que quien invita se puso en la
--     suya), el mensaje es corto y sin enlaces ni teléfonos, la mesa que recibe puede rechazar y bloquear a
--     esa mesa por el resto de la visita, y nadie tiene más de 3 invitaciones abiertas.
--   · La plata no cambia de reglas: el precio sale de la base y se congela, el pago lo confirma el servidor,
--     y si la invitación dejó de estar vigente cuando llega el pago (por ejemplo, la canceló), se devuelve sola.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Módulo y configuración
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._catalogo_modulos()
RETURNS TABLE (modulo text, nombre text, descripcion text, orden integer)
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  VALUES
    ('campanas',  'Campañas',            'Promociones por aviso al celular, con beneficio al pagar.',       1),
    ('niveles',   'Niveles y rachas',    'Bronce, Plata y Oro, y rachas de visitas con premios.',           2),
    ('pasaporte', 'Pasaporte de la casa','Lo que cada cliente probó de la carta, con insignias.',           3),
    ('raspe',     'Raspe y gana',        'Premio sorpresa al pagar, con tope de premios al mes.',           4),
    ('juegos',    'Juegos en la mesa',   'Trivia y ruleta mientras esperan.',                                5),
    ('ronda',     'Invitar una ronda',   'Marcar un pedido como ronda para la mesa.',                        6),
    ('dividir',   'Dividir un plato',    'Cada uno paga su parte de un plato compartido.',                   7),
    ('tablets',   'Tablets compartidas', 'El equipo entra con su PIN en una tablet del local.',              8),
    ('invitar',   'Invitar a otra mesa', 'Invitar un trago a otra mesa del local, que decide si lo acepta.', 9)
$$;
INSERT INTO public.feature_flags (key, description, default_enabled)
VALUES ('invitar', 'Invitar a otra mesa: invitar un trago a otra mesa del local, que decide si lo acepta.', true)
ON CONFLICT (key) DO NOTHING;
UPDATE public.plans SET features = features || '{"invitar": true}' WHERE features ? 'campanas';

ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS invitar_mesas boolean NOT NULL DEFAULT false;
GRANT UPDATE (invitar_mesas) ON public.branches TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Tablas
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invitaciones_mesa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  de_table_id uuid NOT NULL REFERENCES public.tables(id) ON DELETE CASCADE,
  de_session_id uuid NOT NULL REFERENCES public.table_sessions(id) ON DELETE CASCADE,
  de_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  de_alias text,
  para_table_id uuid NOT NULL REFERENCES public.tables(id) ON DELETE CASCADE,
  para_session_id uuid NOT NULL REFERENCES public.table_sessions(id) ON DELETE CASCADE,
  menu_item_id uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  mensaje text CHECK (mensaje IS NULL OR char_length(mensaje) BETWEEN 1 AND 80),
  estado text NOT NULL DEFAULT 'ofrecida' CHECK (estado IN ('ofrecida', 'aceptada', 'pagada', 'rechazada', 'cancelada')),
  vence_at timestamptz NOT NULL DEFAULT now() + interval '15 minutes',
  respondida_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  respondida_at timestamptz,
  payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  pagada_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (de_table_id <> para_table_id),
  CHECK (estado <> 'pagada' OR pagada_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS invitaciones_mesa_para_idx ON public.invitaciones_mesa (para_session_id, estado);
CREATE INDEX IF NOT EXISTS invitaciones_mesa_de_idx ON public.invitaciones_mesa (de_session_id, estado);
CREATE INDEX IF NOT EXISTS invitaciones_mesa_user_idx ON public.invitaciones_mesa (de_user_id);
-- Una invitación abierta a la vez de una visita a otra mesa
CREATE UNIQUE INDEX IF NOT EXISTS invitaciones_mesa_par_uidx ON public.invitaciones_mesa (de_session_id, para_table_id)
  WHERE estado IN ('ofrecida', 'aceptada');

-- La mesa que recibe puede bloquear a otra mesa por el resto de su visita
CREATE TABLE IF NOT EXISTS public.bloqueos_invitacion (
  para_session_id uuid NOT NULL REFERENCES public.table_sessions(id) ON DELETE CASCADE,
  de_table_id uuid NOT NULL REFERENCES public.tables(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (para_session_id, de_table_id)
);

ALTER TABLE public.invitaciones_mesa ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bloqueos_invitacion ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invitaciones_mesa_lectura ON public.invitaciones_mesa;
CREATE POLICY invitaciones_mesa_lectura ON public.invitaciones_mesa FOR SELECT TO authenticated
  USING (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager', 'cashier', 'waiter']) OR public.is_platform_admin());
DROP POLICY IF EXISTS bloqueos_invitacion_lectura ON public.bloqueos_invitacion;
CREATE POLICY bloqueos_invitacion_lectura ON public.bloqueos_invitacion FOR SELECT TO authenticated
  USING (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager']) OR public.is_platform_admin());
REVOKE INSERT, UPDATE, DELETE ON public.invitaciones_mesa, public.bloqueos_invitacion FROM anon, authenticated;
GRANT SELECT ON public.invitaciones_mesa, public.bloqueos_invitacion TO authenticated;

ALTER TABLE public.cotizaciones ADD COLUMN IF NOT EXISTS invitacion_id uuid REFERENCES public.invitaciones_mesa(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Lo que hace el comensal
-- ─────────────────────────────────────────────────────────────────────────────
-- ¿Se puede invitar en este local? (módulo + el dueño lo activó en la sucursal)
CREATE OR REPLACE FUNCTION public._invitar_activo(_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(b.invitar_mesas, false) AND public.tiene_funcion(b.tenant_id, 'invitar')
    FROM public.branches b WHERE b.id = _branch_id
$$;
REVOKE ALL ON FUNCTION public._invitar_activo(uuid) FROM PUBLIC, anon, authenticated;

-- Las mesas a las que se puede invitar: solo números (de mesas con gente registrada), sin la mía ni las que me bloquearon
CREATE OR REPLACE FUNCTION public.mesas_para_invitar(_qr_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
BEGIN
  SELECT * INTO c FROM public._comensal_en_mesa(_qr_token);
  IF NOT public._invitar_activo((c.mesa).branch_id) THEN RETURN '[]'::jsonb; END IF;
  RETURN (SELECT coalesce(jsonb_agg(t.number ORDER BY t.number), '[]'::jsonb)
            FROM public.tables t JOIN public.table_sessions ts ON ts.table_id = t.id AND ts.is_active
           WHERE t.branch_id = (c.mesa).branch_id AND t.id <> (c.mesa).id AND t.unida_a IS NULL
             AND EXISTS (SELECT 1 FROM public.comensales_mesa cm WHERE cm.session_id = ts.id)
             AND NOT EXISTS (SELECT 1 FROM public.bloqueos_invitacion b WHERE b.para_session_id = ts.id AND b.de_table_id = (c.mesa).id));
END;
$$;
REVOKE ALL ON FUNCTION public.mesas_para_invitar(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mesas_para_invitar(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.invitar_otra_mesa(_qr_token text, _mesa integer, _menu_item_id uuid, _mensaje text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  para public.tables;
  para_sesion uuid;
  v_mensaje text := nullif(btrim(coalesce(_mensaje, '')), '');
  v_alias text;
  nueva uuid;
BEGIN
  SELECT * INTO c FROM public._comensal_en_mesa(_qr_token);
  IF NOT public._invitar_activo((c.mesa).branch_id) THEN
    RAISE EXCEPTION 'Este local no tiene invitaciones a otras mesas' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO para FROM public.tables WHERE branch_id = (c.mesa).branch_id AND number = _mesa AND unida_a IS NULL;
  IF para.id IS NULL OR para.id = (c.mesa).id THEN
    RAISE EXCEPTION 'Elige otra mesa del local' USING ERRCODE = 'P0001';
  END IF;
  SELECT ts.id INTO para_sesion FROM public.table_sessions ts WHERE ts.table_id = para.id AND ts.is_active
     AND EXISTS (SELECT 1 FROM public.comensales_mesa cm WHERE cm.session_id = ts.id);
  IF para_sesion IS NULL THEN
    RAISE EXCEPTION 'En esa mesa no hay nadie que pueda recibir la invitación' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.bloqueos_invitacion WHERE para_session_id = para_sesion AND de_table_id = (c.mesa).id) THEN
    RAISE EXCEPTION 'Esa mesa no está recibiendo invitaciones' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.menu_items m WHERE m.id = _menu_item_id AND m.tenant_id = (c.mesa).tenant_id
                   AND coalesce(m.status, 'available') = 'available')
     OR EXISTS (SELECT 1 FROM public.modifier_groups g WHERE g.menu_item_id = _menu_item_id AND (g.required OR g.min_selections > 0)) THEN
    RAISE EXCEPTION 'Elige un producto disponible y sin opciones por elegir' USING ERRCODE = 'P0001';
  END IF;
  IF v_mensaje IS NOT NULL AND (char_length(v_mensaje) > 80
       OR lower(v_mensaje) ~ '(https?://|www\.|\.(cl|com|net|org|app|ly)(\M|/)|@|instagram|whatsapp|\+?56 ?9|\d{7,})') THEN
    RAISE EXCEPTION 'El mensaje va corto (hasta 80 letras) y sin enlaces, teléfonos ni redes' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM public.invitaciones_mesa WHERE de_user_id = (SELECT auth.uid()) AND estado IN ('ofrecida', 'aceptada')
        AND vence_at > now()) >= 3 THEN
    RAISE EXCEPTION 'Ya tienes 3 invitaciones esperando. Espera a que respondan.' USING ERRCODE = 'P0001';
  END IF;
  -- Una invitación vencida no cuenta como abierta: se cierra antes de abrir otra a la misma mesa
  UPDATE public.invitaciones_mesa SET estado = 'cancelada'
   WHERE de_session_id = c.sesion AND para_table_id = para.id AND estado IN ('ofrecida', 'aceptada') AND vence_at <= now();
  IF EXISTS (SELECT 1 FROM public.invitaciones_mesa WHERE de_session_id = c.sesion AND para_table_id = para.id AND estado IN ('ofrecida', 'aceptada')) THEN
    RAISE EXCEPTION 'Ya invitaste a esa mesa: espera su respuesta' USING ERRCODE = 'P0001';
  END IF;
  SELECT nullif(btrim(cm.alias), '') INTO v_alias FROM public.comensales_mesa cm WHERE cm.session_id = c.sesion AND cm.user_id = (SELECT auth.uid());
  INSERT INTO public.invitaciones_mesa (tenant_id, branch_id, de_table_id, de_session_id, de_user_id, de_alias,
                                        para_table_id, para_session_id, menu_item_id, mensaje)
  VALUES ((c.mesa).tenant_id, (c.mesa).branch_id, (c.mesa).id, c.sesion, (SELECT auth.uid()), left(v_alias, 30),
          para.id, para_sesion, _menu_item_id, v_mensaje)
  RETURNING id INTO nueva;
  RETURN nueva;
END;
$$;
REVOKE ALL ON FUNCTION public.invitar_otra_mesa(text, integer, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invitar_otra_mesa(text, integer, uuid, text) TO authenticated;

-- La mesa que recibe: acepta, o rechaza (y si quiere, no recibe más de esa mesa en esta visita)
CREATE OR REPLACE FUNCTION public.responder_invitacion(_qr_token text, _invitacion_id uuid, _aceptar boolean, _bloquear boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  i public.invitaciones_mesa;
BEGIN
  SELECT * INTO c FROM public._comensal_en_mesa(_qr_token);
  SELECT * INTO i FROM public.invitaciones_mesa WHERE id = _invitacion_id FOR UPDATE;
  IF i.id IS NULL OR i.para_session_id <> c.sesion THEN
    RAISE EXCEPTION 'Esa invitación no es para tu mesa' USING ERRCODE = 'P0001';
  END IF;
  IF i.estado <> 'ofrecida' OR i.vence_at <= now() THEN
    RAISE EXCEPTION 'Esa invitación ya no está disponible' USING ERRCODE = 'P0001';
  END IF;
  IF _aceptar THEN
    -- Quien invita tiene 10 minutos para pagar
    UPDATE public.invitaciones_mesa SET estado = 'aceptada', respondida_por = (SELECT auth.uid()), respondida_at = now(),
           vence_at = now() + interval '10 minutes'
     WHERE id = i.id;
  ELSE
    UPDATE public.invitaciones_mesa SET estado = 'rechazada', respondida_por = (SELECT auth.uid()), respondida_at = now() WHERE id = i.id;
    IF _bloquear THEN
      INSERT INTO public.bloqueos_invitacion (para_session_id, de_table_id, tenant_id) VALUES (c.sesion, i.de_table_id, i.tenant_id)
      ON CONFLICT DO NOTHING;
      UPDATE public.invitaciones_mesa SET estado = 'rechazada', respondida_por = (SELECT auth.uid()), respondida_at = now()
       WHERE para_session_id = c.sesion AND de_table_id = i.de_table_id AND estado = 'ofrecida';
    END IF;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.responder_invitacion(text, uuid, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.responder_invitacion(text, uuid, boolean, boolean) TO authenticated;

-- Quien invita la cancela (mientras nadie la pague)
CREATE OR REPLACE FUNCTION public.cancelar_invitacion(_qr_token text, _invitacion_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
BEGIN
  SELECT * INTO c FROM public._comensal_en_mesa(_qr_token);
  UPDATE public.invitaciones_mesa SET estado = 'cancelada'
   WHERE id = _invitacion_id AND de_user_id = (SELECT auth.uid()) AND estado IN ('ofrecida', 'aceptada');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esa invitación ya no se puede cancelar' USING ERRCODE = 'P0001';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.cancelar_invitacion(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancelar_invitacion(text, uuid) TO authenticated;

-- Quien invita paga, una vez aceptada: precio de la base, congelado, para la otra mesa
CREATE OR REPLACE FUNCTION public.cotizar_invitacion(_qr_token text, _invitacion_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  i public.invitaciones_mesa;
  precios jsonb;
  v_total integer;
  cot uuid;
  expira timestamptz;
BEGIN
  SELECT * INTO c FROM public._comensal_en_mesa(_qr_token);
  SELECT * INTO i FROM public.invitaciones_mesa WHERE id = _invitacion_id;
  IF i.id IS NULL OR i.de_user_id IS DISTINCT FROM (SELECT auth.uid()) OR i.de_session_id <> c.sesion THEN
    RAISE EXCEPTION 'Esa invitación no es tuya' USING ERRCODE = 'P0001';
  END IF;
  IF i.estado <> 'aceptada' OR i.vence_at <= now() THEN
    RAISE EXCEPTION 'Esa invitación todavía no fue aceptada o ya venció' USING ERRCODE = 'P0001';
  END IF;
  precios := public.calcular_precios(i.tenant_id, i.branch_id, jsonb_build_array(jsonb_build_object('menu_item_id', i.menu_item_id, 'quantity', 1)));
  v_total := (precios ->> 'total')::integer;
  INSERT INTO public.cotizaciones (tenant_id, branch_id, table_id, user_id, tipo, items, notas, subtotal, invitacion_id)
  VALUES (i.tenant_id, i.branch_id, i.para_table_id, (SELECT auth.uid()), 'carrito', precios -> 'items',
          'Invitación de la mesa ' || (c.mesa).number, v_total, i.id)
  RETURNING id, expira_at INTO cot, expira;
  RETURN jsonb_build_object('id', cot, 'subtotal', v_total, 'expira_at', expira, 'items', precios -> 'items');
END;
$$;
REVOKE ALL ON FUNCTION public.cotizar_invitacion(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cotizar_invitacion(text, uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Encajes: presencia, confirmar el pago, mesa en vivo, privacidad, auditoría y demo
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  def text;
  nuevo text;
BEGIN
  -- El código de presencia de una invitación se pide en la mesa de quien invita (no está en la que recibe)
  def := pg_get_functiondef('public.controlar_presencia_cotizacion'::regproc);
  nuevo := replace(def, $q$    SELECT id INTO sesion FROM public.table_sessions WHERE table_id = NEW.table_id AND is_active;$q$,
    $q$    IF NEW.invitacion_id IS NOT NULL THEN
      SELECT de_session_id INTO sesion FROM public.invitaciones_mesa WHERE id = NEW.invitacion_id;
    ELSE
      SELECT id INTO sesion FROM public.table_sessions WHERE table_id = NEW.table_id AND is_active;
    END IF;$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'controlar_presencia_cotizacion: no se encontró dónde'; END IF;
  EXECUTE nuevo;

  -- Confirmar el pago: si la invitación ya no está aceptada (la cancelaron), se devuelve sola; si lo está, queda pagada
  def := pg_get_functiondef('public.confirmar_pago'::regproc);
  nuevo := replace(def, $q$  -- Pago tardío con el monto correcto: se respeta el precio congelado (aunque la cotización haya vencido).$q$,
    $q$  -- Invitación a otra mesa (fase 9.1): si ya no está aceptada (se canceló o ya se pagó), se devuelve este pago
  IF cot.invitacion_id IS NOT NULL THEN
    PERFORM 1 FROM public.invitaciones_mesa WHERE id = cot.invitacion_id FOR UPDATE;
    IF NOT EXISTS (SELECT 1 FROM public.invitaciones_mesa WHERE id = cot.invitacion_id AND estado = 'aceptada') THEN
      UPDATE public.intentos_pago
         SET estado = 'reembolsado', monto_devolver = coalesce(_monto_cobrado, 0) + it.propina, proveedor = _proveedor, referencia_externa = _referencia, resuelto_at = ahora,
             motivo = 'Esa invitación ya no estaba vigente: se devuelve automáticamente'
       WHERE id = it.id;
      RETURN jsonb_build_object('estado', 'reembolsado', 'nuevo', true,
                                'motivo', 'Esa invitación ya no estaba vigente: se devuelve automáticamente',
                                'reembolsar', _monto_cobrado + it.propina);
    END IF;
  END IF;

  -- Pago tardío con el monto correcto: se respeta el precio congelado (aunque la cotización haya vencido).$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'confirmar_pago: no se encontró dónde (1)'; END IF;
  def := nuevo;
  nuevo := replace(def, $q$  IF cot.envio_campana_id IS NOT NULL AND cot.descuento > 0 THEN
    INSERT INTO public.beneficios_usados$q$,
    $q$  IF cot.invitacion_id IS NOT NULL THEN
    UPDATE public.invitaciones_mesa SET estado = 'pagada', payment_id = pago, order_id = pedido, pagada_at = ahora WHERE id = cot.invitacion_id;
  END IF;

  IF cot.envio_campana_id IS NOT NULL AND cot.descuento > 0 THEN
    INSERT INTO public.beneficios_usados$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'confirmar_pago: no se encontró dónde (2)'; END IF;
  EXECUTE nuevo;

  -- La mesa en vivo: invitaciones que llegaron a mi mesa y las que yo mandé (esta visita)
  def := pg_get_functiondef('public.mi_mesa_en_vivo'::regproc);
  nuevo := replace(def, $q$    'modulos', public.modulos_del_local((c.mesa).tenant_id),$q$,
    $q$    'modulos', public.modulos_del_local((c.mesa).tenant_id),
    'invitar_activo', public._invitar_activo((c.mesa).branch_id),
    'invitaciones', jsonb_build_object(
      'recibidas', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                       'id', i.id, 'de_mesa', dt.number, 'de_alias', i.de_alias, 'producto', m.name, 'mensaje', i.mensaje,
                       'estado', CASE WHEN i.estado IN ('ofrecida', 'aceptada') AND i.vence_at <= now() THEN 'vencida' ELSE i.estado END)
                       ORDER BY i.created_at DESC), '[]'::jsonb)
                      FROM public.invitaciones_mesa i JOIN public.tables dt ON dt.id = i.de_table_id JOIN public.menu_items m ON m.id = i.menu_item_id
                     WHERE i.para_session_id = c.sesion AND i.estado <> 'cancelada'),
      'enviadas', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                      'id', i.id, 'para_mesa', pt.number, 'producto', m.name,
                      'estado', CASE WHEN i.estado IN ('ofrecida', 'aceptada') AND i.vence_at <= now() THEN 'vencida' ELSE i.estado END,
                      'vence_at', i.vence_at)
                      ORDER BY i.created_at DESC), '[]'::jsonb)
                     FROM public.invitaciones_mesa i JOIN public.tables pt ON pt.id = i.para_table_id JOIN public.menu_items m ON m.id = i.menu_item_id
                    WHERE i.de_session_id = c.sesion AND i.de_user_id = (SELECT auth.uid()))),$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'mi_mesa_en_vivo: no se encontró dónde'; END IF;
  EXECUTE nuevo;

  -- Privacidad: sus invitaciones aparecen en sus datos; al borrarla, su nombre y su mensaje se borran
  def := pg_get_functiondef('public.mis_datos()'::regprocedure);
  nuevo := replace(def, $q$    'trivia_en_vivo', (SELECT count(*) FROM public.respuestas_trivia_vivo r WHERE r.user_id = yo),$q$,
    $q$    'trivia_en_vivo', (SELECT count(*) FROM public.respuestas_trivia_vivo r WHERE r.user_id = yo),
    'invitaciones_a_otras_mesas', (SELECT count(*) FROM public.invitaciones_mesa i WHERE i.de_user_id = yo),$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'mis_datos: no se encontró dónde'; END IF;
  EXECUTE nuevo;
  def := pg_get_functiondef('public._borrar_datos_comensal(uuid)'::regprocedure);
  nuevo := replace(def, '  DELETE FROM public.envios_campana WHERE user_id = _user_id;',
    '  DELETE FROM public.envios_campana WHERE user_id = _user_id;
  UPDATE public.invitaciones_mesa SET de_alias = NULL, mensaje = NULL WHERE de_user_id = _user_id;');
  IF nuevo = def THEN RAISE EXCEPTION '_borrar_datos_comensal: no se encontró dónde'; END IF;
  EXECUTE nuevo;

  -- La auditoría de la plata: una invitación pagada tiene su pago y su pedido, en la mesa que recibe
  def := pg_get_functiondef('public.auditoria_plata()'::regprocedure);
  nuevo := regexp_replace(def, '\n(\s*END;\s*\$function\$)', $q$

  -- Fase 9.1: una invitación pagada tiene su pago aprobado y su pedido en la mesa que la recibió; ninguna
  -- invitación cancelada o rechazada tiene un pago vigente
  RETURN QUERY
  SELECT 'invitacion_incoherente'::text, i.id::text,
         (CASE WHEN i.estado = 'pagada' AND (p.id IS NULL OR o.id IS NULL) THEN 'Invitación pagada sin su pago o su pedido'
               WHEN i.estado = 'pagada' AND o.table_id <> i.para_table_id THEN 'El pedido de la invitación quedó en otra mesa'
               ELSE 'Invitación cerrada con un pago vigente' END)::text
    FROM public.invitaciones_mesa i
    LEFT JOIN public.payments p ON p.id = i.payment_id
    LEFT JOIN public.orders o ON o.id = i.order_id
   WHERE (i.estado = 'pagada' AND (p.id IS NULL OR o.id IS NULL OR o.table_id <> i.para_table_id))
      OR (i.estado IN ('cancelada', 'rechazada') AND i.payment_id IS NOT NULL);
\1$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'auditoria_plata: no se encontró el final'; END IF;
  EXECUTE nuevo;

  -- El reinicio del demo deja las invitaciones apagadas (como vienen)
  def := pg_get_functiondef('public.reiniciar_demo()'::regprocedure);
  nuevo := replace(def, '  DELETE FROM public.trivias_vivo WHERE tenant_id = demo;',
    '  DELETE FROM public.trivias_vivo WHERE tenant_id = demo;
  DELETE FROM public.invitaciones_mesa WHERE tenant_id = demo;
  UPDATE public.branches SET invitar_mesas = false WHERE tenant_id = demo;');
  IF nuevo = def THEN RAISE EXCEPTION 'reiniciar_demo: no se encontró dónde'; END IF;
  EXECUTE nuevo;
END;
$$;
