# Diagnóstico de Tablio — código actual vs. Brief v3

Fecha: 1 de octubre de 2026 · Fase 1 del plan · Solo lectura: no se modificó código ni base de datos.

**Qué revisé:** las 22 migraciones de `supabase/migrations/`, `src/integrations/supabase/types.ts`, las 11 edge functions de `supabase/functions/`, las rutas de `src/App.tsx` y todas las pantallas que escriben en la base. Comparé todo con `ESTADO_LOVABLE.md` y con `docs/vision/TABLIO_BRIEF_v3.md`.

**Qué no pude revisar:** la base de datos en vivo de Lovable Cloud (no tengo acceso). Lo que depende de ella está marcado como **[verificar en la base]**.

---

## 0. Resumen en simple

1. **La base del producto es buena y vale la pena conservarla.** El pago del comensal lo confirma el servidor, que recalcula los precios. Hay reembolsos, conciliación, lealtad, KDS y backoffice. El diseño se mantiene.
2. **La seguridad está muy abierta.** Hoy cualquier persona con conocimientos técnicos básicos puede:
   - **crearse una cuenta de superadministrador de Tablio** (no estaba en la auditoría de Lovable; es lo más grave);
   - meterse como miembro de cualquier local y administrarlo;
   - marcar pedidos como pagados para que salgan en cocina sin pagar;
   - leer pedidos, mesas y personal de todos los locales.
3. **Varias reglas de "la plata" se cumplen solo en la pantalla, no en el servidor.** Por ejemplo, que en prepago cocina no vea lo no pagado es un filtro del navegador del KDS, y el mozo "cierra" una mesa como pagada sin que quede registro del pago.
4. **Hoy no hay daño real**, porque la base es de prueba (1 local, 2 pedidos, 0 pagos reales). Pero **nada de esto puede salir a un local real** antes de terminar la fase 3.
5. **La migración será sencilla**: casi no hay datos que mover y el esquema completo está en el repositorio.

---

## 1. Correcciones al informe de Lovable (`ESTADO_LOVABLE.md`)

| # | El informe dice | Lo que muestra el código | Archivo |
|---|---|---|---|
| 1 | Hay 32 tablas | **Hay 34.** Coinciden `types.ts` y las migraciones | `src/integrations/supabase/types.ts` |
| 2 | No verificó si existe índice único en `payments.idempotency_key` | **Sí existe** (`payments_idempotency_key_uidx`). Pero no evita el doble cobro ni el doble pedido: el cobro y el pedido ocurren *antes* de guardar el pago (ver problema 8) | `20260806075142_...sql:29` |
| 3 | Las funciones de alta de usuarios son "por rol/invitación" | **`create-platform-admin` y `create-jefe-ventas` no verifican nada.** Cualquiera puede crear un superadmin o un jefe de ventas. Ninguna pantalla las usa, pero están publicadas | `supabase/functions/create-platform-admin/index.ts:19-45`, `create-jefe-ventas/index.ts:19-51` |
| 4 | Los PIN de los mozos están en texto plano y son públicos | La columna `pin` existe y es pública, pero **ningún código usa PIN**: el mozo entra con email y contraseña. El "login con PIN" del brief no existe | `20260307214709_...sql:228`, `src/pages/mozo/MozoLoginPage.tsx:32` |
| 5 | `/finanzas/costos` [NV] | **Simulado**: los gastos se guardan solo en el navegador (`localStorage`) y se pierden al cambiar de equipo | `src/pages/finanzas/FinanzasCostosPage.tsx:41-42,81` |
| 6 | `/vendedor/recursos` [NV] | **Solo visual**: no usa la base | `src/pages/seller/SellerRecursosPage.tsx` |
| 7 | MRR "calculado desde el plan" | Peor: **la tabla `plans` no tiene precio**. Los precios ($199.000 piloto y $299.000 comercial) están escritos a mano en 4 archivos y no calzan con el brief ($79.000–$249.000) | `src/pages/finanzas/Finanzas{Revenue,Clientes,Churn,Costos}Page.tsx:9-14` |
| 8 | En prepago, cocina solo ve lo pagado | Es cierto en pantalla, pero **es un filtro del navegador**: la base le entrega al KDS todos los pedidos | `src/pages/KDSPage.tsx:765-770` |
| 9 | ≈32 usos de `error.message` | Son 27, y ~19 llegan al usuario. Uno llega al **comensal** (pantalla de pago) | `src/pages/PayPage.tsx:200-201` |
| 10 | Políticas del Anexo A | **Coinciden exactamente** con las migraciones (las 120). Faltan en el anexo las 4 de Storage (`menu_images_*`), que sí están en las migraciones | `20260309003422_...sql` |
| 11 | "Cuenta abierta" es un modo de la sucursal | En la práctica **el comensal siempre paga antes**, en los dos modos. El modo solo cambia el filtro del KDS y los pedidos manuales del mozo. Además, el valor por defecto de la base es `open_tab` (cuenta abierta) y el brief pide prepago por defecto | `20260806075142_...sql:2` |
| 12 | Datos: "1 pedido pagado, 0 pagos" | No es solo un dato curioso: **hay un pedido pagado sin registro de pago**. Puede venir de la política pública de pedidos o de un error de `process-payment` (ver problema 8). **[verificar en la base]** | — |

