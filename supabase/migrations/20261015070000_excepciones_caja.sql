-- Fase 4.6 — Excepciones de la caja (brief 5.4: pago sin pedido, monto que no calza, boleta fallida).
-- Una sola bandeja para la caja con lo que necesita una persona, cada cosa con su forma de resolverla y una
-- nota obligatoria cuando se resuelve a mano. Todo queda en la auditoría.
--
-- Hueco que se cierra: cuando la app devolvía un cobro sola (otra persona ya había pagado lo mismo, o el
-- monto no calzaba), le pedía la devolución a la pasarela pero no anotaba si resultó. Si fallaba, el cliente
-- quedaba cobrado sin pedido y nadie se enteraba. Ahora el resultado queda anotado, la revisión automática
-- la reintenta y, si sigue fallando, aparece en la bandeja.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Cobros que la app devuelve sola: cuánto, si resultó, cuántas veces se intentó
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.intentos_pago ADD COLUMN IF NOT EXISTS monto_devolver integer;
ALTER TABLE public.intentos_pago ADD COLUMN IF NOT EXISTS devolucion_estado text;
ALTER TABLE public.intentos_pago ADD COLUMN IF NOT EXISTS devolucion_referencia text;
ALTER TABLE public.intentos_pago ADD COLUMN IF NOT EXISTS devolucion_intentos integer NOT NULL DEFAULT 0;
ALTER TABLE public.intentos_pago ADD COLUMN IF NOT EXISTS devolucion_at timestamptz;
ALTER TABLE public.intentos_pago ADD COLUMN IF NOT EXISTS devolucion_nota text;
ALTER TABLE public.intentos_pago ADD COLUMN IF NOT EXISTS devolucion_resuelta_por uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.intentos_pago DROP CONSTRAINT IF EXISTS intentos_pago_devolucion_estado_valido;
ALTER TABLE public.intentos_pago ADD CONSTRAINT intentos_pago_devolucion_estado_valido
  CHECK (devolucion_estado IS NULL OR devolucion_estado IN ('hecha', 'fallida', 'a_mano'));
CREATE INDEX IF NOT EXISTS intentos_pago_devoluciones_abiertas ON public.intentos_pago (resuelto_at)
  WHERE estado = 'reembolsado' AND devolucion_estado IS DISTINCT FROM 'hecha' AND devolucion_estado IS DISTINCT FROM 'a_mano';
CREATE INDEX IF NOT EXISTS intentos_pago_devolucion_resuelta_por ON public.intentos_pago (devolucion_resuelta_por)
  WHERE devolucion_resuelta_por IS NOT NULL;

-- Lo ya devuelto antes de este cambio: cuánto se cobró (consumo + propina) y, en lo simulado, que resultó
UPDATE public.intentos_pago SET monto_devolver = monto + propina
 WHERE estado = 'reembolsado' AND monto_devolver IS NULL;
UPDATE public.intentos_pago SET devolucion_estado = 'hecha', devolucion_at = resuelto_at
 WHERE estado = 'reembolsado' AND devolucion_estado IS NULL AND proveedor IS DISTINCT FROM 'transbank';

-- confirmar_pago guarda cuánto hay que devolver (lo cobrado de verdad, que puede no calzar con el precio)
DO $$
DECLARE
  def text;
  n integer;
BEGIN
  SELECT pg_get_functiondef('public.confirmar_pago(uuid, boolean, integer, text, text, jsonb, text)'::regprocedure) INTO def;
  IF position('monto_devolver' IN def) = 0 THEN
    n := (length(def) - length(replace(def, 'estado = ''reembolsado'', proveedor = _proveedor,', ''))) / length('estado = ''reembolsado'', proveedor = _proveedor,');
    IF n <> 2 THEN
      RAISE EXCEPTION 'confirmar_pago cambió: se esperaban 2 devoluciones automáticas y hay %', n;
    END IF;
    def := replace(def, 'estado = ''reembolsado'', proveedor = _proveedor,',
                   'estado = ''reembolsado'', monto_devolver = coalesce(_monto_cobrado, 0) + it.propina, proveedor = _proveedor,');
    EXECUTE def;
  END IF;
