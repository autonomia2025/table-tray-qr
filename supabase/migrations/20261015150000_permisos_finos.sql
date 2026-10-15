-- Fase 6.3 — Permisos finos: el dueño (o el administrador) decide qué puede hacer cada rol del local.
--
-- Hay un catálogo cerrado de permisos. Cada uno tiene los roles que lo traen de fábrica (lo que ya
-- funcionaba antes de esta fase) y los roles a los que se les puede dar. El dueño y el administrador
-- siempre pueden todo. Lo que el dueño cambia queda en permisos_rol y la base lo hace cumplir en cada
-- función y regla de acceso: la pantalla solo esconde botones.
--
-- Por qué hay "roles posibles": la plata (pagos, reembolsos, cierres) la ven solo dueño, administrador,
-- encargado y caja (regla del producto). Por eso, por ejemplo, devolver plata no se le puede dar al mozo.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Catálogo
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._catalogo_permisos()
RETURNS TABLE (permiso text, nombre text, accion text, descripcion text, por_defecto text[], posibles text[], orden integer)
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  VALUES
    ('cobrar',         'Cobrar en el local',        'cobrar en el local',          'Registrar cobros en efectivo, POS o transferencia.',          ARRAY['manager', 'cashier', 'waiter'], ARRAY['manager', 'cashier', 'waiter'], 1),
    ('tomar_pedidos',  'Tomar pedidos a mano',      'tomar pedidos a mano',        'Crear pedidos desde la pantalla del mozo.',                   ARRAY['manager', 'waiter'],            ARRAY['manager', 'waiter'],            2),
    ('anular_pedidos', 'Anular pedidos',            'anular pedidos',              'Anular un pedido, con motivo.',                               ARRAY['manager'],                      ARRAY['manager', 'cashier'],           3),
    ('reembolsar',     'Devolver plata',            'devolver plata',              'Reembolsar un pago, con motivo.',                             ARRAY['manager', 'cashier'],           ARRAY['manager', 'cashier'],           4),
    ('cerrar_caja',    'Cortes y cierre de caja',   'hacer cortes y cerrar la caja','Hacer cortes de turno y cerrar la caja del día.',            ARRAY['manager', 'cashier'],           ARRAY['manager', 'cashier'],           5),
    ('ver_reportes',   'Ver reportes',              'ver los reportes',            'Inicio, reportes de ventas y desempeño del equipo.',          ARRAY['manager'],                      ARRAY['manager', 'cashier'],           6),
    ('editar_carta',   'Editar la carta',           'editar la carta',             'Platos, precios, fotos y categorías.',                        ARRAY['manager'],                      ARRAY['manager', 'cashier'],           7),
    ('marcar_agotado', 'Marcar agotados',           'marcar productos agotados',   'Marcar un producto agotado desde la cocina.',                 ARRAY['manager', 'kitchen'],           ARRAY['manager', 'kitchen'],           8)
$$;
REVOKE ALL ON FUNCTION public._catalogo_permisos() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._permiso_posible(_permiso text, _rol text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public._catalogo_permisos() c WHERE c.permiso = _permiso AND _rol = ANY (c.posibles))
$$;
REVOKE ALL ON FUNCTION public._permiso_posible(text, text) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Lo que el dueño cambió (solo las diferencias con lo de fábrica)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.permisos_rol (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  rol text NOT NULL,
  permiso text NOT NULL,
  permitido boolean NOT NULL,
  actualizado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, rol, permiso),
  CONSTRAINT permisos_rol_posible CHECK (public._permiso_posible(permiso, rol))
);
CREATE INDEX IF NOT EXISTS permisos_rol_actualizado_por ON public.permisos_rol (actualizado_por) WHERE actualizado_por IS NOT NULL;