---

## 2. Qué ya cumple el producto respecto del brief

| Regla o módulo del brief | Estado | Dónde |
|---|---|---|
| Pago confirmado por el servidor y precios recalculados desde la base (comensal) | ✅ Cumple | `process-payment/index.ts:107-181` |
| El pedido del comensal se crea solo si el cobro se aprueba | ✅ Cumple | `process-payment/index.ts:208` |
| Proveedor de pagos aislado en un archivo | ✅ Cumple (simulado) | `_shared/provider.ts` |
| Precio guardado en el pedido (editar la carta no cambia pedidos hechos) | ✅ Cumple | `order_items.unit_price`, `menu_item_name` |
| Reembolsos con motivo obligatorio, tope y quién lo hizo | ✅ Cumple en la base (sin plata real) | `refund-payment/index.ts:26,64,78` |
| Conciliación diaria por sucursal | 🟡 Parcial: usa días UTC, no la hora de Chile; el cierre se puede reabrir | `reconcile-payments/index.ts:57-58,89` |
| Lealtad por email con consentimiento, sellos o puntos | 🟡 Parcial: sin límites contra abuso y sin verificar el email (ver sección 4) | `process-payment/index.ts:314-419` |
| Un QR por mesa, sesión compartida, tiempo real | ✅ Cumple | `useTableSession.ts`, publicación realtime |
| KDS con sonido, temporizadores, agotados | ✅ Cumple (sin separar por estación) | `KDSPage.tsx` |
| Mozo: tablero por urgencia, tomar/transferir/cerrar mesa | ✅ Existe (con cambios de estado desde el navegador) | `MozoMesasPage.tsx` |
| Upsell en el checkout, sin preselección | ✅ Cumple (automático, no configurable por el dueño) | `CheckoutPage.tsx:96-132` |
| Reportes con CSV | ✅ Cumple (calculados en el navegador) | `src/components/reports/*` |
| Backoffice comercial (vendedor, jefe, finanzas, superadmin) | ✅ Existe | `src/pages/{seller,jefe-ventas,finanzas,superadmin}` |
| Tabla de auditoría | 🟡 Existe `audit_logs`, pero **nadie escribe en ella** | — |
| Reglas 1 a 10 de la sección 4 | ❌ Ver sección 3 y 4: hoy se rompen las reglas 1, 2, 4, 5, 6, 7 y 10 | — |

---

## 3. Problemas de la sección 10 del brief: confirmación con archivo y línea

### 3.1 Cualquier usuario puede agregarse como miembro de cualquier local — ✅ CONFIRMADO

- Política `tenant_members_public_insert` con `WITH CHECK (true)`, para cualquiera, incluso sin sesión: `supabase/migrations/20260308151352_...sql:34-36`.
- Consecuencia: `get_tenant_id()` le devuelve ese local (`20260309045023_...sql:2-13`) y desde ahí puede editar carta, precios, mesas, pedidos y sucursal (todas las políticas `*_staff_manage`).
- **Agravante:** `tenants_staff_update` (`20260307214709_...sql:326`) deja que cualquier miembro cambie **su propio plan y estado de pago** (`plan_status`, `plan_id`, `is_active`). Eso afecta lo que Tablio factura.
- **Agravante:** `is_tenant_member()` no revisa `is_active` (`20260308182620_...sql:13-24`), así que un miembro desactivado sigue viendo pagos y reembolsos.

