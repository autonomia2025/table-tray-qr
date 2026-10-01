# TABLIO — Brief de producto v3

> **Qué es este documento:** la fuente de verdad de lo que Tablio es y de a dónde queremos llegar.
> Reemplaza al brief v2.2. Parte del producto que ya existe (construido en Lovable) y agrega todo lo que falta.
>
> **Para el equipo:** léanlo como el mapa completo del producto.
> **Para Claude Code:** este documento manda. Si algo del código contradice una regla de la sección 4 o 9, gana el documento. Si crees que una regla está equivocada, no la cambies: proponlo y espera aprobación.

---

## 1. Qué es Tablio

Tablio convierte cada mesa de un local gastronómico en un punto de venta. El cliente escanea el QR de su mesa, ve la carta, pide y paga desde su celular, sin descargar nada. El local recibe el pedido en barra o cocina, lo prepara y lo entrega. Al cierre, el sistema cuadra cada peso.

**La idea central:** el mozo deja de ser el cuello de botella. Ya no tiene que tomar pedidos ni cobrar: se dedica a servir y atender.

**El problema que resuelve:** en las horas de más demanda, los locales pierden plata por filas para pedir y pagar, errores de comanda, mesas que se van sin pagar y personal que no da abasto. Y cada vez cuesta más contratar.

**Cómo gana plata Tablio:** instalación inicial más una suscripción mensual según el tamaño del local. **No cobra comisión sobre las ventas del local**: la plata de cada venta va directo a la cuenta del local, Tablio nunca la toca.

---

## 2. Para quién

| Segmento | Prioridad | Por qué |
|---|---|---|
| **Bares, pubs, cervecerías y terrazas de alto flujo**, Región Metropolitana | **Principal (hoy)** | Es donde el problema duele más y donde nadie se especializa |
| **Cafeterías de especialidad** independientes | Expansión 1 | Visitas casi diarias: ideal para sellos y fidelización |
| **Eventos** (fiestas, festivales, recintos con barra) | Expansión 2 | Mucha gente pidiendo al mismo tiempo; la fila es el gran problema |
| **Restaurantes con reservas** | Expansión 3 | Reservas con abono reducen las mesas que no llegan |

El criterio no es el rubro, es la operación: **locales donde atender al cliente se traba cuando hay mucha gente**.

---

## 3. Punto de partida: lo que ya existe

El producto construido en Lovable ya tiene una base muy sólida. Esto **se mantiene y se mejora**, no se rehace:

- **Comensal:** entra por QR (un QR por mesa), carta con modificadores y alérgenos, carrito individual, upsell en el checkout, propina, lealtad por correo, pago con Apple Pay / Google Pay / tarjeta, seguimiento del pedido en vivo, ver la cuenta de la mesa.
- **Pago:** lo confirma el servidor, que recalcula los precios desde la base y solo crea el pedido si el cobro se aprueba. El proveedor de pagos está aislado en un solo archivo (hoy es simulado).
- **Dos modos por sucursal:** prepago (cocina solo ve lo pagado) o cuenta abierta.
- **Mozo:** tablero de mesas por urgencia, llamados, pedidos de cuenta con sonido, tomar, transferir y cerrar mesa, pedido manual para clientes sin celular.
- **Cocina (KDS):** columnas por estado, sonido, temporizadores, marcar productos agotados.
- **Dueño:** mesas, pedidos, carta, equipo, QR, sucursal, caja con conciliación y reembolsos, lealtad, reportes con exportación a CSV, soporte con IA.
- **Backoffice interno de Tablio:** vendedor (agenda, registro de visitas, pipeline, comisiones), jefe de ventas (equipo, metas, comisiones), finanzas (MRR, clientes, churn), superadmin (alta de locales, impersonación, feature flags).

---

## 4. Reglas que no se negocian

Estas reglas son la columna del producto. Cualquier funcionalidad nueva tiene que respetarlas.

1. **Nada se prepara sin pago confirmado (en modo prepago).** El pedido llega a barra o cocina recién cuando el pago está aprobado.
2. **El pago solo lo confirma el servidor.** Nunca el celular del cliente, nunca el navegador del mozo o del dueño.
3. **El precio se congela antes de pagar.** Al ir a pagar se genera una cotización con los productos, precios, propina y total, que vence a los pocos minutos. Si el dueño cambia un precio mientras alguien paga, a esa persona no le afecta.
4. **Un pago no se cobra ni se produce dos veces**, aunque la confirmación llegue repetida.
5. **Cada local está completamente aislado de los demás.** Ningún local, ni ningún usuario, puede ver ni tocar datos de otro.
6. **Los cambios de estado importantes los hace el servidor**: pagar, preparar, entregar, cerrar, reembolsar. El navegador pide; el servidor valida y ejecuta.
7. **Todo lo sensible queda registrado**: quién reembolsó, quién anuló, quién cambió un precio, quién entró como soporte. Con fecha y motivo.
8. **Cada persona paga lo suyo.** La mesa es un lugar, no una cuenta compartida. Si alguien quiere invitar, lo agrega a su propio pedido.
9. **Tablio nunca custodia la plata de las ventas.** Va directo a la cuenta del local.
10. **El comensal nunca ve problemas internos del local** (deudas con Tablio, errores técnicos, mensajes en inglés).

