# Plan maestro — Tablio

Este es el plan vigente. Reemplaza a `docs/PLAN_FASES.md`, que queda como histórico.
Salió del diagnóstico, del plan maestro y de su autocrítica (1 y 2 de octubre de 2026), con las decisiones del fundador.

**Reglas del plan:**
- **No hay MVP:** se construye el producto completo. Las fases solo ordenan dependencias.
- **Cada etapa termina probada y publicada:** pruebas de seguridad y de navegador contra una base desechable, contra la base real y contra la app publicada, más la integración continua en verde. Cada etapa queda anotada en `docs/BUILD_LOG.md`.
- Si algo obliga a romper una regla de la sección 4 del brief, se detiene y se pregunta.

**Estado:** ✅ hecho · 🔨 en curso · ⏳ pendiente.

---

## Pista del fundador (en paralelo, desde ya)

Son trámites de calendario, no de programación. De ellos dependen decisiones de las fases 2, 4 y 5.

| # | Qué | Estado |
|---|---|---|
| F.1 | Elegir el local piloto y anotar cómo opera: mesas, cuenta abierta, efectivo, boleta, impresora | ⏳ |
| F.2 | Pasarela de pago (que la plata vaya directo al local) | ⏳ |
| F.3 | Boleta electrónica y asesoría tributaria y legal (Ley 21.719, promociones de alcohol) | ⏳ |
| F.4 | Dominio definitivo (antes de imprimir QR reales) | ⏳ |
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
- Sellos retroactivos: si un invitado paga y después guarda su cuenta, recibe los sellos de esa visita.

## Fase 3 — Operación de sala y experiencia del comensal 🔨

| Paso | Qué | Estado |
|---|---|---|
| 3.1 | Turnos de mozo (abrir y cerrar, con duración) y **propina para el mozo que tomó la mesa** (decisión del fundador del 14 de octubre: el cliente no elige; si nadie la había tomado al pagar, va al primero que la tome); propinas por mozo y por turno | ✅ |
| 3.2 | Estaciones en pantalla (cocina y barra por separado) y KDS robusto: recupera todo al volver internet, muestra conexión y última actualización; el mozo lleva lo listo de una estación sin esperar a las demás | ✅ |
| 3.3 | Control del equipo: ranking por período, tiempos objetivo con semáforo, alertas de pedido listo sin entregar, calificación atribuida al mozo que cerró la mesa, metas por mozo | ✅ |
| 3.4 | La mesa en vivo (comensal): quién está, tu pedido por estación, "otra ronda", "lo de siempre", tiempo estimado y aviso al celular | ⏳ |
| 3.5 | Código de presencia en las tarjetas de mesa, cuenta abierta controlada y unir mesas | ⏳ |
| 3.6 | Reportes calculados por el servidor; inicio del dueño que cuenta una historia; productividad de cocina y mapa de calor de horas | ⏳ |
| 3.7 | Sellos que se sienten (el sello "cae" al pagar) | ⏳ |
| 3.8 | Compuerta de la fase 3 | ⏳ |

Detalle de las ideas:

- Estaciones en pantalla (cocina, barra) y KDS robusto · código de presencia para las tarjetas de mesa · mozo y administración pulidos · reportes en el servidor · cuenta abierta controlada · unir mesas.
- **La mesa en vivo** (ideas de experiencia, elegidas por su impacto en ventas):
  - ver quién está en la mesa (alias o avatar) y el estado de **tu** pedido por estación ("tu cerveza está lista, la comida sigue en cocina");
  - **"Otra ronda"** con un toque: repite lo que pediste;
  - **"Lo de siempre"** y favoritos al escanear;
  - tiempo estimado real, según cada plato y lo cargada que está la cocina;
  - aviso al celular "tu pedido está listo" aunque la pantalla esté bloqueada (la app se instala sin tienda de apps).
- **Sellos que se sienten:** tarjeta animada en la que el sello "cae" al pagar.

## Pista P — Calidad que no toca la base (intercalada) ⏳

Una sola capa de traducción de estados (inglés en la base, español en pantalla) · ningún error técnico ni en inglés frente al comensal (bloqueante, regla 10) · limpieza de código sin uso · tope de estilo bajando.

## Fase 4 — Dinero real ⏳

Pasarela real y su receptor de avisos (webhooks) · **conciliación automática contra lo que la pasarela deposita** (al cerrar la caja, decisión del fundador del 13 de octubre) · boleta electrónica (una por venta) · privacidad Ley 21.719 (consentimiento, borrado, retención; bloqueante: estará vigente al lanzar) · excepciones del cajero (pago sin pedido, monto que no calza, boleta fallida) · correos con Resend.

## Fase 5 — Producción y piloto ⏳

Proyecto de producción armado desde el repositorio · dominio y tarjetas impresas · monitoreo · prueba de carga (incluidos los límites de tiempo real) · alta asistida y capacitación · ensayo general · piloto supervisado.

## Después del lanzamiento

**Fase 6 — Control del equipo:** turnos, permisos finos, varios cierres de caja al día, PIN para el mozo en tablets compartidas.

**Fase 7 — Más ventas y experiencia** (ideas de experiencia, segunda ola):
- **Invitar una ronda** (uno paga para la mesa, desde su propio pedido) y **dividir un plato** entre quienes elijas: respetan "cada uno paga lo suyo".
- Niveles por local (Bronce, Plata, Oro) y rachas ("3 viernes seguidos"), con beneficios que define el dueño.
- Pasaporte de la casa: coleccionar estilos y tragos probados, con insignias.
- Premio sorpresa al pagar (raspe y gana) con presupuesto fijado por el local.
- **Juegos en la mesa:** trivia corta mientras esperan (el ganador puede llevarse un sello extra) y la ruleta "¿quién invita la próxima?" (solo diversión, no mueve plata).
- Billeteras digitales reales, `tiene_funcion()` (módulos por plan).

**Fase 8 — El negocio de Tablio:** planes con precio real, cobro a los locales, métricas del backoffice, **noche de trivia en vivo** del bar (pantallas del local y celulares; conecta con el modo eventos).

**Fase 9 — Comunidad** (la más ambiciosa, al final y con cuidado): perfil con amigos, planes ("juntémonos el viernes", con la primera ronda pedida), recomendaciones y fotos de platos de conocidos, **invitar un trago a otra mesa** (está en el brief) y un "salud" virtual entre amigos en el mismo bar.

### Criterios para las ideas de experiencia
- **Primero lo que vende rondas y aprovecha lo ya construido** (la mesa en vivo y los sellos); la comunidad va al final.
- **Comunidad con consentimiento explícito** (Ley 21.719), **desactivada por defecto**, mostrando solo lugares ya visitados y con desfase (nunca "dónde está alguien ahora"), y con moderación contra abusos.
- **Nada que premie tomar más alcohol:** ni retos de cantidad ni sellos por número de tragos. Las promociones de alcohol se revisan con el asesor (F.3).
