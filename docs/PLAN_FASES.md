# Plan por fases — Tablio

Basado en la sección 11 del brief y en `docs/DIAGNOSTICO.md`.

**Cómo leer las estimaciones:** son **días de trabajo** de desarrollo con Claude Code, contando las pruebas. No son días de calendario. A eso se suma tu tiempo para probar y aprobar, y la espera por decisiones o servicios externos (pasarela, boleta, asesores). Son aproximadas y se ajustan al terminar cada fase.

**Regla general:** cada paso deja la app funcionando, se prueba antes de darlo por listo y queda anotado en `docs/BUILD_LOG.md`. Las fases 9 y 10 pueden adelantarse si un cliente real lo necesita, **nunca antes de terminar la fase 3**.

| Fase | Qué | Estimación |
|---|---|---|
| 1 | Diagnóstico | ✅ Terminada |
| 2 | Migración a Supabase propio | 1–2 días · **en curso** (paso 0 hecho) |
| 3 | Seguridad urgente | 10–12 días |
| 4 | Orden | 3–5 días |
| 5 | Blindar la plata | 10–14 días |
| 6 | Control del equipo | 8–10 días |
| 7 | Más ventas | 15–20 días |
| 8 | Backoffice | 8–12 días |
| 9 | Dinero real | 12–20 días + trámites |
| 10 | Nuevos negocios | 25–35 días |

Hasta tener un producto seguro para un primer local real (fases 2 a 5): **unas 5 a 7 semanas de trabajo.**

---

## Fase 1 — Diagnóstico ✅

- [x] `CLAUDE.md`, `docs/DIAGNOSTICO.md`, `docs/PLAN_MIGRACION.md` y este plan.

---

## Fase 2 — Migración (1–2 días)

Detalle completo en `docs/PLAN_MIGRACION.md`. Regla: **tal cual, sin corregir nada.**

| # | Paso | Estimación |
|---|---|---|
| 2.1 | ✅ Congelar Lovable, marcar el punto de partida en git y comprobar que la app compila | 0,5 h |
| 2.2 | Pedir la exportación a Lovable (tú, con el mensaje listo) · pedida | espera |
| 2.3 | Crear el proyecto Supabase en São Paulo (lo creas tú y me das acceso por el conector) | 0,5 h |
| 2.4 | Aplicar las 22 migraciones y comparar tipos, políticas y esquema real | 1 h |
| 2.5 | Recrear usuarios con el mismo identificador | 1 h |
| 2.6 | Cargar datos y comparar conteos | 1 h |
| 2.7 | Copiar las fotos del menú y actualizar sus direcciones | 0,5 h |
| 2.8 | Publicar las edge functions **excepto `create-platform-admin` y `create-jefe-ventas`** y cambiar el chat a Claude Haiku 4.5 | 1–2 h |
| 2.9 | Configurar Auth | 0,5 h |
| 2.10 | Apuntar la app a la base nueva y publicarla en Vercel, con el comando de instalación fijado en `bun install --frozen-lockfile` (así no hay dudas sobre qué archivo de versiones usa, aun antes del paso 4.8) | 1 h |
| 2.11 | Comprobación pantalla por pantalla, contigo | 2–3 h |
| 2.12 | Desconectar Lovable de GitHub, crear `DEMO_ACCESS.md` y completar `BUILD_LOG.md` | 0,5 h |

**Terminado cuando:** toda la lista de la sección 5 del plan de migración da el mismo resultado antes y después.

**Decidido:** Supabase propio (plan gratis, São Paulo), Vercel y Claude Haiku 4.5. **Única excepción a "tal cual":** las dos funciones de alta de superadmin y jefe de ventas no se publican.

---

## Fase 3 — Seguridad urgente (10–12 días)

Cierra los problemas de la sección 10 del brief más los nuevos N1–N4, N8, N13 y N15 del diagnóstico. El problema 10 (orden general) va en la fase 4.

**Idea central:** la base deja de confiar en el navegador. Lo que hoy es público pasa a ser (a) de quien inició sesión en ese local, o (b) una función de servidor que valida el QR de la mesa.

