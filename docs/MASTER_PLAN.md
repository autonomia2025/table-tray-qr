# Plan maestro — Tablio

Este es el plan vigente. Reemplaza a `docs/PLAN_FASES.md`, que queda como histórico.
Salió del diagnóstico, del plan maestro y de su autocrítica (1 y 2 de octubre de 2026), con las decisiones del fundador.

**Reglas del plan:**
- **No hay MVP:** se construye el producto completo. Las fases solo ordenan dependencias.
- **Cada etapa termina probada y publicada:** pruebas de seguridad y de navegador contra una base desechable, contra la base real y contra la app publicada, más la integración continua en verde. Cada etapa queda anotada en `docs/BUILD_LOG.md`.
- Si algo obliga a romper una regla de la sección 4 del brief, se detiene y se pregunta.

**Estado:** ✅ hecho · 🔨 en curso · ⏳ pendiente · ⏸️ en pausa por decisión del fundador.

**Cierre de cada etapa:** receta `/cerrar-fase` (`.claude/skills/cerrar-fase/SKILL.md`). Todos los reportes quedan en la [bitácora de fases](https://claude.ai/artifact/LKBZxWS4xLC4Z8DDuNUiRV).

---

## Pista del fundador (en paralelo, desde ya)

Son trámites de calendario, no de programación. De ellos dependen decisiones de las fases 2, 4 y 5.

| # | Qué | Estado |
|---|---|---|
| F.1 | Elegir el local piloto y anotar cómo opera: mesas, cuenta abierta, efectivo, boleta, impresora | ⏳ |
| F.2 | Pasarela de pago (que la plata vaya directo al local) | ⏳ |
| F.3 | Boleta electrónica y asesoría tributaria y legal (Ley 21.719, promociones de alcohol) | ⏳ |
| F.4 | Dominio definitivo (antes de imprimir QR reales). **Se adelanta:** lo necesitan los correos y las campañas. El fundador aún no lo tiene | ⏳ |
| F.5 | Clave de la API de Claude para el chat de soporte | ⏳ |
| F.6 | **Resend** para correos (transaccionales y marketing): **aprobado**, se configura más adelante | ⏳ |
| F.7 | Credenciales de Google y cuenta de desarrollador de Apple (registro del comensal) | ⏳ más adelante |
| F.8 | Fotos reales para el demo · **plan Pro de Supabase antes del piloto**: el plan gratis pausa el proyecto tras 7 días sin uso (pasó el 13 de octubre; mientras tanto, la revisión diaria de salud lo mantiene activo) | ⏳ |

---

## Fase 0 — Base de trabajo ✅

Migración al Supabase propio, Vercel, integración continua, base desechable para pruebas (Docker), local de demo con todos los roles y reinicio del demo.

## Fase 1 — Seguridad y operaciones en el servidor, por dominio ✅

Cada dominio se cierra completo de una vez: funciones del servidor, reglas de acceso y pantallas adaptadas. Nada provisorio.

| Etapa | Qué | Estado |
|---|---|---|
| 1.1 | Contención inmediata (los agujeros más graves) | ✅ |
| 1.2 | Un solo modelo de roles y un solo login | ✅ |
| 1.3 | Identidad del comensal: invitado o cliente; sellos solo con cuenta verificada | ✅ |
| 1.4 | Pedidos: estados por el servidor, lectura cerrada, registro de eventos | ✅ |
| 1.5 | Mesas y sesiones: abrir, tomar, transferir y cerrar por el servidor | ✅ |
| 1.6 | Acciones del comensal sin cámara: llamar al mozo, pedir la cuenta, calificar | ✅ |
| 1.7 | Configuración del local: carta, marca, sucursal, equipo, lealtad, fotos y auditoría | ✅ |
| 1.8 | Plataforma y backoffice: superadmin, ventas, finanzas, soporte, planes; datos de clientes de Tablio | ✅ |
| 1.9 | Precios por el servidor y pedido manual del mozo por el servidor (cierra la inserción provisoria de pedidos) | ✅ |
| 1.10 | Compuerta de seguridad: barrido final de reglas y funciones, ataques del diagnóstico, asesor de Supabase; auditoría automática en cada cambio | ✅ |

## Fase 2 — Núcleo de la plata ✅

| Paso | Qué | Estado |
|---|---|---|
| 2.A | Cotización con precio congelado, intento reservado antes de cobrar y confirmación atómica (`confirmar_pago`); pago tardío y producto agotado según política; mozo de la mesa en cada pago | ✅ |
| 2.B | "Pagar al mozo" (efectivo o POS) y "Agregar a mi cuenta" en cuenta abierta | ✅ |
| 2.C | Reembolsos atómicos (reserva antes de devolver, nunca más de lo cobrado, cajero con motivo; efectivo y POS se devuelven en el local) | ✅ |
| 2.D | Día de negocio (corte 06:00 de Chile, por sucursal) y cierre de caja con conciliación automática (app, efectivo, POS, reembolsos, devoluciones automáticas); diferencias marcadas con nota obligatoria; cierre bloqueado; propinas por mozo calculadas por el servidor | ✅ |
| 2.E | Compuerta de la plata: los casos difíciles que faltaban y `auditoria_plata()` (revisa que la plata calce en toda la base; la integración continua exige que salga vacía y que detecte un descuadre hecho a propósito) | ✅ |


Cotización con precio congelado → intento de pago reservado antes de cobrar → confirmación atómica (`confirmar_pago`) → checkout → **"Pagar al mozo"** (efectivo o POS: el mozo cobra, lo registra y recién ahí va a cocina) → caja con permisos del cajero → reembolsos → día de negocio y **cierre de caja con conciliación automática** (al cerrar, el sistema cuadra solo lo cobrado en la app, el efectivo y el POS registrados y los reembolsos, y marca las diferencias; el cierre queda bloqueado) → compuerta de pruebas de plata (pago repetido, pagos simultáneos, pago tardío, reembolso doble, dos personas pagando lo último).

- Diseño de pago asíncrono, para que la pasarela se elija más tarde sin rehacer.
- Cada pago guarda el mozo asignado: informe de propinas por mozo y turno (brief 7).
- La cotización admite productos para otras personas: deja listo "invitar una ronda" y "dividir un plato" (fase 7).
- Sellos retroactivos: si un invitado paga y después guarda su cuenta, recibe los sellos de esa visita (hecho en la 3.7).

## Fase 3 — Operación de sala y experiencia del comensal ✅

| Paso | Qué | Estado |
|---|---|---|
| 3.1 | Turnos de mozo (abrir y cerrar, con duración) y **propina para el mozo que tomó la mesa** (decisión del fundador del 14 de octubre: el cliente no elige; si nadie la había tomado al pagar, va al primero que la tome); propinas por mozo y por turno | ✅ |
| 3.2 | Estaciones en pantalla (cocina y barra por separado) y KDS robusto: recupera todo al volver internet, muestra conexión y última actualización; el mozo lleva lo listo de una estación sin esperar a las demás | ✅ |
| 3.3 | Control del equipo: ranking por período, tiempos objetivo con semáforo, alertas de pedido listo sin entregar, calificación atribuida al mozo que cerró la mesa, metas por mozo | ✅ |
| 3.4 | La mesa en vivo (comensal): quién está, tu pedido por estación, "otra ronda", "lo de siempre", tiempo estimado real y aviso cuando algo queda listo (con la página abierta) | ✅ |
| 3.4b | Aviso con la pantalla bloqueada: la app se instala sin tienda (PWA) y envía notificaciones push (estándar del navegador, sin cuentas externas) | ✅ |
| 3.5 | Código de presencia en las tarjetas de mesa, cuenta abierta controlada y unir mesas | ✅ |
| 3.6 | Reportes calculados por el servidor; inicio del dueño que cuenta una historia; productividad de cocina y mapa de calor de horas | ✅ |
| 3.7 | Sellos que se sienten (el sello "cae" al pagar) | ✅ |
| 3.8 | Compuerta de la fase 3: casos que cruzan varias partes, aislamiento de todo lo nuevo, `auditoria_operacion()` (la integración continua exige que salga vacía y que detecte un descuadre hecho a propósito), asesor de Supabase (índices y reglas más rápidas) | ✅ |

Detalle de las ideas:

- Estaciones en pantalla (cocina, barra) y KDS robusto · código de presencia para las tarjetas de mesa · mozo y administración pulidos · reportes en el servidor · cuenta abierta controlada · unir mesas.
- **La mesa en vivo** (ideas de experiencia, elegidas por su impacto en ventas):
  - ver quién está en la mesa (alias o avatar) y el estado de **tu** pedido por estación ("tu cerveza está lista, la comida sigue en cocina");
  - **"Otra ronda"** con un toque: repite lo que pediste;
  - **"Lo de siempre"** y favoritos al escanear;
  - tiempo estimado real, según cada plato y lo cargada que está la cocina;
  - aviso al celular "tu pedido está listo" aunque la pantalla esté bloqueada (la app se instala sin tienda de apps).
- **Sellos que se sienten:** tarjeta animada en la que el sello "cae" al pagar.

## Pista P — Calidad que no toca la base (intercalada) ✅

Una sola capa de traducción de estados (inglés en la base, español en pantalla) · ningún error técnico ni en inglés frente al comensal (bloqueante, regla 10) · limpieza de código sin uso · tope de estilo bajando.

## Fase 4 — Dinero real ✅ (con lo pendiente del fundador en pausa)

**Decisiones del fundador (14 de octubre de 2026):**
- **Pasarelas:** todas las posibles. Cada local conecta con un botón la que quiera, y Tablio nunca toca la plata. Se parte con Mercado Pago (conexión con su cuenta) y Transbank (código de comercio y clave), con un diseño de "enchufes" para sumar más.
- **Cobro de Tablio:** mensualidad. No hay reparto en cada pago.
- **Boleta:** el comprobante de un pago con tarjeta o en línea vale como boleta si el local lo declara en el SII. Para efectivo y transferencia hay que emitir boleta electrónica, a nombre de cada local, enviada por correo.
- **Propinas:** adelantado el 14 de octubre (10% sugerido y propinas por pagar al equipo).
- **Preguntas pendientes:**
  - para el contador: la propina dentro del comprobante en línea, y el modelo de emisión en el SII;
  - para el abogado: el rol de Tablio en la Ley 21.719.

| Paso | Qué | Estado |
|---|---|---|
| 4.1 | Pasarelas conectadas por cada local, con Transbank (Webpay) completo: conectar con claves probadas y cifradas, pago con redirección y vuelta, devolución por la pasarela; un local real sin pasarela no cobra con la app (lo simulado solo en el demo) | ✅ |
| 4.2 | Mercado Pago con un botón (conexión con su cuenta). Necesita la aplicación de Tablio en Mercado Pago, que crea el fundador. **Pendiente por decisión del fundador (15 de octubre): se hace después, para no atrasar la app** | ⏸️ |
| 4.2b | **Apple Pay y Google Pay en la misma pantalla de pago** (prioridad del fundador, por fricción). Webpay no los muestra en línea; Klap Checkout Flex sí, sin salir del sitio. Necesita que el fundador pida a Klap la evaluación comercial y el acceso de prueba; después, un conector "Klap" igual al de Transbank. **En pausa por decisión del fundador (15 de octubre): no bloquea las demos** | ⏸️ |
| 4.3 | Boleta para efectivo y transferencia, siempre a nombre de cada local. **Etapa 1 (hecha):** la transferencia como medio de cobro del mozo y la caja (con los datos del local para transferir y su propia fila en el cuadre); al cobrar en efectivo o transferencia se marca "Entregué la boleta" (con su número, opcional); lo que falta queda en "Boletas por entregar" del mozo y de la caja, y como aviso al cerrar. **Etapa 2:** proveedor de boletas conectado por cada local (como las pasarelas), enviada por correo o al celular | 🔨 etapa 1 ✅ |
| 4.4 | Pagos que no vuelven (revisión automática cada 5 minutos) y conciliación al cerrar la caja contra la pasarela (cada pago con Webpay contra Transbank); claves guardadas 120 días tras desconectar, solo para revisiones y devoluciones | ✅ |
| 4.5 | Privacidad (Ley 21.719): consentimiento aparte para promociones, ver y descargar mis datos, borrar mi cuenta (la plata del local queda sin el nombre), invitados que no vuelven en 90 días se borran solos, política de privacidad. Falta la revisión de un abogado | ✅ |
| 4.6 | Excepciones de la caja: una bandeja (Caja → Excepciones) con cobro sin pedido por devolver, reembolso rechazado, monto que no calza con Transbank, boleta de un día anterior sin marcar y pago sin confirmar; se resuelven con explicación y quedan en la auditoría. Las devoluciones automáticas quedan anotadas y se reintentan solas. **Falta:** los correos con Resend (esperan el dominio) | 🔨 caja ✅ · correos ⏳ |
| 4.7 | Compuerta de la fase 4: casos difíciles que faltaban (conectar dos veces a la vez, vuelta de Webpay repetida, boleta y excepción resueltas dos veces a la vez, transferencia devuelta, cliente que borra su cuenta después de pagar), aislamiento de todo lo nuevo, y las tres auditorías vacías, con revisiones nuevas de pasarelas y privacidad | ✅ |


Pasarela real y su receptor de avisos (webhooks) · **conciliación automática contra lo que la pasarela deposita** (al cerrar la caja, decisión del fundador del 13 de octubre) · boleta electrónica (una por venta) · privacidad Ley 21.719 (consentimiento, borrado, retención; bloqueante: estará vigente al lanzar) · excepciones del cajero (pago sin pedido, monto que no calza, boleta fallida) · correos con Resend.

## Fase 5 — Producción y piloto 🔨

Proyecto de producción armado desde el repositorio · dominio y tarjetas impresas · monitoreo · prueba de carga (incluidos los límites de tiempo real) · alta asistida y capacitación · ensayo general · piloto supervisado.

Primero va lo que no depende del fundador. Lo marcado ⏸️ espera algo suyo.

| Paso | Qué | Estado |
|---|---|---|
| 5.1 | **Alta del local por Tablio:** el superadmin (y el equipo de ventas) crea un local completo de una vez, en el servidor y sin dejar nada a medias: local, sucursal, carta vacía, mesas con su QR y código, y estación principal. El dueño recibe un enlace para activar su cuenta y elige su propia contraseña (nunca la elige Tablio) | ✅ |
| 5.2 | **Primeros pasos del dueño:** lista de lo que falta para abrir (marca, carta, mesas, equipo, cobro, QR impresos, pedido de prueba) e importar la carta pegando una lista | ✅ |
| 5.3 | **Prueba de carga:** un bar lleno un viernes (muchos celulares pidiendo y pagando a la vez, pantallas en vivo), contra la base desechable, para conocer los límites | ✅ (en este computador; repetirla en producción en 5.6) |
| 5.4 | **Monitoreo interno:** pantalla de salud para Tablio (relojes automáticos, pagos trabados, excepciones abiertas, auditorías, errores de funciones) y aviso diario si algo falla | ✅ |
| 5.5 | **Capacitación:** guías cortas dentro de la app para dueño, caja, mozo y cocina | ✅ |
| 5.6 | Proyecto de producción separado del demo, plan pagado de Supabase, dominio definitivo y tarjetas QR impresas | ⏸️ fundador |
| 5.7 | Ensayo general y piloto supervisado en un local real | ⏸️ fundador |

## Después del lanzamiento

**Orden acordado con el fundador (15 de octubre de 2026):** mientras el piloto espera sus decisiones (paso 5.6), se adelanta lo que no depende de él: fase 6, después Campañas, después el resto de la fase 7 (con los juegos), la fase 8 y la fase 9.

**Fase 6 — Control del equipo** 🔨

| Paso | Qué | Estado |
|---|---|---|
| 6.0 | Turnos y propina del mozo de la mesa | ✅ (fase 3.1) |
| 6.1 | **PIN del mozo en tablets compartidas:** el local deja una tablet como "equipo compartido" y cada mozo entra con su PIN de 4 números. Todo lo que hace queda a su nombre (propinas, cobros, entregas), sin compartir contraseñas | ✅ |
| 6.2 | **Varios cierres de caja al día:** cortes por turno (por ejemplo, mañana y noche), cada uno con su conteo y su diferencia; el cierre del día los suma. Sigue bloqueado y auditado | ✅ |
| 6.3 | **Permisos finos:** el dueño ajusta qué puede hacer cada rol (reembolsar, cerrar caja, cobrar, anular pedidos, ver reportes, editar la carta…). Se aplica en el servidor, no solo en la pantalla | ✅ |
| 6.4 | Compuerta de la fase 6: casos difíciles (cobros durante un corte, dos cortes a la vez, intentos de PIN a la vez, quitar un permiso mientras se usa), aislamiento de lo nuevo y las tres auditorías vacías, con revisiones nuevas de tablets y permisos | ✅ |

**Fase 7 — Más ventas y experiencia** (ideas de experiencia, segunda ola):

| Paso | Qué | Estado |
|---|---|---|
| 7.1 | **Campañas por aviso al celular** (aprobadas el 15 de octubre): sección "Campañas" del dueño, públicos listos (todos, no vienen hace 30 días, frecuentes, por plato), solo a quien aceptó promociones y junta sellos en el local, sin alcohol ni enlaces, límites (4 en 30 días, una por persona a la semana, de 10:00 a 22:00), baja desde cada aviso, medición de visitas y ventas en 7 días y sugerencia en Inicio | ✅ |
| 7.2 | **Beneficio de la campaña al pagar con el QR:** un descuento o regalo que el cliente activa desde el aviso, congelado en la cotización (el precio sigue saliendo de la base), uno por persona, medido en visitas y ventas. Nunca sobre productos con alcohol | ✅ |
| 7.3 | **Campañas por correo:** el mismo mensaje por correo a quienes no tienen la app, con baja en cada correo. Espera el dominio y Resend | ⏸ |
| 7.4 | **Invitar una ronda:** uno pide "para la mesa" desde su propio pedido y lo paga él; el resto de la mesa lo ve en la mesa en vivo | ✅ |
| 7.4b | **Dividir un plato** entre quienes elijas, cada uno paga su parte; a cocina recién cuando está todo pagado. Si alguien no paga, quien lo pidió paga esa parte o el personal lo anula y lo pagado se devuelve desde la caja | ✅ |
| 7.5 | **Niveles y rachas:** Bronce, Plata y Oro por visitas de 90 días, y rachas de semanas seguidas (o del mismo día), con premios que define el dueño y que se entregan con código como los de la tarjeta | ✅ |
| 7.6 | **Pasaporte de la casa:** lo que cada cliente probó por sección de la carta (platos y tragos), con insignias. Solo insignias, sin premios | ✅ |
| 7.7 | **Premio sorpresa al pagar (raspe y gana):** un raspe al día por cliente con cuenta; el local elige el premio (nunca alcohol), cada cuánto se gana y el tope de premios al mes. Lo decide la base al pagar | ✅ |
| 7.8 | **Juegos en la mesa:** trivia de 5 preguntas que corrige el servidor, con ranking de la mesa, y la ruleta "¿quién invita la próxima?" (solo diversión). Premios por definir | ✅ |
| 7.9 | **Módulos por plan:** catálogo cerrado de módulos (campañas, niveles, pasaporte, raspe, juegos, ronda, dividir, tablets), qué trae cada plan y ajuste por local del superadmin, con motivo. Se cumple en la base (`tiene_funcion`). Por ahora todos los planes traen todo: el reparto se decide con los precios (fase 8) | ✅ |
| 7.9b | **Billeteras digitales:** la tarjeta de sellos en Apple Wallet y Google Wallet. Espera las cuentas de desarrollador de Apple y Google | ⏸ |
| 7.10 | **Compuerta de la fase 7:** aislamiento de todo lo nuevo, casos difíciles que cruzan etapas (apagar un módulo a medio pagar, devolver un pago con un raspe sin raspar, borrar una cuenta con datos de la fase 7) y las tres auditorías vacías y atentas a descuadres de campañas, beneficio, platos divididos, raspes y planes | ✅ |

Detalle de cada idea:
- **Invitar una ronda** (uno paga para la mesa, desde su propio pedido) y **dividir un plato** entre quienes elijas: respetan "cada uno paga lo suyo".
- Niveles por local (Bronce, Plata, Oro) y rachas ("3 viernes seguidos"), con beneficios que define el dueño.
- Pasaporte de la casa: coleccionar estilos y tragos probados, con insignias.
- Premio sorpresa al pagar (raspe y gana) con presupuesto fijado por el local.
- **Juegos en la mesa:** trivia corta mientras esperan (el ganador puede llevarse un sello extra) y la ruleta "¿quién invita la próxima?" (solo diversión, no mueve plata).
- Billeteras digitales reales, `tiene_funcion()` (módulos por plan).

**Fase 8 — El negocio de Tablio:** planes con precio real, cobro a los locales, métricas del backoffice, **noche de trivia en vivo** del bar (pantallas del local y celulares; conecta con el modo eventos).

| Paso | Qué | Estado |
|---|---|---|
| 8.1 | **Mensualidad de Tablio:** suscripción de cada local (plan, precio, día de cobro, prueba), cobros que genera la base cada mes, registro del pago por finanzas, estados (al día, por pagar, en gracia, atrasado) con aviso al dueño. Nada se corta solo | ✅ |
| 8.2 | **Métricas de finanzas desde cobros reales:** ingreso mensual, clientes, abandono y cohortes calculados en la base con los cobros pagados (hoy se estiman en el navegador con precios fijos) | ⏳ |
| 8.3 | **Cobro automático con tarjeta** de la mensualidad, aviso antes del cobro y reintentos. Espera que el fundador elija con qué cobrar (y el dominio para los correos) | ⏸ |
| 8.4 | **Noche de trivia en vivo:** el local la lanza en su pantalla, los clientes juegan desde la mesa y el ranking se ve en vivo | ⏳ |
| 8.5 | Compuerta de la fase 8 | ⏳ |

**Fase 9 — Comunidad** (la más ambiciosa, al final y con cuidado): perfil con amigos, planes ("juntémonos el viernes", con la primera ronda pedida), recomendaciones y fotos de platos de conocidos, **invitar un trago a otra mesa** (está en el brief) y un "salud" virtual entre amigos en el mismo bar.

### Criterios para las ideas de experiencia
- **Primero lo que vende rondas y aprovecha lo ya construido** (la mesa en vivo y los sellos); la comunidad va al final.
- **Comunidad con consentimiento explícito** (Ley 21.719), **desactivada por defecto**, mostrando solo lugares ya visitados y con desfase (nunca "dónde está alguien ahora"), y con moderación contra abusos.
- **Nada que premie tomar más alcohol:** ni retos de cantidad ni sellos por número de tragos. Las promociones de alcohol se revisan con el asesor (F.3).
