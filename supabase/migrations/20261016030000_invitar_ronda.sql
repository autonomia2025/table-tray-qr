-- Fase 7.4 — Invitar una ronda. Alguien de la mesa pide algo "para la mesa" y lo paga él, desde su propio
-- pedido: la plata no cambia (cada uno paga lo suyo, regla 8). El pedido queda marcado como ronda y los demás
-- de la mesa lo ven en la mesa en vivo ("Camila invitó una ronda: 4× Schop").

ALTER TABLE public.cotizaciones ADD COLUMN IF NOT EXISTS ronda boolean NOT NULL DEFAULT false;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS ronda boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS orders_rondas ON public.orders (session_id) WHERE ronda;

-- La cotización recibe si es una ronda (cambia la firma: se reemplazan crear_cotizacion y cotizar)
DO $$
DECLARE
  def text := pg_get_functiondef('public.crear_cotizacion(uuid,text,jsonb,uuid[],text)'::regprocedure);
  nuevo text := def;
  cambios text[][] := ARRAY[
    ARRAY[$q$_notas text DEFAULT NULL::text)$q$, $q$_notas text DEFAULT NULL::text, _ronda boolean DEFAULT false)$q$],
    ARRAY[$q$INSERT INTO public.cotizaciones (tenant_id, branch_id, table_id, user_id, tipo, items, notas, subtotal, descuento, envio_campana_id)$q$,
          $q$INSERT INTO public.cotizaciones (tenant_id, branch_id, table_id, user_id, tipo, items, notas, subtotal, descuento, envio_campana_id, ronda)$q$],
    ARRAY[$q$            CASE WHEN coalesce(ben.descuento, 0) > 0 THEN ben.envio_id END)$q$,
          $q$            CASE WHEN coalesce(ben.descuento, 0) > 0 THEN ben.envio_id END, coalesce(_ronda, false))$q$]
  ];
  i integer;
BEGIN
  FOR i IN 1 .. array_length(cambios, 1) LOOP
    IF position(cambios[i][1] IN nuevo) = 0 THEN RAISE EXCEPTION 'crear_cotizacion: no se encontró el cambio %', i; END IF;
    nuevo := replace(nuevo, cambios[i][1], cambios[i][2]);
  END LOOP;
  DROP FUNCTION public.cotizar(text, jsonb, uuid[], text);
  DROP FUNCTION public.crear_cotizacion(uuid, text, jsonb, uuid[], text);
  EXECUTE nuevo;
END;
$$;
REVOKE ALL ON FUNCTION public.crear_cotizacion(uuid, text, jsonb, uuid[], text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crear_cotizacion(uuid, text, jsonb, uuid[], text, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.cotizar(_qr_token text, _items jsonb DEFAULT NULL, _order_ids uuid[] DEFAULT NULL,
                                          _notas text DEFAULT NULL, _ronda boolean DEFAULT false)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.crear_cotizacion(auth.uid(), _qr_token, _items, _order_ids, _notas, _ronda)
$$;
REVOKE ALL ON FUNCTION public.cotizar(text, jsonb, uuid[], text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cotizar(text, jsonb, uuid[], text, boolean) TO authenticated;

-- El pedido pagado queda marcado como ronda
DO $$
DECLARE
  def text := pg_get_functiondef('public.confirmar_pago(uuid,boolean,integer,text,text,jsonb,text)'::regprocedure);
  nuevo text := def;
  cambios text[][] := ARRAY[
    ARRAY[$q$                               descuento, envio_campana_id)$q$,
          $q$                               descuento, envio_campana_id, ronda)$q$],
    ARRAY[$q$            cot.descuento, CASE WHEN cot.descuento > 0 THEN cot.envio_campana_id END)$q$,
          $q$            cot.descuento, CASE WHEN cot.descuento > 0 THEN cot.envio_campana_id END, cot.ronda)$q$]
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

-- La mesa en vivo muestra las rondas de la visita (de cualquiera de la mesa, solo lo que ya está pagado)
DO $$
DECLARE
  def text := pg_get_functiondef('public.mi_mesa_en_vivo(text)'::regprocedure);
  nuevo text;
BEGIN
  nuevo := replace(def, $q$  RETURN jsonb_build_object('mesa', (c.mesa).number, 'personas', personas, 'pedidos', pedidos);$q$,
    $q$  RETURN jsonb_build_object('mesa', (c.mesa).number, 'personas', personas, 'pedidos', pedidos,
    'rondas', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                 'id', o.id, 'creado', o.created_at, 'estado', o.status, 'mia', o.user_id = auth.uid(),
                 'quien', coalesce((SELECT cm.alias FROM public.comensales_mesa cm
                                     WHERE cm.session_id = c.sesion AND cm.user_id = o.user_id LIMIT 1), 'Alguien de la mesa'),
                 'items', (SELECT coalesce(jsonb_agg(jsonb_build_object('nombre', oi.menu_item_name, 'cantidad', oi.quantity)
                                                     ORDER BY oi.menu_item_name), '[]'::jsonb)
                             FROM public.order_items oi WHERE oi.order_id = o.id)) ORDER BY o.created_at DESC), '[]'::jsonb)
                 FROM public.orders o
                WHERE o.session_id = c.sesion AND o.ronda AND o.status <> 'cancelled' AND o.payment_status = 'paid'));$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'mi_mesa_en_vivo: no se encontró el final'; END IF;
  EXECUTE nuevo;
END;
$$;