**Sobre la cuenta abierta:** se mantiene como modo permitido por sucursal, porque algunos locales lo necesitan. Pero el prepago es el modo recomendado y el que viene activado. En cuenta abierta, el sistema debe mostrarle al dueño cuánto está arriesgando y cuánto pierde por mesas que se van sin pagar.

---

## 5. Roles y paneles

### 5.1 Comensal (sin cuenta)
Escanea el QR de la mesa, ingresa un **código corto de 4 dígitos impreso en la mesa** (prueba que está ahí, no en su casa con una foto del QR), ve la carta con fotos, alérgenos y agotados en vivo, arma su propio carrito, paga, y sigue su pedido en vivo con estado separado por estación (la cerveza puede estar lista mientras la comida sigue en cocina). Puede pedir otra ronda con un toque, llamar al mozo, pedir la cuenta, descargar su boleta. Siempre tiene la opción "pagar con el mozo", pero la pantalla le avisa claramente que su pedido no está pagado ni enviado.

### 5.2 Mozo
Entra con PIN, elige su zona y ve una **cola de tareas** ordenada por prioridad: entregas listas, problemas, cuentas, llamados. Un llamado viejo sube solo al tope para que nadie quede olvidado. **No toma pedidos ni cobra** (salvo el pedido manual para clientes sin celular, que pasa por el servidor igual que cualquier pedido). **No cambia estados de cocina.** Ve el nombre o alias de cada persona para saber a quién entregar. Puede unir mesas para grupos grandes y traspasar mesas a un compañero.

### 5.3 Cocina y barra (KDS)
Pantalla fija, letra grande. Recibe solo lo que corresponde según el modo (en prepago, solo lo pagado), **separado por estación** (barra y cocina por separado). Avanza cada comanda con botones grandes. Marca agotados con efecto inmediato en la carta. Si se corta internet, al volver recupera todo. Siempre muestra si está conectada y la hora de la última actualización.

### 5.4 Cajero (rol nuevo)
Hoy la caja está dentro del panel del dueño. Se separa como **rol propio**, para que el dueño pueda darle acceso a la caja a alguien sin darle acceso a todo el local. Abre y cierra turno, ve las mesas en vivo, gestiona **excepciones** (pago sin pedido, monto que no calza, boleta fallida) y hace reembolsos con motivo obligatorio. El cierre de turno queda bloqueado: nadie puede editarlo después.

### 5.5 Dueño / administrador del local
Todo lo que ya existe (carta, mesas, QR, equipo, sucursal, caja, lealtad, reportes, soporte), más los módulos nuevos de la sección 6. Su pantalla de inicio cuenta una historia en lenguaje simple ("anoche vendiste tanto, más que el viernes pasado, la terraza fue tu mejor zona") en vez de mostrar veinte gráficos.

### 5.6 Superadmin (equipo Tablio)
Alta de locales, planes, estado de pago de cada local, feature flags, métricas del negocio. Puede entrar como soporte al panel de un local, pero queda registrado quién, cuándo y por qué.

### 5.7 Backoffice comercial (equipo Tablio)
Vendedor, jefe de ventas y finanzas. Nunca visibles para los locales. Detalle en la sección 6.3.

---

## 6. Módulos nuevos

### 6.1 Control del equipo

Hoy el dueño no sabe quién hizo qué. Este módulo le da esa información.

- **Turnos:** cada mozo abre y cierra su turno. Se registra hora de inicio, fin, sucursal y duración.
- **Atribución:** cada mesa, pedido, entrega y propina queda asociada al mozo que la atendió, con un historial que no se pierde al cerrar la mesa.
- **Registro de eventos:** cada cambio de estado de un pedido queda guardado con hora real (registrado por el servidor, no por el navegador), para medir tiempos de verdad.
- **Ranking por período:** mesas atendidas, pedidos entregados, ventas atribuidas, propinas, ticket promedio, tiempo de respuesta a llamados y tiempo de entrega.
- **Metas por mozo**, con avance visible en su propio panel.
- **Tiempos objetivo configurables** por local (ej. responder un llamado en 2 minutos, entregar en 10) con semáforo de cumplimiento.
- **Alertas de abandono:** pedido listo sin entregar después de X minutos.
- **Calificación del servicio:** el comensal puede calificar al final, y se atribuye al mozo que cerró la mesa.
- **Productividad de cocina:** tiempos por producto y categoría, para detectar qué platos traban la cocina.
- **Mapa de calor de horas:** para planificar cuánta gente poner en cada turno.