END;
$$;

-- Las funciones de pago anotan cómo resultó cada devolución (solo el servidor)
CREATE OR REPLACE FUNCTION public._anotar_devolucion_intento(_intento_id uuid, _ok boolean, _referencia text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.intentos_pago
     SET devolucion_estado = CASE WHEN _ok THEN 'hecha' ELSE 'fallida' END,
         devolucion_referencia = coalesce(_referencia, devolucion_referencia),
         devolucion_intentos = devolucion_intentos + 1,
         devolucion_at = now()
   WHERE id = _intento_id AND estado = 'reembolsado'
     AND devolucion_estado IS DISTINCT FROM 'hecha' AND devolucion_estado IS DISTINCT FROM 'a_mano';
END;
$$;
REVOKE ALL ON FUNCTION public._anotar_devolucion_intento(uuid, boolean, text) FROM PUBLIC, anon, authenticated;

-- Devoluciones por reintentar con la pasarela: fallidas (o que nunca alcanzaron a pedirse), hasta 6 veces y
-- dentro de 7 días (después la pasarela ya no responde por ese cobro).
CREATE OR REPLACE FUNCTION public._devoluciones_por_reintentar(_branch_id uuid DEFAULT NULL)
RETURNS TABLE (id uuid, token text, conexion_id uuid, monto integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT it.id, it.token_externo, it.conexion_id, coalesce(it.monto_devolver, it.monto + it.propina)
    FROM public.intentos_pago it
    JOIN public.cotizaciones c ON c.id = it.cotizacion_id
   WHERE it.estado = 'reembolsado' AND it.proveedor = 'transbank' AND it.token_externo IS NOT NULL
     AND (it.devolucion_estado IS NULL OR it.devolucion_estado = 'fallida')
     AND it.devolucion_intentos < 6
     AND it.resuelto_at > now() - interval '7 days'
     AND it.resuelto_at < now() - interval '2 minutes'
     AND (_branch_id IS NULL OR c.branch_id = _branch_id)
   ORDER BY it.resuelto_at
   LIMIT 100
$$;
REVOKE ALL ON FUNCTION public._devoluciones_por_reintentar(uuid) FROM PUBLIC, anon, authenticated;

-- El reloj de 5 minutos también despierta la revisión si hay devoluciones por reintentar
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
  IF NOT EXISTS (SELECT 1 FROM public._intentos_por_revisar(NULL))
     AND NOT EXISTS (SELECT 1 FROM public._devoluciones_por_reintentar(NULL)) THEN
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := rtrim(base, '/') || '/revisar-pagos',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-tablio-cron', clave),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000);
END;
$$;
REVOKE ALL ON FUNCTION public._llamar_revisar_pagos() FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Diferencias con la pasarela (monto que no calza): quedan guardadas hasta que alguien las revisa
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.diferencias_pasarela (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL UNIQUE REFERENCES public.payments(id) ON DELETE CASCADE,
  dia date NOT NULL,
  monto integer NOT NULL,
  detalle text NOT NULL,
  estado text NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'revisada', 'corregida')),
  nota text CHECK (nota IS NULL OR char_length(nota) <= 500),
  revisada_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revisada_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  actualizada_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS diferencias_pasarela_abiertas ON public.diferencias_pasarela (branch_id) WHERE estado = 'abierta';
CREATE INDEX IF NOT EXISTS diferencias_pasarela_tenant ON public.diferencias_pasarela (tenant_id);
CREATE INDEX IF NOT EXISTS diferencias_pasarela_revisada_por ON public.diferencias_pasarela (revisada_por) WHERE revisada_por IS NOT NULL;
ALTER TABLE public.diferencias_pasarela ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS diferencias_pasarela_plata ON public.diferencias_pasarela;
CREATE POLICY diferencias_pasarela_plata ON public.diferencias_pasarela FOR SELECT TO authenticated
  USING (public.tiene_rol(tenant_id, ARRAY['owner', 'admin', 'manager', 'cashier']));
REVOKE ALL ON public.diferencias_pasarela FROM anon, authenticated;
GRANT SELECT ON public.diferencias_pasarela TO authenticated;

-- La conciliación (función conciliar-pasarela) anota lo que no calza y cierra lo que ya calza (solo el servidor)
CREATE OR REPLACE FUNCTION public._anotar_conciliacion(_branch_id uuid, _dia date, _resultados jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  x jsonb;
  abiertas integer := 0;
  local uuid := (SELECT tenant_id FROM public.branches WHERE id = _branch_id);
BEGIN
  FOR x IN SELECT * FROM jsonb_array_elements(coalesce(_resultados, '[]'::jsonb)) LOOP
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.id = (x ->> 'pago_id')::uuid AND p.branch_id = _branch_id);
    IF (x ->> 'calza')::boolean THEN
      UPDATE public.diferencias_pasarela SET estado = 'corregida', actualizada_at = now()
       WHERE payment_id = (x ->> 'pago_id')::uuid AND estado = 'abierta';
    ELSIF NOT coalesce((x ->> 'transitorio')::boolean, false) THEN
      INSERT INTO public.diferencias_pasarela (tenant_id, branch_id, payment_id, dia, monto, detalle)
      VALUES (local, _branch_id, (x ->> 'pago_id')::uuid, _dia, coalesce((x ->> 'monto')::integer, 0), left(x ->> 'detalle', 300))
      ON CONFLICT (payment_id) DO UPDATE
        SET detalle = EXCLUDED.detalle, monto = EXCLUDED.monto, actualizada_at = now(),
            estado = CASE WHEN diferencias_pasarela.estado = 'revisada' THEN 'revisada' ELSE 'abierta' END;
      abiertas := abiertas + 1;
    END IF;
  END LOOP;
  RETURN abiertas;
END;
$$;
REVOKE ALL ON FUNCTION public._anotar_conciliacion(uuid, date, jsonb) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Boletas: la que no se pudo entregar (el cliente se fue) se anota con su motivo
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS boleta_nota text;
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_boleta_nota_largo;
ALTER TABLE public.payments ADD CONSTRAINT payments_boleta_nota_largo CHECK (boleta_nota IS NULL OR char_length(boleta_nota) <= 500);
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_boleta_estado_valido;
ALTER TABLE public.payments ADD CONSTRAINT payments_boleta_estado_valido
  CHECK (boleta_estado IS NULL OR boleta_estado IN ('pendiente', 'entregada', 'no_entregada'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Reembolsos que la pasarela rechazó: se reintentan o se descartan con motivo
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.refunds ADD COLUMN IF NOT EXISTS revisado_at timestamptz;
ALTER TABLE public.refunds ADD COLUMN IF NOT EXISTS revisado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.refunds ADD COLUMN IF NOT EXISTS revisado_nota text;
ALTER TABLE public.refunds DROP CONSTRAINT IF EXISTS refunds_revisado_nota_largo;
ALTER TABLE public.refunds ADD CONSTRAINT refunds_revisado_nota_largo CHECK (revisado_nota IS NULL OR char_length(revisado_nota) <= 500);
CREATE INDEX IF NOT EXISTS refunds_fallidos ON public.refunds (payment_id) WHERE status = 'failed' AND revisado_at IS NULL;
CREATE INDEX IF NOT EXISTS refunds_revisado_por ON public.refunds (revisado_por) WHERE revisado_por IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. La bandeja de excepciones (dueño, administrador, encargado, caja)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.excepciones_caja(_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  hoy date;
BEGIN
  PERFORM public._tenant_caja(_branch_id); -- dueño, administrador, encargado, caja o superadmin
  hoy := public.dia_negocio(_branch_id, now());
  RETURN (
    SELECT coalesce(jsonb_agg(e ORDER BY e ->> 'fecha'), '[]'::jsonb) FROM (
      -- Pago sin pedido: la app debía devolverlo y la pasarela no lo devolvió (tras reintentar)
      SELECT jsonb_build_object(
               'tipo', 'devolucion_fallida', 'id', it.id, 'fecha', it.resuelto_at,
               'monto', coalesce(it.monto_devolver, it.monto + it.propina),
               'mesa', (SELECT t.number FROM public.tables t WHERE t.id = c.table_id),
               'detalle', coalesce(it.motivo, 'Cobro que había que devolver'),
               'referencia', it.referencia_externa, 'intentos', it.devolucion_intentos) AS e
        FROM public.intentos_pago it JOIN public.cotizaciones c ON c.id = it.cotizacion_id
       WHERE c.branch_id = _branch_id AND it.estado = 'reembolsado'
         AND it.resuelto_at > now() - interval '30 days'
         AND ((it.devolucion_estado = 'fallida' AND (it.devolucion_intentos >= 3 OR it.resuelto_at < now() - interval '7 days'))
           OR (it.devolucion_estado IS NULL AND it.proveedor = 'transbank' AND it.resuelto_at < now() - interval '30 minutes'))
      UNION ALL
      -- Reembolso que la pasarela rechazó (y no se hizo después)
      SELECT jsonb_build_object(
               'tipo', 'reembolso_fallido', 'id', r.id, 'fecha', r.created_at, 'monto', r.amount,
               'mesa', (SELECT t.number FROM public.tables t WHERE t.id = p.table_id),
               'detalle', r.reason, 'pago_id', p.id, 'referencia', p.external_reference,
               'autorizado_por', r.authorized_by_name)
        FROM public.refunds r JOIN public.payments p ON p.id = r.payment_id
       WHERE p.branch_id = _branch_id AND r.status = 'failed' AND r.revisado_at IS NULL
         AND r.created_at > now() - interval '30 days'
         AND NOT EXISTS (SELECT 1 FROM public.refunds r2 WHERE r2.payment_id = r.payment_id
                          AND r2.status IN ('completed', 'pending') AND r2.created_at > r.created_at)
      UNION ALL
      -- Monto que no calza con la pasarela
      SELECT jsonb_build_object(
               'tipo', 'diferencia_pasarela', 'id', d.id, 'fecha', d.created_at, 'monto', d.monto,
               'mesa', (SELECT t.number FROM public.payments p JOIN public.tables t ON t.id = p.table_id WHERE p.id = d.payment_id),
               'detalle', d.detalle, 'dia', d.dia, 'pago_id', d.payment_id,
               'referencia', (SELECT p.external_reference FROM public.payments p WHERE p.id = d.payment_id))
        FROM public.diferencias_pasarela d
       WHERE d.branch_id = _branch_id AND d.estado = 'abierta'
      UNION ALL
      -- Boleta de un día anterior que nadie marcó
      SELECT jsonb_build_object(
               'tipo', 'boleta_atrasada', 'id', p.id, 'fecha', p.created_at, 'monto', p.amount,
               'mesa', (SELECT t.number FROM public.tables t WHERE t.id = p.table_id),
               'detalle', CASE p.method WHEN 'transfer' THEN 'Cobro por transferencia sin boleta marcada' ELSE 'Cobro en efectivo sin boleta marcada' END,
               'dia', p.dia_negocio,
               'cobrado_por', (SELECT su.name FROM public.staff_users su
                                WHERE su.auth_user_id::text = p.provider_payload ->> 'cobrado_por' AND su.tenant_id = p.tenant_id
                                ORDER BY su.created_at LIMIT 1))
        FROM public.payments p
       WHERE p.branch_id = _branch_id AND p.boleta_estado = 'pendiente' AND p.dia_negocio < hoy
         AND p.status IN ('approved', 'partially_refunded') AND p.created_at > now() - interval '30 days'
      UNION ALL
      -- Pago que salió a la pasarela y la revisión automática no ha podido resolver
      SELECT jsonb_build_object(
               'tipo', 'pago_sin_confirmar', 'id', it.id, 'fecha', it.created_at, 'monto', it.monto + it.propina,
               'mesa', (SELECT t.number FROM public.tables t WHERE t.id = c.table_id),
               'detalle', 'Salió a Webpay y no ha vuelto confirmación')
        FROM public.intentos_pago it JOIN public.cotizaciones c ON c.id = it.cotizacion_id
       WHERE c.branch_id = _branch_id AND it.estado = 'reservado' AND it.token_externo IS NOT NULL
         AND it.created_at < now() - interval '30 minutes' AND it.created_at > now() - interval '7 days'
    ) x(e)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.excepciones_caja(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.excepciones_caja(uuid) TO authenticated;

-- Resolver a mano (los reintentos los hacen las funciones de pago). Siempre con nota cuando no hay otra
-- constancia; todo queda en la auditoría.
CREATE OR REPLACE FUNCTION public.resolver_excepcion(_tipo text, _id uuid, _accion text, _nota text DEFAULT NULL, _folio text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sucursal uuid;
  local uuid;
  explicacion text := nullif(btrim(coalesce(_nota, '')), '');
  numero text := nullif(btrim(coalesce(_folio, '')), '');
  filas integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Tienes que iniciar sesión' USING ERRCODE = '42501';
  END IF;
  IF explicacion IS NOT NULL AND char_length(explicacion) > 500 THEN
    RAISE EXCEPTION 'La nota es demasiado larga (máximo 500 letras)' USING ERRCODE = '22023';
  END IF;
  IF numero IS NOT NULL AND char_length(numero) > 40 THEN
    RAISE EXCEPTION 'El número de boleta es demasiado largo' USING ERRCODE = '22023';
  END IF;

  -- ¿De qué sucursal es? (y que exista)
  sucursal := CASE _tipo
    WHEN 'devolucion_fallida' THEN (SELECT c.branch_id FROM public.intentos_pago it JOIN public.cotizaciones c ON c.id = it.cotizacion_id WHERE it.id = _id)
    WHEN 'reembolso_fallido' THEN (SELECT p.branch_id FROM public.refunds r JOIN public.payments p ON p.id = r.payment_id WHERE r.id = _id)
    WHEN 'diferencia_pasarela' THEN (SELECT d.branch_id FROM public.diferencias_pasarela d WHERE d.id = _id)
    WHEN 'boleta_atrasada' THEN (SELECT p.branch_id FROM public.payments p WHERE p.id = _id)
    ELSE NULL END;
  IF sucursal IS NULL THEN
    RAISE EXCEPTION 'No encontramos esa excepción' USING ERRCODE = 'P0002';
  END IF;
  local := public._tenant_caja(sucursal); -- solo quien ve la plata del local

  IF _accion IN ('a_mano', 'descartar', 'revisada', 'no_entregada') AND (explicacion IS NULL OR char_length(explicacion) < 5) THEN
    RAISE EXCEPTION 'Explica qué pasó (al menos 5 letras)' USING ERRCODE = 'P0001';
  END IF;

  IF _tipo = 'devolucion_fallida' AND _accion = 'a_mano' THEN
    UPDATE public.intentos_pago
       SET devolucion_estado = 'a_mano', devolucion_nota = explicacion, devolucion_resuelta_por = auth.uid(), devolucion_at = now()
     WHERE id = _id AND estado = 'reembolsado'
       AND devolucion_estado IS DISTINCT FROM 'hecha' AND devolucion_estado IS DISTINCT FROM 'a_mano';
  ELSIF _tipo = 'reembolso_fallido' AND _accion = 'descartar' THEN
    UPDATE public.refunds SET revisado_at = now(), revisado_por = auth.uid(), revisado_nota = explicacion
     WHERE id = _id AND status = 'failed' AND revisado_at IS NULL;
  ELSIF _tipo = 'diferencia_pasarela' AND _accion = 'revisada' THEN
    UPDATE public.diferencias_pasarela SET estado = 'revisada', nota = explicacion, revisada_por = auth.uid(), revisada_at = now(), actualizada_at = now()
     WHERE id = _id AND estado = 'abierta';
  ELSIF _tipo = 'boleta_atrasada' AND _accion IN ('entregada', 'no_entregada') THEN
    UPDATE public.payments
       SET boleta_estado = _accion, boleta_folio = CASE WHEN _accion = 'entregada' THEN numero END,
           boleta_nota = explicacion, boleta_marcada_at = now(), boleta_marcada_por = auth.uid()
     WHERE id = _id AND boleta_estado = 'pendiente';
  ELSE
    RAISE EXCEPTION 'Esa acción no corresponde a esta excepción' USING ERRCODE = '22023';
  END IF;
  GET DIAGNOSTICS filas = ROW_COUNT;
  IF filas = 0 THEN
    -- Otra persona la resolvió recién (o ya no aplica): no se cambia nada
    RETURN jsonb_build_object('resuelta', false, 'ya_estaba', true);
  END IF;

  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (local, auth.uid(), 'excepcion_resuelta', _tipo, _id,
          jsonb_build_object('accion', _accion, 'nota', explicacion, 'folio', numero));
  RETURN jsonb_build_object('resuelta', true, 'ya_estaba', false);
END;
$$;
REVOKE ALL ON FUNCTION public.resolver_excepcion(text, uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolver_excepcion(text, uuid, text, text, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Las auditorías
-- ─────────────────────────────────────────────────────────────────────────────
-- Operación: una boleta marcada (entregada o no entregada) dice cuándo
DO $$
DECLARE
  def text;
BEGIN
  SELECT pg_get_functiondef('public.auditoria_operacion()'::regprocedure) INTO def;
  IF position('''no_entregada''' IN def) = 0 THEN
    def := replace(def, 'WHERE p.boleta_estado = ''entregada'' AND p.boleta_marcada_at IS NULL',
                   'WHERE p.boleta_estado IN (''entregada'', ''no_entregada'') AND p.boleta_marcada_at IS NULL');
    IF position('''no_entregada''' IN def) = 0 THEN
      RAISE EXCEPTION 'No se pudo actualizar la revisión de boletas en la auditoría';
    END IF;
    EXECUTE def;
  END IF;
END;
$$;

-- Plata: un cobro que había que devolver no puede quedar sin devolver (ni sin explicación) más de 7 días
DO $$
DECLARE
  def text;
  anclaje text;
BEGIN
  SELECT pg_get_functiondef('public.auditoria_plata()'::regprocedure) INTO def;
  IF position('devolucion_sin_resolver' IN def) = 0 THEN
    anclaje := substring(def FROM '\n(\s*RETURN;\s*\n\s*END;\s*\$function\$)');
    IF anclaje IS NULL THEN
      -- Sin RETURN final explícito: se agrega antes del END
      anclaje := substring(def FROM '\n(\s*END;\s*\$function\$)');
    END IF;
    IF anclaje IS NULL THEN
      RAISE EXCEPTION 'No se encontró dónde agregar la revisión de devoluciones a auditoria_plata';
    END IF;
    def := replace(def, anclaje,
'  -- Devoluciones automáticas que la pasarela no hizo y nadie resolvió (fase 4.6)
  RETURN QUERY
  SELECT ''devolucion_sin_resolver''::text, it.id::text,
         format(''Cobro de %s que había que devolver sigue sin devolverse desde %s'', coalesce(it.monto_devolver, it.monto + it.propina), it.resuelto_at::date)
    FROM public.intentos_pago it
   WHERE it.estado = ''reembolsado'' AND it.devolucion_estado = ''fallida''
     AND it.resuelto_at < now() - interval ''7 days'';
' || anclaje);
    IF position('devolucion_sin_resolver' IN def) = 0 THEN
      RAISE EXCEPTION 'No se pudo agregar la revisión de devoluciones a auditoria_plata';
    END IF;
    EXECUTE def;
  END IF;
END;
$$;
