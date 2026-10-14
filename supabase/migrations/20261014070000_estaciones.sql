-- Fase 3.2 — Estaciones (cocina y barra por separado).
-- La base ya tenía estaciones por sucursal, estación por categoría y estado por producto (fase 1.4).
-- Aquí se agregan las protecciones que faltaban para usarlas en pantallas reales:
--   · la estación predeterminada no se borra ni se desactiva (los productos sin estación caen ahí);
--   · un producto nunca va a una estación desactivada o de otra sucursal: cae en la predeterminada;
--   · al desactivar o borrar una estación, lo que estaba en preparación ahí pasa a la predeterminada
--     (ninguna comanda queda en una pantalla que ya nadie mira);
--   · el demo trae una estación "Barra" para cervezas, tragos y bebidas.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. La estación predeterminada se queda
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.proteger_estacion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  destino uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.es_predeterminada AND EXISTS (SELECT 1 FROM public.branches WHERE id = OLD.branch_id) THEN
      RAISE EXCEPTION 'La estación principal no se puede borrar' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    IF OLD.es_predeterminada AND (NOT NEW.is_active OR NOT NEW.es_predeterminada) THEN
      RAISE EXCEPTION 'La estación principal no se puede desactivar' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.branch_id <> OLD.branch_id THEN
      RAISE EXCEPTION 'Una estación no se cambia de sucursal' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.is_active OR NOT OLD.is_active THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Se desactiva o se borra: lo pendiente pasa a la estación principal de la sucursal.
  SELECT id INTO destino FROM public.stations WHERE branch_id = OLD.branch_id AND es_predeterminada;
  IF destino IS NOT NULL AND destino <> OLD.id THEN
    UPDATE public.order_items SET station_id = destino
     WHERE station_id = OLD.id AND status IN ('confirmed', 'in_kitchen', 'ready');
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
REVOKE ALL ON FUNCTION public.proteger_estacion() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS proteger_estacion ON public.stations;
CREATE TRIGGER proteger_estacion BEFORE UPDATE OR DELETE ON public.stations
  FOR EACH ROW EXECUTE FUNCTION public.proteger_estacion();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Cada producto va a una estación activa de su sucursal
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.asignar_estacion_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sucursal uuid;
BEGIN
  SELECT branch_id INTO sucursal FROM public.orders WHERE id = NEW.order_id;
  -- La estación que venga tiene que ser activa y de la sucursal del pedido
  IF NEW.station_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.stations s WHERE s.id = NEW.station_id AND s.branch_id = sucursal AND s.is_active) THEN
    NEW.station_id := NULL;
  END IF;
  IF NEW.station_id IS NULL THEN
    SELECT s.id INTO NEW.station_id
      FROM public.menu_items mi
      JOIN public.categories c ON c.id = mi.category_id
      JOIN public.stations s ON s.id = c.station_id AND s.branch_id = sucursal AND s.is_active
     WHERE mi.id = NEW.menu_item_id;
  END IF;
  IF NEW.station_id IS NULL THEN
    SELECT id INTO NEW.station_id FROM public.stations WHERE branch_id = sucursal AND es_predeterminada;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.asignar_estacion_item() FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. El demo trae "Barra" (bebidas) además de "Cocina"
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  demo constant uuid := '651c363f-0084-50af-9873-be98cfeaaf47';
  sucursal uuid;
  barra uuid;
BEGIN
  SELECT id INTO sucursal FROM public.branches WHERE tenant_id = demo ORDER BY created_at LIMIT 1;
  IF sucursal IS NULL THEN
    RETURN; -- base sin demo (la base desechable lo carga después, con crear_demo.py)
  END IF;
  SELECT id INTO barra FROM public.stations WHERE branch_id = sucursal AND name = 'Barra';
  IF barra IS NULL THEN
    INSERT INTO public.stations (tenant_id, branch_id, name, sort_order) VALUES (demo, sucursal, 'Barra', 1)
    RETURNING id INTO barra;
  END IF;
  UPDATE public.categories SET station_id = barra
   WHERE tenant_id = demo AND name IN ('Cervezas', 'Tragos', 'Sin alcohol') AND station_id IS NULL;
END;
$$;