| # | Paso | Problema que cierra | Estimación |
|---|---|---|---|
| 3.1 | **Borrar del repositorio `create-platform-admin` y `create-jefe-ventas`** (ya no se publicaron en la fase 2; nadie las usa) | N1 🔴 | 0,5 h |
| 3.2 | `create-tenant-user` exige ser dueño o admin de *ese* local, o superadmin. Búsqueda de usuarios paginada. Errores en español | 5 | 0,5 día |
| 3.3 | Quitar el alta pública en `tenant_members`. Solo el servidor o el superadmin agregan miembros | 1 | 0,5 día |
| 3.4 | `is_tenant_member()` revisa `is_active`. `get_tenant_id()` deja de elegir al azar | 1, N11 | 0,5 día |
| 3.5 | **Roles en la base:** dueño/admin, mozo, cocina y (luego) cajero, cada uno con sus permisos. El mozo no edita precios ni la sucursal. Los campos de plan del local solo los cambia el superadmin | N8, 1 | 1 día |
| 3.6 | **El mozo usa su sesión real** (ya entra con email y contraseña), no el dato guardado en el navegador | N2 | 0,5 día |
| 3.7 | **Cambios de estado por funciones de servidor:** avanzar pedido (solo cocina y dueño), cancelar con motivo (solo dueño), entregar (mozo), cerrar mesa (mozo, verificando lo pagado), marcar agotado (cocina). Cada uno valida rol y local y deja la hora del servidor | 6 | 2 días |
| 3.8 | **Pedido manual del mozo por el servidor**, con precios y modificadores desde la base | 7 | 0,5 día |
| 3.9 | **Pagos sin doble cobro:** reservar la clave de idempotencia *antes* de cobrar, y crear pedido, productos y pago en una sola operación de base (todo o nada). Número de pedido único por sucursal. Reembolsos con bloqueo | 8 | 1,5 días |
| 3.10 | **Cerrar escrituras públicas** en pedidos, sesiones, mesas e invitaciones. Las acciones del comensal (llamar al mozo, pedir la cuenta, calificar) pasan a funciones que validan el QR de la mesa | 2 | 1 día |
| 3.11 | **Cerrar lecturas públicas.** El comensal ve solo su mesa, mediante funciones validadas por QR. Del local solo se publica lo que necesita la carta (nombre, colores, logo). Personal e invitaciones dejan de ser públicos. **El tiempo real del comensal y del KDS se rehace sobre esto, sin que se pierda el "en vivo"** | 3, 4 | 1,5 días |
| 3.12 | PIN: borrar la columna en texto plano (hoy nadie la usa). El login con PIN del brief se construye con PIN cifrado en la fase 5 | 3 | 0,5 h |
| 3.13 | Suplantación de soporte registrada en el servidor: quién, cuándo, a qué local y por qué (motivo obligatorio) | N3, regla 7 | 0,5 día |
| 3.14 | Lealtad: búsqueda exacta del email (sin comodines), sin mostrar premios a cualquiera, canje solo con verificación | N4 | 0,5 día |
| 3.15 | Chat de soporte: solo para usuarios con sesión, con límite de uso | 9 (resto) | 0,5 h |
| 3.16 | Sacar `.env` del repositorio. El comensal nunca ve `error.message` | N13, N15 | 0,5 h |
| 3.17 | **Pruebas de seguridad automáticas:** un set que intenta cada ataque del diagnóstico como anónimo, como mozo, como dueño de otro local y como superadmin. Tiene que fallar todo lo que debe fallar. Se corre en cada cambio futuro | todos | 1 día |

**Terminado cuando:** las pruebas de 3.17 pasan y la lista de la fase 2 sigue funcionando igual para el usuario.

---

## Fase 4 — Orden (3–5 días)