### 3.2 Cualquiera, sin sesión, puede modificar cualquier pedido, incluso marcarlo como pagado — ✅ CONFIRMADO

- `orders_public_update_status`: `USING (true) WITH CHECK (true)` para todos: `20260319160810_...sql:2-7`. El comentario de la migración explica el motivo: el mozo no usaba sesión de Supabase.
- Lo mismo para sesiones de mesa (`table_sessions_public_update`, `20260319160810_...sql:10-15`) y mesas (`tables_public_update_status`, `20260313143718_...sql:1-6`).
- Efecto en cocina: el KDS muestra un pedido apenas su `payment_status` dice `paid` (`KDSPage.tsx:766-767`). Basta con cambiar ese campo para que se prepare sin pagar.
- Además, `orders_public_insert` y `order_items_public_insert` permiten crear pedidos con **cualquier precio** en una mesa con sesión activa (`20260320030541_...sql:3-25`).

### 3.3 Los PIN de los mozos están en texto plano y son públicos — 🟡 CONFIRMADO CON CORRECCIÓN

- Columna `staff_users.pin text` (`20260307214709_...sql:228`) y lectura pública de toda la tabla `staff_users` (`20260308151352_...sql:39-41`).
- **Corrección:** ningún código lee ni escribe PIN. Los mozos entran con email y contraseña (`MozoLoginPage.tsx:32`). El riesgo depende de si hay PIN cargados en la base. **[verificar en la base]**
- Lo que sí se expone hoy: nombres, roles, local y `auth_user_id` de todo el personal de todos los locales.

### 3.4 Datos de pedidos, mesas y personal se pueden leer entre locales — ✅ CONFIRMADO

Lectura pública total (`USING (true)`) en: `orders` (`20260307214709_...sql:368`), `order_items` (`:373`), `table_sessions` (`:363`), `tables` (`:358`), `bill_requests` (`:378`), `waiter_calls` (`:383`), `tenants` (`:325`, con email, RUT y teléfono del local), `staff_users` (`20260308151352_...sql:39`), `staff_invitations` (`20260308171228_...sql:16`) y `backoffice_invitations` (`20260318051715_...sql:22`).

**Agravante:** las invitaciones públicas exponen el `token`. Con él, cualquiera puede registrarse como mozo de un local (`register-waiter`) o como vendedor de Tablio (`register-seller`). Y como también se pueden *modificar* públicamente (`staff_invitations_public_update`, `backoffice_invitations_public_update`), se puede extender su vencimiento o "reactivarlas".

### 3.5 La creación de usuarios de un local no verifica quién la pide — ✅ CONFIRMADO (y es peor)

- `create-tenant-user/index.ts:19-26` solo revisa que exista el encabezado `Authorization`. La app siempre lo manda con la clave pública, así que cualquiera pasa.
- Con eso se puede crear un usuario con email confirmado y **meterlo en cualquier local** (`:72-93`). Si el email ya existe, mete a ese usuario existente en el local que se pida.
- `listUsers()` sin paginar (`:47`): falla cuando haya más de 50 usuarios.
- Devuelve mensajes de error técnicos en inglés (`:65`, `:102`).

### 3.6 Cocina, dueño y mozo cambian estados de pedido desde el navegador — ✅ CONFIRMADO

| Quién | Qué cambia | Dónde |
|---|---|---|
| Cocina (KDS) | estado del pedido | `src/pages/KDSPage.tsx:728` |
| Cocina (KDS) | marca el producto agotado | `src/pages/KDSPage.tsx:741-744` |
| Dueño | avanza y cancela pedidos | `src/pages/admin/PedidosPage.tsx:217, 226, 235-238` |
| Mozo | **estados de cocina** (`in_kitchen`, `ready`): contradice "el mozo no cambia estados de cocina" | `src/pages/mozo/MozoNotificacionesPage.tsx:258-264` |
| Mozo | cierra la mesa: marca la cuenta `paid`, cierra la sesión, marca todo `delivered` y libera la mesa | `MozoNotificacionesPage.tsx:245-248`, `MozoMesasPage.tsx:246-249` |
| Comensal | pone la mesa en `waiting_bill` y califica la sesión | `src/pages/BillPage.tsx:277`, `TrackingPage.tsx:395` |

