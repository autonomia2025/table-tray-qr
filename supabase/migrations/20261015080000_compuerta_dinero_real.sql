-- Fase 4.7 — Compuerta del dinero real. Las auditorías automáticas también revisan lo nuevo de la fase 4:
-- pagos con pasarela que se puedan rastrear y devolver, claves de pasarela (que existan mientras se usan y
-- se borren a los 120 días de desconectar), cobros simulados solo donde se permiten, diferencias con la
-- pasarela del mismo local y, en privacidad, que nadie quede con consentimiento sin tener cuenta.
-- La prueba f4-7-compuerta exige que salgan vacías y que detecten un descuadre hecho a propósito.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Auditoría de la plata: pasarelas
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  def text;
  anclaje text;
BEGIN
  SELECT pg_get_functiondef('public.auditoria_plata()'::regprocedure) INTO def;
  IF position('pago_pasarela_sin_rastro' IN def) = 0 THEN
    anclaje := substring(def FROM '\n(\s*END;\s*\$function\$)');
    IF anclaje IS NULL THEN
      RAISE EXCEPTION 'No se encontró dónde agregar las revisiones de pasarela a auditoria_plata';
    END IF;
    def := replace(def, anclaje,
'  -- Pasarelas (fase 4.7) ────────────────────────────────────────────────────
  -- Un pago con Transbank guarda con qué conexión y con qué número se cobró: sin eso no se puede
  -- conciliar ni devolver.
  RETURN QUERY
  SELECT ''pago_pasarela_sin_rastro''::text, p.id::text, ''Pago con Transbank sin su número de Webpay o sin la conexión con que se cobró''
    FROM public.payments p
   WHERE p.provider = ''transbank''
     AND (p.provider_payload ->> ''token'' IS NULL OR p.provider_payload ->> ''conexion_id'' IS NULL);

  RETURN QUERY
  SELECT ''intento_sin_conexion''::text, it.id::text, ''Intento que salió a la pasarela sin saber con qué conexión''
    FROM public.intentos_pago it
   WHERE it.token_externo IS NOT NULL AND it.conexion_id IS NULL;

  -- La conexión activa tiene su clave guardada; la desconectada hace más de 120 días ya no la tiene.
  RETURN QUERY
  SELECT ''conexion_sin_clave''::text, c.id::text, ''Pasarela activa sin su clave guardada: no podría cobrar ni devolver''
    FROM public.conexiones_pago c
   WHERE c.estado = ''activa''
     AND (c.secreto_id IS NULL OR NOT EXISTS (SELECT 1 FROM vault.secrets s WHERE s.id = c.secreto_id));

  RETURN QUERY
  SELECT ''clave_vencida''::text, c.id::text, format(''Clave de una pasarela desconectada el %s que debía borrarse a los 120 días'', c.desconectado_at::date)
    FROM public.conexiones_pago c
   WHERE c.estado = ''desconectada'' AND c.secreto_id IS NOT NULL
     AND c.desconectado_at < now() - interval ''121 days'';

  -- Cobros simulados solo donde el local los permite (el demo); un local real nunca cobra de mentira.
  RETURN QUERY
  SELECT ''pago_simulado_en_local_real''::text, p.id::text, ''Pago simulado en una sucursal que no permite pagos simulados''
    FROM public.payments p JOIN public.branches b ON b.id = p.branch_id
   WHERE p.provider = ''simulated'' AND NOT b.pagos_simulados;

  -- Una diferencia con la pasarela es del mismo local y sucursal que su pago.
  RETURN QUERY
  SELECT ''diferencia_de_otro_local''::text, d.id::text, ''Diferencia con la pasarela anotada en otro local o sucursal que su pago''
    FROM public.diferencias_pasarela d JOIN public.payments p ON p.id = d.payment_id
   WHERE d.tenant_id <> p.tenant_id OR d.branch_id <> p.branch_id;
' || anclaje);
    IF position('pago_pasarela_sin_rastro' IN def) = 0 THEN
      RAISE EXCEPTION 'No se pudieron agregar las revisiones de pasarela a auditoria_plata';
    END IF;
    EXECUTE def;
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Auditoría de la operación: privacidad
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  def text;
BEGIN
  SELECT pg_get_functiondef('public.auditoria_operacion()'::regprocedure) INTO def;
  IF position('consentimiento_sin_cuenta' IN def) = 0 THEN
    def := replace(def, '  -- Sellos ───',
'  -- Privacidad (fase 4.7) ───────────────────────────────────────────────────
  -- El consentimiento para promociones es de una cuenta guardada, nunca de un invitado.
  RETURN QUERY
  SELECT ''consentimiento_sin_cuenta'', c.user_id::text, ''Consentimiento para promociones de alguien sin cuenta guardada''
    FROM public.consentimientos_comensal c JOIN auth.users u ON u.id = c.user_id
   WHERE coalesce(u.is_anonymous, false) OR u.email IS NULL;

  -- Sellos ───');
    IF position('consentimiento_sin_cuenta' IN def) = 0 THEN
      RAISE EXCEPTION 'No se pudo agregar la revisión de privacidad a la auditoría';
    END IF;
    EXECUTE def;
  END IF;
END;
$$;