| # | Paso | Estimación |
|---|---|---|
| 4.1 | **Un solo login** para todos los roles. Se eliminan `/mozo/login` y `AdminLoginPage` | 0,5 día |
| 4.2 | **Una sola forma de saber quién es el usuario y qué rol tiene**, en vez de seis distintas (dueño, mozo, vendedor, jefe, superadmin, finanzas y KDS) | 1 día |
| 4.3 | **Una sola capa de traducción de estados** para las pantallas: los estados siguen en inglés dentro de la base (`confirmed`, `in_kitchen`, `waiting_bill`...) y el usuario siempre los ve en español. Renombrarlos en la base obligaría a tocar funciones, filtros y tiempo real, con riesgo de romper algo, y el resultado para el usuario sería el mismo | 0,5 día |
| 4.4 | Un solo ayudante de mensajes de error en lenguaje simple. Se reemplazan los 27 `error.message` | 0,5 día |
| 4.5 | Borrar el código sin usar (7 archivos) y sacar los plugins y textos de Lovable (`vite.config.ts`, `index.html`, `README.md`) | 0,5 día |
| 4.6 | Unificar `staff_users` y `tenant_members`, o dejar clara la función de cada una | 0,5–1 día |
| 4.7 | **Separar entornos:** proyecto de pruebas y proyecto de producción | 0,5 día |
| 4.8 | **Un solo gestor de dependencias: bun** (es el que está al día). Borrar los archivos de versiones desactualizados: `package-lock.json` (npm, sin cambios desde marzo de 2026) y `bun.lockb` (formato viejo de bun, de la plantilla original). Dejar solo `bun.lock`. Confirmar en Vercel que instala con bun (`bun install --frozen-lockfile`) y que el resultado es igual al local. Actualizar los comandos de `CLAUDE.md` | 0,5 h |

**Terminado cuando:** hay un solo login, ninguna pantalla muestra un estado o mensaje en inglés y la app compila sin código muerto.

---

## Hito — Dominio definitivo (antes de imprimir cualquier QR real)

**Por qué importa:** cada QR guarda la dirección completa de la app (`https://<dominio>/<local>/menu?t=…`). Si después se cambia el dominio, **todos los QR impresos dejan de funcionar** y hay que reimprimirlos en cada local. El dominio también se usa en los correos de "olvidé mi contraseña" y en los links de invitación.

**Qué hay que hacer (1 a 2 días de calendario, menos de 1 hora de trabajo):**
1. Elegir y comprar el dominio (por ejemplo `tablio.cl` en NIC Chile; un `.cl` puede tardar hasta un día hábil en quedar activo).
2. Conectarlo a Vercel (DNS) y esperar a que tome.
3. Actualizar en Supabase la URL del sitio y las direcciones de retorno de Auth.
4. Imprimir un QR de prueba y comprobarlo en un celular.

**Cuándo decidirlo:**
- **Lo ideal:** durante la fase 2, para conectarlo al publicar en Vercel. Así todas las pruebas de las fases 3 a 5 se hacen ya con la dirección definitiva.
- **Último momento razonable: al empezar la fase 5.** En esa fase se crea el código de presencia de 4 dígitos (paso 5.2), que va impreso en la misma tarjeta de mesa que el QR. Conviene diseñar e imprimir la tarjeta una sola vez, con dominio y código, antes de instalar el primer local piloto. Al ritmo estimado, eso es **dentro de unas 3 a 4 semanas de trabajo**.
- **Nunca después de imprimir el primer QR para un local real.**

Te aviso cuando estemos a un paso de ese plazo.

---

## Fase 5 — Blindar la plata (10–14 días)

