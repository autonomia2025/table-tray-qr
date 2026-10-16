-- Fase 7.2 — Beneficio de la campaña al pagar con el QR.
--
-- Una campaña puede traer un beneficio: un % de descuento (5 a 50) o un monto fijo (con compra mínima de al
-- menos el doble), válido por unos días desde que se envió. Se aplica solo:
--   · a quien recibió esa campaña, con su cuenta, al pedir y pagar con el QR (no al pagarle al mozo);
--   · una vez por persona y campaña;
--   · sobre los productos sin alcohol (menu_items.tiene_alcohol): nada que premie tomar más alcohol.
-- El precio sigue saliendo de la base: crear_cotizacion calcula el descuento y lo congela en la cotización
-- (su subtotal ya viene con el descuento, así que el cobro, la propina, los sellos y los reportes no
-- cambian). confirmar_pago anota el uso en beneficios_usados; si ese beneficio ya se usó en otro pago (dos
-- pagos a la vez), devuelve el segundo, como hace con cualquier cobro que no corresponde.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Productos con alcohol (el dueño los marca en el Menú)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS tiene_alcohol boolean NOT NULL DEFAULT false;
GRANT SELECT (tiene_alcohol) ON public.menu_items TO anon, authenticated;
GRANT INSERT (tiene_alcohol), UPDATE (tiene_alcohol) ON public.menu_items TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. El beneficio de cada campaña
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.campanas
  ADD COLUMN IF NOT EXISTS beneficio_tipo text CHECK (beneficio_tipo IN ('porcentaje', 'monto')),
  ADD COLUMN IF NOT EXISTS beneficio_valor integer,
  ADD COLUMN IF NOT EXISTS beneficio_minimo integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS beneficio_dias integer NOT NULL DEFAULT 7;
ALTER TABLE public.campanas ADD CONSTRAINT campanas_beneficio_valido CHECK (
  beneficio_tipo IS NULL
  OR (beneficio_tipo = 'porcentaje' AND beneficio_valor BETWEEN 5 AND 50)
  OR (beneficio_tipo = 'monto' AND beneficio_valor BETWEEN 500 AND 50000 AND beneficio_minimo >= 2 * beneficio_valor));
