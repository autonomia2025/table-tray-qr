-- Fase 1.1 — Contención inmediata (docs/DIAGNOSTICO.md, problemas 1, 3, 4 y 9).
-- Cierra los huecos más graves sin esperar el modelo de roles de la fase 1.2.

-- 1. Nadie puede agregarse como miembro de un local desde el navegador.
--    Las altas de miembros las hace el servidor (funciones) o el superadmin
--    (política tenant_members_superadmin_all, que se mantiene).
DROP POLICY IF EXISTS "tenant_members_public_insert" ON public.tenant_members;

-- 2. El PIN del personal estaba en texto plano y era legible por cualquiera.
--    Ningún código lo usa; el login con PIN se construirá con PIN cifrado.
ALTER TABLE public.staff_users DROP COLUMN IF EXISTS pin;

-- 3. Las invitaciones dejan de ser públicas (exponían el código para registrarse).
DROP POLICY IF EXISTS "staff_invitations_public_read" ON public.staff_invitations;
DROP POLICY IF EXISTS "staff_invitations_public_update" ON public.staff_invitations;
DROP POLICY IF EXISTS "backoffice_invitations_public_read" ON public.backoffice_invitations;
DROP POLICY IF EXISTS "backoffice_invitations_public_update" ON public.backoffice_invitations;

-- La pantalla de registro del mozo consulta SOLO la invitación cuyo código tiene,
-- y solo ve el nombre del local, el rol y si sigue vigente.
CREATE OR REPLACE FUNCTION public.ver_invitacion_mozo(_token text)
RETURNS TABLE (local text, rol text, estado text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv record;
BEGIN
  SELECT i.role, i.expires_at, i.used_at, t.name AS local_nombre
    INTO inv
    FROM public.staff_invitations i
    JOIN public.tenants t ON t.id = i.tenant_id
   WHERE i.token = _token;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::text, NULL::text, 'no_existe'::text;
  ELSIF inv.used_at IS NOT NULL THEN
    RETURN QUERY SELECT inv.local_nombre, inv.role, 'usada'::text;
  ELSIF inv.expires_at < now() THEN
    RETURN QUERY SELECT inv.local_nombre, inv.role, 'vencida'::text;
  ELSE
    RETURN QUERY SELECT inv.local_nombre, inv.role, 'vigente'::text;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.ver_invitacion_mozo(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ver_invitacion_mozo(text) TO anon, authenticated;

-- 4. Límite de uso del chat de soporte (por usuario y por día).
--    Solo lo usa la función del servidor; el navegador no puede leerla ni escribirla.
CREATE TABLE IF NOT EXISTS public.support_chat_uso (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dia date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Santiago')::date,
  mensajes integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, dia)
);
ALTER TABLE public.support_chat_uso ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_chat_uso FROM anon, authenticated;

-- Suma un mensaje y responde si el usuario sigue dentro del límite.
CREATE OR REPLACE FUNCTION public.registrar_uso_chat(_user_id uuid, _limite integer)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.support_chat_uso AS u (user_id, dia, mensajes)
  VALUES (_user_id, (now() AT TIME ZONE 'America/Santiago')::date, 1)
  ON CONFLICT (user_id, dia) DO UPDATE SET mensajes = u.mensajes + 1
  RETURNING mensajes <= _limite;
$$;

REVOKE ALL ON FUNCTION public.registrar_uso_chat(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_uso_chat(uuid, integer) TO service_role;
