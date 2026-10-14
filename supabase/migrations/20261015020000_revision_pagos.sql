-- Fase 4.4 — Pagos que no vuelven y conciliación con la pasarela.
-- Si el cliente paga en Webpay y cierra el celular antes de volver a Tablio, nadie confirma el pago y
-- Transbank lo anula solo al poco rato (probado en su ambiente de pruebas): no se le cobra, pero el
-- intento quedaba "reservado" para siempre. Ahora una revisión automática (cada 5 minutos, con
-- pg_cron) consulta a la pasarela los intentos a medias y los cierra como corresponde. Y al cerrar la
-- caja se puede verificar cada pago con Webpay del día contra lo que dice Transbank.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Intentos por revisar y pagos por verificar (solo el servidor)
-- ─────────────────────────────────────────────────────────────────────────────
-- Intentos que salieron a la pasarela hace más de 3 minutos y siguen sin resolver (máx. 7 días:
-- después la pasarela ya no responde por ellos), y los que nunca alcanzaron a salir (más de 15 min).
CREATE OR REPLACE FUNCTION public._intentos_por_revisar(_branch_id uuid DEFAULT NULL)
RETURNS TABLE (id uuid, token text, conexion_id uuid, propina integer, proveedor text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT it.id, it.token_externo, it.conexion_id, it.propina, it.proveedor
    FROM public.intentos_pago it
    JOIN public.cotizaciones c ON c.id = it.cotizacion_id
   WHERE it.estado = 'reservado'
     AND (_branch_id IS NULL OR c.branch_id = _branch_id)
     AND it.created_at > now() - interval '7 days'
     AND ((it.token_externo IS NOT NULL AND it.created_at < now() - interval '3 minutes')
       OR (it.token_externo IS NULL AND it.proveedor IS DISTINCT FROM 'simulated' AND it.created_at < now() - interval '15 minutes'))
   ORDER BY it.created_at
   LIMIT 200
$$;
REVOKE ALL ON FUNCTION public._intentos_por_revisar(uuid) FROM PUBLIC, anon, authenticated;

-- Los pagos con pasarela de un día de negocio, para compararlos con lo que dice la pasarela
CREATE OR REPLACE FUNCTION public._pagos_pasarela_dia(_branch_id uuid, _dia date)
RETURNS TABLE (id uuid, monto integer, propina integer, reembolsado integer, estado text, proveedor text,
               token text, conexion_id uuid, referencia text, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.amount, p.tip_amount, coalesce(p.refunded_amount, 0), p.status, p.provider,
         p.provider_payload ->> 'token', (p.provider_payload ->> 'conexion_id')::uuid, p.external_reference, p.created_at
    FROM public.payments p
   WHERE p.branch_id = _branch_id AND p.dia_negocio = _dia AND p.provider = 'transbank'
   ORDER BY p.created_at
$$;
REVOKE ALL ON FUNCTION public._pagos_pasarela_dia(uuid, date) FROM PUBLIC, anon, authenticated;

-- ¿Puede esta persona revisar los pagos de la sucursal? (dueño, administrador, encargado o caja)
CREATE OR REPLACE FUNCTION public._puede_ver_plata(_user_id uuid, _branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members m JOIN public.branches b ON b.tenant_id = m.tenant_id
     WHERE m.user_id = _user_id AND b.id = _branch_id AND m.is_active
       AND m.role IN ('owner', 'admin', 'manager', 'cashier'))
$$;
REVOKE ALL ON FUNCTION public._puede_ver_plata(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Revisión automática cada 5 minutos (pg_cron → función revisar-pagos)
-- ─────────────────────────────────────────────────────────────────────────────
-- La función revisar-pagos solo atiende al reloj con una clave que vive en la bóveda (nadie la escribe:
-- se genera aquí). La dirección de las funciones de cada ambiente se guarda en la bóveda como
-- 'url_funciones' (producción y local la configuran una vez); sin ella, el reloj no hace nada.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'cron_revisar_pagos') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'cron_revisar_pagos', 'Clave del reloj de revisión de pagos');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._verificar_cron(_clave text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _clave IS NOT NULL AND _clave = (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_revisar_pagos')
$$;
REVOKE ALL ON FUNCTION public._verificar_cron(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._llamar_revisar_pagos()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base text := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'url_funciones');
  clave text := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_revisar_pagos');
BEGIN
  IF base IS NULL OR clave IS NULL THEN RETURN; END IF;
  -- Solo si hay algo que revisar (no despierta la función en vano)
  IF NOT EXISTS (SELECT 1 FROM public._intentos_por_revisar(NULL)) THEN RETURN; END IF;
  PERFORM net.http_post(
    url := rtrim(base, '/') || '/revisar-pagos',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-tablio-cron', clave),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000);
END;
$$;
REVOKE ALL ON FUNCTION public._llamar_revisar_pagos() FROM PUBLIC, anon, authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'revisar-pagos') THEN
    PERFORM cron.unschedule('revisar-pagos');
  END IF;
  PERFORM cron.schedule('revisar-pagos', '*/5 * * * *', 'SELECT public._llamar_revisar_pagos()');
END;
$$;