ALTER TABLE public.campanas ADD CONSTRAINT campanas_beneficio_plazo CHECK (beneficio_dias BETWEEN 1 AND 30 AND beneficio_minimo BETWEEN 0 AND 1000000);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Dónde queda: la cotización (congelado), el pedido y el uso
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.cotizaciones
  ADD COLUMN IF NOT EXISTS descuento integer NOT NULL DEFAULT 0 CHECK (descuento >= 0),
  ADD COLUMN IF NOT EXISTS envio_campana_id uuid REFERENCES public.envios_campana(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS cotizaciones_envio_campana ON public.cotizaciones (envio_campana_id) WHERE envio_campana_id IS NOT NULL;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS descuento integer NOT NULL DEFAULT 0 CHECK (descuento >= 0),
  ADD COLUMN IF NOT EXISTS envio_campana_id uuid REFERENCES public.envios_campana(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS orders_envio_campana ON public.orders (envio_campana_id) WHERE envio_campana_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.beneficios_usados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  campana_id uuid REFERENCES public.campanas(id) ON DELETE SET NULL,
  envio_id uuid UNIQUE REFERENCES public.envios_campana(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  descuento integer NOT NULL CHECK (descuento > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS beneficios_usados_campana ON public.beneficios_usados (campana_id);
CREATE INDEX IF NOT EXISTS beneficios_usados_usuario ON public.beneficios_usados (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS beneficios_usados_pago ON public.beneficios_usados (payment_id);
CREATE INDEX IF NOT EXISTS beneficios_usados_pedido ON public.beneficios_usados (order_id);
CREATE INDEX IF NOT EXISTS beneficios_usados_tenant ON public.beneficios_usados (tenant_id);
ALTER TABLE public.beneficios_usados ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.beneficios_usados FROM anon, authenticated;
-- Sin acceso desde el navegador: se ve en resultados_campanas y en mis_datos.

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. ¿Esta persona tiene un beneficio vigente aquí? ¿De cuánto, para este carrito?
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._beneficio_para(_user_id uuid, _tenant_id uuid, _lineas jsonb)
RETURNS TABLE (envio_id uuid, descuento integer, titulo text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH vigente AS (
    SELECT e.id, c.titulo, c.beneficio_tipo, c.beneficio_valor, c.beneficio_minimo
      FROM public.envios_campana e
      JOIN public.campanas c ON c.id = e.campana_id
     WHERE e.user_id = _user_id AND e.tenant_id = _tenant_id
       AND c.estado = 'enviada' AND c.beneficio_tipo IS NOT NULL
       AND now() <= c.enviada_at + make_interval(days => c.beneficio_dias)
       AND NOT EXISTS (SELECT 1 FROM public.beneficios_usados u WHERE u.envio_id = e.id)
       AND NOT EXISTS (SELECT 1 FROM auth.users au WHERE au.id = _user_id AND coalesce(au.is_anonymous, false))
     ORDER BY c.enviada_at DESC
     LIMIT 1),
  base AS (
    SELECT coalesce(sum((l ->> 'subtotal')::integer), 0)::integer AS sin_alcohol
      FROM jsonb_array_elements(coalesce(_lineas, '[]'::jsonb)) l
      JOIN public.menu_items mi ON mi.id = (l ->> 'menu_item_id')::uuid AND NOT mi.tiene_alcohol)
  SELECT v.id,
         CASE WHEN v.beneficio_tipo = 'porcentaje' THEN (b.sin_alcohol * v.beneficio_valor / 100)
              ELSE least(v.beneficio_valor, b.sin_alcohol) END,
         v.titulo
    FROM vigente v, base b
   WHERE b.sin_alcohol > 0 AND b.sin_alcohol >= v.beneficio_minimo
$$;
REVOKE ALL ON FUNCTION public._beneficio_para(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. La cotización congela el descuento
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  def text := pg_get_functiondef('public.crear_cotizacion(uuid,text,jsonb,uuid[],text)'::regprocedure);
  nuevo text := def;
  cambios text[][] := ARRAY[
    ARRAY[$q$  expira timestamptz;
BEGIN$q$,
          $q$  expira timestamptz;
  ben record;
BEGIN
  SELECT NULL::uuid AS envio_id, 0 AS descuento, NULL::text AS titulo INTO ben;$q$],
    ARRAY[$q$    subtotal := (precios ->> 'total')::integer;
    INSERT INTO public.cotizaciones (tenant_id, branch_id, table_id, user_id, tipo, items, notas, subtotal)
    VALUES (mesa.tenant_id, mesa.branch_id, mesa.id, _user_id, 'carrito', precios -> 'items',
            left(nullif(btrim(coalesce(_notas, '')), ''), 300), subtotal)$q$,
          $q$    subtotal := (precios ->> 'total')::integer;
    -- Beneficio de campaña (fase 7.2): ya viene descontado del subtotal que se cobra
    SELECT * INTO ben FROM public._beneficio_para(_user_id, mesa.tenant_id, precios -> 'items');
    subtotal := subtotal - coalesce(ben.descuento, 0);
    INSERT INTO public.cotizaciones (tenant_id, branch_id, table_id, user_id, tipo, items, notas, subtotal, descuento, envio_campana_id)
    VALUES (mesa.tenant_id, mesa.branch_id, mesa.id, _user_id, 'carrito', precios -> 'items',
            left(nullif(btrim(coalesce(_notas, '')), ''), 300), subtotal, coalesce(ben.descuento, 0),
            CASE WHEN coalesce(ben.descuento, 0) > 0 THEN ben.envio_id END)$q$],
    ARRAY[$q$  RETURN jsonb_build_object('id', cot, 'subtotal', subtotal, 'expira_at', expira, 'items', precios -> 'items');$q$,
          $q$  RETURN jsonb_build_object('id', cot, 'subtotal', subtotal, 'expira_at', expira, 'items', precios -> 'items',
                            'descuento', coalesce(ben.descuento, 0),
                            'beneficio', CASE WHEN coalesce(ben.descuento, 0) > 0 THEN ben.titulo END);$q$]
  ];
  i integer;
BEGIN
  FOR i IN 1 .. array_length(cambios, 1) LOOP
    IF position(cambios[i][1] IN nuevo) = 0 THEN RAISE EXCEPTION 'crear_cotizacion: no se encontró el cambio %', i; END IF;
    nuevo := replace(nuevo, cambios[i][1], cambios[i][2]);
  END LOOP;
  EXECUTE nuevo;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. El pago anota el uso (una sola vez) y el pedido guarda su descuento
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  def text := pg_get_functiondef('public.confirmar_pago(uuid,boolean,integer,text,text,jsonb,text)'::regprocedure);
  nuevo text := def;
  cambios text[][] := ARRAY[
    ARRAY[$q$  -- Pago tardío con el monto correcto: se respeta el precio congelado (aunque la cotización haya vencido).$q$,
          $q$  -- Beneficio de campaña (fase 7.2): uno por persona y campaña. Si ya se usó en otro pago (dos pagos a
  -- la vez), este se devuelve.
  IF cot.envio_campana_id IS NOT NULL AND cot.descuento > 0 THEN
    PERFORM 1 FROM public.envios_campana WHERE id = cot.envio_campana_id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.beneficios_usados WHERE envio_id = cot.envio_campana_id) THEN
      UPDATE public.intentos_pago
         SET estado = 'reembolsado', monto_devolver = coalesce(_monto_cobrado, 0) + it.propina, proveedor = _proveedor, referencia_externa = _referencia, resuelto_at = ahora,
             motivo = 'Ese beneficio ya se usó en otro pago: se devuelve automáticamente'
       WHERE id = it.id;
      RETURN jsonb_build_object('estado', 'reembolsado', 'nuevo', true,
                                'motivo', 'Ese beneficio ya se usó en otro pago: se devuelve automáticamente',
                                'reembolsar', _monto_cobrado + it.propina);
    END IF;
  END IF;

  -- Pago tardío con el monto correcto: se respeta el precio congelado (aunque la cotización haya vencido).$q$],
    ARRAY[$q$total_amount, notes, confirmed_at, payment_status, paid_at, user_id, alerta)$q$,
          $q$total_amount, notes, confirmed_at, payment_status, paid_at, user_id, alerta,
                               descuento, envio_campana_id)$q$],
    ARRAY[$q$            CASE WHEN agotados IS NOT NULL THEN 'Pagado con producto agotado: ' || agotados END)
    RETURNING id INTO pedido;$q$,
          $q$            CASE WHEN agotados IS NOT NULL THEN 'Pagado con producto agotado: ' || agotados END,
            cot.descuento, CASE WHEN cot.descuento > 0 THEN cot.envio_campana_id END)
    RETURNING id INTO pedido;$q$],
    ARRAY[$q$  RETURNING id INTO pago;
$q$,
          $q$  RETURNING id INTO pago;

  IF cot.envio_campana_id IS NOT NULL AND cot.descuento > 0 THEN
    INSERT INTO public.beneficios_usados (tenant_id, campana_id, envio_id, user_id, payment_id, order_id, descuento)
    SELECT e.tenant_id, e.campana_id, e.id, it.user_id, pago, pedido, cot.descuento
      FROM public.envios_campana e WHERE e.id = cot.envio_campana_id;
  END IF;
$q$]
  ];
  i integer;
BEGIN
  FOR i IN 1 .. array_length(cambios, 1) LOOP
    IF position(cambios[i][1] IN nuevo) = 0 THEN RAISE EXCEPTION 'confirmar_pago: no se encontró el cambio %', i; END IF;
    nuevo := replace(nuevo, cambios[i][1], cambios[i][2]);
  END LOOP;
  EXECUTE nuevo;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Guardar la campaña con su beneficio (cambia la firma: se reemplaza la función)
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.guardar_campana(uuid, text, text, text, uuid, uuid);
CREATE OR REPLACE FUNCTION public.guardar_campana(
  _tenant_id uuid, _titulo text, _mensaje text, _publico text, _plato uuid DEFAULT NULL, _campana_id uuid DEFAULT NULL,
  _beneficio_tipo text DEFAULT NULL, _beneficio_valor integer DEFAULT NULL, _beneficio_minimo integer DEFAULT 0,
  _beneficio_dias integer DEFAULT 7)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_titulo text := btrim(coalesce(_titulo, ''));
  v_mensaje text := btrim(coalesce(_mensaje, ''));
  v_tipo text := nullif(_beneficio_tipo, '');
  v_minimo integer := coalesce(_beneficio_minimo, 0);
  v_dias integer := coalesce(_beneficio_dias, 7);
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
  -- El beneficio
  IF v_tipo IS NOT NULL AND v_tipo NOT IN ('porcentaje', 'monto') THEN
    RAISE EXCEPTION 'Elige el tipo de beneficio' USING ERRCODE = 'P0001';
  END IF;
  IF v_tipo = 'porcentaje' AND coalesce(_beneficio_valor, 0) NOT BETWEEN 5 AND 50 THEN
    RAISE EXCEPTION 'El descuento va de 5%% a 50%%' USING ERRCODE = 'P0001';
  END IF;
  IF v_tipo = 'monto' AND coalesce(_beneficio_valor, 0) NOT BETWEEN 500 AND 50000 THEN
    RAISE EXCEPTION 'El descuento va de $500 a $50.000' USING ERRCODE = 'P0001';
  END IF;
  IF v_tipo = 'monto' AND v_minimo < 2 * _beneficio_valor THEN
    RAISE EXCEPTION 'Con un descuento en pesos, la compra mínima tiene que ser al menos el doble del descuento' USING ERRCODE = 'P0001';
  END IF;
  IF v_dias NOT BETWEEN 1 AND 30 OR v_minimo NOT BETWEEN 0 AND 1000000 THEN
    RAISE EXCEPTION 'El beneficio dura de 1 a 30 días' USING ERRCODE = 'P0001';
  END IF;

  IF _campana_id IS NULL THEN
    INSERT INTO public.campanas (tenant_id, titulo, mensaje, publico, menu_item_id, creada_por,
                                 beneficio_tipo, beneficio_valor, beneficio_minimo, beneficio_dias)
    VALUES (_tenant_id, v_titulo, v_mensaje, _publico, CASE WHEN _publico = 'por_plato' THEN _plato END, (SELECT auth.uid()),
            v_tipo, CASE WHEN v_tipo IS NOT NULL THEN _beneficio_valor END, CASE WHEN v_tipo IS NOT NULL THEN v_minimo ELSE 0 END, v_dias)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.campanas
       SET titulo = v_titulo, mensaje = v_mensaje, publico = _publico,
           menu_item_id = CASE WHEN _publico = 'por_plato' THEN _plato END,
           beneficio_tipo = v_tipo, beneficio_valor = CASE WHEN v_tipo IS NOT NULL THEN _beneficio_valor END,
           beneficio_minimo = CASE WHEN v_tipo IS NOT NULL THEN v_minimo ELSE 0 END, beneficio_dias = v_dias,
           updated_at = now()
     WHERE id = _campana_id AND tenant_id = _tenant_id AND estado = 'borrador'
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'Esa campaña ya se envió y no se puede cambiar' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.guardar_campana(uuid, text, text, text, uuid, uuid, text, integer, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_campana(uuid, text, text, text, uuid, uuid, text, integer, integer, integer) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Resultados, enlace del cliente, privacidad y auditoría
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  def text;
  nuevo text;
BEGIN
  -- Resultados: el beneficio y cuántos lo usaron (con cuánto descuento)
  def := pg_get_functiondef('public.resultados_campanas(uuid)'::regprocedure);
  nuevo := replace(def, $q$'medicion_abierta', c.enviada_at > now() - interval '7 days'$q$,
    $q$'medicion_abierta', c.enviada_at > now() - interval '7 days',
             'beneficio', CASE WHEN c.beneficio_tipo IS NOT NULL THEN jsonb_build_object(
                            'tipo', c.beneficio_tipo, 'valor', c.beneficio_valor, 'minimo', c.beneficio_minimo, 'dias', c.beneficio_dias,
                            'vence_at', c.enviada_at + make_interval(days => c.beneficio_dias)) END,
             'canjes', (SELECT count(*) FROM public.beneficios_usados u WHERE u.campana_id = c.id),
             'descuentos', (SELECT coalesce(sum(u.descuento), 0) FROM public.beneficios_usados u WHERE u.campana_id = c.id)$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'resultados_campanas: no se encontró dónde'; END IF;
  EXECUTE nuevo;

  -- El enlace del aviso muestra el beneficio y si ya se usó
  def := pg_get_functiondef('public.ver_promo(text)'::regprocedure);
  nuevo := replace(def, $q$'de_baja', EXISTS (SELECT 1 FROM public.bajas_campanas b WHERE b.tenant_id = e.tenant_id AND b.user_id = e.user_id))$q$,
    $q$'de_baja', EXISTS (SELECT 1 FROM public.bajas_campanas b WHERE b.tenant_id = e.tenant_id AND b.user_id = e.user_id),
             'beneficio', CASE WHEN c.beneficio_tipo IS NOT NULL THEN jsonb_build_object(
                            'tipo', c.beneficio_tipo, 'valor', c.beneficio_valor, 'minimo', c.beneficio_minimo,
                            'vence_at', c.enviada_at + make_interval(days => c.beneficio_dias),
                            'usado', EXISTS (SELECT 1 FROM public.beneficios_usados u WHERE u.envio_id = e.id)) END)$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'ver_promo: no se encontró dónde'; END IF;
  EXECUTE nuevo;

  -- Privacidad
  def := pg_get_functiondef('public.mis_datos()'::regprocedure);
  nuevo := replace(def, $q$    'sin_promociones_de', (SELECT coalesce(jsonb_agg(t.name), '[]'::jsonb)$q$,
    $q$    'beneficios_usados', (SELECT coalesce(jsonb_agg(jsonb_build_object('local', t.name, 'descuento', bu.descuento, 'fecha', bu.created_at)), '[]'::jsonb)
                            FROM public.beneficios_usados bu JOIN public.tenants t ON t.id = bu.tenant_id WHERE bu.user_id = yo),
    'sin_promociones_de', (SELECT coalesce(jsonb_agg(t.name), '[]'::jsonb)$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'mis_datos: no se encontró dónde'; END IF;
  EXECUTE nuevo;

  def := pg_get_functiondef('public._borrar_datos_comensal(uuid)'::regprocedure);
  nuevo := replace(def, '  DELETE FROM public.bajas_campanas WHERE user_id = _user_id;',
    '  DELETE FROM public.bajas_campanas WHERE user_id = _user_id;
  UPDATE public.beneficios_usados SET user_id = NULL WHERE user_id = _user_id;');
  IF nuevo = def THEN RAISE EXCEPTION '_borrar_datos_comensal: no se encontró dónde'; END IF;
  EXECUTE nuevo;

  -- La auditoría de la plata: cada descuento tiene su uso anotado (y al revés), con el mismo monto
  def := pg_get_functiondef('public.auditoria_plata()'::regprocedure);
  nuevo := regexp_replace(def, '\n(\s*END;\s*\$function\$)', $q$

  -- Fase 7.2: un pedido con descuento de campaña tiene su uso anotado con el mismo monto, y cada uso es de
  -- un pedido con ese descuento; nunca un descuento mayor que el pedido.
  RETURN QUERY
  SELECT 'beneficio_incoherente', o.id::text,
         format('Pedido con descuento %s y uso anotado %s', o.descuento, coalesce(u.descuento::text, 'ninguno'))
    FROM public.orders o LEFT JOIN public.beneficios_usados u ON u.order_id = o.id
   WHERE o.descuento > 0 AND (u.id IS NULL OR u.descuento <> o.descuento);

  RETURN QUERY
  SELECT 'beneficio_incoherente', u.id::text, 'Uso de beneficio sin un pedido con ese descuento'
    FROM public.beneficios_usados u JOIN public.orders o ON o.id = u.order_id
   WHERE o.descuento <> u.descuento OR u.tenant_id <> o.tenant_id;
\1$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'auditoria_plata: no se encontró el final'; END IF;
  EXECUTE nuevo;
END;
$$;