| # | Paso | Estimación |
|---|---|---|
| 5.1 | **Cotización con precio congelado:** al ir a pagar, el servidor crea una cotización (productos, precios, propina, total) que vence en pocos minutos. El pago cobra exactamente esa cotización. Si cambia un precio, quien ya estaba pagando no se ve afectado | 2 días |
| 5.2 | **Código de presencia de 4 dígitos** impreso en la mesa (se puede renovar). Sin código no se puede pedir ni pagar. **Requiere el dominio definitivo** (hito anterior): QR y código se imprimen juntos | 1 día |
| 5.3 | **Prepago por defecto** en sucursales nuevas, y el filtro "cocina solo ve lo pagado" pasa a la base (no solo a la pantalla) | 0,5 día |
| 5.4 | **Estaciones (barra / cocina):** cada categoría o producto va a una estación. Cada KDS ve solo la suya. El comensal ve el estado por estación ("tu cerveza está lista, la comida sigue en cocina") | 2 días |
| 5.5 | KDS robusto: indicador de conexión, hora de la última actualización y recuperación completa al volver internet | 1 día |
| 5.6 | **Rol cajero** con su propio panel: abrir y cerrar turno, mesas en vivo, excepciones (pago sin pedido, monto que no calza) y reembolsos con motivo | 2 días |
| 5.7 | **Cierre de turno bloqueado:** una vez cerrado, nadie lo edita. Los días de caja usan la hora de Chile (una noche de bar no se parte en dos) | 1 día |
| 5.8 | **Cuenta abierta bien hecha:** "pagar con el mozo" con aviso claro de que no está pagado; el cobro del mozo (efectivo o POS) queda registrado como pago; el dueño ve cuánto está arriesgando y cuánto pierde por mesas que se van sin pagar | 1,5 días |
| 5.9 | **Login del mozo con PIN** (cifrado, con bloqueo tras intentos fallidos) y elección de zona | 1 día |
| 5.10 | **Registro de auditoría automático** de reembolsos, anulaciones, cambios de precio y cierres | 0,5 día |
| 5.11 | **Pruebas de los casos difíciles:** pago repetido, pago tardío (cotización vencida), dos personas pagando el último producto, reembolso doble y corte de internet en el KDS | 1 día |

**Terminado cuando:** las pruebas de 5.11 pasan y un local podría operar una noche completa en modo prueba con la caja cuadrada.

---

## Fase 6 — Control del equipo (8–10 días)

| # | Paso | Estimación |
|---|---|---|
| 6.1 | **Turnos de mozo:** abrir y cerrar, con sucursal y duración | 1 día |
| 6.2 | **Registro de eventos:** cada cambio de estado de un pedido, con la hora del servidor y quién lo hizo | 1 día |
| 6.3 | **Atribución histórica:** mesa, pedido, entrega y propina asociados al mozo, aunque la mesa se cierre o se transfiera | 1 día |
| 6.4 | **Tiempos objetivo** configurables por local (llamado, entrega) con semáforo | 1 día |
| 6.5 | **Alertas de abandono:** pedido listo sin entregar después de X minutos | 0,5 día |
| 6.6 | Calificación del comensal atribuida al mozo que cerró la mesa | 0,5 día |
| 6.7 | **Ranking por período** y **metas por mozo**, con su avance visible en el panel del mozo | 1,5 días |
| 6.8 | Productividad de cocina por producto y categoría | 1 día |
| 6.9 | Mapa de calor de horas | 1 día |
| 6.10 | Inicio del dueño "en lenguaje simple" ("anoche vendiste…") y reportes calculados en el servidor | 1 día |

---

## Fase 7 — Más ventas (15–20 días)

Todo viene **desactivado** y el dueño lo activa por local. Orden según el brief: primero lo de más impacto y menos riesgo.

| # | Paso | Estimación |
|---|---|---|
| 7.1 | Interruptores por local para cada función (sobre `feature_flags`) | 0,5 día |
| 7.2 | **Upsell configurable** por el dueño (hoy es automático) | 1,5 días |
| 7.3 | **"Lo de siempre":** el cliente recurrente pide su pedido habitual con un toque (requiere consentimiento) | 2 días |
| 7.4 | **Happy hour dinámico:** un toque o por horario, aparece al instante. Quien ya estaba pagando conserva su precio (usa la cotización de 5.1) | 2,5 días |
| 7.5 | **Sellos y puntos con límites contra abuso:** una visita por día y por local, solo con pago confirmado | 1 día |
| 7.6 | **Propina por mozo:** el cliente elige a quién va. Tablio informa, no reparte | 1,5 días |
| 7.7 | **Clientes dormidos** e invitaciones con consentimiento (requiere proveedor de correo: decisión tuya) | 2 días |
| 7.8 | **Invitar un trago** a otra mesa, con devolución automática si nadie lo reclama | 2,5 días |
| 7.9 | **Saldo prepagado y giftcard**, al final: deuda del local con el cliente, tope por cliente, carga separada del bono y saldo que sobrevive si el local se suspende. **No se activa con plata real sin asesoría tributaria y legal** | 4–5 días |

---

