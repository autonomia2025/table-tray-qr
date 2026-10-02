-- Fase 0.5 — Dejar limpio el local de demo ("Demo Tablio", id fijo de scripts/demo/crear_demo.py).
-- Borra lo operado (pedidos, pagos, sesiones, llamados, lealtad, invitaciones) y deja las mesas
-- libres y la carta disponible. No toca la carta, el equipo, las cuentas ni ningún otro local.
-- Solo puede ejecutarla un superadmin.
CREATE OR REPLACE FUNCTION public.reiniciar_demo()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  demo constant uuid := '651c363f-0084-50af-9873-be98cfeaaf47';
  pedidos integer;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Solo un superadmin puede reiniciar el demo' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = demo AND slug = 'demo-tablio') THEN
    RAISE EXCEPTION 'No existe el local de demo en esta base';
  END IF;

  SELECT count(*) INTO pedidos FROM public.orders WHERE tenant_id = demo;

  DELETE FROM public.refunds WHERE tenant_id = demo;
  DELETE FROM public.loyalty_rewards WHERE tenant_id = demo;
  DELETE FROM public.loyalty_customers WHERE tenant_id = demo;
  DELETE FROM public.payments WHERE tenant_id = demo;
  DELETE FROM public.payment_settlements WHERE tenant_id = demo;
  DELETE FROM public.order_items WHERE tenant_id = demo;
  DELETE FROM public.orders WHERE tenant_id = demo;
  DELETE FROM public.bill_requests WHERE tenant_id = demo;
  DELETE FROM public.waiter_calls WHERE tenant_id = demo;
  DELETE FROM public.table_sessions WHERE tenant_id = demo;
  DELETE FROM public.staff_invitations WHERE tenant_id = demo;
  DELETE FROM public.support_tickets WHERE tenant_id = demo;
  UPDATE public.tables SET status = 'free', assigned_waiter_id = NULL WHERE tenant_id = demo;
  UPDATE public.menu_items SET status = 'available', total_orders = 0 WHERE tenant_id = demo;

  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, metadata)
  VALUES (demo, auth.uid(), 'demo_reiniciado', 'tenant', jsonb_build_object('pedidos_borrados', pedidos));

  RETURN jsonb_build_object('pedidos_borrados', pedidos);
END;
$$;

REVOKE ALL ON FUNCTION public.reiniciar_demo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reiniciar_demo() TO authenticated;
