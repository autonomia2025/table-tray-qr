# Login unificado + Control de gestión operacional

## Parte 1 — Mapa completo de roles y flujos (estado actual)

### A. Comensal (sin cuenta)
1. Escanea el QR de su mesa → `/:slug/menu?t=<qr_token>`.
2. El token resuelve tenant, sucursal, mesa y sesión de mesa (`useTableSession`). Sin token válido se muestra alerta y no puede pedir.
3. Arma su carrito individual (persistido en sessionStorage) → `/:slug/cart` → `/:slug/checkout`.
4. En checkout: upsell, nota para cocina, propina, email de lealtad (progreso de sellos/puntos y canje de premio), y pago con Apple Pay / Google Pay / tarjeta.
5. El servidor (`process-payment`) recalcula precios desde la base, cobra, y recién ahí crea la orden. El celular nunca confirma el pago.
6. Post pago: `/:slug/tracking` (estado del pedido), `/:slug/bill` (cuenta de la mesa), rating de 5 estrellas al cerrar la sesión.

### B. Mozo (`/mozo/*`)
- Login hoy separado en `/mozo/login`; el layout intenta auto-login desde la sesión de Supabase.
- **Mesas**: tablero ordenado por 7 urgencias operativas; toma mesa (`tables.assigned_waiter_id`), transfiere mesa a otro mozo, cierra mesa con confirmación de 2 pasos.
- **Notificaciones**: llamados de mozo y solicitudes de cuenta, con sonido.
- **Pedido manual**: crea pedidos para clientes que no usan el celular.
- No maneja estados de cocina (eso es exclusivo del KDS).

### C. Cocina / Barra (KDS, `/kds?branch=`)
- Pantalla oscura de 3 columnas, alertas de audio, temporizadores de latencia (verde <10m, ámbar 10–20m, rojo >20m), 86/sin stock, agrupación por cantidades.
- En modo prepago solo muestra pedidos ya pagados.

### D. Dueño / Admin del restaurante (`/admin/:slug/*`)
Mesas, Pedidos (kanban), Menú, Caja (pagos, conciliación, reembolsos), Lealtad, Reportes (ventas, cocina, mesas, equipo, clientes, menú + CSV), Equipo, QR, Sucursal (modo prepago vs cuenta abierta), Soporte (chat IA + tickets).

### E. Backoffice Tablio (interno)
- **Vendedor** (`/vendedor/*`): mi día, registro de visita <30s, pipeline, comisiones, números, recursos.
- **Jefe de Ventas** (`/jefe-ventas/*`): dashboard, equipo, comisiones, pipeline, perfil.
- **Finanzas** (`/finanzas/*`): revenue/MRR, clientes, churn, costos.
- **SuperAdmin** (`/superadmin/*`): tenants (con impersonación), equipo, métricas, feature flags, config.

---

## Parte 2 — Unificar el login por completo

Hoy `/`, `/login` y `/admin/login` ya usan el login unificado, pero `/mozo/login` sigue existiendo como pantalla aparte y cada panel resuelve el rol a su manera.

Cambios:
- Eliminar `/mozo/login` y redirigir a `/login`. Un solo formulario para todos los roles.
- Extraer la resolución de rol a un módulo compartido (`src/lib/auth-roles.ts`) usado por el login, los guards y los contextos, con este orden: platform admin → backoffice → tenant member (owner/admin/waiter) → staff user.
- Cada layout protegido (Mozo, SuperAdmin, Seller, Jefe de Ventas, Finanzas, Admin) usa un único `RoleGuard` que, si la sesión no corresponde al panel, redirige al panel correcto en vez de a un login propio.
- Un solo "Cerrar sesión" real: limpia sesión de Supabase, contexto de mozo e impersonación, y vuelve a `/login`.
- Pantalla de "cuenta sin panel asignado" clara en vez de errores genéricos.

---

## Parte 3 — Control de gestión (quién trabaja y cuánto)

### 3.1 Turnos de personal
- Nueva tabla `staff_shifts`: apertura y cierre de turno por mozo, con sucursal y duración.
- El mozo abre turno al entrar al panel y lo cierra desde su perfil (o se cierra solo al final del día).
- El dueño ve quién está en turno ahora mismo, en vivo.

### 3.2 Atribución de trabajo por pedido y por mesa
- Nueva columna en `orders`: mozo responsable al momento de atender/entregar.
- Nueva tabla `order_events`: registro inmutable de cada cambio de estado (quién, qué, cuándo). De ahí salen los tiempos reales: confirmado → cocina → listo → entregado.
- Nueva tabla `table_assignments`: histórico de qué mozo tuvo qué mesa y por cuánto tiempo (hoy solo existe el estado actual en `tables.assigned_waiter_id`, se pierde al cerrar).
- Al cerrar la mesa, la atribución queda congelada y guardada: nada se borra.

### 3.3 Panel "Operación" para el dueño (nueva sección)
- **En vivo**: mozos en turno, mesas por mozo, pedidos abiertos por mozo, alertas sin atender y tiempo de espera.
- **Ranking de equipo** por periodo: mesas atendidas, pedidos entregados, ventas atribuidas, propinas, ticket promedio, tiempo promedio de respuesta a llamados, tiempo promedio de entrega, sesiones cerradas y rating promedio de sus mesas.
- **Historial por persona**: turnos, horas trabajadas, ventas por hora trabajada.
- Exportable a CSV con el formato actual (punto y coma + BOM).

### 3.4 Ideas adicionales de gestión propuestas
1. **Rating atribuido**: el rating de 5 estrellas de la sesión se asocia al mozo que la cerró.
2. **SLA operativo**: metas por sucursal (responder llamado <2 min, entregar <15 min) y semáforo de cumplimiento por mozo.
3. **Alertas de abandono**: mesa con pedido listo y sin entregar por X minutos → notificación al mozo y registro para el dueño.
4. **Productividad de cocina**: ranking de tiempos por categoría y por ítem, para detectar cuellos de botella del menú.
5. **Cierre de caja por turno**: resumen imprimible al cerrar turno (ventas, propinas, pagos por método).
6. **Bitácora de auditoría visible**: quién canceló pedidos, quién aplicó reembolsos, quién cambió precios (usando `audit_logs`).
7. **Objetivos por mozo**: meta de ventas o de upsell por turno, con avance visible en su propio panel (gamificación suave).
8. **Heatmap de horas**: ventas y carga por hora y día, para planificar cuántos mozos necesita cada turno.

---

## Detalles técnicos

- Migraciones: `staff_shifts`, `order_events`, `table_assignments`, columna de mozo en `orders`, más GRANTs y RLS por `tenant_id` para cada tabla nueva.
- Los eventos de estado se escriben con triggers en base de datos, para que la métrica no dependa del cliente.
- Las métricas del panel Operación se calculan con consultas agregadas sobre `order_events` y `table_assignments`, no con estado local.
- Se reutilizan `src/lib/report-utils.ts` y `src/lib/export-utils.ts`; el nuevo panel entra como pestaña propia en el layout de admin.
- El login unificado no cambia el diseño actual de la pantalla, solo su lógica de resolución de rol.

## Orden de trabajo
1. Login unificado + guards compartidos.
2. Migraciones de gestión (turnos, eventos, asignaciones).
3. Escritura de datos desde el panel de mozo y KDS.
4. Panel "Operación" del dueño con vivo + ranking + exportación.