## Fase 8 — Backoffice (8–12 días)

| # | Paso | Estimación |
|---|---|---|
| 8.1 | Planes con precio real en la base (hasta 12, 13–30 y 31–60 mesas, y personalizado), según la sección 8 del brief | 0,5 día |
| 8.2 | **Facturación de suscripciones:** suscripciones, cobros y facturas a cada local | 2 días |
| 8.3 | **MRR, churn y cohortes calculados desde cobros reales**, no desde precios fijos en el código | 1,5 días |
| 8.4 | **Tabla de costos** en la base (hoy solo vive en el navegador) | 1 día |
| 8.5 | **Cobro automático mensual:** aviso previo, reintentos, período de gracia y **nunca cortar el servicio en medio de una noche de operación**. Requiere elegir cómo se le cobra a los locales | 3–4 días |
| 8.6 | Superadmin: saldo prepagado de cada local con alerta si un local con saldo deja de pagar (depende de 7.9) | 1 día |
| 8.7 | Vendedor: metas personales y material de apoyo en la base (hoy es solo visual) | 1 día |

---

## Fase 9 — Dinero real (12–20 días + trámites)

Cada servicio externo necesita tu aprobación. Varias cosas dependen de terceros.

| # | Paso | Estimación |
|---|---|---|
| 9.1 | **Elegir pasarela** (Transbank, Mercado Pago u otra) con la plata yendo directo a la cuenta del local (regla 9) | decisión tuya |
| 9.2 | Conectar la pasarela en `_shared/provider.ts`, más **webhooks idempotentes** (una confirmación repetida no cobra ni produce dos veces) | 4–6 días |
| 9.3 | Apple Pay y Google Pay reales (hoy al servidor solo le llega el nombre del método) | 1–2 días |
| 9.4 | Reembolsos reales por la pasarela y conciliación contra lo que liquida la pasarela | 1–2 días |
| 9.5 | **Boleta electrónica (SII)** por proveedor autorizado: exactamente una boleta por venta, con reintentos si falla | 3–5 días |
| 9.6 | **Impresora** de barra o cocina | 2–4 días |
| 9.7 | Correo transaccional (boletas, recuperación de contraseña a escala) | 1 día |
| 9.8 | Asesorías: tributaria (saldo prepagado, propinas), legal (Ley 21.719 de datos personales, vigente desde diciembre de 2026) | externo |
| 9.9 | Derecho a borrar datos personales (Ley 21.719) | 1 día |

---

## Fase 10 — Nuevos negocios (25–35 días)

Antes de empezar: pedidos sin mesa obligatoria (punto de venta genérico), porque hoy `orders.table_id` es obligatorio.

| # | Paso | Estimación |
|---|---|---|
| 10.1 | Pedido sin mesa (mostrador, barra de evento) | 1–2 días |
| 10.2 | **Cafeterías:** modo mostrador con número de retiro y aviso al celular. Sellos y "lo de siempre" como funciones principales | 5–7 días |
| 10.3 | **Eventos:** entradas con consumo incluido, barras múltiples con fila digital, canje con QR personal y reportes por evento | 10–14 días |
| 10.4 | **Reservas:** día, hora y personas; abono opcional que se descuenta; recordatorio; apertura automática de la mesa al llegar; política de no presentación | 8–10 días |

---

## Decisiones y cuándo hacen falta

| Decisión | Hace falta en |
|---|---|
| ~~Cuenta de Supabase y acceso para Claude Code~~ | ✅ Decidido: Supabase propio, plan gratis, São Paulo |
| ~~Hosting de la app~~ | ✅ Decidido: Vercel |
| ~~Proveedor de IA del chat~~ | ✅ Decidido: Claude Haiku 4.5 |
| **Dominio definitivo** | Ideal en la fase 2. **Último momento razonable: al empezar la fase 5.** Siempre antes de imprimir el primer QR real |
| Proveedor de correo | Fase 7 |
| Cómo se cobra la suscripción a los locales | Fase 8 |
| Pasarela de pagos | Fase 9 |
| Proveedor de boleta electrónica | Fase 9 |
| Impresora | Fase 9 |
| Precios finales de los planes | Fase 8 |
