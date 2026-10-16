-- Fase 7.9 — Módulos por plan. Las funciones nuevas de "más ventas y experiencia" son módulos que pueden ir en
-- un plan u otro. Lo básico (pedir, pagar, mozo, cocina, caja, sellos, reportes) nunca es un módulo: siempre está.
--   · Catálogo cerrado en _catalogo_modulos(), como el de permisos.
--   · Cada plan dice qué módulos trae (plans.features). Por decisión del fundador pendiente (precios de la fase 8),
--     por ahora todos los planes traen todos los módulos.
--   · El superadmin puede prender o apagar un módulo para un local en particular (tenant_feature_flags),
--     por encima de su plan. Un local sin plan (demo, prueba) tiene todo.
--   · Se cumple en la base: tiene_funcion(local, módulo) en cada función del módulo. Las pantallas solo esconden.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Catálogo y planes
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._catalogo_modulos()
RETURNS TABLE (modulo text, nombre text, descripcion text, orden integer)
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  VALUES
    ('campanas',  'Campañas',            'Promociones por aviso al celular, con beneficio al pagar.',       1),
    ('niveles',   'Niveles y rachas',    'Bronce, Plata y Oro, y rachas de visitas con premios.',           2),
    ('pasaporte', 'Pasaporte de la casa','Lo que cada cliente probó de la carta, con insignias.',           3),
    ('raspe',     'Raspe y gana',        'Premio sorpresa al pagar, con tope de premios al mes.',           4),
    ('juegos',    'Juegos en la mesa',   'Trivia y ruleta mientras esperan.',                                5),
    ('ronda',     'Invitar una ronda',   'Marcar un pedido como ronda para la mesa.',                        6),
    ('dividir',   'Dividir un plato',    'Cada uno paga su parte de un plato compartido.',                   7),
    ('tablets',   'Tablets compartidas', 'El equipo entra con su PIN en una tablet del local.',              8)
$$;
REVOKE ALL ON FUNCTION public._catalogo_modulos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._catalogo_modulos() TO authenticated;

-- tenant_feature_flags apunta a feature_flags: cada módulo tiene su fila
INSERT INTO public.feature_flags (key, description, default_enabled)
SELECT c.modulo, c.nombre || ': ' || c.descripcion, true FROM public._catalogo_modulos() c
ON CONFLICT (key) DO NOTHING;

-- Los planes por tamaño del brief (sección 8, hipótesis). Precio y reparto de módulos: fase 8.
CREATE UNIQUE INDEX IF NOT EXISTS plans_name_uidx ON public.plans (name);
INSERT INTO public.plans (name, display_name, max_tables, features)
SELECT p.name, p.display_name, p.max_tables, (SELECT jsonb_object_agg(c.modulo, true) FROM public._catalogo_modulos() c)
  FROM (VALUES ('chico', 'Hasta 12 mesas', 12), ('mediano', '13 a 30 mesas', 30), ('grande', '31 a 60 mesas', 60),
               ('personalizado', 'Más de 60 mesas', 500)) p(name, display_name, max_tables)
ON CONFLICT (name) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ¿Tiene el local este módulo?
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tiene_funcion(_tenant_id uuid, _modulo text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    -- Lo que el superadmin ajustó para este local
    (SELECT f.is_enabled FROM public.tenant_feature_flags f WHERE f.tenant_id = _tenant_id AND f.flag_key = _modulo),
    -- Lo que trae su plan
    (SELECT (p.features ->> _modulo)::boolean FROM public.tenants t JOIN public.plans p ON p.id = t.plan_id WHERE t.id = _tenant_id),
    -- Sin plan (demo, prueba), o un módulo que el plan no menciona: lo tiene
    true)
