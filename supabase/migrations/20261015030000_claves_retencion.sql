-- Fase 4.4 — Al desconectar una pasarela, la clave ya no se usa para cobrar, pero se guarda 120 días
-- (cifrada) solo para revisar pagos que quedaron a medio camino y para devolver pagos de esos días.
-- Antes se borraba al instante: un pago en curso al desconectar quedaba sin poder resolverse y un
-- pago de ayer ya no se podía devolver por la pasarela. Después de 120 días, el reloj la borra sola.

CREATE OR REPLACE FUNCTION public._guardar_conexion_pago(
  _user_id uuid, _branch_id uuid, _proveedor text, _ambiente text, _etiqueta text, _secreto jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  local uuid;
  secreto uuid;
  nueva uuid;
  quien text;
BEGIN
  IF NOT public._puede_configurar_pagos(_user_id, _branch_id) THEN
    RAISE EXCEPTION 'Solo el dueño o el administrador conectan los pagos' USING ERRCODE = '42501';
  END IF;
  SELECT tenant_id INTO local FROM public.branches WHERE id = _branch_id;
  -- La anterior deja de cobrar (su clave se guarda 120 días para revisiones y devoluciones)
  UPDATE public.conexiones_pago SET estado = 'desconectada', desconectado_at = now()
   WHERE branch_id = _branch_id AND estado = 'activa';
  secreto := vault.create_secret(_secreto::text, 'pago-' || gen_random_uuid()::text, 'Clave de pasarela de un local');
  SELECT coalesce(s.name, u.email, 'Local') INTO quien
    FROM auth.users u LEFT JOIN public.staff_users s ON s.auth_user_id = u.id AND s.tenant_id = local
   WHERE u.id = _user_id;
  INSERT INTO public.conexiones_pago (tenant_id, branch_id, proveedor, ambiente, etiqueta, secreto_id, conectado_por,
                                      conectado_por_nombre, verificado_at)
  VALUES (local, _branch_id, _proveedor, _ambiente, _etiqueta, secreto, _user_id, quien, now())
  RETURNING id INTO nueva;
  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (local, _user_id, 'pasarela_conectada', 'conexion_pago', nueva,
          jsonb_build_object('proveedor', _proveedor, 'ambiente', _ambiente, 'etiqueta', _etiqueta));
  RETURN jsonb_build_object('id', nueva, 'proveedor', _proveedor, 'ambiente', _ambiente, 'etiqueta', _etiqueta);
END;
$$;
REVOKE ALL ON FUNCTION public._guardar_conexion_pago(uuid, uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.desconectar_pago(_conexion_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.conexiones_pago;
BEGIN
  SELECT * INTO c FROM public.conexiones_pago WHERE id = _conexion_id FOR UPDATE;
  IF c.id IS NULL OR NOT public._puede_configurar_pagos(auth.uid(), c.branch_id) THEN
    RAISE EXCEPTION 'Solo el dueño o el administrador desconectan los pagos' USING ERRCODE = '42501';
  END IF;
  IF c.estado <> 'activa' THEN RETURN; END IF;
  UPDATE public.conexiones_pago SET estado = 'desconectada', desconectado_at = now() WHERE id = c.id;
  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (c.tenant_id, auth.uid(), 'pasarela_desconectada', 'conexion_pago', c.id,
          jsonb_build_object('proveedor', c.proveedor, 'etiqueta', c.etiqueta));
END;
$$;
REVOKE ALL ON FUNCTION public.desconectar_pago(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.desconectar_pago(uuid) TO authenticated;

-- Borra las claves de pasarelas desconectadas hace más de 120 días (todos los días, de madrugada)
CREATE OR REPLACE FUNCTION public._purgar_claves_pasarela()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer := 0;
  c record;
BEGIN
  FOR c IN SELECT id, secreto_id FROM public.conexiones_pago
            WHERE estado = 'desconectada' AND secreto_id IS NOT NULL AND desconectado_at < now() - interval '120 days'
  LOOP
    DELETE FROM vault.secrets WHERE id = c.secreto_id;
    UPDATE public.conexiones_pago SET secreto_id = NULL WHERE id = c.id;
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public._purgar_claves_pasarela() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purgar-claves-pasarela') THEN
    PERFORM cron.unschedule('purgar-claves-pasarela');
  END IF;
  PERFORM cron.schedule('purgar-claves-pasarela', '17 9 * * *', 'SELECT public._purgar_claves_pasarela()');
END;
$$;