### 6.2 Más ventas

Funcionalidades que ayudan al local a vender más. **Todas vienen desactivadas** y el dueño las activa.

- **Sellos y puntos** (ya existe la base): a la quinta visita, un schop gratis. Se cuenta una visita solo con pago confirmado. Límites para evitar abuso.
- **"Lo de siempre":** al escanear, el cliente recurrente ve su pedido habitual y lo pide con un toque.
- **Recuperar clientes dormidos:** identifica a quienes no vuelven hace X tiempo, para mandarles una invitación (con su consentimiento).
- **Upsell en el checkout** (ya existe): sugerencias configurables por el dueño, nunca preseleccionadas, fáciles de ignorar.
- **Happy hour dinámico:** el dueño activa una promoción con un toque o la programa por horario. Aparece al instante en todas las cartas. Una persona que ya estaba pagando conserva su precio.
- **Invitar un trago:** pagar un producto para otra mesa. Si nadie lo reclama en un tiempo, se devuelve la plata. El que invita puede cancelar antes.
- **Saldo prepagado y giftcard:** el cliente carga plata (ej. carga $20.000 y recibe $23.000). Reglas obligatorias:
  - Es una **deuda del local con el cliente**, no plata disponible. El panel la muestra así.
  - Tope máximo de saldo por cliente.
  - Se separa la plata cargada del bono regalado.
  - Si el local cierra o se suspende, el saldo no desaparece.
  - **No se activa con dinero real hasta revisarlo con un asesor tributario y legal.**
- **Propina por mozo:** el cliente elige a qué mozo va su propina. Tablio informa, no reparte la plata. Tablio no cobra nada sobre las propinas.

### 6.3 Backoffice comercial (interno de Tablio)

Ya existe en buena parte. Se mejora:

- **Vendedor:** agenda del día, registro de visitas, pipeline de prospectos, comisiones, metas personales, material de apoyo.
- **Jefe de ventas:** equipo, metas, comisiones, pipeline global, invitaciones.
- **Finanzas:** ingreso mensual recurrente, clientes, abandono y cohortes. **Debe calcularse desde cobros reales de suscripción**, no estimarse desde el plan. Hay que crear la facturación de suscripciones (hoy no existe) y la tabla de costos (hoy es solo visual).
- **Superadmin:** se suma la visibilidad del saldo prepagado que tiene cada local, con alerta si un local con saldo de clientes deja de pagar.
- **Cobro a los locales:** cargo automático mensual, aviso antes del cobro, reintentos si falla, período de gracia, y **nunca se corta el servicio de un local en medio de una noche de operación**.

### 6.4 Nuevos negocios

Se construyen **después** de que el segmento principal esté sólido. El sistema debe diseñarse desde ya para no tener supuestos fijos de bar (mesas, estaciones y modos configurables por local).

- **Cafeterías:**
  - **Modo mostrador:** el cliente escanea un QR en el mostrador, pide y paga, y recibe un **número de retiro**. Cuando está listo, su celular le avisa.
  - Sellos y "lo de siempre" como funciones principales.
- **Eventos:**
  - Venta de **entradas con consumo incluido** (ej. entrada + 2 tragos).
  - **Barras múltiples** con fila digital: el asistente pide desde su celular y retira cuando le avisan.
  - Canje del consumo prepagado con un QR personal.
  - Reportes por evento.
- **Reservas:**
  - Reserva de mesa con día, hora y número de personas.
  - **Abono opcional** que se descuenta del consumo, para reducir las mesas que no llegan.
  - Recordatorio antes de la reserva.
  - Al llegar, la reserva abre automáticamente la sesión de la mesa.
  - Política de no presentación configurable por el local.

---

## 7. Lo legal y tributario

- **Boleta electrónica (SII):** a través de un proveedor autorizado. Una venta genera exactamente una boleta, nunca dos. Si la boleta falla, la venta sigue siendo válida y se reintenta. Hoy no existe.
- **Datos personales (Ley 21.719, vigente desde diciembre 2026):** nada se asocia a una persona sin su consentimiento claro. Debe poder pedir que borren sus datos.
- **Propinas con tarjeta:** pertenecen a los trabajadores. El sistema las informa por mozo y turno; no las retiene.
- **Saldo prepagado y caducidad:** revisar con asesor antes de usar dinero real.