**Agravante importante para la plata:** cuando el mozo cierra la mesa, la cuenta queda `paid` **sin crear ningún pago** y sin marcar los pedidos como pagados. En cuenta abierta, la plata cobrada por el mozo no queda registrada en ningún lado y la caja no cuadra.

### 3.7 El pedido manual del mozo usa precios del navegador — ✅ CONFIRMADO

- Total calculado en el navegador: `src/pages/mozo/MozoPedidoManualPage.tsx:109`.
- Inserta sesión, pedido y productos directo desde el navegador: `:126-134, 151-184`.
- Número de pedido calculado contando pedidos (`:145-149`): dos pedidos simultáneos pueden repetir número.
- Ignora los modificadores (no hay forma de agregar "sin hielo", "extra queso").
- La "llamada falsa" `supabase.rpc("get_tenant_id") // dummy` está en `:187`.

### 3.8 Falta confirmar que un mismo pago no pueda registrarse dos veces en la base — 🟡 CORREGIDO: la protección existe, pero llega tarde

- **Sí existe** el índice único `payments_idempotency_key_uidx` (`20260806075142_...sql:29`).
- **El problema es el orden** en `process-payment/index.ts`:
  1. Revisa si la clave ya existe (`:50-57`).
  2. **Cobra** (`:204`).
  3. **Crea el pedido pagado** (`:208-266`).
  4. Recién ahí guarda el pago (`:269-294`).

  Si llegan dos solicitudes iguales al mismo tiempo, las dos pasan el paso 1, **las dos cobran** y **las dos crean pedido** (cocina prepara doble). El índice solo hace fallar el segundo guardado del pago, cuando ya es tarde. Con el simulador no se nota; con una pasarela real sería un doble cobro.
- Otros riesgos del mismo flujo:
  - Si falla el guardado de productos (`:241`), queda un pedido pagado sin productos.
  - Si falla el guardado del pago (`:291-294`), queda un pedido pagado sin pago (posible origen del dato raro de la base).
  - `order_number` se calcula contando (`:209-221`), así que dos pagos simultáneos pueden repetir número.
  - Los montos de sesión, lealtad y popularidad se leen y reescriben sin bloqueo (`:244-247, 254-265, 308-312`): se pierden sumas si dos personas pagan al mismo tiempo.
- Reembolsos: dos reembolsos simultáneos del mismo pago pueden superar el monto pagado (`refund-payment/index.ts:60-99`, sin bloqueo).

### 3.9 El chat de soporte depende de la IA de Lovable — ✅ CONFIRMADO

- Llama a `https://ai.gateway.lovable.dev` con `LOVABLE_API_KEY` y el modelo `google/gemini-3-flash-preview`: `supabase/functions/support-chat/index.ts:37-54`.
- **Agravante:** no verifica quién llama. La pantalla solo manda la clave pública (`src/pages/admin/SoportePage.tsx:15-19`), así que cualquiera puede usar el chat y gastar el saldo de IA.
- La pantalla espera las respuestas en formato "OpenAI" (`SoportePage.tsx:41-46`), lo que importa para el reemplazo (ver `PLAN_MIGRACION.md`).

### 3.10 Dos logins, código sin usar, estados mezclados y errores técnicos — ✅ CONFIRMADO

- **Dos logins:** `/mozo/login` (`MozoLoginPage.tsx`) y el unificado (`UnifiedLoginPage.tsx`). Además `AdminLoginPage.tsx` existe sin ruta.
- **Código sin usar:** ver sección 6.
- **Estados en inglés:** pedidos `confirmed/in_kitchen/ready/delivered/cancelled`, mesas `free/occupied/waiting_bill/paying`, pagos `approved/failed/refunded`. Etapas de leads en español (`contactado`, `demo_agendada`). En `PedidosPage.tsx:218` el dueño ve "Pedido #12 → in_kitchen".
- **Errores técnicos al usuario:** 27 usos de `error.message`. Llegan a pantalla, por ejemplo, en `PayPage.tsx:200-201` (comensal), `MenuAdminPage.tsx:146,152,228,267,270`, `LealtadPage.tsx:115`, `SoportePage.tsx:107`, `MesasPage.tsx:118`, `ImageUploadField.tsx:41`, `SAConfigPage.tsx:71`, `SAEquipoPage.tsx:88`, `JVPerfilPage.tsx:26,36` y `BackofficeVendedores.tsx:115,121,139`. También en las edge functions de alta de usuarios.

