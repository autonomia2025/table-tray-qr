# ESTADO_LOVABLE.md — Auditoría de Tablio

Fecha de auditoría: 1 de octubre de 2026. Solo lectura: no se cambió código ni base de datos.
Leyenda de estado: **[BD]** funciona contra la base de datos real · **[SIM]** usa datos simulados o calculados localmente · **[VISUAL]** solo existe visualmente · **[NV]** no verificado a fondo en esta auditoría.

Stack: React 18 + Vite + TypeScript + Tailwind + shadcn/ui, Zustand (carrito), React Query, Framer Motion. Backend en Lovable Cloud (Postgres + Auth + Realtime + Storage + Edge Functions en Deno). ~18.000 líneas en `src/pages`.

Datos actuales en la base (conteo, sin datos personales): 1 local (tenant), 1 sucursal, 2 mesas, 2 pedidos (1 pagado, 1 sin pagar), 0 pagos, 0 reembolsos, 0 cierres de caja, 0 clientes de lealtad, 1 lead, 1 miembro de backoffice, 3 miembros de local, 3 usuarios de staff. **Es una base de prueba; no hay operación real.**

---

## 1. Inventario de roles y pantallas

### Comensal (sin cuenta, entra por QR)
| Ruta | Qué hace | Estado |
|---|---|---|
| `/:slug` | Splash con colores y portada del local | [BD] |
| `/:slug/menu?t=<qr_token>` | Menú por categorías; el token identifica mesa/sucursal (`useTableSession`). Sin token válido muestra alerta | [BD] |
| `/:slug/item/:id` | Detalle de plato con modificadores y alérgenos | [BD] |
| `/:slug/cart` | Carrito individual (sessionStorage) | [BD] lectura de precios, carrito local |
| `/:slug/checkout` | Upsell, nota a cocina, propina, email de lealtad, pago (Apple Pay / Google Pay / tarjeta) vía función `process-payment` | [BD] + **cobro [SIM]** |
| `/:slug/confirm` | Redirige a checkout (flujo antiguo eliminado) | redirección |
| `/:slug/tracking` | Estado del pedido en vivo (Realtime), botón "pagar desde el celular" | [BD] |
| `/:slug/bill` | Cuenta de la mesa calculada desde la base | [BD] |
| `/:slug/pay` | Pagar la cuenta abierta de la mesa (modo cuenta abierta) | [BD] + cobro [SIM] |

### Mozo / garzón
| Ruta | Qué hace | Estado |
|---|---|---|
| `/mozo/join/:token` | Alta de mozo con invitación (función `register-waiter`) | [BD] |
| `/mozo/login` | Login separado del unificado (duplicado) | [BD] |
| `/mozo/mesas` | Tablero por urgencia, tomar/transferir/cerrar mesa (confirmación 2 pasos) | [BD] |
| `/mozo/notificaciones` | Llamados de mozo y pedidos de cuenta con sonido | [BD] |
| `/mozo/pedido-manual/:tableId` | Pedido manual para clientes sin celular — **se inserta directo desde el navegador** | [BD] |
| `/mozo/perfil` | Perfil y cierre de sesión | [BD] |

### Cocina / barra (KDS)
| `/kds?branch=<id>` | 3 columnas, audio, temporizadores, 86/sin stock. En modo prepago oculta pedidos no pagados | [BD] |

### Cajero
No existe un rol ni pantalla de cajero separada. La caja está dentro del panel del dueño (`/admin/:slug/caja`). **Inexistente como rol.**

### Dueño / Admin del local (`/admin/:slug/*`, guard `AdminGuard`)
| Ruta | Qué hace | Estado |
|---|---|---|
| `mesas` | Semáforo de mesas, crear mesas | [BD] |
| `pedidos` | Kanban de pedidos, cancelar con motivo | [BD] |
| `menu` | Categorías, platos, modificadores, imágenes (bucket `menu-images`) | [BD] |
| `equipo` | Mozos e invitaciones | [BD] |
| `qr` | Un QR por mesa → `/:slug/menu?t=…`, imprimir/descargar | [BD] |
| `sucursal` | Datos de sucursal y modo de pago (prepago / cuenta abierta) | [BD] |
| `caja` | Pagos, conciliación diaria (`reconcile-payments`), reembolsos (`refund-payment`) | [BD] (proveedor simulado) |
| `lealtad` | Programa de sellos o puntos y premio | [BD] |
| `reportes` | Ventas, cocina, mesas, equipo, clientes, menú + CSV | [BD] cálculo en el navegador |
| `soporte` | Chat IA (función `support-chat`) + tickets | [BD] |

