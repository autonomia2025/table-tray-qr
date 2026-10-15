-- Fase 5.3 — La prueba de carga encontró bloqueos mutuos (deadlocks): con la mesa llena, alguien llamaba al
-- mozo o pedía la cuenta justo cuando otra persona de la misma mesa pagaba. Cada operación tomaba la mesa y
-- su visita en orden distinto y la base cortaba una de las dos: el pago quedaba "en revisión" (nunca se
-- descuadró la plata, pero el cliente tenía que esperar). La regla desde ahora, en todas las funciones que
-- tocan una mesa: PRIMERO la mesa, después su visita (table_sessions), después los pedidos. Es el orden que
-- ya usaban el pago (confirmar_pago) y todas las funciones del personal (_mesa_y_actor).

DO $$
DECLARE
  def text;
  cambio record;
BEGIN
  FOR cambio IN SELECT * FROM (VALUES
    -- Llamar al mozo y pedir la cuenta: tomaban la visita primero
    ('public.llamar_mozo(text, text)',
     '  PERFORM 1 FROM public.table_sessions WHERE id = c.sesion FOR UPDATE; -- una llamada a la vez por mesa',
     '  PERFORM 1 FROM public.tables WHERE id = (c.mesa).id FOR UPDATE; -- primero la mesa (orden: mesa, visita, pedidos)
  PERFORM 1 FROM public.table_sessions WHERE id = c.sesion FOR UPDATE; -- una llamada a la vez por mesa'),
    ('public.pedir_cuenta(text, integer, integer)',
     '  PERFORM 1 FROM public.table_sessions WHERE id = c.sesion FOR UPDATE;',
     '  PERFORM 1 FROM public.tables WHERE id = (c.mesa).id FOR UPDATE; -- primero la mesa (orden: mesa, visita, pedidos)
  PERFORM 1 FROM public.table_sessions WHERE id = c.sesion FOR UPDATE;'),
    -- Pedir sin pagar: insertaba el pedido y después cambiaba la mesa (dos personas a la vez se bloqueaban)
    ('public.pedir_sin_pagar(text, jsonb, text, text)',
     '  SELECT * INTO c FROM public._comensal_en_mesa(_qr_token);',
     '  SELECT * INTO c FROM public._comensal_en_mesa(_qr_token);
  PERFORM 1 FROM public.tables WHERE id = (c.mesa).id FOR UPDATE; -- primero la mesa (orden: mesa, visita, pedidos)'),
    -- El cobro del mozo: tomaba los pedidos antes que la mesa
    ('public.registrar_cobro_mozo(uuid[], text, integer, integer, boolean, text)',
     '  PERFORM 1 FROM public.orders WHERE id = ANY (_order_ids) FOR UPDATE;',
     '  PERFORM 1 FROM public.tables WHERE id = (SELECT o.table_id FROM public.orders o WHERE o.id = _order_ids[1]) FOR UPDATE; -- primero la mesa
  PERFORM 1 FROM public.orders WHERE id = ANY (_order_ids) FOR UPDATE;')
  ) AS v(firma, antes, despues)
  LOOP
    SELECT pg_get_functiondef(cambio.firma::regprocedure) INTO def;
    IF position('primero la mesa' IN def) > 0 THEN
      CONTINUE; -- ya aplicado
    END IF;
    IF position(cambio.antes IN def) = 0 THEN
      RAISE EXCEPTION 'No se encontró dónde ordenar los bloqueos en %', cambio.firma;
    END IF;
    def := replace(def, cambio.antes, cambio.despues);
    EXECUTE def;
  END LOOP;
END;
$$;