---

## 4. Problemas nuevos que no están en la sección 10

Ordenados por gravedad. Propongo sumarlos a la fase 3.

| # | Problema | Gravedad | Dónde |
|---|---|---|---|
| N1 | **Cualquiera puede crear un superadministrador de Tablio** (o un jefe de ventas). Con eso ve y borra todos los locales | 🔴 Crítico | `create-platform-admin/index.ts:19-45`, `create-jefe-ventas/index.ts:19-51` |
| N2 | El panel del mozo confía en un dato del navegador (`sessionStorage.mozo_staff`). Con las políticas públicas actuales, cualquiera puede operar mesas sin iniciar sesión | 🔴 Alto | `src/contexts/WaitersContext.tsx:33-41` |
| N3 | La suplantación del superadmin es un dato del navegador (`sessionStorage.superadmin_impersonating`), **no queda registrada** (rompe la regla 7) y salta la verificación de acceso en el panel del dueño | 🔴 Alto | `src/contexts/AdminContext.tsx:39-42, 75-78`, `SATenantsPage.tsx:211` |
| N4 | ✅ **Resuelto en la fase 1.3** (los sellos van ligados a la cuenta verificada del cliente). **Robo de premios de lealtad:** `loyalty-status` entrega los premios de cualquier email sin verificarlo, y `process-payment` permite canjear un premio con solo poner ese email. Además la búsqueda usa `ilike`, así que un email con `%` puede coincidir con otros clientes | 🟠 Alto | `loyalty-status/index.ts:38-53`, `process-payment/index.ts:329-334, 369-379` |
| N5 | **Sellos sin límite:** se suma una visita por cada pago. Diez pagos de $1.000 son diez visitas. El brief exige límites | 🟠 Medio | `process-payment/index.ts:343` |
| N6 | **Modificadores inventados:** si el navegador manda un modificador que no existe, se cobra $0 pero llega igual a cocina. Tampoco se validan los modificadores obligatorios | 🟠 Medio | `process-payment/index.ts:160-166` |
| N7 | El servidor no revisa si el local está activo, si la sucursal está abierta ni si la categoría está en su horario antes de cobrar | 🟠 Medio | `process-payment/index.ts:59-65` |
| N8 | Los roles no se distinguen en la base: un mozo (miembro del local) puede cambiar precios, el modo de pago de la sucursal o marcar pedidos como pagados | 🟠 Medio | todas las políticas `*_staff_manage` |
| N9 | El cierre de caja usa días en UTC: una noche de bar (20:00 a 03:00 de Chile) queda partida en dos días | 🟠 Medio | `reconcile-payments/index.ts:57-58` |
| N10 | Un cierre de caja ya cerrado se puede reabrir y sobrescribir. Y cualquier miembro del local, incluido un mozo, puede cerrar caja | 🟠 Medio | `reconcile-payments/index.ts:53, 77-95` |
| N11 | `get_tenant_id()` usa `LIMIT 1` sin orden: si un usuario pertenece a dos locales, el sistema elige uno al azar | 🟡 Bajo hoy | `20260309045023_...sql:12` |
| N12 | Apple Pay y Google Pay: el navegador pide el pago, pero al servidor solo le llega el nombre del método, no el comprobante. Con pasarela real hay que rehacer esta parte | 🟡 Fase 9 | `CheckoutPage.tsx:164-179`, `src/lib/walletPayment.ts` |
| N13 | El archivo `.env` está subido al repositorio. Solo trae la clave pública (no es grave), pero conviene sacarlo | 🟡 Bajo | `.env` |
| N14 | La política `backoffice_members_jefe_update` consulta la misma tabla que protege. Puede dar el error de "recursión infinita" al editar | 🟡 Bajo | `20260327024211_...sql:12-19` |
| N15 | El comensal ve `err.message` en la pantalla de pago (rompe la regla 10) | 🟡 Bajo | `PayPage.tsx:200-201` |
| N16 | ✅ **Resuelto en la fase 1.2.** **El mozo tenía que entrar dos veces.** Al entrar por el login principal, `MozoLayout` muestra la redirección a `/mozo/login` en el primer dibujo de la pantalla, antes de que alcance a revisar la sesión. Detectado por Playwright al migrar | 🟡 Medio | `src/pages/mozo/MozoLayout.tsx:146-154` (el estado `autoLogging` parte en `false`) |

