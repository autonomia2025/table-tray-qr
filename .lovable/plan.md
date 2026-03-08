

## Plan: Landing page + cuenta superadmin

El usuario quiere dos cosas:
1. Reemplazar la página de inicio ("Welcome to your blank app") por una landing atractiva que presente MenuQR y dirija a los distintos roles (cliente, admin, mozo, superadmin).
2. Crear la cuenta superadmin con `jtmenesesg@gmail.com` / `30012003`.

### 1. Crear cuenta superadmin

Usar una migración SQL para crear el usuario con la edge function `create-tenant-user` (que usa `auth.admin.createUser`) y luego insertar un registro en una tabla `platform_admins` para identificar superadmins de forma segura (en vez de depender de sessionStorage).

**Nuevo approach**: Crear tabla `platform_admins` con `user_id` referenciando `auth.users`, y una función `is_platform_admin()` security definer. Luego crear el usuario vía edge function y registrarlo ahí.

Sin embargo, dado que crear el usuario requiere el service role key (solo disponible en edge functions), lo más práctico es:
- Crear la tabla `platform_admins` vía migración.
- Crear una edge function `create-superadmin` que cree el usuario y lo inserte en `platform_admins`.
- Invocarla una vez para crear la cuenta.

**Simplificación**: Usaremos la edge function existente `create-tenant-user` para crear el usuario, y luego una migración para la tabla `platform_admins`. El registro en `platform_admins` se insertará desde el frontend al momento de la creación, o directamente vía una nueva edge function.

**Decisión final**: 
- Migración: crear tabla `platform_admins (id, user_id unique, created_at)` con RLS.
- Edge function `create-platform-admin`: crea usuario con admin API + inserta en `platform_admins`.
- Luego desde el chat invocamos la edge function con los datos del usuario.

### 2. Landing page (`Index.tsx`)

Reemplazar con una página tipo "hero" para MenuQR:
- Hero section con título, subtítulo descriptivo y branding
- Sección con 3-4 features/beneficios (QR digital, pedidos en tiempo real, KDS, gestión multi-sucursal)
- Botones de acceso: "Soy restaurante" → `/admin/login`, "Soy mozo" → `/mozo/login`, "SuperAdmin" → `/superadmin` (discreto)
- Diseño moderno con gradientes, iconos de Lucide, animaciones con framer-motion
- Responsive (mobile-first)

### Archivos a modificar/crear

| Archivo | Acción | Descripción |
|---|---|---|
| `src/pages/Index.tsx` | Reescribir | Landing page con hero, features y accesos por rol |
| Migración SQL | Crear | Tabla `platform_admins` |
| `supabase/functions/create-platform-admin/index.ts` | Crear | Edge function para crear superadmin |
| `src/pages/superadmin/SuperAdminLayout.tsx` | Modificar | Agregar guard que valide contra `platform_admins` |
| `src/contexts/SuperAdminContext.tsx` | Modificar | Verificar autenticación real contra DB |

### Seguridad

- `platform_admins` con RLS: solo lectura para el propio usuario autenticado.
- SuperAdminLayout verificará sesión + existencia en `platform_admins` antes de renderizar.
- Se eliminará la dependencia de sessionStorage para determinar si alguien es superadmin (se mantiene solo para impersonation de tenants).

