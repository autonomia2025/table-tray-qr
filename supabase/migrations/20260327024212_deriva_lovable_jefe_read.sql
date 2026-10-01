-- Cambio que en Lovable se hizo a mano, fuera de las migraciones, entre la
-- 20260327024211 y la 20260328030145. Sin este paso, una base nueva no puede
-- aplicar la 20260328030145 (la regla ya existe). Con él, el resultado es
-- idéntico a la base real de Lovable (ver migracion/lovable/esquema_real.sql).
-- Detectado al migrar al Supabase propio el 1 de octubre de 2026.
DROP POLICY IF EXISTS "backoffice_members_jefe_read" ON public.backoffice_members;