---

## 5. Qué falta, ordenado por las fases de la sección 11

### Fase 2 — Migración
- Todo está pendiente. El plan está en `docs/PLAN_MIGRACION.md`.
- También salir de Lovable en el frontend: plugins de Lovable en `vite.config.ts:4` y `package.json:76-77,91`, `previewAuthStorage.ts`, metadatos de `index.html:11-21` y `README.md`.

### Fase 3 — Seguridad urgente
- Los 10 problemas de la sección 10 y los nuevos N1 a N4, N8 y N13.
- Darle al mozo una sesión real de Supabase. Hoy no la necesita porque todo es público; al cerrar las políticas, la necesitará.
- Ojo: al cerrar la lectura pública, el **seguimiento en vivo del comensal** (`TrackingPage`) y el **KDS** dejan de recibir actualizaciones. Hay que darles un camino seguro (vista limitada por sesión de mesa o función de servidor).

### Fase 4 — Orden
- Un solo login (eliminar `/mozo/login` y `AdminLoginPage.tsx`).
- Un solo mecanismo para resolver el rol (hoy cada panel lo hace a su manera: `AdminContext`, `MozoLayout`, `SellerContext`, `JefeVentasContext`, `SuperAdminContext`, `FinanzasLayout`, `KDSPage:364-419`).
- Una sola capa de traducción de estados para las pantallas. Los estados se quedan en inglés dentro de la base (decisión del 1 de octubre de 2026).
- Un solo ayudante de mensajes de error en español.
- Borrar el código sin usar (sección 6).
- Separar entornos: base de prueba y base de producción.

### Fase 5 — Blindar la plata
| Requisito del brief | Hoy |
|---|---|
| Cotización con precio congelado y vencimiento | ❌ No existe (se recalcula al cobrar) |
| Idempotencia reservada antes de cobrar | ❌ (problema 8) |
| Cambios de estado por el servidor | ❌ (problema 6) |
| Código de presencia de 4 dígitos en la mesa | ❌ No existe |
| Rol cajero separado | ❌ No existe (la caja está en el panel del dueño) |
| Cierre de turno bloqueado | ❌ Se puede reabrir (N10) |
| KDS separado por estación (barra / cocina) | ❌ No hay concepto de estación en la base |
| Estado del pedido por estación para el comensal | ❌ |
| Prepago como modo por defecto | ❌ El valor por defecto es `open_tab` |
| "Pagar con el mozo" con aviso de que no está pagado | ❌ No existe para el comensal |
| Riesgo de cuenta abierta visible para el dueño | ❌ No existe |
| Registrar el pago cuando el mozo cierra una mesa en cuenta abierta | ❌ (problema 6) |
| El KDS muestra si está conectado y la hora de la última actualización | ❌ [verificar en pantalla] |

### Fase 6 — Control del equipo (módulo 6.1)
- Ya existen: `tables.assigned_waiter_id` (solo el mozo *actual*, sin historial), los tiempos `kitchen_accepted_at/ready_at/delivered_at` en pedidos (escritos por el navegador, sin el reloj del servidor) y `table_sessions.rating` (sin atribución al mozo).
- Falta todo lo demás: turnos, atribución histórica, registro de eventos con hora del servidor, ranking, metas por mozo, tiempos objetivo, alertas de abandono, productividad de cocina y mapa de calor.

### Fase 7 — Más ventas (módulo 6.2)
- Sellos y puntos: base existente, sin límites ni verificación de email (N4, N5).
- Upsell: existe, automático; falta que el dueño lo configure.
- Faltan: "lo de siempre", clientes dormidos, happy hour, invitar un trago, saldo prepagado y giftcard, y propina por mozo.
- Faltan los interruptores por local para activar cada función (hay `feature_flags` y `tenant_feature_flags`, pero no se usan para esto).

### Fase 8 — Backoffice
- Facturación de suscripciones: no existe. `plans` no tiene precio.
- Costos: solo en el navegador.
- MRR, churn y cohortes: estimados con precios fijos en el código.
- Cobro automático a los locales: no existe.
- Saldo prepagado por local para el superadmin: no existe (el saldo prepagado tampoco).