---

## 8. Modelo de negocio

| Concepto | Monto referencial |
|---|---|
| Instalación inicial | CLP 150.000 – 300.000 (pago único) |
| Suscripción mensual | CLP 79.000 – 249.000 según número de mesas |
| Comisión sobre ventas del local | **No se cobra** |
| Módulos avanzados (eventos, reservas, saldo prepagado) | A definir: pueden ir en planes superiores |

Planes por tamaño (hipótesis a validar): hasta 12 mesas, 13 a 30, 31 a 60, y personalizado sobre 60.

---

## 9. Reglas de calidad para quien construye (Claude Code)

1. **Lee antes de tocar.** Antes de cambiar un área, revisa su estado actual en el código y en la base.
2. **Un cambio a la vez**, siempre dejando la app funcionando.
3. **No digas "listo" sin haberlo probado.** Si tocaste la base, corre la migración. Si tocaste la plata, prueba los casos difíciles: pago repetido, pago tardío, dos personas pagando el último producto.
4. **Si un error persiste después de dos intentos, detente** y explica qué pasa, en vez de seguir probando a ciegas.
5. **Toda tabla nueva lleva aislamiento por local.** Toda función nueva revoca permisos al público salvo que tenga que ser pública a propósito.
6. **Nada importante en memoria.** Lo que importa queda guardado en la base.
7. **Explica todo en español simple.** El fundador no es desarrollador.
8. **Mantén al día:** `CLAUDE.md` (reglas), `docs/BUILD_LOG.md` (qué cambió y por qué), `docs/DEMO_ACCESS.md` (cómo probar la demo, actualizado en el mismo cambio).
9. **Pregunta antes de** cambiar una regla de la sección 4, agregar un servicio externo nuevo, o hacer algo que no se pueda deshacer.

---

## 10. Problemas conocidos (urgentes)

Detectados en la auditoría del producto actual. Se corrigen **justo después de migrar la base**, antes de cualquier funcionalidad nueva:

1. Cualquier usuario puede agregarse a sí mismo como miembro de cualquier local.
2. Cualquiera, sin iniciar sesión, puede modificar cualquier pedido, incluido marcarlo como pagado.
3. Los PIN de los mozos están guardados en texto plano y son públicos.
4. Datos de pedidos, mesas y personal se pueden leer entre locales.
5. La creación de usuarios de un local no verifica quién la pide.
6. Cocina, dueño y mozo cambian estados de pedido desde el navegador.
7. El pedido manual del mozo usa precios del navegador.
8. Falta confirmar que un mismo pago no pueda registrarse dos veces a nivel de base de datos.
9. El chat de soporte depende de la IA de Lovable y dejará de funcionar fuera de Lovable.
10. Hay dos logins, código sin usar, estados mezclados en inglés y español, y mensajes de error técnicos que ve el usuario.

---

## 11. Orden de construcción

| Fase | Qué se hace |
|---|---|
| **1. Diagnóstico** | Claude Code revisa el código contra este documento |
| **2. Migración** | La base pasa de Lovable a un Supabase propio, sin cambiar nada, y se comprueba que todo funciona igual |
| **3. Seguridad urgente** | Se cierran los problemas de la sección 10 |
| **4. Orden** | Un solo login, código limpio, estados en español, errores en lenguaje simple |
| **5. Blindar la plata** | Cotización con precio congelado, cambios de estado por el servidor, código de presencia, rol cajero, cierre de turno bloqueado, KDS por estación |
| **6. Control del equipo** | Módulo 6.1 |
| **7. Más ventas** | Módulo 6.2, empezando por lo de más impacto y menos riesgo: upsell, "lo de siempre", happy hour. El saldo prepagado al final |
| **8. Backoffice** | Facturación de suscripciones, costos reales, cobro automático a locales |
| **9. Dinero real** | Pasarela de pagos real, boleta electrónica, impresora, asesorías |
| **10. Nuevos negocios** | Cafeterías, luego eventos, luego reservas |

Las fases 9 y 10 pueden adelantarse si un cliente real lo necesita, pero nunca antes de terminar la fase 3.

---

## 12. Decisiones abiertas

- Pasarela de pagos: Transbank, Mercado Pago u otra.
- Proveedor de boleta electrónica.
- Precios finales de los planes y qué módulos van en cada plan.
- Cómo se inscribe el medio de pago guardado del cliente para pagar rondas en un toque.
- Cómo se conecta la impresora de la barra.