$$;
REVOKE ALL ON FUNCTION public.tiene_funcion(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._exigir_funcion(_tenant_id uuid, _modulo text)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.tiene_funcion(_tenant_id, _modulo) THEN
    RAISE EXCEPTION 'Esta función no está incluida en el plan del local' USING ERRCODE = 'P0001';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public._exigir_funcion(uuid, text) FROM PUBLIC, anon, authenticated;

-- Lo que ve cualquiera con sesión (el comensal, el personal): qué módulos tiene el local. No es sensible.
CREATE OR REPLACE FUNCTION public.modulos_del_local(_tenant_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_object_agg(c.modulo, public.tiene_funcion(_tenant_id, c.modulo)) FROM public._catalogo_modulos() c
$$;
REVOKE ALL ON FUNCTION public.modulos_del_local(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.modulos_del_local(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Lo que hace el superadmin (queda en la auditoría)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guardar_modulos_plan(_plan_id uuid, _modulos jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  antes jsonb;
  v_nuevo jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Solo el superadmin cambia los planes' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(_modulos) IS DISTINCT FROM 'object'
     OR EXISTS (SELECT 1 FROM jsonb_each(_modulos) e
                 WHERE e.key NOT IN (SELECT modulo FROM public._catalogo_modulos()) OR jsonb_typeof(e.value) <> 'boolean') THEN
    RAISE EXCEPTION 'Módulos no válidos' USING ERRCODE = 'P0001';
  END IF;
  SELECT features INTO antes FROM public.plans WHERE id = _plan_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ese plan no existe' USING ERRCODE = 'P0001';
  END IF;
  -- Solo los módulos del catálogo (lo demás que hubiera en features se conserva tal cual)
  v_nuevo := coalesce(antes, '{}'::jsonb) || _modulos;
  UPDATE public.plans SET features = v_nuevo WHERE id = _plan_id;
  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (NULL, (SELECT auth.uid()), 'modulos_plan_cambiados', 'plan', _plan_id, jsonb_build_object('antes', antes, 'despues', v_nuevo));
END;
$$;
REVOKE ALL ON FUNCTION public.guardar_modulos_plan(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_modulos_plan(uuid, jsonb) TO authenticated;

-- Un módulo para un local en particular: true/false, o NULL para volver a lo de su plan
CREATE OR REPLACE FUNCTION public.ajustar_modulo_local(_tenant_id uuid, _modulo text, _estado boolean, _motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_motivo text := btrim(coalesce(_motivo, ''));
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Solo el superadmin ajusta los módulos de un local' USING ERRCODE = '42501';
  END IF;
  IF _modulo NOT IN (SELECT modulo FROM public._catalogo_modulos()) THEN
    RAISE EXCEPTION 'Ese módulo no existe' USING ERRCODE = 'P0001';
  END IF;
  IF char_length(v_motivo) NOT BETWEEN 5 AND 500 THEN
    RAISE EXCEPTION 'Escribe el motivo (de 5 a 500 letras)' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = _tenant_id) THEN
    RAISE EXCEPTION 'Ese local no existe' USING ERRCODE = 'P0001';
  END IF;
  IF _estado IS NULL THEN
    DELETE FROM public.tenant_feature_flags WHERE tenant_id = _tenant_id AND flag_key = _modulo;
  ELSE
    INSERT INTO public.tenant_feature_flags (tenant_id, flag_key, is_enabled) VALUES (_tenant_id, _modulo, _estado)
    ON CONFLICT (tenant_id, flag_key) DO UPDATE SET is_enabled = EXCLUDED.is_enabled;
  END IF;
  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (_tenant_id, (SELECT auth.uid()), 'modulo_ajustado', 'tenant', _tenant_id,
          jsonb_build_object('modulo', _modulo, 'estado', _estado, 'motivo', v_motivo));
END;
$$;
REVOKE ALL ON FUNCTION public.ajustar_modulo_local(uuid, text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ajustar_modulo_local(uuid, text, boolean, text) TO authenticated;

-- El plan de un local (o ninguno)
CREATE OR REPLACE FUNCTION public.asignar_plan(_tenant_id uuid, _plan_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  antes uuid;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Solo el superadmin cambia el plan de un local' USING ERRCODE = '42501';
  END IF;
  IF _plan_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.plans WHERE id = _plan_id AND coalesce(is_active, true)) THEN
    RAISE EXCEPTION 'Ese plan no existe' USING ERRCODE = 'P0001';
  END IF;
  SELECT plan_id INTO antes FROM public.tenants WHERE id = _tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ese local no existe' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.tenants SET plan_id = _plan_id, updated_at = now() WHERE id = _tenant_id;
  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (_tenant_id, (SELECT auth.uid()), 'plan_asignado', 'tenant', _tenant_id, jsonb_build_object('antes', antes, 'despues', _plan_id));
END;
$$;
REVOKE ALL ON FUNCTION public.asignar_plan(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asignar_plan(uuid, uuid) TO authenticated;

-- Los ajustes por local solo por la función (con motivo y auditoría)
REVOKE INSERT, UPDATE, DELETE ON public.tenant_feature_flags FROM anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Cada módulo lo revisa en la base
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  def text;
  nuevo text;
BEGIN
  -- Campañas: guardar y enviar
  def := pg_get_functiondef('public.guardar_campana'::regproc);
  nuevo := replace(def, $q$  PERFORM public._exigir_permiso(_tenant_id, 'enviar_campanas');$q$,
    $q$  PERFORM public._exigir_permiso(_tenant_id, 'enviar_campanas');
  PERFORM public._exigir_funcion(_tenant_id, 'campanas');$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'guardar_campana: no se encontró dónde'; END IF;
  EXECUTE nuevo;
  def := pg_get_functiondef('public.enviar_campana'::regproc);
  nuevo := replace(def, $q$  PERFORM public._exigir_permiso(c.tenant_id, 'enviar_campanas');$q$,
    $q$  PERFORM public._exigir_permiso(c.tenant_id, 'enviar_campanas');
  PERFORM public._exigir_funcion(c.tenant_id, 'campanas');$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'enviar_campana: no se encontró dónde'; END IF;
  EXECUTE nuevo;

  -- Niveles y rachas: no se premian ni se muestran
  def := pg_get_functiondef('public._logros_visita'::regproc);
  nuevo := replace(def, $q$  IF prog.id IS NULL THEN RETURN 0; END IF;$q$,
    $q$  IF prog.id IS NULL OR NOT public.tiene_funcion(m.tenant_id, 'niveles') THEN RETURN 0; END IF;$q$);
  IF nuevo = def THEN RAISE EXCEPTION '_logros_visita: no se encontró dónde'; END IF;
  EXECUTE nuevo;
  def := pg_get_functiondef('public.mis_sellos'::regproc);
  nuevo := replace(def, $q$    'nivel', CASE WHEN prog.niveles_activos OR prog.racha_semanas IS NOT NULL THEN$q$,
    $q$    'nivel', CASE WHEN (prog.niveles_activos OR prog.racha_semanas IS NOT NULL) AND public.tiene_funcion(_tenant_id, 'niveles') THEN$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'mis_sellos: no se encontró dónde'; END IF;
  EXECUTE nuevo;

  -- Pasaporte
  def := pg_get_functiondef('public.mi_pasaporte'::regproc);
  nuevo := replace(def, $q$  IF NOT activo THEN$q$, $q$  IF NOT activo OR NOT public.tiene_funcion(_tenant_id, 'pasaporte') THEN$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'mi_pasaporte: no se encontró dónde'; END IF;
  EXECUTE nuevo;

  -- Raspe y gana: no se sortea ni se muestra
  def := pg_get_functiondef('public._raspe_visita'::regproc);
  nuevo := replace(def, $q$  IF prog.id IS NULL OR NOT prog.sorpresa_activa OR prog.sorpresa_premio IS NULL THEN RETURN false; END IF;$q$,
    $q$  IF prog.id IS NULL OR NOT prog.sorpresa_activa OR prog.sorpresa_premio IS NULL
     OR NOT public.tiene_funcion(m.tenant_id, 'raspe') THEN RETURN false; END IF;$q$);
  IF nuevo = def THEN RAISE EXCEPTION '_raspe_visita: no se encontró dónde'; END IF;
  EXECUTE nuevo;
  def := pg_get_functiondef('public.mis_raspes'::regproc);
  nuevo := replace(def, $q$    'activo', coalesce(prog.sorpresa_activa, false),$q$,
    $q$    'activo', coalesce(prog.sorpresa_activa, false) AND public.tiene_funcion(_tenant_id, 'raspe'),$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'mis_raspes: no se encontró dónde'; END IF;
  EXECUTE nuevo;

  -- Juegos
  FOR def IN SELECT pg_get_functiondef(p.oid) FROM pg_proc p
              WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('empezar_trivia', 'girar_ruleta') LOOP
    nuevo := replace(def, $q$  SELECT * INTO c FROM public._comensal_en_mesa(_qr_token);$q$,
      $q$  SELECT * INTO c FROM public._comensal_en_mesa(_qr_token);
  PERFORM public._exigir_funcion((c.mesa).tenant_id, 'juegos');$q$);
    IF nuevo = def THEN RAISE EXCEPTION 'juegos: no se encontró dónde'; END IF;
    EXECUTE nuevo;
  END LOOP;

  -- Dividir un plato
  def := pg_get_functiondef('public.dividir_plato'::regproc);
  nuevo := replace(def, $q$  SELECT * INTO c FROM public._comensal_en_mesa(_qr_token);$q$,
    $q$  SELECT * INTO c FROM public._comensal_en_mesa(_qr_token);
  PERFORM public._exigir_funcion((c.mesa).tenant_id, 'dividir');$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'dividir_plato: no se encontró dónde'; END IF;
  EXECUTE nuevo;

  -- Ronda: sin el módulo, el pedido no queda marcado como ronda (la plata no cambia)
  def := pg_get_functiondef('public.crear_cotizacion(uuid,text,jsonb,uuid[],text,boolean)'::regprocedure);
  nuevo := replace(def, $q$CASE WHEN coalesce(ben.descuento, 0) > 0 THEN ben.envio_id END, coalesce(_ronda, false))$q$,
    $q$CASE WHEN coalesce(ben.descuento, 0) > 0 THEN ben.envio_id END, coalesce(_ronda, false) AND public.tiene_funcion(mesa.tenant_id, 'ronda'))$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'crear_cotizacion: no se encontró dónde'; END IF;
  EXECUTE nuevo;

  -- Tablets compartidas: activar una nueva
  def := pg_get_functiondef('public.crear_equipo_compartido'::regproc);
  nuevo := replace(def, $q$    RAISE EXCEPTION 'Solo el dueño, el administrador o el encargado activan una tablet' USING ERRCODE = '42501';
  END IF;$q$,
    $q$    RAISE EXCEPTION 'Solo el dueño, el administrador o el encargado activan una tablet' USING ERRCODE = '42501';
  END IF;
  PERFORM public._exigir_funcion(local, 'tablets');$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'crear_equipo_compartido: no se encontró dónde'; END IF;
  EXECUTE nuevo;

  -- La mesa en vivo dice qué módulos tiene el local (las pantallas del comensal esconden lo que no está)
  def := pg_get_functiondef('public.mi_mesa_en_vivo'::regproc);
  nuevo := replace(def, $q$  RETURN jsonb_build_object('mesa', (c.mesa).number, 'personas', personas, 'pedidos', pedidos,$q$,
    $q$  RETURN jsonb_build_object('mesa', (c.mesa).number, 'personas', personas, 'pedidos', pedidos,
    'modulos', public.modulos_del_local((c.mesa).tenant_id),$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'mi_mesa_en_vivo: no se encontró dónde'; END IF;
  EXECUTE nuevo;

  -- La auditoría de seguridad revisa que los planes solo mencionen módulos del catálogo
  def := pg_get_functiondef('public.auditoria_seguridad()'::regprocedure);
  nuevo := regexp_replace(def, '\n(\s*END;\s*\$function\$)', $q$

  -- Fase 7.9: un plan solo trae módulos que existen, con sí o no
  RETURN QUERY
  SELECT 'modulo_desconocido'::text, p.name::text, ('Módulo "' || e.key || '" en el plan')::text
    FROM public.plans p, jsonb_each(p.features) e
   WHERE e.key NOT IN (SELECT modulo FROM public._catalogo_modulos()) OR jsonb_typeof(e.value) <> 'boolean';
\1$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'auditoria_seguridad: no se encontró el final'; END IF;
  EXECUTE nuevo;
END;
$$;