ALTER TABLE public.permisos_rol ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.permisos_rol FROM anon, authenticated;
GRANT SELECT ON public.permisos_rol TO authenticated;
-- Se cambian solo con guardar_permiso_rol. Los leen el dueño y el administrador (cada persona recibe los
-- suyos en mi_perfil).
CREATE POLICY permisos_rol_lectura ON public.permisos_rol FOR SELECT TO authenticated
  USING (public.tiene_rol(tenant_id, ARRAY['owner', 'admin']) OR public.is_platform_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. ¿Este rol puede? ¿La persona conectada puede?
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._rol_puede(_tenant_id uuid, _rol text, _permiso text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN _rol IN ('owner', 'admin', 'superadmin') THEN true
    WHEN _rol IS NULL OR NOT EXISTS (SELECT 1 FROM public._catalogo_permisos() c WHERE c.permiso = _permiso) THEN false
    ELSE coalesce(
      (SELECT pr.permitido AND public._permiso_posible(_permiso, _rol)
         FROM public.permisos_rol pr
        WHERE pr.tenant_id = _tenant_id AND pr.rol = _rol AND pr.permiso = _permiso),
      (SELECT _rol = ANY (c.por_defecto) FROM public._catalogo_permisos() c WHERE c.permiso = _permiso))
  END
$$;
REVOKE ALL ON FUNCTION public._rol_puede(uuid, text, text) FROM PUBLIC, anon, authenticated;

-- Para reglas de acceso y funciones: la persona conectada, en ese local (superadmin, siempre).
CREATE OR REPLACE FUNCTION public.tiene_permiso(_tenant_id uuid, _permiso text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_platform_admin() OR EXISTS (
    SELECT 1 FROM public.tenant_members tm
     WHERE tm.user_id = (SELECT auth.uid()) AND tm.tenant_id = _tenant_id AND tm.is_active
       AND public._rol_puede(_tenant_id, tm.role, _permiso))
$$;
REVOKE ALL ON FUNCTION public.tiene_permiso(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tiene_permiso(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public._exigir_permiso(_tenant_id uuid, _permiso text)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _tenant_id IS NULL OR NOT public.tiene_permiso(_tenant_id, _permiso) THEN
    RAISE EXCEPTION 'Tu rol no tiene permiso para %. Pídeselo al dueño del local.',
      coalesce((SELECT c.accion FROM public._catalogo_permisos() c WHERE c.permiso = _permiso), 'hacer esto')
      USING ERRCODE = '42501';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public._exigir_permiso(uuid, text) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Ver y cambiar los permisos (dueño y administrador)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.permisos_del_local(_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.tiene_rol(_tenant_id, ARRAY['owner', 'admin']) OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Solo el dueño o el administrador ven los permisos' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT jsonb_agg(jsonb_build_object(
             'permiso', c.permiso, 'nombre', c.nombre, 'descripcion', c.descripcion,
             'posibles', to_jsonb(c.posibles),
             'roles', (SELECT jsonb_object_agg(r.rol, jsonb_build_object(
                          'permitido', public._rol_puede(_tenant_id, r.rol, c.permiso),
                          'posible', r.rol = ANY (c.posibles),
                          'de_fabrica', r.rol = ANY (c.por_defecto)))
                         FROM unnest(ARRAY['manager', 'cashier', 'waiter', 'kitchen']) AS r(rol))
           ) ORDER BY c.orden)
      FROM public._catalogo_permisos() c);
END;
$$;
REVOKE ALL ON FUNCTION public.permisos_del_local(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.permisos_del_local(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.guardar_permiso_rol(_tenant_id uuid, _rol text, _permiso text, _permitido boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  antes boolean;
BEGIN
  IF NOT (public.tiene_rol(_tenant_id, ARRAY['owner', 'admin']) OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Solo el dueño o el administrador cambian los permisos' USING ERRCODE = '42501';
  END IF;
  IF _permitido IS NULL OR NOT EXISTS (SELECT 1 FROM public._catalogo_permisos() c WHERE c.permiso = _permiso) THEN
    RAISE EXCEPTION 'Ese permiso no existe' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public._permiso_posible(_permiso, _rol) THEN
    RAISE EXCEPTION 'Ese permiso no se le puede dar a ese rol' USING ERRCODE = 'P0001';
  END IF;

  antes := public._rol_puede(_tenant_id, _rol, _permiso);
  INSERT INTO public.permisos_rol (tenant_id, rol, permiso, permitido, actualizado_por, updated_at)
  VALUES (_tenant_id, _rol, _permiso, _permitido, (SELECT auth.uid()), now())
  ON CONFLICT (tenant_id, rol, permiso)
  DO UPDATE SET permitido = EXCLUDED.permitido, actualizado_por = EXCLUDED.actualizado_por, updated_at = now();

  IF antes IS DISTINCT FROM _permitido THEN
    INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, metadata)
    VALUES (_tenant_id, (SELECT auth.uid()), 'permiso_cambiado', 'permisos_rol',
            jsonb_build_object('rol', _rol, 'permiso', _permiso, 'antes', antes, 'ahora', _permitido));
  END IF;
  RETURN jsonb_build_object('rol', _rol, 'permiso', _permiso, 'permitido', _permitido);
END;
$$;
REVOKE ALL ON FUNCTION public.guardar_permiso_rol(uuid, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_permiso_rol(uuid, text, text, boolean) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Cada persona recibe sus permisos en mi_perfil (la pantalla esconde lo que no puede)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  def text := pg_get_functiondef('public.mi_perfil()'::regprocedure);
  nuevo text;
BEGIN
  nuevo := replace(def, $q$'staff_nombre', su.name$q$,
    $q$'staff_nombre', su.name,
               'permisos', (SELECT coalesce(jsonb_agg(c.permiso ORDER BY c.orden), '[]'::jsonb)
                              FROM public._catalogo_permisos() c WHERE public._rol_puede(t.id, tm.role, c.permiso))$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'mi_perfil: no se encontró dónde agregar los permisos'; END IF;
  EXECUTE nuevo;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. La base los hace cumplir
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  cambios text[][] := ARRAY[
    -- Devolver plata
    ARRAY['public.reservar_reembolso(uuid,uuid,integer,text)',
          $q$IF rol IS NULL OR rol NOT IN ('owner', 'admin', 'manager', 'cashier', 'superadmin') THEN
    RAISE EXCEPTION 'Solo la caja, el encargado o el dueño pueden reembolsar' USING ERRCODE = '42501';$q$,
          $q$IF rol IS NULL OR NOT public._rol_puede(pago.tenant_id, rol, 'reembolsar') THEN
    RAISE EXCEPTION 'Tu rol no tiene permiso para devolver plata. Pídeselo al dueño del local.' USING ERRCODE = '42501';$q$],
    -- Cobrar en el local
    ARRAY['public.registrar_cobro_mozo(uuid[],text,integer,integer,boolean,text)',
          $q$IF rol IS NULL OR rol NOT IN ('owner', 'admin', 'manager', 'cashier', 'waiter') THEN
    RAISE EXCEPTION 'No tienes permiso para este cambio' USING ERRCODE = '42501';$q$,
          $q$IF rol IS NULL OR NOT public._rol_puede(primero.tenant_id, rol, 'cobrar') THEN
    RAISE EXCEPTION 'Tu rol no tiene permiso para cobrar en el local. Pídeselo al dueño del local.' USING ERRCODE = '42501';$q$],
    -- Anular pedidos
    ARRAY['public.cambiar_estado_pedido(uuid,text,uuid,text)',
          $q$OR (_estado = 'cancelled' AND rol NOT IN ('owner', 'admin', 'manager')) THEN$q$,
          $q$OR (_estado = 'cancelled' AND NOT public._rol_puede(pedido.tenant_id, rol, 'anular_pedidos')) THEN$q$],
    -- Tomar pedidos a mano
    ARRAY['public.crear_pedido_mozo(uuid,jsonb,text)',
          $q$IF a.rol NOT IN ('owner', 'admin', 'manager', 'waiter') THEN
    RAISE EXCEPTION 'No tienes permiso para este cambio' USING ERRCODE = '42501';$q$,
          $q$IF NOT public._rol_puede((a.mesa).tenant_id, a.rol, 'tomar_pedidos') THEN
    RAISE EXCEPTION 'Tu rol no tiene permiso para tomar pedidos a mano. Pídeselo al dueño del local.' USING ERRCODE = '42501';$q$],
    -- Cortes y cierre de caja
    ARRAY['public.cerrar_caja(uuid,date,integer,integer,text)',
          $q$  local := public._tenant_caja(_branch_id);
$q$,
          $q$  local := public._tenant_caja(_branch_id);
  PERFORM public._exigir_permiso(local, 'cerrar_caja');
$q$],
    ARRAY['public.hacer_corte_caja(uuid,integer,integer,text,text)',
          $q$
BEGIN
$q$,
          $q$
BEGIN
  PERFORM public._exigir_permiso(local, 'cerrar_caja');
$q$],
    -- Ver reportes
    ARRAY['public._tenant_reportes(uuid)',
          $q$IF local IS NULL OR NOT (public.tiene_rol(local, ARRAY['owner', 'admin', 'manager']) OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Solo el dueño o el encargado ven los reportes' USING ERRCODE = '42501';$q$,
          $q$IF local IS NULL OR NOT public.tiene_permiso(local, 'ver_reportes') THEN
    RAISE EXCEPTION 'Tu rol no tiene permiso para ver los reportes. Pídeselo al dueño del local.' USING ERRCODE = '42501';$q$],
    ARRAY['public.ranking_equipo(uuid,date,date)',
          $q$IF local IS NULL OR NOT (public.tiene_rol(local, ARRAY['owner', 'admin', 'manager']) OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'Solo el dueño o el encargado ven el desempeño del equipo' USING ERRCODE = '42501';$q$,
          $q$IF local IS NULL OR NOT public.tiene_permiso(local, 'ver_reportes') THEN
    RAISE EXCEPTION 'Tu rol no tiene permiso para ver los reportes. Pídeselo al dueño del local.' USING ERRCODE = '42501';$q$],
    -- Marcar agotados
    ARRAY['public.marcar_agotado(uuid,boolean)',
          $q$IF local IS NULL OR NOT public.tiene_rol(local, ARRAY['owner', 'admin', 'manager', 'kitchen']) THEN$q$,
          $q$IF local IS NULL OR NOT public.tiene_permiso(local, 'marcar_agotado') THEN$q$],
    -- Editar la carta: importar y fotos
    ARRAY['public.importar_carta(uuid,jsonb)',
          $q$  local := public._gestiona_sucursal(_branch_id);
$q$,
          $q$  SELECT b.tenant_id INTO local FROM public.branches b WHERE b.id = _branch_id;
  PERFORM public._exigir_permiso(local, 'editar_carta');
$q$],
    ARRAY['public.puede_editar_fotos(text)',
          $q$RETURN public.tiene_rol(_carpeta::uuid, ARRAY['owner', 'admin', 'manager']) OR public.is_platform_admin();$q$,
          $q$RETURN public.tiene_permiso(_carpeta::uuid, 'editar_carta');$q$]
  ];
  i integer;
  def text;
  nuevo text;
BEGIN
  FOR i IN 1 .. array_length(cambios, 1) LOOP
    def := pg_get_functiondef(cambios[i][1]::regprocedure);
    nuevo := replace(def, cambios[i][2], cambios[i][3]);
    IF nuevo = def THEN
      RAISE EXCEPTION 'Permisos: no se encontró el chequeo de % (%)', cambios[i][1], left(cambios[i][2], 60);
    END IF;
    EXECUTE nuevo;
  END LOOP;
END;
$$;

-- Editar la carta: las reglas de acceso de las tablas de la carta
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['menus', 'categories', 'menu_items', 'modifier_groups', 'modifiers'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_gestion', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated
         USING (public.tiene_permiso(tenant_id, ''editar_carta''))
         WITH CHECK (public.tiene_permiso(tenant_id, ''editar_carta''))',
      t || '_gestion', t);
  END LOOP;
END;
$$;

-- El reinicio del demo deja los permisos de fábrica
DO $$
DECLARE
  def text := pg_get_functiondef('public.reiniciar_demo()'::regprocedure);
  nuevo text;
BEGIN
  nuevo := replace(def, 'DELETE FROM public.cortes_caja WHERE tenant_id = demo;',
                        'DELETE FROM public.cortes_caja WHERE tenant_id = demo;
  DELETE FROM public.permisos_rol WHERE tenant_id = demo;');
  IF nuevo = def THEN RAISE EXCEPTION 'reiniciar_demo: no se encontró dónde limpiar los permisos'; END IF;
  EXECUTE nuevo;
END;
$$;
