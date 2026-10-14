-- Fase 4.1 — Pasarelas de pago conectadas por cada local (decisión del fundador del 14 de octubre de 2026).
-- Cada local conecta su propia cuenta de la pasarela que quiera (Transbank primero, Mercado Pago después);
-- la plata va directo a esa cuenta y Tablio nunca la toca (regla 9). Las claves del local se guardan
-- cifradas en la bóveda (Vault) y solo las leen las funciones del servidor.
--
-- Regla nueva de seguridad: hasta hoy todos los cobros con la app eran simulados. Desde ahora un local
-- solo cobra con la app si tiene una pasarela conectada; el cobro simulado queda solo para locales
-- marcados para demostración (branches.pagos_simulados, que solo cambia el superadmin).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Cobro simulado solo en locales de demostración
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS pagos_simulados boolean NOT NULL DEFAULT false;
-- El demo y el local de pruebas siguen simulando (no hay plata real)
UPDATE public.branches SET pagos_simulados = true
 WHERE tenant_id IN (SELECT id FROM public.tenants WHERE slug IN ('demo-tablio', 'local-ajeno'));
-- Sin GRANT UPDATE para esta columna: ni el dueño ni nadie desde el navegador la cambia

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Conexiones de pago
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.conexiones_pago (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  proveedor text NOT NULL CHECK (proveedor IN ('transbank', 'mercadopago')),
  ambiente text NOT NULL CHECK (ambiente IN ('integracion', 'produccion')),
  estado text NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa', 'desconectada')),
  -- Lo que se puede mostrar (código de comercio, cuenta): nunca la clave
  etiqueta text NOT NULL CHECK (char_length(etiqueta) BETWEEN 1 AND 80),
  -- La clave, cifrada en la bóveda: solo el servidor la lee
  secreto_id uuid,
  conectado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  conectado_por_nombre text,
  verificado_at timestamptz,
  desconectado_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Una sola pasarela activa por sucursal: es la que usa el pago con el QR
CREATE UNIQUE INDEX IF NOT EXISTS conexiones_pago_activa_uidx ON public.conexiones_pago (branch_id) WHERE estado = 'activa';
CREATE INDEX IF NOT EXISTS conexiones_pago_tenant_idx ON public.conexiones_pago (tenant_id);

ALTER TABLE public.conexiones_pago ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conexiones_pago_lectura ON public.conexiones_pago;
CREATE POLICY conexiones_pago_lectura ON public.conexiones_pago FOR SELECT TO authenticated
  USING (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager']) OR public.is_platform_admin());
REVOKE ALL ON public.conexiones_pago FROM anon, authenticated;
-- Sin la columna de la clave
GRANT SELECT (id, tenant_id, branch_id, proveedor, ambiente, estado, etiqueta, conectado_por_nombre,
              verificado_at, desconectado_at, created_at) ON public.conexiones_pago TO authenticated;

-- Los intentos de pago recuerdan con qué conexión y con qué número de la pasarela se cobraron
ALTER TABLE public.intentos_pago
  ADD COLUMN IF NOT EXISTS conexion_id uuid REFERENCES public.conexiones_pago(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS token_externo text;
CREATE UNIQUE INDEX IF NOT EXISTS intentos_pago_token_uidx ON public.intentos_pago (token_externo) WHERE token_externo IS NOT NULL;

-- ¿Puede esta persona configurar los pagos de esta sucursal? (dueño o administrador activos)
CREATE OR REPLACE FUNCTION public._puede_configurar_pagos(_user_id uuid, _branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members m JOIN public.branches b ON b.tenant_id = m.tenant_id
     WHERE m.user_id = _user_id AND b.id = _branch_id AND m.is_active AND m.role IN ('owner', 'admin'))
$$;
REVOKE ALL ON FUNCTION public._puede_configurar_pagos(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Guarda una conexión verificada (la llama la función conectar-pago después de probar las claves)
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
  anterior public.conexiones_pago;
  secreto uuid;
  nueva uuid;
  quien text;
BEGIN
  IF NOT public._puede_configurar_pagos(_user_id, _branch_id) THEN
    RAISE EXCEPTION 'Solo el dueño o el administrador conectan los pagos' USING ERRCODE = '42501';
  END IF;
  SELECT tenant_id INTO local FROM public.branches WHERE id = _branch_id;
  -- La anterior se desconecta (y su clave se borra de la bóveda)
  FOR anterior IN SELECT * FROM public.conexiones_pago WHERE branch_id = _branch_id AND estado = 'activa' FOR UPDATE LOOP
    UPDATE public.conexiones_pago SET estado = 'desconectada', desconectado_at = now(), secreto_id = NULL WHERE id = anterior.id;
    IF anterior.secreto_id IS NOT NULL THEN DELETE FROM vault.secrets WHERE id = anterior.secreto_id; END IF;
  END LOOP;
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

-- El dueño o el administrador desconectan la pasarela (desde ese momento no se cobra con la app)
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
  UPDATE public.conexiones_pago SET estado = 'desconectada', desconectado_at = now(), secreto_id = NULL WHERE id = c.id;
  IF c.secreto_id IS NOT NULL THEN DELETE FROM vault.secrets WHERE id = c.secreto_id; END IF;
  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (c.tenant_id, auth.uid(), 'pasarela_desconectada', 'conexion_pago', c.id,
          jsonb_build_object('proveedor', c.proveedor, 'etiqueta', c.etiqueta));
END;
$$;
REVOKE ALL ON FUNCTION public.desconectar_pago(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.desconectar_pago(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Lo que usan las funciones de cobro (solo el servidor)
-- ─────────────────────────────────────────────────────────────────────────────
-- Cómo cobra una sucursal: su pasarela activa (con la clave), simulado (demo) o nada
CREATE OR REPLACE FUNCTION public._pasarela_sucursal(_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.conexiones_pago;
  simula boolean;
BEGIN
  SELECT * INTO c FROM public.conexiones_pago WHERE branch_id = _branch_id AND estado = 'activa';
  IF c.id IS NOT NULL THEN
    RETURN jsonb_build_object('proveedor', c.proveedor, 'ambiente', c.ambiente, 'conexion_id', c.id,
      'credenciales', (SELECT decrypted_secret::jsonb FROM vault.decrypted_secrets WHERE id = c.secreto_id));
  END IF;
  SELECT pagos_simulados INTO simula FROM public.branches WHERE id = _branch_id;
  RETURN CASE WHEN coalesce(simula, false) THEN jsonb_build_object('proveedor', 'simulado') ELSE NULL END;
END;
$$;
REVOKE ALL ON FUNCTION public._pasarela_sucursal(uuid) FROM PUBLIC, anon, authenticated;

-- Las credenciales de una conexión (aunque ya esté desconectada, para devolver un pago antiguo
-- mientras su clave exista; si se borró, la devolución se hace en el local)
CREATE OR REPLACE FUNCTION public._credenciales_conexion(_conexion_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object('proveedor', c.proveedor, 'ambiente', c.ambiente,
           'credenciales', (SELECT decrypted_secret::jsonb FROM vault.decrypted_secrets WHERE id = c.secreto_id))
    FROM public.conexiones_pago c WHERE c.id = _conexion_id
$$;
REVOKE ALL ON FUNCTION public._credenciales_conexion(uuid) FROM PUBLIC, anon, authenticated;

-- Anota el número de la pasarela en el intento (para reconocerlo cuando vuelve el cliente)
CREATE OR REPLACE FUNCTION public._anotar_token_intento(_intento_id uuid, _conexion_id uuid, _proveedor text, _token text)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.intentos_pago SET conexion_id = _conexion_id, proveedor = _proveedor, token_externo = _token
   WHERE id = _intento_id AND estado = 'reservado'
$$;
REVOKE ALL ON FUNCTION public._anotar_token_intento(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;


-- El intento al que vuelve el cliente desde la pasarela, con lo necesario para terminarlo y
-- devolverlo a su pantalla (por el número de la pasarela o, si abandonó, por la orden de compra)
CREATE OR REPLACE FUNCTION public._intento_de_retorno(_token text, _orden text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object('id', it.id, 'estado', it.estado, 'monto', it.monto, 'propina', it.propina,
           'conexion_id', it.conexion_id, 'token', it.token_externo, 'slug', tn.slug, 'qr', t.qr_token,
           'tipo', cot.tipo)
    FROM public.intentos_pago it
    JOIN public.cotizaciones cot ON cot.id = it.cotizacion_id
    JOIN public.tables t ON t.id = cot.table_id
    JOIN public.tenants tn ON tn.id = t.tenant_id
   WHERE (_token IS NOT NULL AND it.token_externo = _token)
      OR (_token IS NULL AND _orden IS NOT NULL AND it.token_externo IS NOT NULL
          AND replace(it.id::text, '-', '') LIKE _orden || '%')
   ORDER BY it.created_at DESC LIMIT 1
$$;
REVOKE ALL ON FUNCTION public._intento_de_retorno(text, text) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Lo que ve el comensal
-- ─────────────────────────────────────────────────────────────────────────────
-- Con qué paga en esta mesa (sin claves): para mostrar el botón correcto o avisar que no hay pago con la app
CREATE OR REPLACE FUNCTION public.pasarela_de_mesa(_qr_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  mesa uuid;
  sucursal uuid;
  c public.conexiones_pago;
  simula boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Abre la carta desde el QR de tu mesa' USING ERRCODE = '42501';
  END IF;
  mesa := public._mesa_del_qr(_qr_token);
  SELECT branch_id INTO sucursal FROM public.tables WHERE id = mesa;
  IF sucursal IS NULL THEN
    RAISE EXCEPTION 'QR de mesa no válido' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO c FROM public.conexiones_pago WHERE branch_id = sucursal AND estado = 'activa';
  IF c.id IS NOT NULL THEN
    RETURN jsonb_build_object('proveedor', c.proveedor, 'prueba', c.ambiente = 'integracion');
  END IF;
  SELECT pagos_simulados INTO simula FROM public.branches WHERE id = sucursal;
  RETURN jsonb_build_object('proveedor', CASE WHEN coalesce(simula, false) THEN 'simulado' END, 'prueba', coalesce(simula, false));
END;
$$;
REVOKE ALL ON FUNCTION public.pasarela_de_mesa(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pasarela_de_mesa(text) TO authenticated;

-- Cómo terminó un pago que salió a la pasarela (solo quien lo hizo)
CREATE OR REPLACE FUNCTION public.resultado_intento(_intento_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  it public.intentos_pago;
  p public.payments;
BEGIN
  SELECT * INTO it FROM public.intentos_pago WHERE id = _intento_id;
  IF it.id IS NULL OR it.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'No encontramos ese pago' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO p FROM public.payments WHERE id = it.payment_id;
  RETURN jsonb_build_object(
    'estado', it.estado, 'monto', it.monto, 'propina', it.propina, 'motivo', it.motivo,
    'referencia', p.external_reference, 'payment_id', p.id,
    'order_number', (SELECT o.order_number FROM public.orders o WHERE o.id = p.order_id));
END;
$$;
REVOKE ALL ON FUNCTION public.resultado_intento(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resultado_intento(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. El reinicio del demo deja el demo sin pasarelas conectadas (sigue simulando)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  def text;
BEGIN
  SELECT pg_get_functiondef('public.reiniciar_demo()'::regprocedure) INTO def;
  IF position('conexiones_pago' IN def) = 0 THEN
    def := replace(def, 'DELETE FROM public.intentos_pago WHERE tenant_id = demo;',
                   'DELETE FROM public.intentos_pago WHERE tenant_id = demo;
  DELETE FROM vault.secrets WHERE id IN (SELECT secreto_id FROM public.conexiones_pago WHERE tenant_id = demo);
  DELETE FROM public.conexiones_pago WHERE tenant_id = demo;');
    IF position('conexiones_pago' IN def) = 0 THEN
      RAISE EXCEPTION 'No se pudo agregar las conexiones de pago al reinicio del demo';
    END IF;
    EXECUTE def;
  END IF;
END;
$$;
