-- Fase 1.7 — Fotos de la carta: las suben y borran quienes editan la carta (dueño, administrador,
-- encargado) en la carpeta de su local. Antes podía hacerlo cualquier miembro, también un mozo.

-- Revisa si quien llama puede editar la carta del local dueño de la carpeta (primer tramo de la ruta).
CREATE OR REPLACE FUNCTION public.puede_editar_fotos(_carpeta text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.tiene_rol(_carpeta::uuid, ARRAY['owner', 'admin', 'manager']) OR public.is_platform_admin();
EXCEPTION WHEN invalid_text_representation THEN
  RETURN false; -- la carpeta no es un local
END;
$$;
REVOKE ALL ON FUNCTION public.puede_editar_fotos(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.puede_editar_fotos(text) TO authenticated;

DROP POLICY IF EXISTS "menu_images_tenant_upload" ON storage.objects;
DROP POLICY IF EXISTS "menu_images_tenant_update" ON storage.objects;
DROP POLICY IF EXISTS "menu_images_tenant_delete" ON storage.objects;

CREATE POLICY menu_images_tenant_upload ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'menu-images' AND public.puede_editar_fotos((storage.foldername(name))[1]));
CREATE POLICY menu_images_tenant_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'menu-images' AND public.puede_editar_fotos((storage.foldername(name))[1]))
  WITH CHECK (bucket_id = 'menu-images' AND public.puede_editar_fotos((storage.foldername(name))[1]));
CREATE POLICY menu_images_tenant_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'menu-images' AND public.puede_editar_fotos((storage.foldername(name))[1]));