### Fase 9 — Dinero real
- Pasarela real, boleta electrónica (SII), impresora: nada existe. El adaptador `_shared/provider.ts` está listo para recibir la pasarela.
- Webhooks de la pasarela: no existen (hoy el cobro es inmediato y simulado).

### Fase 10 — Nuevos negocios
- Modo mostrador, eventos y reservas: nada existe.
- El modelo de datos asume mesas: `orders.table_id` y `session_id` son obligatorios. Hay que hacerlos opcionales o agregar un "punto de venta" genérico para el mostrador.

---

## 6. Inconsistencias y código sin usar

### Archivos que nadie importa (seguros de borrar en la fase 4, previa confirmación)
| Archivo | Líneas |
|---|---|
| `src/pages/Index.tsx` | 189 |
| `src/pages/admin/AdminLoginPage.tsx` | 134 |
| `src/pages/admin/AdminGlobalPage.tsx` | 87 |
| `src/pages/backoffice/BackofficeDashboard.tsx` | 268 |
| `src/pages/backoffice/BackofficeLayout.tsx` | 163 |
| `src/pages/backoffice/BackofficeVendedores.tsx` | 392 |
| `src/components/NavLink.tsx` | 29 |
| 25 componentes de `src/components/ui/` sin uso | (plantilla de shadcn; no molestan) |

`BackofficePipeline.tsx` y `BackofficeJoinPage.tsx` **sí se usan** (desde jefe de ventas y la ruta de invitación).

### Edge functions publicadas que ninguna pantalla usa
- `create-platform-admin` y `create-jefe-ventas`: sin uso y **peligrosas** (N1). No se publican en el proyecto nuevo (fase 2) y se borran del repositorio en el paso 3.1.

### Otras inconsistencias
- **Roles con nombres distintos:** `tenant_members.role` usa `owner`, `admin`, `staff` y `waiter`. `create-tenant-user` crea `staff`, `register-waiter` copia el rol de la invitación (`waiter`). `refund-payment` solo acepta `owner`/`admin`. `has_staff_role()` existe y no se usa.
- **Dos tablas de personal:** `staff_users` y `tenant_members` guardan casi lo mismo. Una migración las sincronizó una sola vez (`20260319151617_...sql`). Si la segunda inserción falla en `register-waiter/index.ts:117-120`, queda un mozo que no puede operar.
- **Migración que borra datos:** `20260309050435_...sql` borra todos los pedidos. Es inofensiva en una base nueva, pero no debe volver a correr sobre datos reales.
- **Política eliminada que no existe en el repositorio:** `backoffice_members_jefe_read_v2` se borra en `20260328030145_...sql:22`, pero nunca se crea en ninguna migración. Señal de que alguna vez se tocó la base a mano. **[verificar en la base que no haya más diferencias]**
- **Precios de planes** fijos en 4 archivos de finanzas y distintos del brief.
- **Reportes y finanzas** se calculan en el navegador descargando todos los datos. Escala mal.
- **El comensal no puede pedir sin pagar** en ningún modo, y la pantalla de sucursal dice "Cuenta abierta: piden libremente y pagan al final" (`SucursalPage.tsx:151`). Lo que promete la pantalla no calza con lo que hace la app.
- **Tests:** solo existe `src/test/example.test.ts`, que no prueba nada.
- **Compilación verificada** al empezar la fase 2: `npm run build` pasa. El revisor de estilo marca 153 avisos (124 errores, 29 advertencias) heredados de Lovable. `package-lock.json` está desactualizado respecto de `package.json`; `bun.lock` es el correcto.

---

## 7. Lo que hay que verificar en la base en vivo (al empezar la fase 2)

1. Si hay PIN cargados en `staff_users.pin`.
2. El origen del pedido marcado `paid` sin registro en `payments`.
3. Que no haya políticas, funciones o columnas creadas a mano fuera de las migraciones (comparar el esquema real con el repositorio).
4. La configuración de Auth: correos, URLs de redirección y proveedores.
5. La configuración `verify_jwt` de cada edge function (no está en `supabase/config.toml`).
6. Qué archivos hay en el bucket `menu-images`.