### Backoffice interno Tablio
| Ruta | Rol | Estado |
|---|---|---|
| `/vendedor/mi-dia`, `registro`, `pipeline`, `comisiones`, `numeros`, `recursos` | Vendedor | [BD] para leads; `recursos` [VISUAL]/[NV] |
| `/jefe-ventas/dashboard`, `equipo`, `comisiones`, `pipeline`, `perfil` | Jefe de ventas | [BD] |
| `/finanzas/revenue`, `clientes`, `churn` | Finanzas | [BD] lee `tenants` y `plans`; MRR y cohortes **calculados en el navegador** a partir del plan |
| `/finanzas/costos` | Finanzas | categorías fijas en código; [NV] si persiste costos (no hay tabla de costos en la base → probablemente [SIM]/[VISUAL]) |
| `/superadmin/tenants`, `equipo`, `metricas`, `flags`, `config` | SuperAdmin | [BD]; incluye impersonación y lista de usuarios por local |
| `/backoffice/join/:token` | Invitación al backoffice | [BD] |
| `/backoffice/*` | Redirige a jefe de ventas (código viejo `src/pages/backoffice/*` reutilizado parcialmente) | redirección |

Login: `/`, `/login`, `/admin/login` usan `UnifiedLoginPage` (redirige según rol). `/admin/forgot-password`, `/reset-password` [BD].

---

## 2. Modelo de datos

### Tablas (32) — resumen por dominio
- **Plataforma**: `plans`, `tenants`, `platform_admins`, `feature_flags`, `tenant_feature_flags`, `audit_logs`.
- **Local**: `restaurants`, `branches` (`payment_mode`), `tables` (`qr_token`, `status`, `assigned_waiter_id`), `tenant_members` (usuario↔local, rol), `staff_users` (incluye `pin` en texto), `staff_invitations`.
- **Menú**: `menus`, `categories`, `menu_items` (precio entero CLP), `modifier_groups`, `modifiers`.
- **Operación**: `table_sessions`, `orders` (`status`, `payment_status`), `order_items` (guarda `unit_price` y `menu_item_name` copiados al momento), `waiter_calls`, `bill_requests`.
- **Dinero**: `payments` (`idempotency_key`, `refunded_amount`, `provider`), `refunds`, `payment_settlements`.
- **Lealtad**: `loyalty_programs`, `loyalty_customers`, `loyalty_rewards`.
- **Backoffice**: `backoffice_members`, `backoffice_invitations`, `leads`, `lead_activities`, `seller_goals`, `support_tickets`.

Las columnas y tipos completos de cada tabla están en `src/integrations/supabase/types.ts` (generado automáticamente desde la base; es la fuente fiel para recrear el esquema). Las migraciones SQL están en `supabase/migrations/`.

Valores de estado encontrados en datos: pedidos `delivered`; pago de pedidos `paid`, `unpaid`; mesas `free`, `occupied`; leads `cliente_pagando`. En código: pedidos `pending/confirmed/in_kitchen/ready/delivered/cancelled`; pago `paid/unpaid/refunded`.

Realtime activo en: `tables`, `table_sessions`, `orders`, `order_items`, `bill_requests`, `waiter_calls`.
Storage: bucket público `menu-images`.

### Funciones de base de datos
- `get_tenant_id()` — devuelve el local del usuario conectado (vía `tenant_members`). Base de casi todas las políticas.
- `is_tenant_member(tenant)`, `is_platform_admin()`, `has_backoffice_role(user, rol)`, `has_staff_role(user, rol)` — verificadores de rol (security definer).
- `update_updated_at_column()` — trigger de fecha de modificación en `loyalty_customers`, `loyalty_programs`, `menu_items`, `payment_settlements`, `payments`, `tenants`.
No hay triggers de negocio (ni de estados, ni de auditoría automática).

### Edge functions (servidor)
| Función | Qué hace |
|---|---|
| `process-payment` | Recibe carrito + token de mesa; recalcula precios desde la base; abre/une sesión; cobra con el proveedor; **solo si aprobado** crea pedido pagado y registra pago; idempotencia por `idempotency_key`; actualiza lealtad y canjea premios. También paga pedidos abiertos (modo cuenta abierta) |
| `refund-payment` | Valida usuario del local, registra reembolso parcial/total, actualiza `refunded_amount` y marca pedidos `refunded` |
| `reconcile-payments` | Cierre/conciliación diaria por sucursal y proveedor |
| `loyalty-status` | Progreso de sellos/puntos por email |
| `list-tenant-users` | Lista emails/roles de un local (solo superadmin o dueño/admin) |
| `create-tenant-user` | Crea usuario y lo agrega al local — **no verifica quién llama más allá de que traiga un header** |
| `create-platform-admin`, `create-jefe-ventas`, `register-seller`, `register-waiter` | Altas de usuarios por rol/invitación |
| `support-chat` | Chat de soporte con IA |
| `_shared/provider.ts` | Adaptador de pagos: **simulado** (aprueba todo monto > 0) |

