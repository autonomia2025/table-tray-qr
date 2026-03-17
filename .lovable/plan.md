

## Plan: Corrección de 10 bugs en el panel

Se corrigen bugs en 6 archivos. No se necesitan cambios en la base de datos.

---

### FIX 1 — TrackingPage.tsx: Condición de carrera "No encontramos tu pedido"

**Problema**: La query de sesión tiene `staleTime: 10_000`, lo que causa que `tableData` exista pero `session` aún no haya cargado, mostrando el error falso.

**Cambios**:
- Línea 167: cambiar `staleTime: 10_000` a `staleTime: 0` y agregar `refetchOnMount: true`
- Línea 439: reemplazar la condición de error con `ordersLoading` guard que evita el falso positivo cuando session aún está cargando

### FIX 2 — TrackingPage.tsx: Texto explicativo en botón "Pedir la cuenta" deshabilitado

**Problema**: El usuario no entiende por qué el botón está gris.

**Cambio**: Debajo del botón de cuenta (línea ~717), agregar un `<p>` con "Disponible cuando tu pedido sea entregado" cuando `!hasDelivered`.

### FIX 3 — TrackingPage.tsx: Redirigir a menú cuando la sesión cierra + suscripción realtime

**Problema**: No existe suscripción realtime a `table_sessions`. Cuando el mozo cierra la mesa, el cliente no es redirigido.

**Cambio**: Agregar un `useEffect` con suscripción realtime a `table_sessions` filtrada por `table_id`. Cuando `is_active` cambia a `false`, mostrar toast "¡Gracias por tu visita!" y navegar a `/${slug}/menu` después de 2 segundos. Usar channel name único con tableData id.

### FIX 4 — MozoNotificacionesPage.tsx: Botones no actualizan

**Estado**: Ya corregido en código actual. Los handlers ya llaman `setActionLoading`, `fetchAll`, y `setActionLoading(null)`. No requiere cambios.

### FIX 5 — MozoNotificacionesPage.tsx: Estado de bill_request inconsistente

**Problema**: `handleBillClose` usa status `'completed'` pero el flujo de pago espera `'paid'`.

**Cambio**: Línea 245, cambiar `{ status: 'completed', attended_at: now }` a `{ status: 'paid', attended_at: now }`.

### FIX 6 — TrackingPage.tsx: Banner de llamada al mozo poco visible

**Problema**: Los fondos `bg-green-50` / `bg-yellow-50` tienen bajo contraste.

**Cambio**: Reemplazar el banner (líneas 666-688) con fondos sólidos: `bg-amber-500 text-white` para pending, `bg-green-500 text-white` para attended. Emoji grande (2xl) y texto bold blanco.

### FIX 7 — MozoLayout.tsx: Badge no se actualiza al desasignar mesa

**Estado**: Ya corregido. La suscripción realtime ya incluye `tables` con evento UPDATE (línea en MozoLayout). No requiere cambios.

### FIX 8 — BillPage.tsx: Error de sesión no encontrada

**Problema**: `staleTime: 5000` y la condición `!session && !isLoading` se dispara demasiado rápido.

**Cambios**:
- Línea 113: cambiar `staleTime: 5000` a `staleTime: 0` y agregar `refetchOnMount: true`
- Agregar estado `sessionTimeout` con `useState(false)` y un `useEffect` con `setTimeout` de 3 segundos
- Línea 273: cambiar condición a `!session && !isLoading && sessionTimeout`

### FIX 9 — AdminLayout.tsx: Agregar link a KDS Cocina

**Cambios**:
- Importar `ChefHat` de lucide-react
- Agregar `branchId` al destructuring de `useAdmin()`
- Agregar item de navegación antes de "Sucursal": `{ path: '/kds?branch=${branchId}', label: "KDS Cocina", icon: ChefHat, external: true }`
- Modificar el onClick de los botones de nav para abrir en nueva pestaña cuando `item.external` es true

### FIX 10 — Reportes: Labels en español + botón actualizar

**OrdersTab.tsx**: Línea 133, cambiar "Revenue por mesa" a "Ingresos por mesa"

**TablesTab.tsx**: Labels ya están en español. Sin cambios necesarios.

**ReportesPage.tsx**: Agregar botón "↻ Actualizar" (llama a `fetchData`) junto al botón CSV existente (línea ~148-154).

---

### Archivos modificados
- `src/pages/TrackingPage.tsx` (Fixes 1, 2, 3, 6)
- `src/pages/BillPage.tsx` (Fix 8)
- `src/pages/mozo/MozoNotificacionesPage.tsx` (Fix 5)
- `src/pages/admin/AdminLayout.tsx` (Fix 9)
- `src/components/reports/OrdersTab.tsx` (Fix 10)
- `src/pages/admin/ReportesPage.tsx` (Fix 10)

### Sin cambios necesarios (ya corregidos)
- `src/pages/mozo/MozoLayout.tsx` (Fix 7 ya implementado)
- `src/pages/mozo/MozoNotificacionesPage.tsx` (Fix 4 ya implementado)
- `src/components/reports/TablesTab.tsx` (Fix 10 — ya en español)

