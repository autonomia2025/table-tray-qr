-- Fase 3.4b — Avisos al celular aunque la pantalla esté bloqueada (notificaciones push del navegador).
-- El comensal acepta los avisos y su navegador entrega una "dirección de aviso" (endpoint) con dos
-- claves. Se guarda aquí, ligada a su identidad. Cuando la cocina deja algo listo, la función
-- avisar-listo le manda el aviso a esa dirección (firmado con la clave de Tablio, VAPID).
-- Estándar de los navegadores: no requiere cuentas externas ni costo.

CREATE TABLE IF NOT EXISTS public.suscripciones_push (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE CHECK (endpoint LIKE 'https://%' AND char_length(endpoint) <= 1000),
  p256dh text NOT NULL CHECK (char_length(p256dh) BETWEEN 40 AND 200),
  auth text NOT NULL CHECK (char_length(auth) BETWEEN 10 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  usado_at timestamptz
);
CREATE INDEX IF NOT EXISTS suscripciones_push_usuario_idx ON public.suscripciones_push (user_id, tenant_id);
ALTER TABLE public.suscripciones_push ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.suscripciones_push FROM anon;
REVOKE INSERT, UPDATE ON public.suscripciones_push FROM authenticated;
GRANT SELECT, DELETE ON public.suscripciones_push TO authenticated;
GRANT ALL ON public.suscripciones_push TO service_role;
-- Cada uno ve y borra solo las suyas (el personal no las ve)
DROP POLICY IF EXISTS suscripciones_propias ON public.suscripciones_push;
CREATE POLICY suscripciones_propias ON public.suscripciones_push FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS suscripciones_borrar_propias ON public.suscripciones_push;
CREATE POLICY suscripciones_borrar_propias ON public.suscripciones_push FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Lo ya avisado no se vuelve a avisar
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS avisado_at timestamptz;

-- Guardar mi dirección de aviso (desde el QR de mi mesa). Máximo 5 celulares o navegadores por persona.
CREATE OR REPLACE FUNCTION public.guardar_suscripcion_push(_qr_token text, _endpoint text, _p256dh text, _auth text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  id_sus uuid;
BEGIN
  SELECT * INTO c FROM public._comensal_en_mesa(_qr_token);
  IF _endpoint IS NULL OR _endpoint NOT LIKE 'https://%' OR char_length(_endpoint) > 1000 THEN
    RAISE EXCEPTION 'No pudimos activar los avisos en este celular' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.suscripciones_push (tenant_id, user_id, endpoint, p256dh, auth)
  VALUES ((c.mesa).tenant_id, auth.uid(), _endpoint, _p256dh, _auth)
  ON CONFLICT (endpoint) DO UPDATE
    SET user_id = auth.uid(), tenant_id = EXCLUDED.tenant_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, created_at = now()
  RETURNING id INTO id_sus;

  DELETE FROM public.suscripciones_push
   WHERE user_id = auth.uid() AND id IN (
     SELECT id FROM public.suscripciones_push WHERE user_id = auth.uid() ORDER BY created_at DESC OFFSET 5);

  RETURN jsonb_build_object('id', id_sus);
END;
$$;
REVOKE ALL ON FUNCTION public.guardar_suscripcion_push(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_suscripcion_push(text, text, text, text) TO authenticated;

-- Reinicio del demo: también borra las suscripciones de los clientes del demo
DO $$
DECLARE
  def text;
BEGIN
  SELECT pg_get_functiondef('public.reiniciar_demo()'::regprocedure) INTO def;
  IF position('public.suscripciones_push' IN def) = 0 THEN
    def := replace(def, 'DELETE FROM public.turnos WHERE tenant_id = demo;',
                   'DELETE FROM public.turnos WHERE tenant_id = demo;
  DELETE FROM public.suscripciones_push WHERE tenant_id = demo;');
    EXECUTE def;
  END IF;
END;
$$;