El texto completo de cada política de seguridad está en el **Anexo A**.

---

## 3. Flujos de negocio

1. **Entrar a la mesa**: el comensal escanea el QR → `/:slug/menu?t=<qr_token>`. El navegador busca la mesa por token. No hay código de presencia.
2. **Pedir**: arma su carrito individual en el navegador (sessionStorage).
3. **Pagar (prepago)**: en `/checkout` el navegador envía el carrito y el token a `process-payment`. **El servidor** recalcula precios desde `menu_items`/`modifiers`, cobra (simulado) y recién con aprobación crea `orders` con `payment_status='paid'`, `order_items` y `payments`. La confirmación la decide el servidor en `process-payment/index.ts` (~líneas 210–305).
4. **Pagar (cuenta abierta)**: `/pay` o `/bill` llaman a `process-payment` con los pedidos pendientes de la sesión; el servidor marca `paid` (línea ~304).
5. **Llega a cocina**: el KDS lee `orders` en vivo. En prepago filtra por pagados; en cuenta abierta muestra todo.
6. **Estados de cocina**: KDS y admin cambian `status` **desde el navegador** (`KDSPage.tsx:728`, `PedidosPage.tsx:217`). `MozoNotificacionesPage.tsx:258-264` también cambia a `in_kitchen/ready` (contradice la regla "mozo no maneja cocina").
7. **Cerrar mesa**: el mozo desde `/mozo/mesas` marca pedidos `delivered` y cierra la sesión, todo desde el navegador (`MozoMesasPage.tsx:248`).
8. **Cuadrar caja**: el dueño en Caja ejecuta `reconcile-payments`, que compara lo esperado vs lo liquidado por día/proveedor. Con proveedor simulado no hay liquidación externa real.

---

## 4. Funcionalidades que no son para el bar (backoffice)
- **Vendedor**: agenda del día, registro de visita rápido, pipeline Kanban de `leads`, comisiones y números personales (`seller_goals`, `lead_activities`).
- **Jefe de ventas**: dashboard del equipo, metas, comisiones, pipeline global, invitaciones (`backoffice_invitations`).
- **Finanzas**: MRR/ARR, clientes, churn y cohortes calculados en el navegador desde `tenants` + `plans` (no desde pagos reales de suscripción: no existe tabla de facturación SaaS). Costos: [NV], sin tabla propia.
- **SuperAdmin**: alta de locales (wizard), impersonación, equipo interno, métricas comerciales, feature flags, metas de vendedores.

---

## 5. Integraciones y secretos
| Servicio | Estado |
|---|---|
| Pagos (Mercado Pago/Transbank/Stripe) | **No integrado.** Proveedor simulado (`_shared/provider.ts`, `PROVIDER_NAME="simulated"`) |
| Apple Pay / Google Pay | Botones vía Payment Request API del navegador; el cobro termina en el simulador |
| Boletas / SII | **No existe** |
| IA | `support-chat` usa Lovable AI Gateway (modelo `google/gemini-3-flash-preview`) con `LOVABLE_API_KEY` — configurado |
| Correo | Solo correos de autenticación por defecto. Sin correos transaccionales |
| Mapas | No existe |

Secretos configurados (nombres): `LOVABLE_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`, `SUPABASE_JWKS`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS`. Frontend: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`. Para producción faltarían las credenciales del proveedor de pagos real.

---

## 6. Inconsistencias y problemas
- **Dos logins**: `/mozo/login` (`MozoLoginPage`) además del unificado. Existe `AdminLoginPage.tsx` sin ruta (código muerto). También `Index.tsx`, `AdminGlobalPage.tsx`, `BackofficeLayout/Dashboard/Vendedores` sin ruta directa [verificar antes de borrar].
- **Cada panel resuelve el rol a su manera** (`FinanzasLayout`, `SellerLayout`, `JefeVentasLayout`, `SuperAdminLayout`, `AdminContext`, `MozoLayout`).
- **Mozo cambia estados de cocina** en `MozoNotificacionesPage` (contra la regla del producto).
- **Pedido manual del mozo** se crea desde el navegador con precios del navegador (`MozoPedidoManualPage.tsx:109,145-189`) — no pasa por el servidor. Incluye `supabase.rpc("get_tenant_id") // dummy` (l.187).
- **Mezcla de idiomas**: estados en inglés (`delivered`, `paid`) y etapas de leads en español (`demo_agendada`, `cliente_pagando`).
- **PIN del staff guardado en texto plano** en `staff_users.pin` y legible públicamente (ver sección 7).
- **Sin historial de quién hizo qué**: no hay atribución de pedidos por mozo, ni turnos, ni eventos de estado (ver plan anterior de "control de gestión", no implementado).
- **Reportes y finanzas calculados en el navegador** (escala mal con muchos datos).
- **Varios `toast` muestran mensajes de error técnicos** crudos (≈32 usos de `error.message`).
- `create-tenant-user` usa `listUsers()` sin paginar para buscar usuarios existentes (falla con >50 usuarios).
- Base con datos de prueba (1 local) mezclados con configuración real; no hay separación de entornos.

