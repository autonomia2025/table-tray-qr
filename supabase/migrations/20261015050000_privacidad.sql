-- Fase 4.5 — Privacidad del comensal (Ley 21.719, vigente el 1 de diciembre de 2026).
-- El comensal puede ver y descargar sus datos, decidir si recibe promociones (consentimiento aparte,
-- desmarcado por defecto) y borrar su cuenta. Al borrar, sus datos personales se eliminan (correo,
-- sellos, premios, avisos, su lugar en las mesas) y los registros de plata del local se conservan sin
-- su nombre: el local debe guardarlos por ley tributaria. Los invitados que no vuelven en 90 días se
-- borran solos.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Los registros de plata sobreviven sin el nombre de la persona
-- ─────────────────────────────────────────────────────────────────────────────
-- Antes, borrar a alguien borraba en cascada sus cotizaciones e intentos de pago (parte del registro
-- de la plata y de la protección contra cobros dobles). Ahora quedan, sin la persona.
ALTER TABLE public.cotizaciones ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.intentos_pago ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.cotizaciones DROP CONSTRAINT IF EXISTS cotizaciones_user_id_fkey;
ALTER TABLE public.cotizaciones ADD CONSTRAINT cotizaciones_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.intentos_pago DROP CONSTRAINT IF EXISTS intentos_pago_user_id_fkey;
ALTER TABLE public.intentos_pago ADD CONSTRAINT intentos_pago_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Consentimiento para promociones (aparte de la cuenta; desmarcado por defecto)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.consentimientos_comensal (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  promociones boolean NOT NULL DEFAULT false,
  politica_version text NOT NULL,
  actualizado_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.consentimientos_comensal ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS consentimientos_propios ON public.consentimientos_comensal;
CREATE POLICY consentimientos_propios ON public.consentimientos_comensal FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
REVOKE INSERT, UPDATE, DELETE ON public.consentimientos_comensal FROM anon, authenticated;
GRANT SELECT ON public.consentimientos_comensal TO authenticated;

-- Versión vigente de la política de privacidad (la página /privacidad muestra la misma)
CREATE OR REPLACE FUNCTION public._version_politica()
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$ SELECT '2026-10-15' $$;
REVOKE ALL ON FUNCTION public._version_politica() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guardar_consentimiento(_promociones boolean)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  u auth.users;
BEGIN
  SELECT * INTO u FROM auth.users WHERE id = auth.uid();
  IF u.id IS NULL OR coalesce(u.is_anonymous, false) THEN
    RAISE EXCEPTION 'Guarda tu cuenta para elegir tus preferencias' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.consentimientos_comensal (user_id, promociones, politica_version, actualizado_at)
  VALUES (u.id, coalesce(_promociones, false), public._version_politica(), now())
  ON CONFLICT (user_id) DO UPDATE
    SET promociones = EXCLUDED.promociones, politica_version = EXCLUDED.politica_version, actualizado_at = now();
  RETURN jsonb_build_object('promociones', coalesce(_promociones, false), 'politica_version', public._version_politica());
END;
$$;
REVOKE ALL ON FUNCTION public.guardar_consentimiento(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_consentimiento(boolean) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Mis datos: todo lo que Tablio guarda de la persona, para verlo y descargarlo
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mis_datos()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  yo uuid := auth.uid();
  u auth.users;
BEGIN
  IF yo IS NULL THEN
    RAISE EXCEPTION 'Entra a la app para ver tus datos' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO u FROM auth.users WHERE id = yo;
  RETURN jsonb_build_object(
    'generado_at', now(),
    'politica_version', public._version_politica(),
    'cuenta', jsonb_build_object('correo', u.email, 'invitado', coalesce(u.is_anonymous, false), 'creada_at', u.created_at),
    'preferencias', (SELECT jsonb_build_object('promociones', c.promociones, 'actualizado_at', c.actualizado_at)
                       FROM public.consentimientos_comensal c WHERE c.user_id = yo),
    'sellos', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                 'local', t.name, 'visitas', lc.visits, 'puntos', lc.points, 'gastado', lc.total_spent,
                 'ultima_visita', lc.last_visit_at,
                 'premios', (SELECT coalesce(jsonb_agg(jsonb_build_object('premio', r.description, 'estado', r.status, 'ganado_at', r.earned_at)), '[]'::jsonb)
                               FROM public.loyalty_rewards r WHERE r.customer_id = lc.id))), '[]'::jsonb)
                 FROM public.loyalty_customers lc JOIN public.tenants t ON t.id = lc.tenant_id
                WHERE lc.user_id = yo OR (u.email IS NOT NULL AND lower(lc.email) = lower(u.email))),
    'pedidos', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                  'local', t.name, 'fecha', o.created_at, 'numero', o.order_number, 'total', o.total_amount,
                  'estado_pago', o.payment_status, 'notas', o.notes,
                  'productos', (SELECT coalesce(jsonb_agg(jsonb_build_object('producto', oi.menu_item_name, 'cantidad', oi.quantity, 'precio', oi.unit_price)), '[]'::jsonb)
                                  FROM public.order_items oi WHERE oi.order_id = o.id)) ORDER BY o.created_at DESC), '[]'::jsonb)
                  FROM public.orders o JOIN public.tenants t ON t.id = o.tenant_id WHERE o.user_id = yo),
    'pagos', (SELECT coalesce(jsonb_agg(jsonb_build_object('local', t.name, 'fecha', p.created_at, 'consumo', p.amount,
                                                          'propina', p.tip_amount, 'devuelto', p.refunded_amount,
                                                          'comprobante', p.external_reference) ORDER BY p.created_at DESC), '[]'::jsonb)
                FROM public.payments p JOIN public.tenants t ON t.id = p.tenant_id WHERE p.user_id = yo),
    'mesas', (SELECT coalesce(jsonb_agg(jsonb_build_object('local', t.name, 'fecha', cm.created_at, 'alias', cm.alias) ORDER BY cm.created_at DESC), '[]'::jsonb)
                FROM public.comensales_mesa cm JOIN public.tenants t ON t.id = cm.tenant_id WHERE cm.user_id = yo),
    'avisos_al_celular', (SELECT count(*) FROM public.suscripciones_push s WHERE s.user_id = yo));
