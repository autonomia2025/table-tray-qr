

## Analysis of Current State vs Your Requests

### What you're asking for (3 things):

**1. Login sin slug — solo email + contraseña**
Currently: `/admin` pide un slug, luego `/admin/:slug/login` pide email+pass. Quieres eliminar el slug del flujo. El admin simplemente ingresa email y contraseña, y el sistema detecta automáticamente a qué restaurante pertenece via `tenant_members`.

**2. Gestión de mozos desde el panel admin con invitación**
Currently: La sección Equipo (`/admin/:slug/equipo`) ya existe y permite crear/editar mozos con PIN. Lo que falta es un mecanismo de invitación (link o similar) para que un mozo pueda vincularse al equipo.

**3. Tarjetas QR por mesa — ¿se seleccionan desde el admin?**
Currently: **Ya existe** en `/admin/:slug/qr`. Muestra todas las mesas, permite generar token QR por mesa, ver el QR, descargar PNG individual, e imprimir todas en grilla 3x3. Esto ya funciona.

---

## Plan de implementación

### 1. Simplificar login admin: eliminar slug

**Cambios:**

- **`/admin/login`** — Nueva ruta única de login. Formulario con solo email + contraseña (sin slug). Al autenticarse:
  1. `signInWithPassword({ email, password })`
  2. Buscar en `tenant_members` por `user_id` del usuario autenticado
  3. Si tiene un solo tenant → redirect automático a `/admin/:slug/mesas`
  4. Si tiene múltiples tenants → mostrar selector de restaurante
  5. Si no tiene ninguno → error "No tienes acceso a ningún restaurante"

- **Eliminar `AdminGlobalPage`** (el que pide slug manualmente)
- **Mantener `/admin/:slug/*`** como rutas internas (el slug sigue en la URL para navegación, pero el usuario nunca lo escribe)
- **`AdminContext`**: Ajustar `loadFromAuth` para que si no hay slug en URL, busque por `tenant_members` directamente
- **Logout**: Redirige a `/admin/login` en vez de `/admin/:slug/login`

**Archivos a modificar:**
- `src/pages/admin/AdminLoginPage.tsx` → Reescribir sin dependencia de slug
- `src/pages/admin/AdminGlobalPage.tsx` → Eliminar o convertir en redirect
- `src/contexts/AdminContext.tsx` → Ajustar logout redirect
- `src/App.tsx` → Cambiar rutas

### 2. Invitación de mozos

Agregar a `EquipoPage` un botón **"Generar link de invitación"** que:
- Genera un link único tipo `/mozo/join/:token`
- Crea un registro en una nueva tabla `staff_invitations` con `token`, `branch_id`, `tenant_id`, `role`, `expires_at`
- El mozo abre el link, ingresa su nombre y elige un PIN de 4 dígitos
- Se crea el `staff_user` automáticamente

**Requiere:**
- Nueva tabla `staff_invitations` (migración)
- Nueva página `src/pages/mozo/MozoJoinPage.tsx`
- Botón en `EquipoPage` para generar y copiar link
- Ruta `/mozo/join/:token` en `App.tsx`

### 3. QR por mesa — Ya funciona
La sección QR ya está implementada. Desde `/admin/:slug/qr` puedes:
- Ver todas las mesas con su token QR
- Generar token si no tiene
- Ver QR individual en modal
- Descargar PNG
- Imprimir todas en grilla 3x3

No requiere cambios.

---

## Resumen de archivos

| Acción | Archivo |
|--------|---------|
| Reescribir | `src/pages/admin/AdminLoginPage.tsx` |
| Eliminar/Redirect | `src/pages/admin/AdminGlobalPage.tsx` |
| Editar | `src/contexts/AdminContext.tsx` |
| Editar | `src/App.tsx` |
| Editar | `src/pages/admin/EquipoPage.tsx` |
| Crear | `src/pages/mozo/MozoJoinPage.tsx` |
| Migración | Nueva tabla `staff_invitations` |