---

## 7. Riesgos en la parte de la plata (con evidencia)

**¿El navegador puede marcar un pago como confirmado?** — **Sí, hoy puede.** El flujo oficial confirma en el servidor, pero la política `orders_public_update_status` permite a **cualquiera, incluso sin sesión**, actualizar **cualquier pedido** (`USING true / CHECK true`). Alguien podría cambiar `payment_status` a `paid` y el pedido aparecería en el KDS en modo prepago. La tabla `payments` sí está protegida (sin escritura desde el navegador), así que el pago "falso" no aparecería en Caja, pero sí en cocina. Además `orders_public_insert` permite crear pedidos sin pagar en cualquier mesa con sesión activa (visibles en cocina en modo cuenta abierta).

**¿Se congela el precio al pagar?** — **Sí, en el flujo del comensal.** `process-payment` recalcula desde la base al momento de pagar y copia `unit_price` y `menu_item_name` en `order_items`; editar la carta después no cambia pedidos ya hechos. No existe una "cotización congelada" previa: si el admin cambia el precio entre que el cliente ve el carrito y paga, se cobra el precio nuevo. **Excepción:** el pedido manual del mozo usa el precio que tiene el navegador.

**¿Qué pasa si la confirmación llega dos veces?** — Hay idempotencia por `idempotency_key` (`process-payment` l.49–60): si el mismo key ya existe, devuelve el resultado anterior. No hay índice único verificado en esta auditoría sobre `payments.idempotency_key` [NV], así que dos llamadas simultáneas exactas podrían colarse. No existen webhooks de proveedor (el cobro es síncrono y simulado), por lo que el escenario "webhook duplicado" aún no aplica.

**¿Un local puede ver datos de otro local?** — **Sí, varios.** Lectura pública total (`USING true`) en `orders`, `order_items`, `table_sessions`, `tables`, `waiter_calls`, `bill_requests`, `staff_users` (incluye PIN), `staff_invitations`, `backoffice_invitations`, `tenants`. Más grave: `tenant_members_public_insert` (`CHECK true`) permite que cualquier usuario se **agregue a sí mismo como miembro de cualquier local**, y desde ahí `get_tenant_id()` le da acceso de gestión a ese local (menú, pedidos, pagos). También `staff_invitations` y `backoffice_invitations` se pueden modificar públicamente. `table_sessions` y `tables` se pueden modificar públicamente. Pagos y reembolsos sí están limitados al local.

**¿Los reembolsos funcionan de verdad?** — **Funcionan en la base, no en el dinero.** `refund-payment` valida al usuario, evita reembolsar más que lo pagado, registra el reembolso y marca pedidos `refunded`, pero llama a `refund()` del proveedor simulado: no se devuelve plata real. Hoy hay 0 reembolsos registrados.

---

## 8. Lo que vale la pena rescatar
1. Pago verificado en el servidor con recálculo de precios desde la base y creación del pedido solo tras aprobación (`process-payment`).
2. Adaptador de proveedor de pagos aislado en un archivo (cambiar a proveedor real sin tocar el resto).
3. Modelo de dinero completo: pagos, reembolsos parciales, conciliación diaria, idempotencia.
4. Lealtad por email sin contraseña, con sellos o puntos y canje en el checkout.
5. Modo por sucursal: prepago (cocina solo ve lo pagado) o cuenta abierta.
6. Un QR por mesa con sesiones compartidas multi-dispositivo y Realtime.
7. KDS profesional: audio, temporizadores de latencia, 86/sin stock, agrupación por cantidades.
8. Panel de mozo con priorización por urgencia, transferencia y cierre seguro de mesa.
9. Menú con 4 tipos de modificadores, alérgenos, imágenes y horarios por categoría.
10. Backoffice comercial completo (CRM, comisiones, metas, finanzas SaaS) y SuperAdmin con impersonación.
11. Exportación CSV compatible con Excel en español (punto y coma + BOM).

