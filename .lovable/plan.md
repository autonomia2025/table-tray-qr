

## Plan: Proteger KDS con autenticación

### Problema
El KDS (`/kds`) es accesible sin autenticación. Cualquier persona con la URL puede ver los pedidos de cocina.

### Solución
Agregar un gate de autenticación en `KDSPage.tsx` que verifique sesión de Supabase Auth antes de mostrar contenido. Si no hay sesión, redirigir a `/admin/login`.

### Cambios

**1. `src/pages/KDSPage.tsx`**
- Al inicio del componente `KDSPage`, verificar `supabase.auth.getSession()`
- Si no hay sesión activa → mostrar pantalla de "Acceso restringido" con botón a `/admin/login`
- Si hay sesión → verificar que el usuario sea miembro de algún tenant (`tenant_members`) o staff (`staff_users`)
- Solo si pasa la verificación, mostrar el `BranchSelector` o `KDSBoard`
- Filtrar las sucursales mostradas solo a las del tenant del usuario autenticado

**2. Sin cambios de base de datos** — las tablas y RLS ya existen, solo se agrega la verificación client-side.

### Flujo resultante
1. Usuario abre `/kds`
2. Se verifica sesión auth
3. Sin sesión → redirect a `/admin/login`
4. Con sesión → se busca su `tenant_members` para saber a qué tenant pertenece
5. Solo muestra sucursales de su tenant
6. Accede al KDS filtrado

