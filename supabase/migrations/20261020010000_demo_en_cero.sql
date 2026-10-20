-- Demo en cero (pedido del fundador, 20 de octubre de 2026): reiniciar_demo(false) deja Demo Tablio sin historia
-- (sin las 4 semanas de ventas de ejemplo, ni tablets, PIN ni registro de las pruebas) para probar desde el
-- principio. Se quedan la carta, las mesas, el equipo, las cuentas y la configuración.
-- reiniciar_demo() sin argumento hace lo mismo que antes (lo usan las pruebas y `bun run demo:reiniciar`).
-- Además borra lo que el reinicio dejaba suelto: eventos de pedidos, comensales de la mesa y partidas de trivia.
DO $$
DECLARE
  def text := pg_get_functiondef('public.reiniciar_demo()'::regprocedure);
  nuevo text := def;
  antes text;
BEGIN
  nuevo := replace(nuevo, 'public.reiniciar_demo()', 'public.reiniciar_demo(_con_historia boolean DEFAULT true)');

  antes := nuevo;
  nuevo := replace(nuevo, '  DELETE FROM public.payments WHERE tenant_id = demo;',
    E'  DELETE FROM public.partidas_trivia WHERE tenant_id = demo;\n  DELETE FROM public.payments WHERE tenant_id = demo;');
  IF nuevo = antes THEN RAISE EXCEPTION 'demo_en_cero: no encontré el borrado de pagos'; END IF;

  antes := nuevo;
  nuevo := replace(nuevo, '  DELETE FROM public.order_items WHERE tenant_id = demo;',
    E'  DELETE FROM public.order_events WHERE tenant_id = demo;\n  DELETE FROM public.order_items WHERE tenant_id = demo;');
  IF nuevo = antes THEN RAISE EXCEPTION 'demo_en_cero: no encontré el borrado de productos'; END IF;

  antes := nuevo;
  nuevo := replace(nuevo, '  DELETE FROM public.table_sessions WHERE tenant_id = demo;',
    E'  DELETE FROM public.comensales_mesa WHERE tenant_id = demo;\n  DELETE FROM public.table_sessions WHERE tenant_id = demo;');
  IF nuevo = antes THEN RAISE EXCEPTION 'demo_en_cero: no encontré el borrado de visitas'; END IF;

  antes := nuevo;
  nuevo := replace(nuevo,
    E'  PERFORM public._sembrar_historia_demo();\n  PERFORM public._sembrar_cliente_demo();\n  PERFORM public._sembrar_propinas_pagadas_demo();',
    E'  IF _con_historia THEN\n    PERFORM public._sembrar_historia_demo();\n    PERFORM public._sembrar_cliente_demo();\n    PERFORM public._sembrar_propinas_pagadas_demo();\n  ELSE\n    DELETE FROM public.equipos_compartidos WHERE tenant_id = demo;\n    DELETE FROM public.pines_personal WHERE tenant_id = demo;\n    DELETE FROM public.audit_logs WHERE tenant_id = demo;\n  END IF;');
  IF nuevo = antes THEN RAISE EXCEPTION 'demo_en_cero: no encontré la siembra de la historia'; END IF;

  antes := nuevo;
  nuevo := replace(nuevo, $r$jsonb_build_object('pedidos_borrados', pedidos));$r$,
    $r$jsonb_build_object('pedidos_borrados', pedidos, 'con_historia', _con_historia));$r$);
  IF nuevo = antes THEN RAISE EXCEPTION 'demo_en_cero: no encontré el registro de auditoría'; END IF;

  DROP FUNCTION public.reiniciar_demo();
  EXECUTE nuevo;
END $$;

REVOKE ALL ON FUNCTION public.reiniciar_demo(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reiniciar_demo(boolean) TO authenticated;