## Lo que no se pudo verificar
- Si existe índice único en `payments.idempotency_key`.
- Si `/finanzas/costos` y `/vendedor/recursos` guardan datos o son solo visuales.
- Comportamiento real de Apple Pay/Google Pay en dispositivos (solo se probó el flujo con tarjeta simulada).
- Configuración de correos de autenticación y proveedores de login más allá de email.

---

## Anexo A — Políticas de seguridad (RLS) tal como existen en la base
Formato: tabla | política | operación | roles | condición de lectura (USING) | condición de escritura (CHECK)

- audit_logs | audit_logs_insert | INSERT | {public} | USING: - | CHECK: true
- audit_logs | audit_logs_tenant_read | SELECT | {public} | USING: (tenant_id = get_tenant_id()) | CHECK: -
- audit_logs | superadmin_delete_audit_logs | DELETE | {authenticated} | USING: is_platform_admin() | CHECK: -
- backoffice_invitations | backoffice_invitations_jefe_manage | ALL | {authenticated} | USING: (EXISTS ( SELECT 1 FROM backoffice_members bm WHERE ((bm.user_id = auth.uid()) AND (bm.role = 'jefe_ventas'::text) AND (bm.is_active = true)))) | CHECK: (EXISTS ( SELECT 1 FROM backoffice_members bm WHERE ((bm.user_id = auth.uid()) AND (bm.role = 'jefe_ventas'::text) AND (bm.is_active = true))))
- backoffice_invitations | backoffice_invitations_public_read | SELECT | {anon,authenticated} | USING: true | CHECK: -
- backoffice_invitations | backoffice_invitations_public_update | UPDATE | {anon,authenticated} | USING: true | CHECK: -
- backoffice_invitations | backoffice_invitations_superadmin_all | ALL | {authenticated} | USING: is_platform_admin() | CHECK: is_platform_admin()
- backoffice_members | backoffice_members_jefe_read | SELECT | {authenticated} | USING: ((user_id = auth.uid()) OR has_backoffice_role(auth.uid(), 'jefe_ventas'::text)) | CHECK: -
- backoffice_members | backoffice_members_jefe_update | UPDATE | {authenticated} | USING: (EXISTS ( SELECT 1 FROM backoffice_members bm WHERE ((bm.user_id = auth.uid()) AND (bm.role = 'jefe_ventas'::text) AND (bm.is_active = true)))) | CHECK: -
- backoffice_members | backoffice_members_own_read | SELECT | {authenticated} | USING: (user_id = auth.uid()) | CHECK: -
- backoffice_members | backoffice_members_superadmin_all | ALL | {authenticated} | USING: is_platform_admin() | CHECK: is_platform_admin()
- bill_requests | bill_requests_public_insert | INSERT | {public} | USING: - | CHECK: (EXISTS ( SELECT 1 FROM table_sessions ts WHERE ((ts.table_id = bill_requests.table_id) AND (ts.is_active = true))))
- bill_requests | bill_requests_public_read | SELECT | {public} | USING: true | CHECK: -
- bill_requests | bill_requests_staff_manage | ALL | {public} | USING: (tenant_id = get_tenant_id()) | CHECK: -
- bill_requests | superadmin_delete_bill_requests | DELETE | {authenticated} | USING: is_platform_admin() | CHECK: -
- branches | branches_public_read | SELECT | {public} | USING: true | CHECK: -
- branches | branches_staff_manage | ALL | {public} | USING: (tenant_id = get_tenant_id()) | CHECK: -
- branches | superadmin_delete_branches | DELETE | {authenticated} | USING: is_platform_admin() | CHECK: -
- branches | superadmin_insert_branches | INSERT | {authenticated} | USING: - | CHECK: is_platform_admin()
- branches | superadmin_update_branches | UPDATE | {authenticated} | USING: is_platform_admin() | CHECK: -
- categories | categories_public_read | SELECT | {public} | USING: true | CHECK: -
- categories | categories_staff_manage | ALL | {public} | USING: (tenant_id = get_tenant_id()) | CHECK: -
- categories | superadmin_delete_categories | DELETE | {authenticated} | USING: is_platform_admin() | CHECK: -
- categories | superadmin_insert_categories | INSERT | {authenticated} | USING: - | CHECK: is_platform_admin()
- feature_flags | feature_flags_public_read | SELECT | {public} | USING: true | CHECK: -
- feature_flags | feature_flags_superadmin_manage | ALL | {authenticated} | USING: is_platform_admin() | CHECK: is_platform_admin()
- lead_activities | lead_activities_jefe_insert | INSERT | {authenticated} | USING: - | CHECK: (EXISTS ( SELECT 1 FROM backoffice_members bm WHERE ((bm.user_id = auth.uid()) AND (bm.role = 'jefe_ventas'::text) AND (bm.is_active = true))))
- lead_activities | lead_activities_jefe_read | SELECT | {authenticated} | USING: (EXISTS ( SELECT 1 FROM backoffice_members bm WHERE ((bm.user_id = auth.uid()) AND (bm.role = 'jefe_ventas'::text) AND (bm.is_active = true)))) | CHECK: -
- lead_activities | lead_activities_seller_insert | INSERT | {authenticated} | USING: - | CHECK: ((lead_id IN ( SELECT leads.id FROM leads WHERE (leads.assigned_seller_id IN ( SELECT backoffice_members.id FROM backoffice_members WHERE (backoffice_members.user_id = auth.uid()))))) OR is_platform_admin())
- lead_activities | lead_activities_seller_read | SELECT | {authenticated} | USING: (lead_id IN ( SELECT leads.id FROM leads WHERE (leads.assigned_seller_id IN ( SELECT backoffice_members.id FROM backoffice_members WHERE (backoffice_members.user_id = auth.uid()))))) | CHECK: -
- lead_activities | lead_activities_superadmin_all | ALL | {authenticated} | USING: is_platform_admin() | CHECK: is_platform_admin()
- leads | leads_jefe_manage | ALL | {authenticated} | USING: (EXISTS ( SELECT 1 FROM backoffice_members bm WHERE ((bm.user_id = auth.uid()) AND (bm.role = 'jefe_ventas'::text) AND (bm.is_active = true)))) | CHECK: (EXISTS ( SELECT 1 FROM backoffice_members bm WHERE ((bm.user_id = auth.uid()) AND (bm.role = 'jefe_ventas'::text) AND (bm.is_active = true))))
- leads | leads_jefe_read | SELECT | {authenticated} | USING: (EXISTS ( SELECT 1 FROM backoffice_members bm WHERE ((bm.user_id = auth.uid()) AND (bm.role = 'jefe_ventas'::text) AND (bm.is_active = true)))) | CHECK: -
- leads | leads_seller_insert | INSERT | {authenticated} | USING: - | CHECK: ((assigned_seller_id IN ( SELECT backoffice_members.id FROM backoffice_members WHERE (backoffice_members.user_id = auth.uid()))) OR is_platform_admin())
- leads | leads_seller_read_own | SELECT | {authenticated} | USING: (assigned_seller_id IN ( SELECT backoffice_members.id FROM backoffice_members WHERE (backoffice_members.user_id = auth.uid()))) | CHECK: -
- leads | leads_seller_update_own | UPDATE | {authenticated} | USING: (assigned_seller_id IN ( SELECT backoffice_members.id FROM backoffice_members WHERE (backoffice_members.user_id = auth.uid()))) | CHECK: -
- leads | leads_superadmin_all | ALL | {authenticated} | USING: is_platform_admin() | CHECK: is_platform_admin()
- loyalty_customers | Tenant members can view loyalty customers | SELECT | {authenticated} | USING: (is_tenant_member(tenant_id) OR is_platform_admin()) | CHECK: -
- loyalty_programs | Public can view active loyalty programs | SELECT | {anon} | USING: (is_active = true) | CHECK: -
- loyalty_programs | Tenant members can create loyalty programs | INSERT | {authenticated} | USING: - | CHECK: is_tenant_member(tenant_id)
- loyalty_programs | Tenant members can update loyalty programs | UPDATE | {authenticated} | USING: is_tenant_member(tenant_id) | CHECK: is_tenant_member(tenant_id)
- loyalty_programs | Tenant members can view loyalty programs | SELECT | {authenticated} | USING: (is_tenant_member(tenant_id) OR is_platform_admin()) | CHECK: -
- loyalty_rewards | Tenant members can view loyalty rewards | SELECT | {authenticated} | USING: (is_tenant_member(tenant_id) OR is_platform_admin()) | CHECK: -
- menu_items | menu_items_public_read | SELECT | {public} | USING: true | CHECK: -
- menu_items | menu_items_staff_manage | ALL | {public} | USING: (tenant_id = get_tenant_id()) | CHECK: -
- menu_items | superadmin_delete_menu_items | DELETE | {authenticated} | USING: is_platform_admin() | CHECK: -
- menu_items | superadmin_insert_menu_items | INSERT | {authenticated} | USING: - | CHECK: is_platform_admin()
- menus | menus_public_read | SELECT | {public} | USING: true | CHECK: -
- menus | menus_staff_manage | ALL | {public} | USING: (tenant_id = get_tenant_id()) | CHECK: -
- menus | superadmin_delete_menus | DELETE | {authenticated} | USING: is_platform_admin() | CHECK: -
- menus | superadmin_insert_menus | INSERT | {authenticated} | USING: - | CHECK: is_platform_admin()
- menus | superadmin_update_menus | UPDATE | {authenticated} | USING: is_platform_admin() | CHECK: -
- modifier_groups | modifier_groups_public_read | SELECT | {public} | USING: true | CHECK: -
- modifier_groups | modifier_groups_staff_manage | ALL | {public} | USING: (tenant_id = get_tenant_id()) | CHECK: -
- modifier_groups | superadmin_delete_modifier_groups | DELETE | {authenticated} | USING: is_platform_admin() | CHECK: -
- modifiers | modifiers_public_read | SELECT | {public} | USING: true | CHECK: -
- modifiers | modifiers_staff_manage | ALL | {public} | USING: (tenant_id = get_tenant_id()) | CHECK: -
- modifiers | superadmin_delete_modifiers | DELETE | {authenticated} | USING: is_platform_admin() | CHECK: -
- order_items | order_items_public_insert | INSERT | {public} | USING: - | CHECK: (EXISTS ( SELECT 1 FROM (orders o JOIN table_sessions ts ON ((ts.table_id = o.table_id))) WHERE ((o.id = order_items.order_id) AND (ts.is_active = true))))
- order_items | order_items_public_read | SELECT | {public} | USING: true | CHECK: -
- order_items | order_items_staff_manage | ALL | {public} | USING: (tenant_id = get_tenant_id()) | CHECK: -
- order_items | superadmin_delete_order_items | DELETE | {authenticated} | USING: is_platform_admin() | CHECK: -
- orders | orders_public_insert | INSERT | {public} | USING: - | CHECK: (EXISTS ( SELECT 1 FROM table_sessions ts WHERE ((ts.table_id = orders.table_id) AND (ts.is_active = true))))
- orders | orders_public_read | SELECT | {public} | USING: true | CHECK: -
- orders | orders_public_update_status | UPDATE | {public} | USING: true | CHECK: true
- orders | orders_staff_manage | ALL | {public} | USING: (tenant_id = get_tenant_id()) | CHECK: -
- orders | superadmin_delete_orders | DELETE | {authenticated} | USING: is_platform_admin() | CHECK: -
- payment_settlements | Tenant members can view settlements | SELECT | {authenticated} | USING: (is_tenant_member(tenant_id) OR is_platform_admin()) | CHECK: -
- payments | Public can view payments of active sessions | SELECT | {anon} | USING: (EXISTS ( SELECT 1 FROM table_sessions s WHERE ((s.id = payments.session_id) AND (s.is_active = true)))) | CHECK: -
- payments | Tenant members can view payments | SELECT | {authenticated} | USING: (is_tenant_member(tenant_id) OR is_platform_admin()) | CHECK: -
- plans | plans_public_read | SELECT | {public} | USING: true | CHECK: -
- platform_admins | platform_admins_own_read | SELECT | {authenticated} | USING: (user_id = auth.uid()) | CHECK: -
- refunds | Tenant members can view refunds | SELECT | {authenticated} | USING: (is_tenant_member(tenant_id) OR is_platform_admin()) | CHECK: -
- restaurants | restaurants_public_read | SELECT | {public} | USING: true | CHECK: -
- restaurants | restaurants_staff_manage | ALL | {public} | USING: (tenant_id = get_tenant_id()) | CHECK: -
- restaurants | superadmin_delete_restaurants | DELETE | {authenticated} | USING: is_platform_admin() | CHECK: -
- restaurants | superadmin_insert_restaurants | INSERT | {authenticated} | USING: - | CHECK: is_platform_admin()
- restaurants | superadmin_update_restaurants | UPDATE | {authenticated} | USING: is_platform_admin() | CHECK: -
- seller_goals | seller_goals_jefe_manage | ALL | {authenticated} | USING: has_backoffice_role(auth.uid(), 'jefe_ventas'::text) | CHECK: has_backoffice_role(auth.uid(), 'jefe_ventas'::text)
- seller_goals | seller_goals_own_read | SELECT | {authenticated} | USING: (seller_id IN ( SELECT backoffice_members.id FROM backoffice_members WHERE (backoffice_members.user_id = auth.uid()))) | CHECK: -
- seller_goals | seller_goals_superadmin_all | ALL | {authenticated} | USING: is_platform_admin() | CHECK: is_platform_admin()
- staff_invitations | staff_invitations_public_read | SELECT | {anon,authenticated} | USING: true | CHECK: -
- staff_invitations | staff_invitations_public_update | UPDATE | {anon,authenticated} | USING: true | CHECK: -
- staff_invitations | staff_invitations_staff_manage | ALL | {authenticated} | USING: (tenant_id = get_tenant_id()) | CHECK: -
- staff_invitations | superadmin_delete_staff_invitations | DELETE | {authenticated} | USING: is_platform_admin() | CHECK: -
- staff_users | staff_users_public_read | SELECT | {public} | USING: true | CHECK: -
- staff_users | staff_users_tenant_manage | ALL | {public} | USING: (tenant_id = get_tenant_id()) | CHECK: -
- staff_users | staff_users_tenant_read | SELECT | {public} | USING: (tenant_id = get_tenant_id()) | CHECK: -
- staff_users | superadmin_delete_staff_users | DELETE | {authenticated} | USING: is_platform_admin() | CHECK: -
- staff_users | superadmin_insert_staff_users | INSERT | {authenticated} | USING: - | CHECK: is_platform_admin()
- support_tickets | support_tickets_superadmin_all | ALL | {public} | USING: is_platform_admin() | CHECK: is_platform_admin()
- support_tickets | support_tickets_tenant_insert | INSERT | {public} | USING: - | CHECK: is_tenant_member(tenant_id)
- support_tickets | support_tickets_tenant_read | SELECT | {public} | USING: is_tenant_member(tenant_id) | CHECK: -
- table_sessions | superadmin_delete_table_sessions | DELETE | {authenticated} | USING: is_platform_admin() | CHECK: -
- table_sessions | superadmin_insert_table_sessions | INSERT | {authenticated} | USING: - | CHECK: is_platform_admin()
- table_sessions | table_sessions_public_insert | INSERT | {public} | USING: - | CHECK: true
- table_sessions | table_sessions_public_read | SELECT | {public} | USING: true | CHECK: -
- table_sessions | table_sessions_public_update | UPDATE | {public} | USING: true | CHECK: true
- table_sessions | table_sessions_staff_manage | ALL | {public} | USING: (tenant_id = get_tenant_id()) | CHECK: -
- tables | superadmin_delete_tables | DELETE | {authenticated} | USING: is_platform_admin() | CHECK: -
- tables | superadmin_insert_tables | INSERT | {authenticated} | USING: - | CHECK: is_platform_admin()
- tables | tables_public_read | SELECT | {public} | USING: true | CHECK: -
- tables | tables_public_update_status | UPDATE | {public} | USING: true | CHECK: true
- tables | tables_staff_manage | ALL | {public} | USING: (tenant_id = get_tenant_id()) | CHECK: -
- tenant_feature_flags | superadmin_delete_tenant_feature_flags | DELETE | {authenticated} | USING: is_platform_admin() | CHECK: -
- tenant_feature_flags | tenant_ff_superadmin_manage | ALL | {authenticated} | USING: is_platform_admin() | CHECK: is_platform_admin()
- tenant_feature_flags | tenant_ff_tenant_read | SELECT | {public} | USING: (tenant_id = get_tenant_id()) | CHECK: -
- tenant_members | superadmin_delete_tenant_members | DELETE | {authenticated} | USING: is_platform_admin() | CHECK: -
- tenant_members | tenant_members_own_read | SELECT | {authenticated} | USING: (user_id = auth.uid()) | CHECK: -
- tenant_members | tenant_members_public_insert | INSERT | {public} | USING: - | CHECK: true
- tenant_members | tenant_members_superadmin_all | ALL | {authenticated} | USING: is_platform_admin() | CHECK: is_platform_admin()
- tenant_members | tenant_members_tenant_read | SELECT | {authenticated} | USING: is_tenant_member(tenant_id) | CHECK: -
- tenants | superadmin_delete_tenants | DELETE | {authenticated} | USING: is_platform_admin() | CHECK: -
- tenants | superadmin_tenants_all | ALL | {authenticated} | USING: is_platform_admin() | CHECK: is_platform_admin()
- tenants | tenants_public_read | SELECT | {public} | USING: true | CHECK: -
- tenants | tenants_staff_update | UPDATE | {public} | USING: (id = get_tenant_id()) | CHECK: -
- waiter_calls | superadmin_delete_waiter_calls | DELETE | {authenticated} | USING: is_platform_admin() | CHECK: -
- waiter_calls | waiter_calls_public_insert | INSERT | {public} | USING: - | CHECK: true
- waiter_calls | waiter_calls_public_read | SELECT | {public} | USING: true | CHECK: -
- waiter_calls | waiter_calls_staff_manage | ALL | {public} | USING: (tenant_id = get_tenant_id()) | CHECK: -
