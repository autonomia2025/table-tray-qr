-- Fase 6.4 — Compuerta de la fase 6: las auditorías aprenden a vigilar lo nuevo.
--   auditoria_operacion: PIN y tablets coherentes con su local (6.1).
--   auditoria_seguridad: ningún permiso fuera de lo posible (6.3).
--   (Los cortes de caja de la 6.2 ya los revisa auditoria_plata: corte_cambio y cortes_no_suman.)

DO $$
DECLARE
  def text := pg_get_functiondef('public.auditoria_operacion()'::regprocedure);
  nuevo text;
BEGIN
  nuevo := regexp_replace(def, '\n(\s*END;\s*\$function\$)', $q$

  -- Fase 6.1: un PIN es de una persona de ese mismo local, y una tablet es de una sucursal de su local.
  RETURN QUERY
  SELECT 'pin_incoherente', p.staff_id::text, 'PIN guardado con un local distinto al de su persona'
    FROM public.pines_personal p JOIN public.staff_users s ON s.id = p.staff_id
   WHERE s.tenant_id <> p.tenant_id;

  RETURN QUERY
  SELECT 'tablet_incoherente', e.id::text, 'Tablet de una sucursal de otro local'
    FROM public.equipos_compartidos e JOIN public.branches b ON b.id = e.branch_id
   WHERE b.tenant_id <> e.tenant_id;
\1$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'auditoria_operacion: no se encontró el final'; END IF;
  EXECUTE nuevo;
END;
$$;

DO $$
DECLARE
  def text := pg_get_functiondef('public.auditoria_seguridad()'::regprocedure);
  nuevo text;
BEGIN
  nuevo := regexp_replace(def, '\n(\s*END;\s*\$function\$)', $q$

  -- Fase 6.3: ningún permiso guardado que no exista o que no se le pueda dar a ese rol (la plata nunca
  -- va a mozo ni cocina). La tabla lo impide; esto avisa si alguien se lo saltó.
  RETURN QUERY
  SELECT 'permiso_imposible', pr.tenant_id::text || ' · ' || pr.rol || ' · ' || pr.permiso,
         'Permiso guardado que no se le puede dar a ese rol'
    FROM public.permisos_rol pr
   WHERE NOT public._permiso_posible(pr.permiso, pr.rol);
\1$q$);
  IF nuevo = def THEN RAISE EXCEPTION 'auditoria_seguridad: no se encontró el final'; END IF;
  EXECUTE nuevo;
END;
$$;

-- El corte guarda el nombre de quien lo hizo (antes, su correo): así lo ve la caja en la lista.
DO $$
DECLARE
  def text := pg_get_functiondef('public._registrar_corte(uuid,uuid,date,integer,integer,text,text,boolean)'::regprocedure);
  nuevo text;
BEGIN
  nuevo := replace(def, $q$quien text := (SELECT coalesce(email, 'Tablio') FROM auth.users WHERE id = auth.uid());$q$,
    $q$quien text := coalesce(
    (SELECT s.name FROM public.staff_users s WHERE s.auth_user_id = auth.uid() AND s.tenant_id = _local AND s.is_active ORDER BY s.created_at LIMIT 1),
    (SELECT email FROM auth.users WHERE id = auth.uid()), 'Tablio');$q$);
  IF nuevo = def THEN RAISE EXCEPTION '_registrar_corte: no se encontró quién'; END IF;
  EXECUTE nuevo;
END;
$$;
