-- Borra "La parrillada" (pedido del fundador, 20 de octubre de 2026): local de prueba que venía de Lovable
-- (marzo de 2026), con 2 mesas, 2 platos y 2 pedidos sin pagos. Solo existe en la base real; en una base nueva
-- no hace nada.
-- Se borra el local de una vez: todo lo suyo cae en cascada en la misma instrucción. La protección de la
-- estación principal ("no se borra mientras exista su sucursal") se suspende solo durante este borrado.
-- Las cuentas de sus dos mozos de prueba se borran si no quedan en ningún otro local. La del dueño se queda
-- (sin local).
DO $$
DECLARE
  parr constant uuid := 'bff4a8b9-fbb3-4431-94b0-0f03048de1df';
  mozos uuid[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = parr AND slug = 'la-parrillada') THEN
    RETURN;
  END IF;

  SELECT array_agg(m.user_id) INTO mozos
    FROM public.tenant_members m WHERE m.tenant_id = parr AND m.role = 'waiter';

  -- Lo que no cae en cascada se conserva sin el local: el registro de auditoría y los posibles clientes.
  UPDATE public.audit_logs SET tenant_id = NULL, metadata = coalesce(metadata, '{}') || jsonb_build_object('local_borrado', 'la-parrillada')
   WHERE tenant_id = parr;
  UPDATE public.leads SET converted_tenant_id = NULL WHERE converted_tenant_id = parr;

  ALTER TABLE public.stations DISABLE TRIGGER proteger_estacion;
  DELETE FROM public.tenants WHERE id = parr;
  ALTER TABLE public.stations ENABLE TRIGGER proteger_estacion;

  DELETE FROM auth.users u
   WHERE u.id = ANY (coalesce(mozos, '{}'))
     AND NOT EXISTS (SELECT 1 FROM public.tenant_members m WHERE m.user_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM public.platform_admins p WHERE p.user_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM public.backoffice_members b WHERE b.user_id = u.id);

  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (NULL, NULL, 'local_borrado', 'tenant', parr,
          jsonb_build_object('local', 'la-parrillada', 'motivo', 'Pedido del fundador: local de prueba de Lovable',
                             'cuentas_borradas', coalesce(array_length(mozos, 1), 0)));
END $$;
