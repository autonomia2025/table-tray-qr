-- Fase 5.2 — Primeros pasos del dueño. Un local recién activado ve en su Inicio qué le falta para abrir (su
-- marca, la carta, el equipo, el cobro con la app, los QR impresos, un pedido de prueba y abrir), calculado por
-- la base. Y la carta se puede cargar de una vez pegando una lista, en vez de plato por plato.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Lo que la base no puede saber sola: que imprimió los QR, y que ya no quiere ver la lista
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS qr_listos_at timestamptz;
ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS primeros_pasos_ocultos_at timestamptz;
-- Los locales que ya venden (tienen pedidos) imprimieron sus QR hace rato
UPDATE public.branches b SET qr_listos_at = coalesce(b.qr_listos_at, (SELECT min(o.created_at) FROM public.orders o WHERE o.branch_id = b.id))
 WHERE b.qr_listos_at IS NULL AND EXISTS (SELECT 1 FROM public.orders o WHERE o.branch_id = b.id);

-- Dueño, administrador o encargado del local de la sucursal (o superadmin)
CREATE OR REPLACE FUNCTION public._gestiona_sucursal(_branch_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  local uuid := (SELECT tenant_id FROM public.branches WHERE id = _branch_id);
BEGIN
  IF local IS NULL OR NOT (public.tiene_rol(local, ARRAY['owner', 'admin', 'manager']) OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'No tienes permiso para este cambio' USING ERRCODE = '42501';
  END IF;
  RETURN local;
END;
$$;
REVOKE ALL ON FUNCTION public._gestiona_sucursal(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.marcar_paso(_branch_id uuid, _paso text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._gestiona_sucursal(_branch_id);
  IF _paso = 'qr' THEN
    UPDATE public.branches SET qr_listos_at = coalesce(qr_listos_at, now()) WHERE id = _branch_id;
  ELSIF _paso = 'ocultar' THEN
    UPDATE public.branches SET primeros_pasos_ocultos_at = now() WHERE id = _branch_id;
  ELSIF _paso = 'mostrar' THEN
    UPDATE public.branches SET primeros_pasos_ocultos_at = NULL WHERE id = _branch_id;
  ELSE
    RAISE EXCEPTION 'Paso no válido' USING ERRCODE = '22023';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.marcar_paso(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marcar_paso(uuid, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Qué le falta al local para abrir
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.primeros_pasos(_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  local uuid;
  b public.branches;
  t public.tenants;
  platos integer;
  pasos jsonb;
BEGIN
  local := public._gestiona_sucursal(_branch_id);
  SELECT * INTO b FROM public.branches WHERE id = _branch_id;
  SELECT * INTO t FROM public.tenants WHERE id = local;
  SELECT count(*) INTO platos
    FROM public.menu_items mi JOIN public.categories c ON c.id = mi.category_id JOIN public.menus m ON m.id = c.menu_id
   WHERE m.branch_id = _branch_id AND mi.price > 0 AND coalesce(mi.status, 'available') = 'available';
  pasos := jsonb_build_array(
    jsonb_build_object('clave', 'marca', 'hecho', t.logo_url IS NOT NULL OR t.welcome_message IS NOT NULL),
    jsonb_build_object('clave', 'carta', 'hecho', platos >= 3, 'platos', platos),
    jsonb_build_object('clave', 'equipo', 'hecho', EXISTS (SELECT 1 FROM public.staff_users s WHERE s.branch_id = _branch_id AND s.is_active)),
    jsonb_build_object('clave', 'cobro', 'hecho', b.pagos_simulados OR EXISTS (SELECT 1 FROM public.conexiones_pago c WHERE c.branch_id = _branch_id AND c.estado = 'activa')),
    jsonb_build_object('clave', 'qr', 'hecho', b.qr_listos_at IS NOT NULL),
    jsonb_build_object('clave', 'prueba', 'hecho', EXISTS (SELECT 1 FROM public.orders o WHERE o.branch_id = _branch_id)),
    jsonb_build_object('clave', 'abrir', 'hecho', coalesce(b.is_open, false)));
  RETURN jsonb_build_object(
    'pasos', pasos,
    'hechos', (SELECT count(*) FROM jsonb_array_elements(pasos) p WHERE (p ->> 'hecho')::boolean),
    'total', jsonb_array_length(pasos),
    'ocultos', b.primeros_pasos_ocultos_at IS NOT NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.primeros_pasos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.primeros_pasos(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Importar la carta pegando una lista (todo o nada, en el servidor)
-- ─────────────────────────────────────────────────────────────────────────────
-- _lineas: [{categoria, nombre, precio, descripcion?}]. Las categorías que no existen se crean; un plato que
-- ya está en esa categoría (mismo nombre) no se repite.
CREATE OR REPLACE FUNCTION public.importar_carta(_branch_id uuid, _lineas jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  local uuid;
  carta uuid;
  x jsonb;
  v_categoria text;
  v_nombre text;
  v_precio integer;
  v_descripcion text;
  categoria uuid;
  cat_nuevas integer := 0;
  platos_nuevos integer := 0;
  repetidos integer := 0;
  n integer := 0;
BEGIN
  local := public._gestiona_sucursal(_branch_id);
  IF jsonb_typeof(_lineas) <> 'array' OR jsonb_array_length(_lineas) = 0 THEN
    RAISE EXCEPTION 'No hay platos para importar' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_array_length(_lineas) > 300 THEN
    RAISE EXCEPTION 'Son muchos platos de una vez: importa hasta 300' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO carta FROM public.menus WHERE branch_id = _branch_id AND is_active ORDER BY created_at LIMIT 1;
  IF carta IS NULL THEN
    INSERT INTO public.menus (tenant_id, branch_id, name, is_active) VALUES (local, _branch_id, 'Carta', true) RETURNING id INTO carta;
  END IF;

  FOR x IN SELECT * FROM jsonb_array_elements(_lineas) LOOP
    n := n + 1;
    v_categoria := left(nullif(btrim(coalesce(x ->> 'categoria', '')), ''), 40);
    v_nombre := btrim(coalesce(x ->> 'nombre', ''));
    v_descripcion := left(nullif(btrim(coalesce(x ->> 'descripcion', '')), ''), 200);
    BEGIN
      v_precio := (x ->> 'precio')::integer;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'Línea %: el precio de "%" no es un número', n, v_nombre USING ERRCODE = 'P0001';
    END;
    IF char_length(v_nombre) < 1 OR char_length(v_nombre) > 80 THEN
      RAISE EXCEPTION 'Línea %: el nombre del plato debe tener entre 1 y 80 letras', n USING ERRCODE = 'P0001';
    END IF;
    IF v_precio IS NULL OR v_precio < 1 OR v_precio > 10000000 THEN
      RAISE EXCEPTION 'Línea %: el precio de "%" no es válido', n, v_nombre USING ERRCODE = 'P0001';
    END IF;
    v_categoria := coalesce(v_categoria, 'Carta');

    SELECT id INTO categoria FROM public.categories WHERE menu_id = carta AND lower(name) = lower(v_categoria) LIMIT 1;
    IF categoria IS NULL THEN
      INSERT INTO public.categories (tenant_id, menu_id, name, sort_order)
      VALUES (local, carta, v_categoria, (SELECT coalesce(max(sort_order) + 1, 0) FROM public.categories WHERE menu_id = carta))
      RETURNING id INTO categoria;
      cat_nuevas := cat_nuevas + 1;
    END IF;

    IF EXISTS (SELECT 1 FROM public.menu_items WHERE category_id = categoria AND lower(name) = lower(v_nombre)) THEN
      repetidos := repetidos + 1;
      CONTINUE;
    END IF;
    INSERT INTO public.menu_items (tenant_id, category_id, name, description_short, price, status, sort_order)
    VALUES (local, categoria, v_nombre, v_descripcion, v_precio, 'available',
            (SELECT coalesce(max(sort_order) + 1, 0) FROM public.menu_items WHERE category_id = categoria));
    platos_nuevos := platos_nuevos + 1;
  END LOOP;

  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (local, auth.uid(), 'carta_importada', 'branch', _branch_id,
          jsonb_build_object('categorias_nuevas', cat_nuevas, 'platos_nuevos', platos_nuevos, 'repetidos', repetidos));
  RETURN jsonb_build_object('categorias_nuevas', cat_nuevas, 'platos_nuevos', platos_nuevos, 'repetidos', repetidos);
END;
$$;
REVOKE ALL ON FUNCTION public.importar_carta(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.importar_carta(uuid, jsonb) TO authenticated;