END;
$$;
REVOKE ALL ON FUNCTION public.mis_datos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mis_datos() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Borrar mi cuenta (la llama la función borrar-mi-cuenta, que después borra la cuenta en sí)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._borrar_datos_comensal(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  correo text;
  fichas integer;
BEGIN
  -- Las cuentas del equipo de un local o de Tablio no se borran por aquí
  IF EXISTS (SELECT 1 FROM public.tenant_members WHERE user_id = _user_id)
     OR EXISTS (SELECT 1 FROM public.staff_users WHERE auth_user_id = _user_id)
     OR EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = _user_id)
     OR EXISTS (SELECT 1 FROM public.backoffice_members WHERE user_id = _user_id) THEN
    RAISE EXCEPTION 'Esta cuenta es de un equipo: pide la baja a quien administra el local' USING ERRCODE = 'P0001';
  END IF;
  SELECT lower(email) INTO correo FROM auth.users WHERE id = _user_id;
  -- Sellos, premios y movimientos (por cuenta o por su correo)
  WITH borradas AS (
    DELETE FROM public.loyalty_customers
     WHERE user_id = _user_id OR (correo IS NOT NULL AND lower(email) = correo)
    RETURNING 1)
  SELECT count(*) INTO fichas FROM borradas;
  DELETE FROM public.suscripciones_push WHERE user_id = _user_id;
  DELETE FROM public.consentimientos_comensal WHERE user_id = _user_id;
  -- Lo escrito por la persona en sus pedidos puede tener datos personales
  UPDATE public.orders SET notes = NULL WHERE user_id = _user_id AND notes IS NOT NULL;
  UPDATE public.payments SET customer_email = NULL WHERE user_id = _user_id OR (correo IS NOT NULL AND lower(customer_email) = correo);
  -- Queda constancia, sin datos de la persona
  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, metadata)
  VALUES (NULL, NULL, 'cuenta_comensal_borrada', 'comensal', jsonb_build_object('fichas_de_sellos', fichas));
  RETURN jsonb_build_object('fichas_de_sellos', fichas);
END;
$$;
REVOKE ALL ON FUNCTION public._borrar_datos_comensal(uuid) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Invitados que no vuelven en 90 días se borran solos (sus pedidos quedan, sin la persona)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._purgar_invitados()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  DELETE FROM public.suscripciones_push
   WHERE user_id IN (SELECT id FROM auth.users WHERE is_anonymous AND created_at < now() - interval '90 days'
                       AND coalesce(last_sign_in_at, created_at) < now() - interval '90 days');
  WITH borrados AS (
    DELETE FROM auth.users
     WHERE is_anonymous AND created_at < now() - interval '90 days'
       AND coalesce(last_sign_in_at, created_at) < now() - interval '90 days'
    RETURNING 1)
  SELECT count(*) INTO n FROM borrados;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public._purgar_invitados() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purgar-invitados') THEN
    PERFORM cron.unschedule('purgar-invitados');
  END IF;
  PERFORM cron.schedule('purgar-invitados', '43 9 * * *', 'SELECT public._purgar_invitados()');
END;
$$;
