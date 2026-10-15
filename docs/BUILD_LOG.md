# Bitácora de construcción — Tablio

Qué cambió, cuándo y por qué. Lo más reciente va arriba.

---

## 2026-10-15 — Fase 6.1: PIN del mozo en tablets compartidas ✅
Por acuerdo con el fundador, mientras el piloto espera sus decisiones se adelanta la fase 6.

**Qué hace:** muchos locales tienen una tablet para los mozos. Ahora:
- el dueño o el encargado la activa desde Equipo;
- cada mozo entra con su nombre y su PIN de 4 números, y todo lo que hace queda a su nombre (propinas, cobros, entregas), sin compartir contraseñas;
- "Cambiar de mozo" la deja lista para el siguiente, y tras 4 minutos sin uso vuelve sola a pedir el PIN.

**Cómo está protegido:**
- El PIN se guarda cifrado en una tabla que nadie lee desde el navegador. No se aceptan PIN obvios, y 5 intentos fallidos lo bloquean 10 minutos.
- La tablet tiene su propia credencial, que se desactiva desde Equipo.
- Salir en la tablet no cierra la sesión del teléfono del mozo.
- Un mozo desactivado no entra, aunque tenga PIN.

**Pruebas:**
- `tests/seguridad/f6-1-pin-tablets.test.ts` revisa:
  - que nadie lea el PIN;
  - que la sesión que se entrega sea la del mozo correcto;
  - el bloqueo por intentos;
  - la tablet desactivada;
  - quién puede activar tablets;
  - que el dueño de otro local no las toque;
  - que un mozo desactivado no entre.
- `e2e/tablet.spec.ts` recorre la tablet de punta a punta.

## 2026-10-15 — Fase 5.5: guías de capacitación ✅
- **Una guía corta por rol:** dueño o administrador, caja, mozo, y cocina y barra. Cada una trae los pasos del día a día con los nombres exactos de los botones, y qué hacer si algo falla.
- **Dónde se abren:** con el botón "?" en el panel, la pantalla del mozo y la cocina.
- **Para imprimir:** en `/ayuda/:rol`, para entregársela al equipo el primer día.
- **No se desactualizan:** `src/lib/guias.test.ts` revisa que cada botón nombrado en una guía exista en la app; si alguien cambia el texto de un botón, la prueba avisa.
- **Pruebas:** `e2e/guias.spec.ts` (el mozo, el dueño y la cocina abren su guía, y la versión imprimible).

## 2026-10-15 — Fase 5.4: monitoreo interno ✅
Antes, la revisión diaria solo comprobaba que la app y la base respondieran. Ahora la base se revisa por dentro cada hora:
- los relojes automáticos y sus fallas;
- las llamadas del reloj a las funciones;
- los pagos con pasarela sin confirmar y los cobros que había que devolver;
- las excepciones de caja de todos los locales;
- las tres auditorías;
- los locales creados cuyo dueño no activó la cuenta.

**Cómo se ve y cómo avisa:**
- El resultado queda registrado (30 días). El superadmin lo ve en vivo en **Salud** (`/superadmin/salud`), con la historia hora por hora.
- La revisión diaria de GitHub ahora también falla, y avisa por correo, si la última revisión encontró un problema o si la base lleva más de 3 horas sin revisarse.
- Lo único público es el estado ("ok", "atencion" o "problema"), sin ningún detalle.

**Pruebas:**
- `tests/seguridad/f5-4-salud.test.ts` revisa quién ve qué, que lo público no tenga datos, y que una revisión con un pago trabado a propósito dé "problema".
- `e2e/salud.spec.ts` cubre la página.

## 2026-10-15 — Fase 5.3: prueba de carga ✅
`bun run carga` simula un viernes lleno: un local de 40 mesas, comensales que piden y pagan en rondas, 10 pantallas en vivo y una cocina avanzando pedidos. Resultados y cómo leerlos en `docs/PRUEBA_CARGA.md`.

**Resumen:**
- Con 50 comensales (unos 350 pagos por minuto, varias veces el peak real) no hubo ni un error de pago.
- Con 150, todo resulta pero más lento.
- Con 300 entrando a la vez, este computador se satura.
- En todos los casos las auditorías de la plata quedaron vacías.

**Lo que encontró y se corrigió:**
1. **Bloqueos mutuos en la misma mesa** (pago mientras alguien llama al mozo, pide la cuenta o pide sin pagar; y el cobro del mozo). Todas las funciones toman ahora primero la mesa, después la visita y después los pedidos (`20261015110000_orden_bloqueos`). La prueba `f5-3-mesa-llena` lo provoca a propósito.
2. **Mensajes falsos bajo carga** en `process-payment`. Con el servidor ocupado ya no dice "QR no válido", "este local no recibe pagos" ni "abre la carta desde el QR", sino "Hay mucho movimiento… intenta de nuevo".
3. **La pantalla del mozo recargaba todo con cada aviso.** Ahora junta los avisos (como máximo una recarga por segundo) y se pone al día sola cada 20 segundos.
4. **La cocina se pone al día cada 15 segundos** (antes 30) si pierde un aviso en vivo.

## 2026-10-15 — Fase 5.2: primeros pasos del dueño y pegar la carta ✅
Un local recién activado no tenía guía: el dueño entraba a un panel vacío. Ahora:

- **"Para abrir tu local"** en el Inicio:
  - siete pasos en orden (marca, carta, equipo, cobro con la app, QR de las mesas, pedido de prueba y abrir), cada uno con su botón a dónde se hace;
  - los calcula la base (`primeros_pasos`) y se marcan solos; los QR, al descargarlos o imprimirlos;
  - se puede ocultar;
  - los locales que ya venden tienen sus QR dados por listos.
- **Pegar la carta** (Menú → "Pegar carta"):
  - el dueño pega su carta como texto (títulos de categoría y un plato por línea con su precio) o como columnas copiadas de una planilla;
  - ve una vista previa con las líneas que no se entendieron;
  - la importa de una vez con `importar_carta`: todo o nada, hasta 300 platos, crea las categorías que faltan y no repite platos ya cargados.

**Pruebas:**
- `src/lib/primerosPasos.test.ts`: el lector de la carta pegada con precios chilenos en sus formas comunes, títulos, planillas y líneas sin precio.
- `tests/seguridad/f5-2-primeros-pasos.test.ts`:
  - solo el dueño, administrador o encargado usan esto en su local;
  - un local nuevo parte en cero y se va marcando;
  - la importación es todo o nada, con sus límites.
- `e2e/primeros-pasos.spec.ts` recorre el flujo de punta a punta.
- **Prueba antigua corregida:** `e2e/flujo-demo.spec.ts` buscaba el botón "Entregado" con un selector demasiado amplio. Con otras pruebas en paralelo, a veces entregaba el pedido de otra (por eso fallaba `equipo-desempeno` junto con ella). Ahora actúa solo dentro de la tarjeta de su propio pedido.

## 2026-10-15 — Fase 5.1: alta del local por Tablio ✅
Antes, el superadmin creaba un local escribiendo directo desde el navegador y en pasos sueltos: si fallaba a mitad, quedaba un local a medias. Además no creaba mesas, códigos de mesa ni estaciones, y el superadmin elegía la contraseña del dueño.

**Ahora:**
- `crear_local` lo crea todo en una sola operación del servidor: local, sucursal (cerrada y sin cobros simulados), carta vacía, mesas con su QR y su código, y estación principal. Lo pueden usar el superadmin y el equipo de ventas; si viene de un posible cliente, queda como convertido.
- Al final aparece un enlace para el dueño, con un mensaje listo para copiar o mandar por WhatsApp. Sirve una vez y por 14 días.
- El dueño abre `/activar/…`, escribe su nombre, elige su contraseña y queda dentro de su panel. Si ya tenía cuenta con ese correo (por ejemplo, de otro local), entra con ella y se le suma el local.
- Si dos personas usan el mismo enlace a la vez, solo una lo activa.
- En el detalle de cada local, el superadmin ve si el dueño lo activó o crea un enlace nuevo (el anterior deja de servir).

**Pruebas:**
- `tests/seguridad/f5-1-alta-local.test.ts` revisa:
  - que nadie fuera de Tablio cree locales;
  - que el local quede completo y las auditorías sigan vacías;
  - que los datos malos no creen nada;
  - la activación, incluso con dos personas a la vez;
  - el dueño que ya tenía cuenta;
  - el enlace anulado o vencido;
  - el alta desde ventas.
- Lo que crea locales corre solo en la base desechable, para no llenar los datos reales de locales falsos.
- `e2e/alta-local.spec.ts` recorre el alta de punta a punta.

## 2026-10-15 — Fase 4.7: compuerta del dinero real ✅ (fase 4 terminada)
La fase 4 se cierra igual que la 2 y la 3: con los casos difíciles que faltaban y las auditorías automáticas vacías.

**Revisiones nuevas en la auditoría de la plata:**
- un pago con Transbank sin su número de Webpay o sin su conexión;
- un intento que salió a la pasarela sin conexión;
- una pasarela activa sin su clave guardada, o una desconectada hace más de 120 días que todavía la tiene;
- un cobro simulado en un local que no lo permite;
- una diferencia con la pasarela anotada en otro local.

**En la auditoría de la operación:** un consentimiento para promociones de alguien sin cuenta guardada.

**`tests/seguridad/f4-7-compuerta.test.ts` revisa:**
- "conectar Webpay" dos veces a la vez: queda una sola pasarela activa;
- la vuelta de Webpay repetida a la vez: no se cobra dos veces;
- la boleta marcada por dos personas a la vez, y la misma excepción resuelta dos veces a la vez: queda una sola constancia;
- una transferencia devuelta en el local: se resta de la transferencia, no del efectivo;
- un cliente que pagó y después borró su cuenta: la plata queda intacta y se puede reembolsar;
- el aislamiento de todo lo nuevo de la fase 4 frente al comensal, alguien sin sesión, el mozo y el dueño de otro local (la mozo solo ve sus propias propinas pagadas);
- las tres auditorías vacías y que detecten cada descuadre hecho a propósito.

## 2026-10-15 — Fase 4.6: excepciones de la caja ✅ (los correos esperan el dominio)
El brief pide que la caja gestione las excepciones: pago sin pedido, monto que no calza y boleta fallida. Ahora hay una sola bandeja, en Caja → Excepciones, con un aviso en el Inicio y en el cierre de caja.

**Qué muestra la bandeja y cómo se resuelve cada caso:**
- **Cobro sin pedido por devolver.** Se puede pedir "Revisar con la pasarela" o anotar "Lo devolví de otra forma", con una explicación.
- **Reembolso que la pasarela rechazó.** Se reintenta o se descarta, con motivo.
- **Monto que no calza con Transbank.** Queda guardado desde la conciliación hasta que alguien lo marca revisado, con una explicación. Si después calza, se cierra solo.
- **Boleta de un día anterior sin marcar.** Se marca entregada (con su número) o "no se pudo entregar", con motivo.
- **Pago que salió a Webpay y no se ha confirmado.** Se puede pedir "Revisar con la pasarela".
- Todo lo que se resuelve a mano queda en la auditoría.

**Hueco cerrado.** Cuando la app devolvía un cobro sola (otra persona ya había pagado lo mismo, o el monto no calzaba), no revisaba si la pasarela lo devolvió. Si fallaba, el cliente quedaba cobrado sin pedido y nadie se enteraba. Ahora:
- se guarda cuánto se cobró y si la devolución resultó;
- la revisión automática de cada 5 minutos la reintenta hasta 6 veces, y antes pregunta a Transbank cómo está el cobro, para no devolver dos veces;
- si sigue fallando, aparece en la bandeja;
- la auditoría de la plata lo marca si pasa más de 7 días sin resolver.

**Pruebas:**
- `tests/seguridad/f4-6-excepciones.test.ts` revisa:
  - que la devolución automática quede anotada;
  - cada tipo de excepción, con su resolución;
  - que la explicación sea obligatoria;
  - quién ve y quién no (mozo, cocina, comensal, sin sesión, otro local);
  - que nadie escriba las diferencias desde el navegador;
  - que la auditoría detecte una devolución olvidada.
- `e2e/excepciones.spec.ts` recorre la bandeja de punta a punta.
- **La compuerta sirvió:** detectó un cierre de caja que cambió, provocado por la propia prueba nueva. Se corrigió la prueba.

## 2026-10-15 — Fase 4.3 (etapa 1): transferencia y boleta del local ✅
La boleta siempre es del local, con su RUT; Tablio nunca la emite a su nombre. Con la app o con POS no hace falta: el comprobante del pago vale como boleta (si el local lo declara en el SII). En efectivo y transferencia, el local la emite con su sistema de siempre, y Tablio se encarga de que no se olvide:
- **Transferencia como medio de cobro.** El mozo y la caja cobran en efectivo, POS o transferencia.
  - El dueño anota sus datos para transferir en Sucursal, y el mozo se los muestra al cliente.
  - En el cierre de caja, la transferencia tiene su fila: suma al total del día, pero no se cuenta en el cajón (se revisa en la cartola).
  - También aparece en los reportes, en "Cómo te pagaron".
- **La boleta, por marcar.** Al cobrar en efectivo o transferencia, el mozo marca "Entregué la boleta" (con su número, opcional).
  - Si no la marca, queda arriba en sus mesas en "Boletas por entregar", con el botón "Ya la entregué".
  - La caja ve las de los últimos 7 días y el aviso antes de cerrar.
  - Marcarla queda en la auditoría.
  - El dueño puede apagar el recordatorio.
- **En la base:**
  - `payments.boleta_estado`, que lo fija el disparador `boleta_del_pago`;
  - las funciones `marcar_boleta`, `boletas_pendientes` y `mis_boletas_pendientes`;
  - la transferencia en `_conciliar_dia` y en `reporte_local`;
  - dos revisiones nuevas en `auditoria_operacion`: `boleta_sin_motivo` y `boleta_incompleta`.
- **El demo:** los cobros de ejemplo de días anteriores ya traen la boleta entregada.

**Pruebas:**
- `tests/seguridad/f4-3-boleta.test.ts` revisa:
  - la caja con la transferencia;
  - marcar la boleta y que marcarla dos veces no cambie nada;
  - que el POS no la pida;
  - quién puede marcarla y quién no (otro mozo, cocina, comensal, sin sesión, otro local);
  - que nadie la escriba directo;
  - el recordatorio apagado;
  - que la auditoría detecte una boleta incoherente.
- `e2e/boleta.spec.ts` recorre el cobro por transferencia de punta a punta.

## 2026-10-15 — Cierre de fase automático y decisiones de boleta y campañas
El fundador pidió que cada fase termine siempre igual, sin tener que acordarse de pedirlo:
- **Receta `/cerrar-fase`** (`.claude/skills/cerrar-fase/SKILL.md`): pruebas completas, publicación, documentos al día, recorrido con fotos, reporte publicado, aviso al celular y seguir con la siguiente etapa. Si esa etapa necesita algo de él (servicio externo, cuenta, regla de la sección 4, algo irreversible), se salta a la siguiente que no esté bloqueada.
- **Bitácora de fases** (página publicada, fuente `docs/bitacora-fases.html`): todos los reportes en un solo lugar, más "Ahora" y "Lo que necesito de ti".
- **Decisiones del fundador:**
  - Boleta en dos etapas, siempre a nombre de cada local: primero el local usa su sistema y Tablio recuerda marcarla; después, un proveedor conectado por local.
  - Campañas por correo aprobadas; esperan el dominio y Resend.
  - Apple Pay, Google Pay y Mercado Pago quedan en pausa.

## 2026-10-15 — Fase 4.5: privacidad del comensal (Ley 21.719) ✅
La ley de datos entra en vigencia el 1 de diciembre de 2026. Lo que hace el comensal desde "Mi cuenta" en la carta:
- **Promociones:** solo con un consentimiento aparte, desmarcado por defecto ("Quiero recibir novedades…") al guardar su cuenta, y cambiable cuando quiera (`guardar_consentimiento`, tabla `consentimientos_comensal`, con la versión de la política que aceptó). Si entra a una cuenta que ya tenía, se respeta lo que había elegido.
- **Descargar mis datos:** `mis_datos` arma un archivo con todo lo que Tablio guarda de la persona: cuenta, preferencias, sellos y premios por local, pedidos, pagos, mesas y avisos.
- **Borrar mi cuenta:** la función `borrar-mi-cuenta`, con una confirmación que explica qué se borra.
  - **Se borra:** correo, sellos, premios y movimientos de todos los locales, avisos, preferencias, lo que escribió en sus pedidos y el correo de los pagos, y la cuenta misma.
  - **Se conserva sin su nombre:** pedidos, pagos e intentos de pago, porque el local debe guardarlos por ley tributaria.
  - **Las cuentas del equipo** no se borran por aquí.
  - **Queda constancia** en la auditoría, sin datos de la persona.
- **Invitados:** los que no vuelven en 90 días se borran solos (pg_cron diario).
- **Política de privacidad** en lenguaje simple, en `/privacidad`, enlazada al guardar la cuenta y desde "Mi cuenta". **Falta la revisión de un abogado** (pregunta guardada).

**Arreglo de fondo:** borrar a una persona borraba en cascada sus cotizaciones e intentos de pago, que son parte del registro de la plata. Ahora quedan, sin la persona (`ON DELETE SET NULL`).

**Caja:** la fila "App (tarjeta, Apple y Google Pay)" pasa a "App (pagos con el QR)". Apple Pay y Google Pay todavía no existen con Webpay; quedan en el paso 4.2b (Klap).

**Pruebas:**
- `tests/seguridad/f4-5-privacidad.test.ts`:
  - cada uno ve solo sus datos;
  - el consentimiento es aparte y solo de la propia persona con cuenta;
  - las cuentas del equipo no se borran y sin confirmar no pasa nada;
  - al borrar se van los datos personales y la plata del local queda sin nombre (la auditoría de la plata sigue vacía);
  - un invitado de más de 90 días se borra solo.
- `e2e/privacidad.spec.ts`: "Mi cuenta" con promociones, descargar (llega el archivo), la confirmación de borrar y la política.

---

## 2026-10-15 — Fase 4.4: pagos que no vuelven y conciliación con Transbank ✅
**Lo que se comprobó** en el ambiente de pruebas de Transbank: si el cliente paga en Webpay y no vuelve a Tablio (cerró el celular), nadie confirma el pago y Transbank lo anula al poco rato ("Transaction has an invalid finished state: aborted"). No se cobra, pero el intento quedaba "reservado" para siempre, y la auditoría de la plata lo marca a la hora.

**Revisión automática** (`20261015020000_revision_pagos.sql`, función `revisar-pagos`):
- **Qué revisa:** el reloj de la base (pg_cron, cada 5 minutos) busca intentos a medio camino (salieron a la pasarela hace más de 3 minutos, o nunca alcanzaron a salir) y le pregunta a la pasarela.
- **Qué hace con cada uno:**
  - si se pudo confirmar, se registra igual que si el cliente hubiera vuelto;
  - si Transbank ya lo anuló, queda rechazado y sin cobro;
  - si no se puede saber, queda pendiente; no se inventa nada.
- **Quién la puede pedir:**
  - el reloj, con una clave que se genera en la bóveda (nadie la escribe);
  - el dueño, el administrador, el encargado o la caja, para su sucursal.
- **Configuración por ambiente:** la dirección de las funciones de cada ambiente va en la bóveda (`url_funciones`): en producción se configura una vez y en las pruebas locales la pone `pruebas-base-local.sh`.

**Conciliación con la pasarela al cerrar la caja** (función `conciliar-pasarela`; decisión del fundador del 13 de octubre):
- **Qué compara:** "Verificar con Transbank" en Caja → Cierre de caja revisa cada pago con Webpay del día contra lo que dice Transbank:
  - autorizado por el mismo monto (consumo más propina);
  - si se devolvió, anulado por lo devuelto.
- **Resultado:** muestra "N pagos verificados: todo calza" o la lista de lo que no calza, y queda en la auditoría.

**pg_net en producción** (`20261015040000_pg_net.sql`):
- **El problema:** el reloj llama a la función con pg_net, que en Supabase local viene activada pero en el proyecto real no. Sin ella, el reloj habría fallado en silencio.
- **Cómo se detectó:** probando el reloj en producción antes de darlo por listo.
- **Comprobado en producción:** la base llama a `revisar-pagos` con su clave y responde 200.

**Claves guardadas 120 días** (`20261015030000_claves_retencion.sql`):
- **Antes:** al desconectar se borraba la clave al instante. Un pago en curso no se podía resolver, y un pago de ayer no se podía devolver por la pasarela.
- **Ahora:** al desconectar, la clave deja de cobrar pero se guarda cifrada 120 días, solo para revisiones y devoluciones. El reloj la borra después.

**Pruebas:**
- `tests/seguridad/f4-4-revision-pagos.test.ts`:
  - quién puede pedir la revisión, y que una clave de reloj inventada no sirve;
  - un pago que salió a Webpay y no volvió se cierra sin cobro, aunque el dueño haya desconectado en el intertanto;
  - el reloj está programado;
  - la conciliación es solo para quien ve la plata.
- `e2e/webpay.spec.ts`: después del pago, "Verificar con Transbank" da "todo calza", y sigue calzando después de devolverlo.

---

## 2026-10-15 — Fase 4.1: pasarelas por local, con Webpay (Transbank) completo ✅
**Decisión del fundador:** cada local conecta la pasarela que quiera, la plata va directo a su cuenta y Tablio nunca la toca (regla 9).

**Base** (`20261015010000_conexiones_pago.sql`):
- **`conexiones_pago`:**
  - una pasarela activa por sucursal;
  - la clave del local se guarda **cifrada en la bóveda (Vault)**;
  - la columna de la clave no se puede leer desde el navegador, ni siquiera por el dueño;
  - la tabla la ven dueño, administrador y encargado.
- **Conectar y desconectar:**
  - `_guardar_conexion_pago` la usa solo el servidor, después de probar las claves;
  - `desconectar_pago` borra la clave de la bóveda;
  - las dos quedan en `audit_logs`.
- **Regla nueva de seguridad:**
  - hasta hoy todo cobro con la app era simulado;
  - ahora un local **sin pasarela no cobra con la app**: el cliente ve "Este local todavía no recibe pagos con la app" y puede pagarle al mozo;
  - lo simulado queda solo en locales marcados `branches.pagos_simulados` (el demo y "Local Ajeno"), que nadie cambia desde el navegador.
- **Funciones para el comensal:**
  - `pasarela_de_mesa`: con qué paga en esa mesa, sin claves;
  - `resultado_intento`: cómo terminó su pago; solo lo ve quien pagó.

**Funciones del servidor:**
- **`_shared/pasarelas/transbank.ts`:** Webpay Plus REST v1.2. Crea, confirma (si ya estaba confirmado, consulta el estado), devuelve y prueba claves. Crear una transacción no cobra nada.
- **`conectar-pago`:**
  - solo dueño o administrador;
  - valida el formato (código de comercio de 12 números);
  - prueba las claves con Transbank y recién entonces las guarda;
  - tiene un atajo "claves de prueba de Transbank" para el ambiente de pruebas.
- **`process-payment`:** con Transbank, reserva el intento (regla 4), crea la transacción por consumo más propina y responde a dónde mandar al cliente.
- **`pago-retorno`:** Webpay devuelve aquí al cliente.
  - **Si pagó:** se confirma con Transbank y en la base (`confirmar_pago`, idempotente: recargar no cobra ni registra dos veces). Si el monto no calza o alguien ya pagó lo mismo, se devuelve solo.
  - **Si anuló o se le acabó el tiempo:** queda rechazado.
  - **Al final:** vuelve a su pantalla. La dirección de la app viaja codificada, porque Webpay vuelve a codificar la dirección de regreso, y solo se aceptan las de Tablio, así que no se puede usar para mandar a otro sitio.
- **`refund-payment`:** devuelve por la misma conexión con la que se cobró.

**Pantallas:**
- **Sucursal → "Cómo te pagan con la app":** estado de la conexión, conectar Webpay (cobrar de verdad o ambiente de pruebas) y desconectar. Mercado Pago aparece como "muy pronto".
- **Pago y pagar la cuenta:**
  - con Webpay, un botón "Pagar con Webpay" (débito, crédito o prepago) que lleva a Webpay, y a la vuelta "Confirmando tu pago…" y "¡Pago listo!" con el comprobante de Transbank;
  - sin pasarela, el aviso y "pagarle al mozo";
  - en el demo, como antes (simulado).

**Pruebas:**
- `tests/seguridad/f4-1-pasarelas.test.ts`, contra el ambiente de pruebas real de Transbank:
  - solo dueño o administrador conectan, y claves malas o mal escritas no se guardan;
  - la clave no se puede leer;
  - el cliente va a Webpay, y volver sin pagar o anulando deja el intento rechazado sin pago;
  - la vuelta nunca lleva fuera de la app, y otra persona no ve el pago;
  - sin pasarela y sin ser demo, no se cobra;
  - el dueño no puede activar lo simulado;
  - el dueño de otro local no conecta.
- `e2e/webpay.spec.ts` (a pedido y sola, `PAGOS_REALES=1 bunx playwright test e2e/webpay.spec.ts`), de punta a punta. Si corre junto a las demás, conecta la pasarela del demo y las que pagan simulado fallan; pasó así una vez en la app publicada y, solas, pasan.
  - el dueño conecta con las claves de prueba;
  - el cliente paga en Webpay con la tarjeta y el banco de prueba de Transbank y vuelve con "¡Pago listo!" y el comprobante;
  - el dueño devuelve el pago por Transbank.

---

## 2026-10-14 — Propinas: 10% sugerido y propinas por pagar al equipo ✅
**Contexto:** conversación con el fundador sobre la plata (fase 4) e investigación de la ley chilena. El artículo 64 del Código del Trabajo dice cuatro cosas:
- la cuenta debe sugerir al menos 10% de propina;
- el cliente puede no darla;
- la propina es íntegra del trabajador, sin descuentos;
- con tarjeta, el local debe entregarla en 7 días hábiles.

**Corrección:** el pago venía con **5% marcado**, bajo el mínimo legal. Ahora hay un solo selector (`SelectorPropina`, `src/lib/propina.ts`) en pagar, pagar la cuenta y pedir la cuenta:
- **10% marcado** (decisión del fundador), 15%, 20% y otro monto;
- **"Sin propina"** siempre a la vista, con la nota "Voluntaria · va íntegra al equipo";
- en el cobro en efectivo o con POS, el mozo tiene botones de 10, 15 y 20% para anotar lo que el cliente decida.

**Propinas por pagar** (`20261014150000_propinas_por_pagar.sql`). La plata de la propina queda en el local (app, POS o efectivo a la caja), y Tablio lleva la cuenta:
- **`propinas_por_pagar`** (dueño, administrador, encargado y caja): cuánto se le debe a cada mozo, desde cuándo y cuándo vence el plazo. El plazo son 7 días hábiles de lunes a viernes; los feriados no se descuentan, así que el aviso llega antes y nunca tarde.
- **`pagar_propinas`:** registra que se le pagó todo lo pendiente (efectivo, transferencia u otro, con nota).
  - Se registra con el mozo bloqueado, así que dos personas al mismo tiempo pagan una sola vez.
  - Queda en `audit_logs`.
  - Tablio no mueve la plata.
- **`mis_propinas_por_cobrar`:** el mozo ve cuánto le deben y lo que ya le pagaron. Cada mozo lee solo sus pagos.
- **La auditoría de la operación** ahora también detecta una propina pagada dos veces o a otro mozo.
- **Pantallas:**
  - Caja → "Propinas del equipo";
  - el Inicio del dueño avisa si hay propinas por pagar, y en rojo si están vencidas;
  - el perfil del mozo muestra "Mis propinas".
- **Demo:** `_sembrar_propinas_pagadas_demo` paga cada lunes las propinas de la semana anterior de la historia de ejemplo, y quedan pendientes los últimos días.

**Pruebas:**
- `tests/seguridad/p1-propinas-por-pagar.test.ts`:
  - la propina pagada con la app queda como deuda con la mozo de la mesa;
  - dos registros al mismo tiempo pagan una vez;
  - la mozo no se paga sola y ve lo suyo;
  - nadie inventa pagos desde el navegador;
  - el dueño de otro local no ve nada;
  - la auditoría sigue vacía.
- `e2e/propinas.spec.ts`: 10% marcado, "sin propina" y otro monto; el dueño registra el pago en Caja; la mozo lo ve en su perfil.

---

## 2026-10-14 — Pista P: calidad que no toca la base ✅
**Una sola capa de traducción de estados** (`src/lib/estados.ts`). La base guarda los estados en inglés (decisión del 1 de octubre) y ahora todo lo que ve una persona pasa por aquí.
- **Dos voces:** la del personal ("Nuevo", "En cocina", "Listo"…) y la del cliente ("Recibido", "En cocina", "¡Listo!"…), con plurales para las columnas.
- **También cubre** mesas, pagos y llamados.
- **Antes:** había 7 mapas sueltos, en el seguimiento, Mesas, Pedidos, el KDS, la pantalla del mozo, sus avisos y la Caja.
  - Cada uno decía distinto el mismo estado ("Preparando" y "En cocina", "Listo para entregar" y "Listo").
  - Los avisos del mozo podían mostrar el estado en inglés si no lo conocían.
- **Ahora:** un estado desconocido se muestra como "En proceso".
- **Prueba:** `src/lib/estados.test.ts` exige un texto en español para cada estado que acepta la base.
- **Cambio visible:** el seguimiento del cliente dice "¡Listo! 🔔" en vez de "¡Listo para entregar!", que es lenguaje del personal.

**Nunca un error técnico ni en inglés (regla 10)** (`src/lib/errores.ts`, `mensajeError`):
- **Qué hace con cada mensaje:**
  - los nuestros (en español) pasan tal cual;
  - los técnicos o en inglés se traducen: sin conexión, sesión cerrada, sin permiso, ya existe, archivo muy grande;
  - si no hay traducción, se reemplazan por un texto claro.
- `mensajeAmigable` ahora usa el mismo traductor.
- **23 lugares mostraban el error crudo de la base:** carta, pago, mesas, soporte, superadmin y backoffice. Ya no lo hacen.
- **Guardia:** `src/lib/errores.test.ts` recorre todas las pantallas y falla si alguna vuelve a mostrar `error.message` en un aviso.
- **La página de "no encontrado" estaba en inglés** ("Oops! Page not found"). Ahora está en español, con el estilo de la app y con una indicación para quien llega desde un QR.
- **Otros textos en inglés:** "Click para subir imagen" y "Dashboard", entre otros, quedaron en español.

**Limpieza de código sin uso** (revisado con `knip`):
- **Se borraron 7 archivos** que ninguna ruta usa: páginas viejas de Lovable (`Index`, `AdminGlobalPage`, tres del backoffice), `NavLink` y `App.css`.
- **Se quitaron las herramientas de Lovable** de la compilación (`lovable-tagger` y dos plugins) y dos dependencias sin uso (`@tailwindcss/typography`, `@testing-library/react`).
- **Se quedan:** los componentes de `components/ui` (la biblioteca de diseño acordada) y las funciones del servidor (las carga Supabase).

**Prueba frágil corregida (de la 3.8):** el descuadre a propósito de "mesa unida" suponía que la mesa 4 estaba libre; si otra prueba la ocupaba, no se detectaba. Ahora arma una cadena de mesas unidas, que es incoherente siempre.

**Estilo:** el tope bajó de 91 a 33 errores.
- Se quitaron los "any" que el sistema de tipos deduce solo.
- Se tiparon los de las pantallas de cliente y operación.
- Se corrigieron bloques vacíos y `let` que debían ser `const`.
- Lo que queda es del backoffice y de la lectura de reportes de la plataforma.

---

## 2026-10-14 — Fase 3.8: compuerta de la fase 3 ✅ (fase 3 terminada)
**Auditoría de la operación** (`auditoria_operacion()`, solo superadmin). Es igual que la de la plata y revisa que la operación calce en toda la base:
- **Turnos y propinas:** la propina es de un mozo del mismo local, y el turno del pago es de ese mozo.
- **Estaciones:** una sola estación principal activa por sucursal, y cada producto en una estación de su sucursal.
- **Pedidos:** cada pedido está en el estado de su producto más atrasado, y lo listo o entregado tiene sus horas.
- **Mesas:**
  - las sesiones abiertas no tienen cierre;
  - una mesa con pedidos no figura libre;
  - las mesas unidas apuntan a una principal válida;
  - cada mesa tiene su código de presencia;
  - cada comensal está en una mesa de su local.
- **Sellos:**
  - las visitas de cada ficha son exactamente los sellos vigentes;
  - no queda un sello vigente de un pago devuelto entero;
  - cada premio por entregar tiene código y un sello vigente.
- **Lo que queda fuera:** los pedidos de antes del estado por producto y las fichas de antes del libro de sellos vienen de reglas anteriores, y la auditoría no los revisa.

**Pruebas** (`tests/seguridad/f3-8-compuerta.test.ts`):
- **Mesas unidas de punta a punta:**
  - la mozo toma la 6 (el turno se abre solo) y le une la 7;
  - un cliente paga desde el QR de la 7 con propina: el pago cae en la 6, con la propina y el turno de la mozo;
  - la barra deja lista el agua, la mozo la lleva y el pedido sigue en preparación hasta que la cocina termina;
  - el cliente suma su sello;
  - la mozo no termina el turno con la mesa a cargo; al cerrar la principal, la 7 se libera y se separa.
- **Al mismo tiempo:** dos personas toman la misma mesa (queda una), y la cocina marca listo mientras el dueño cancela. El pedido queda coherente con sus productos.
- **Aislamiento:** las 10 tablas de la fase 3 y 8 funciones nuevas, contra un comensal, alguien sin sesión y el dueño de otro local.
- **Las tres auditorías vacías:** operación, plata y seguridad.
- **Un descuadre a propósito** (en una transacción que se deshace) que la auditoría tiene que detectar en sus 11 tipos. Para los que ya bloquea la base, como desactivar la estación principal o dejar vigente el sello de un pago devuelto, los resguardos se apagan solo dentro de esa prueba.

**Asesor de Supabase** (seguridad y rendimiento, base real):
- **Seguridad:** no hay nada nuevo que corregir. Lo que marca son decisiones a propósito:
  - invitados sin registrarse;
  - funciones que validan el rol por dentro;
  - `ver_mesa` y `ver_invitacion_mozo`, abiertas a propósito;
  - dos tablas que solo usa el servidor.
  - "Protección de contraseñas filtradas" pide el plan pagado de Supabase y queda para la fase 5.
- **Rendimiento:**
  - 18 reglas de acceso calculaban `auth.uid()` una vez por fila; ahora es una vez por consulta (misma regla, mismo resultado).
  - 28 índices nuevos en las tablas de las pantallas en vivo: productos del pedido, pedidos por sesión, mesa y sucursal, pagos, mesas, llamados, comensales, carta y sellos.
  - Quedan sin índice llaves de tablas chicas, y quedan "varias reglas permitidas" (solo rendimiento, sin riesgo): se ordenan cuando haya volumen real.

---

## 2026-10-14 — Fase 3.7: sellos que se sienten ✅
**Lo que había mal con los sellos** (revisando el código antes de animarlos). Los sumaba `process-payment` leyendo y escribiendo por separado, y eso traía cinco problemas:
- Daba un sello por cada **pago**: tres rondas, tres sellos.
- Dos pagos al mismo tiempo podían pisarse.
- Pagarle al mozo no sumaba.
- El premio "se canjeaba" al pagar, pero nadie del local se enteraba de que tenía que entregarlo.
- Los sellos retroactivos del plan (fase 2) no existían.

**Ahora los suma la base** (`20261014130000_sellos.sql`):
- Un libro de movimientos, `movimientos_lealtad`, que se llena solo con un disparador al guardarse un pago aprobado. Funciona igual para la app y para el cobro del mozo o la caja: cada persona con cuenta verificada suma por lo suyo.
- Si los sellos fallan, el pago no se cae: el problema queda anotado y el cobro sigue.
- **Límites contra el abuso** (brief 6.2):
  - un sello por cliente y día de negocio, protegido por un índice único;
  - compra mínima configurable (`loyalty_programs.monto_minimo`; en el demo, $3.000);
  - solo con cuenta verificada.
- **Sellos retroactivos:** `mis_sellos` le da al cliente que acaba de guardar su cuenta los sellos de lo que pagó en las últimas 48 horas.
- **Reembolso total:** anula el sello, los puntos y el premio que todavía no se entregó. Si ese día pagó otra cosa, el sello pasa a ese pago. Un premio ya entregado no se devuelve.
- **Premios con código** de 4 letras (sin letras que se confunden). Los entrega el personal con `entregar_premio(premio, código)`:
  - el cliente muestra el código en su celular y el mozo lo escribe;
  - la pantalla del mozo y la lista del dueño no muestran el código, así que nadie lo marca entregado sin el cliente presente;
  - queda registrado quién lo entregó, en `audit_logs`.
- **Quién ve qué:**
  - `premios_en_mesa`: el mozo ve los premios de los clientes de una mesa.
  - `premios_por_entregar`: el dueño, el encargado y la caja ven la lista del local.
- **Se borraron:**
  - la función `loyalty-status`, reemplazada por `mis_sellos`;
  - la lógica de sellos de `process-payment` y `refund-payment`;
  - el canje del premio en el pago.

**Lo que se siente (pantallas):**
- **`TarjetaSellos`:**
  - Al ganar un sello, este cae sobre la tarjeta con rebote, una onda y una vibración corta del celular.
  - Al completar la tarjeta salen chispas y aparece el premio con su código grande.
  - Si pagó como invitado, el primer casillero late como sello "fantasma" con "Guardar mi cuenta y mi sello"; al guardarla, ese sello cae.
  - Está en "¡Pago listo!", en el pago de la cuenta y en el seguimiento del pedido. En el seguimiento cae cuando el mozo registra el cobro.
- **Antes de pagar** dice qué suma ese pago: "Este pago suma tu sello 3 de 5", "Con este pago completas tu tarjeta", "Hoy ya sumaste tu sello" o "Desde $3.000…".
- **El mozo**, en el detalle de la mesa, ve "Un premio para entregar · para Juan" y lo entrega escribiendo el código.
- **El dueño**, en Lealtad:
  - configura la compra mínima;
  - el programa queda entre 2 y 30 visitas;
  - ve los premios por entregar y los últimos entregados, con quién los entregó.

**Demo:**
- Nueva cuenta `cliente@demo.tablio.test` (solo para pruebas; los clientes no entran por `/login`).
- `_sembrar_cliente_demo` le pone 4 sellos de la historia de ejemplo: al pagar hoy, el quinto completa la tarjeta.
- Para cargar esa cuenta en la base real se usó `crear_demo.py --solo-cuenta cliente`, igual que con el cajero.

**Pruebas:**
- `tests/seguridad/f3-7-sellos.test.ts`:
  - el invitado que guarda su cuenta recibe el sello y un segundo pago no suma otro;
  - una compra bajo el mínimo no da sello;
  - dos pagos simultáneos dan uno solo;
  - pagarle al mozo suma;
  - un reembolso quita el sello o lo pasa al otro pago del día;
  - el premio tiene código y el mozo lo entrega una sola vez (no lo puede marcar el cliente, la cocina ni alguien sin sesión, y no se entrega con otro código);
  - quién lee los movimientos, y que nadie se regala sellos;
  - el dueño de otro local no ve nada.
- `tests/seguridad/entorno.ts`: `guardarCuenta()` convierte a un invitado en cliente verificado con el buzón de prueba local.
- `e2e/sellos.spec.ts`: el cliente paga, el sello cae y completa la tarjeta; la mozo rechaza un código equivocado y entrega el premio con el correcto.

---

## 2026-10-14 — Fase 3.6: reportes del servidor e inicio del dueño que cuenta una historia ✅
**Antes:** los reportes traían todos los pedidos al navegador y los sumaban ahí.
- Contaban como venta pedidos sin pagar.
- Usaban días en UTC, que en Chile van de 21:00 a 20:59.
- Se iban a poner lentos con el volumen.

**Ahora los calcula la base** con `reporte_local(sucursal, desde, hasta)`:
- Por **día de negocio**: hora de Chile, con el corte de las 06:00, igual que la caja.
- **Ventas:** lo cobrado por consumo menos lo reembolsado, sin propinas. Se comparan con el período anterior.
- Ventas por día, por canal (app, efectivo, POS), platos que más se venden y los que nadie pidió, y categorías.
- **Productividad de cocina:** mediana y "9 de cada 10" de cada plato contra el tiempo de la carta, para ver qué traba.
- **Mapa de calor** día × hora, zonas, mesas (ventas, visitas, duración), clientes que vuelven y calificación.
- Período de hasta un año. Solo dueño, administrador, encargado y superadmin.

**Inicio del dueño** (`/admin/<local>/inicio`, nueva sección; ahora es la entrada del dueño). Usa `historia_del_local` y, en vez de veinte gráficos, cuenta en palabras:
- "Ayer vendiste $X en N pagos, 12% más que el lunes pasado", el plato estrella, la zona y la hora más fuertes, quién vendió más, el ticket, las propinas y la calificación.
- Lo de hoy en vivo y los últimos 7 días contra la semana anterior.
- Avisos: platos agotados, un plato que sale claramente más lento que lo que dice la carta, y lo perdido en mesas que se fueron sin pagar.

**Pantalla de Reportes** reescrita sobre `reporte_local`:
- Períodos: hoy, 7, 30 y 90 días.
- Pestañas: Resumen, Platos, Cocina, Horas, Mesas y zonas, y Clientes.
- Exporta a CSV.
- Se borraron los 8 componentes viejos que calculaban en el navegador.

**Historia de ejemplo en el demo** (`_sembrar_historia_demo`).
- **Por qué:** al reiniciar el demo se borraba todo, y el inicio y los reportes quedaban vacíos, así que no servían para mostrar Tablio.
- **Cuándo:** ahora `reiniciar_demo` siembra 4 semanas creíbles. Las pruebas locales y la integración continua también las siembran.
- **Qué trae:**
  - más gente el fin de semana y peaks de almuerzo y noche;
  - platos estrella, propinas, pagos con app, efectivo y POS, y calificaciones;
  - días cerrados y cuadrados en caja;
  - una chorrillana que esta semana sale lenta, para que el inicio la avise.
- **Límites:**
  - solo toca el local de demo y solo días anteriores a hoy (hoy queda limpio para probar);
  - cada pago calza con sus pedidos, así que `auditoria_plata()` sigue vacía.
- **Lo que no tiene:** clientes registrados. Esos se ven cuando pagan personas reales.

**Error encontrado y corregido:** la "hora más fuerte" del inicio agrupaba mal y fallaba apenas había ventas de días anteriores. Lo destapó la historia de ejemplo.

**Pruebas:**
- `tests/seguridad/f3-6-reportes.test.ts`:
  - un pago nuevo aparece en ventas, canal, plato, hora e inicio;
  - un pedido sin pagar no cuenta como venta;
  - mozo, cocina, caja, comensal, anónimo y el dueño de otro local no ven nada;
  - las funciones internas, incluida la siembra, no se llaman desde el navegador;
  - el período tiene límite.
- `e2e/reportes.spec.ts`: el dueño entra al inicio y ve la historia y el aviso de la chorrillana; recorre los reportes y mira el inicio en el celular. La caja no ve reportes.

---

## 2026-10-14 — Fase 3.5: código de presencia, cuenta abierta controlada y unir mesas ✅
**Código de presencia** (brief 5.1). Cada mesa tiene 4 números impresos que prueban que el cliente está ahí y no en su casa con una foto del QR.
- **Dónde se guarda:** los códigos viven en `codigos_mesa`, que solo lee el personal. El comensal puede leer la fila de su mesa, así que ahí se lo saltaría.
- **Cuándo se pide:** solo para lo que no se paga al pedir (pagar al mozo, agregar a mi cuenta). Pagar con la app no tiene riesgo y no se le suma fricción. Es configurable en Sucursal: solo para pedir sin pagar (recomendado), siempre (también para pagar con la app) o nunca.
- **Cómo se exige:** disparadores en `orders` y `cotizaciones`; se pide una vez por visita.
- **Contra adivinanzas:** `confirmar_presencia` bloquea 10 minutos tras 5 intentos fallidos, así que no se puede adivinar probando.
- **El comensal** lo escribe en una ventanita; si no lo encuentra, el mozo lo ve en el detalle de la mesa.
- **El dueño** lo ve en QR, sale en las tarjetas impresas y puede cambiarlos todos (`cambiar_codigos_mesa`, queda auditado). Se recomienda pegarlo aparte del QR.

**Cuenta abierta controlada** (brief 4).
- Límite por persona (`branches.limite_cuenta_persona`, $30.000 por defecto). Al llegar, la app le pide pagar lo que lleva para seguir pidiendo.
- Lo que queda sin pagar al cerrar una mesa (solo un encargado puede hacerlo, con motivo) se marca como **pérdida** (`orders.perdido_at`) y queda en la auditoría.
- En **Mesas**, el dueño ve "Lo que todavía no se paga": lo que arriesga ahora y lo perdido en 30 días, con el motivo de cada mesa (`riesgo_cuenta_abierta`).

**Unir mesas** (brief 5.2).
- El mozo une una mesa a otra para un grupo grande (`unir_mesas`). Lo que ya pasaba en la secundaria (comensales, pedidos, pagos, llamados) pasa a la principal, y su QR lleva a la principal.
- Todas las entradas del comensal por QR resuelven la mesa con `_mesa_del_qr`: un solo cambio, comprobado.
- Los pedidos guardan su mesa física, para saber a cuál llevar.
- "Separar" (`separar_mesa`) la libera, y al cerrar la principal se liberan solas.

**Pruebas:**
- `tests/seguridad/f3-5-mesas.test.ts`: 6 pruebas.
  - Sin código no se pide sin pagar; un código malo se rechaza; probar 5 veces bloquea.
  - El comensal no ve el código (ni leyendo su mesa); el mozo y el dueño sí, la cocina no; solo el dueño los cambia.
  - Modos "nunca" y "siempre".
  - Límite de cuenta, pérdida registrada y riesgo visible (no para el mozo).
  - Unir, con pedidos y pagos que se mudan, y QR que lleva a la principal; separar y cerrar liberan.
  - No se une una mesa de otro mozo.
- Las pruebas anteriores de "pagar al mozo" ahora ingresan el código, como un cliente real.
- `e2e/mesas-presencia.spec.ts`:
  - el cliente ingresa un código equivocado y después el correcto;
  - el mozo ve el código, une la 7 a la 6 y las separa;
  - el dueño ve los códigos en QR y el riesgo en Mesas.
- **Base desechable:** 167 de 167 de seguridad y 64 de 64 de navegador.
- **Base de pruebas:** 151 de seguridad (más 16 que solo corren en la desechable).

---

## 2026-10-14 — Fase 3.4b: app instalable y aviso con el celular bloqueado ✅
**Qué es:** el comensal puede pedir que le avisen cuando su pedido esté listo y el aviso le llega aunque tenga el celular bloqueado. Además, Tablio se instala en el celular sin pasar por la tienda de apps.
- Usa el estándar de los navegadores (Web Push). No requiere cuentas externas ni costo.
- Los avisos los entregan los servicios que ya traen Google, Apple y Mozilla en sus navegadores.

**Cómo funciona:**
- **App instalable:**
  - manifiesto (`public/manifest.webmanifest`) e íconos con la marca;
  - etiquetas para iPhone en `index.html`;
  - en la carta y el seguimiento, la app instalada lleva **el nombre del local y abre directo esa mesa**;
  - en Android aparece "📲 Instalar la app".
- **Archivo de avisos (`public/sw.js`):** recibe el aviso, muestra la notificación y, al tocarla, abre el pedido. No guarda nada en caché, así que la app siempre se carga fresca.
- **Migración `20261014100000_avisos_push.sql`:**
  - `suscripciones_push`: la dirección de aviso de cada celular, ligada a su identidad; cada uno ve y borra solo las suyas, y el personal no las ve;
  - `guardar_suscripcion_push`: solo para quien está en la mesa, solo direcciones seguras (`https`) y máximo 5 por persona;
  - `order_items.avisado_at`: para no avisar dos veces lo mismo.
- **Función `avisar-listo`:**
  - la llama la pantalla de cocina al marcar algo listo; solo la cocina, el encargado o el dueño pueden usarla;
  - envía "Ya está listo: Agua mineral. El mozo te lo trae." a cada celular del comensal;
  - si un celular ya no acepta avisos, olvida esa dirección.
- **Cifrado y firma propios** (`supabase/functions/_shared/webpush.ts`, según los estándares RFC 8291 y 8292, solo con las herramientas de cifrado del servidor). La librería `npm:web-push` botaba el servidor de funciones con una clave inválida, así que la reemplacé.
- **Claves de avisos (VAPID):** la privada se generó y se guardó directo en Supabase, sin mostrarse. La pública está en `src/lib/push.ts`.
- **En pantalla:** "🔔 Avísame cuando esté listo, aunque bloquee el celular" y "Te avisaremos aunque bloquees el celular". En iPhone sin instalar, explica cómo agregarla a inicio (Apple solo avisa a apps instaladas).

**Pruebas:**
- `tests/seguridad/f3-4b-cifrado.test.ts`: lo que cifra el servidor lo descifra el "celular" con la receta oficial; la firma VAPID es válida; claves inválidas dan un error normal.
- `tests/seguridad/f3-4b-avisos.test.ts`:
  - cada uno guarda y ve solo su dirección de aviso;
  - el personal no las ve;
  - solo la cocina dispara el aviso;
  - lo listo se avisa una sola vez.
- `e2e/app-instalable.spec.ts`: manifiesto, íconos y archivo de avisos publicados; desde la mesa, la app lleva el nombre del local y abre esa mesa; el seguimiento ofrece los avisos.
- **Entrega real** (`e2e/avisos-reales.spec.ts`, con `AVISOS_REALES=1`, fuera de la integración continua porque usa internet): un Firefox de verdad se suscribe al servicio de Mozilla, la cocina marca listo y **el aviso llega** con su texto. Probado en la base desechable y en la app publicada.
- **Base desechable:** 161 de 161 de seguridad y 63 de 63 de navegador.
- **Base de pruebas:** 145 de seguridad (más 16 que solo corren en la desechable).

---

## 2026-10-14 — Fase 3.4: la mesa en vivo para el comensal ✅
**Antes:**
- El seguimiento decía siempre "Listo en aprox. 10-15 min", sin importar el plato ni la cocina.
- La cerveza lista no se notaba si la comida seguía en preparación.
- El botón "Pedir otra ronda" solo volvía a la carta.

**Ahora (migración `20261014090000_mesa_en_vivo.sql`):**
- **`mi_mesa_en_vivo`** (solo para quien está en la mesa):
  - quién está en la mesa (su nombre o "invitado"; cada uno puede ponerse un nombre);
  - **mis** pedidos, con cada producto, su estado y su estación;
  - un **tiempo estimado real**: lo que de verdad tardó cada plato los últimos 30 días (mediana, con al menos 5 casos) o el tiempo que puso el dueño, más la fila de su estación (unos 3 productos a la vez; cada tanda delante suma 2 minutos).
  - El comensal sigue sin leer estaciones ni pedidos ajenos.
- **Seguimiento:**
  - "Listo en aprox. N min · según cada plato y lo cargada que está la cocina";
  - cada producto con "Recibido en Barra", "Preparando" o "¡Listo!";
  - "✅ Ya está listo: Agua mineral. Sigue en Cocina: Barros Luco.";
  - "En tu mesa: Tú (Juan) · 1 invitado".
- **Aviso cuando algo queda listo:** sonido, vibración y un mensaje, y una notificación del navegador si la pestaña está en segundo plano y el comensal lo permitió ("🔔 Avísame cuando esté listo"). Con la pantalla bloqueada queda para el paso 3.4b (app instalable y notificaciones push).
- **"Otra ronda · repetir este pedido":** copia el pedido al carrito con sus opciones y deja fuera lo agotado. El precio lo vuelve a calcular el servidor al pagar. En la pantalla de pago, el botón que solo volvía a la carta ahora dice "Seguir pidiendo".
- **"⭐ Lo de siempre"** arriba de la carta (`lo_de_siempre`): lo que esa persona pidió en dos visitas o más, si hoy está disponible y no tiene opciones obligatorias. Se agrega con un toque. Sirve también para un invitado que vuelve con el mismo celular.
- Ya no se repite "Mesa 2 · Mesa 2" cuando el nombre de la mesa es igual a su número.

**Pruebas:**
- `tests/seguridad/f3-4-mesa-en-vivo.test.ts`: 3 pruebas.
  - Productos por estación con tiempo estimado; lo listo no espera lo demás; al quedar todo listo, ya no hay estimado.
  - Se ve quién está, pero cada uno ve solo sus pedidos; quien no está en la mesa no ve nada.
  - "Lo de siempre" aparece con dos visitas y nunca para alguien nuevo.
- `e2e/mesa-en-vivo.spec.ts`:
  - el comensal ve su pedido por estación y se pone nombre;
  - la barra deja lista el agua y le llega el aviso;
  - "Otra ronda" llena el carrito;
  - tras dos visitas, la carta le ofrece "Lo de siempre".
- **Base desechable:** 156 de 156 de seguridad y 62 de 62 de navegador.
- **Base de pruebas:** 140 de seguridad (más 16 que solo corren en la desechable).

---

## 2026-10-14 — Fase 3.3: control del equipo ✅
**Antes:** el dueño no sabía quién hacía qué ni cuánto tardaban. El semáforo del mozo tenía minutos fijos en el código, y nadie avisaba si un plato listo se quedaba enfriándose.

**Ahora (migración `20261014080000_control_equipo.sql`):**
- **Tiempos objetivo por sucursal**, que el dueño edita en Sucursal: responder un llamado (2 min), llevar lo listo (5 min) y el pedido completo (20 min). El semáforo del mozo los usa: verde dentro del objetivo, ámbar al pasarse, rojo al doble.
- **Alerta de abandono:** si algo listo de sus mesas pasa el objetivo, el mozo ve "Hay pedidos listos esperando · Mesa 4: listo hace 6 min", la tarjeta se marca en rojo y suena una vez. En la cocina, la tarjeta dice "Listo hace 6 min y nadie lo ha llevado".
- **Quién hizo qué:**
  - cada producto guarda quién lo entregó (`delivered_by`);
  - cada visita guarda el mozo a cargo al cerrarla (`table_sessions.staff_id`), y **la calificación del cliente es de ese mozo**. Si un encargado cierra la mesa, igual cuenta para el mozo que la atendía.
- **`ranking_equipo`** (dueño, administrador y encargado), por hoy, 7 o 30 días: mesas cerradas, entregas, ventas, ticket promedio, propinas, tiempo para responder llamados y para llevar lo listo (promedio y % a tiempo, con semáforo) y calificación. Los tres primeros en ventas llevan medalla.
- **Metas** (`metas_mozo`): de ventas o de mesas cerradas, por día, semana o mes, para un mozo o para todos (la propia gana a la general).
  - El mozo ve en su Perfil la barra de avance ("¡Meta cumplida! 🎉") y cómo va hoy en tiempos y calificación (`mi_desempeno`).
  - El demo trae una meta general de $150.000 diarios. Las metas son configuración: reiniciar el demo no las borra.

**Pruebas:**
- `tests/seguridad/f3-3-equipo.test.ts`: 5 pruebas.
  - Queda anotado quién entregó, quién atendía y la calificación; el ranking y el perfil lo muestran con la meta.
  - Solo el dueño o el encargado ven el ranking, con un período razonable.
  - Metas: las pone el dueño; cada mozo ve la suya y la general, no la de otro; no se duplican.
  - Los tiempos objetivo los cambia el dueño, dentro de rangos (el mozo no).
  - El dueño de otro local no ve el ranking ni pone metas.
- `e2e/equipo-desempeno.spec.ts`:
  - el dueño baja el objetivo a 1 minuto;
  - un plato listo espera y aparecen las alertas en el mozo y en la cocina;
  - el dueño ve el desempeño y le pone una meta a Camila, y ella la ve en su perfil;
  - el objetivo vuelve a 5 minutos.
- **Base desechable:** 153 de 153 de seguridad y 60 de 60 de navegador.
- **Base de pruebas:** 137 de seguridad (más 16 que solo corren en la desechable).
- **Arreglo de una prueba antigua:** la integración continua falló una vez. La prueba antigua de cocina (`flujo-demo`) revisaba que no quedara ningún botón "ENTREGADO" en toda la pantalla. En GitHub las pruebas corren de a dos, y la prueba nueva deja un plato listo esperando a propósito, así que la antigua veía un botón ajeno. Ahora revisa solo la tarjeta de su pedido.

---

## 2026-10-14 — Fase 3.2: cocina y barra por separado, y KDS robusto ✅
**Antes:**
- La base ya separaba estaciones y estado por producto (fase 1.4), pero la pantalla de cocina mostraba todo junto.
- Nadie podía crear una "Barra" ni decir qué va a cada estación.
- El mozo solo veía "listo" cuando todo el pedido estaba listo: la cerveza esperaba a la hamburguesa.
- Si se cortaba internet, la pantalla no recuperaba lo que llegaba mientras tanto.

**Ahora:**
- **Migración `20261014070000_estaciones.sql`:**
  - la estación principal no se borra ni se desactiva;
  - un producto nunca va a una estación desactivada o de otra sucursal: cae en la principal;
  - al desactivar o borrar una estación, lo pendiente pasa a la principal, para que ninguna comanda quede en una pantalla que nadie mira;
  - el demo trae una "Barra" para Cervezas, Tragos y Sin alcohol (también en `crear_demo.py`).
- **KDS:**
  - **selector de estación** (Todas · Cocina · Barra), recordado en ese equipo y en la dirección (`?estacion=`);
  - cada tarjeta muestra solo los productos de esa estación y avanza solo eso;
  - en "Todas", cada producto lleva el nombre de su estación;
  - se actualiza en vivo también por producto.
- **KDS robusto:**
  - al volver internet, al reconectarse y al volver a la pestaña recarga todo, y además cada 30 segundos;
  - muestra "actualizado hh:mm:ss";
  - si se corta internet, un aviso rojo grande: "Sin conexión. Los pedidos nuevos aparecerán solos al volver internet".
- **Mozo:**
  - la mesa se pone verde apenas una estación deja algo listo: "Listo en Barra · lo demás sigue en preparación";
  - "Entregado ✓" lleva solo lo listo.
- **Dueño:**
  - en Sucursal, la sección "Estaciones": crear, renombrar y activar o desactivar;
  - en Carta, cada categoría elige "Se prepara en".

**Pruebas:**
- `tests/seguridad/f3-2-estaciones.test.ts`: 5 pruebas.
  - Bebidas a la barra y comida a la cocina.
  - La barra avanza lo suyo sin tocar la cocina, y el mozo lleva la bebida sin esperar la comida.
  - Solo el dueño o el encargado configuran estaciones; la principal no se borra ni se desactiva.
  - Al desactivar una estación, lo pendiente pasa a la principal.
  - El dueño de otro local no toca ni usa las estaciones del demo.
- `e2e/estaciones.spec.ts`:
  - dos pantallas de cocina (Barra y Cocina) con un pedido de agua y Barros Luco;
  - la barra deja lista el agua y el mozo la lleva;
  - se corta internet en la cocina y aparece el aviso;
  - llega un pedido mientras tanto y, al volver internet, aparece solo.
- **Base desechable:** 148 de 148 de seguridad y 59 de 59 de navegador.
- **Base de pruebas:** 133 de seguridad (más 15 que solo corren en la desechable).

---

## 2026-10-14 — Fase 3.1: turnos de mozo y propina del mozo de la mesa ✅
**Decisión del fundador (14 de octubre):** "el mozo que toma la mesa es el que le llega la propina". El cliente no elige; se actualizó el brief (6.2).

**Antes:**
- si el cliente pagaba con la app antes de que un mozo tomara la mesa, la propina quedaba "Sin mozo asignado";
- si la caja cobraba en efectivo una mesa de un mozo, la propina quedaba a nombre de la caja;
- no había turnos.

**Ahora (migración `20261014060000_turnos_y_propinas.sql`):**
- **Turnos** (tabla `turnos`): inicio, fin, duración, quién lo abrió y quién lo cerró. Un solo turno abierto por persona.
  - `abrir_turno`: un doble toque no abre dos.
  - `cerrar_turno`: el mozo no puede terminar su turno con mesas a cargo. Un encargado puede cerrar un turno olvidado, con motivo, y queda en la auditoría.
  - `mi_turno` y `turnos_sucursal` entregan duración, mesas, pagos, ventas y propinas netas de reembolsos.
  - Tomar una mesa sin turno lo abre solo.
- **La propina es del mozo de la mesa:**
  - `atribuir_propina`, al guardar un pago, lo deja a nombre del mozo de la mesa, aunque cobre la caja (quién cobró queda en el detalle). Si la mesa no tiene mozo, queda pendiente.
  - `al_asignar_mozo`: cuando un mozo toma la mesa, los pagos pendientes de esa visita pasan a ser suyos. En una transferencia, lo ya pagado queda con el anterior, y no se toca un día de caja ya cerrado.
  - Cada pago guarda su turno.
  - Los pagos anteriores que quedaron a nombre de la caja quedaron sin dueño.
- Reiniciar el demo también borra los turnos.
- Los botones para cerrar paneles y ventanas decían "Close" en el texto oculto para lectores de pantalla; ahora dicen "Cerrar" (regla 10).

**Pantallas:**
- **Mozo:** barra verde "En turno desde 18:02 · 2 h 15 min · Propinas $X", que se actualiza con cada pago, o "Empezar turno" si no tiene. En **Perfil**, "Mi turno" muestra desde, duración, mesas, ventas y sus propinas (cuánto en efectivo), y el botón "Terminar turno".
- **Dueño:** en Equipo, la sección "Turnos" lista mozo, inicio, fin, duración, mesas, ventas y propinas, con el total. Permite filtrar por días y cerrar un turno olvidado con motivo.

**Pruebas:**
- `tests/seguridad/f3-1-turnos.test.ts`: 6 pruebas.
  - Abrir y cerrar turno; un doble toque abre uno solo.
  - Tomar una mesa abre el turno solo; no se termina el turno con mesas a cargo.
  - La propina es del mozo aunque cobre la caja.
  - Pagado antes de tomar la mesa: la propina va al primero que la toma, y transferir no se la quita.
  - Quién ve qué turnos; el encargado cierra con motivo y queda auditado.
  - El dueño de otro local no ve ni cierra turnos.
- `e2e/turnos.spec.ts`: la mozo empieza su turno, un cliente paga con propina, ella toma la mesa y la propina aparece en su barra. No puede terminar el turno con la mesa a cargo; el dueño ve el turno en Equipo; ella cierra la mesa y termina su turno.
- **Base desechable:** 143 de 143 de seguridad y 58 de 58 de navegador. **Base de pruebas:** 129 de seguridad (más 14 que solo corren en la desechable).

---

## 2026-10-14 — Fase 2.E: compuerta de la plata ✅ (fase 2 terminada)
**Qué es:** igual que la compuerta de seguridad de la fase 1.10, pero para los montos. Es una revisión automática de que la plata calza en toda la base, y una batería con los casos difíciles que faltaban.

**Error encontrado y corregido:**
- Un pago con la app de varios pedidos pendientes (cuenta abierta) guardaba solo el primero. Si después se reembolsaba completo, solo ese pedido quedaba "reembolsado".
- Ahora cada pago guarda todos sus pedidos (`payments.pedidos`, lo llena un disparador al guardar el pago y se completó para los pagos existentes), y `confirmar_reembolso` los marca todos.

**`auditoria_plata()`** (migración `20261014050000_compuerta_plata.sql`, solo superadmin). Si sale vacía, todo calza. Revisa que:
- lo reembolsado de cada pago sea la suma exacta de sus reembolsos, y que nunca supere lo cobrado;
- el estado del pago corresponda a lo devuelto;
- no queden reembolsos trabados ni intentos de pago sin resolver;
- todo intento aprobado tenga su pago, y que no haya pagos duplicados;
- todo pedido pagado tenga pago y ninguno esté cobrado dos veces;
- lo cobrado sea igual al total de los pedidos;
- en prepago, nada esté en cocina sin pagar;
- cada pago tenga su día de negocio;
- **ningún cierre de caja haya cambiado** después de cerrarse (se recalcula y se compara con lo guardado).

Los pedidos de antes del 1 de octubre vienen del sistema anterior y no se revisan: hay uno pagado sin pago, anotado en el diagnóstico (N17).

**Pruebas (`tests/seguridad/f2e-compuerta-plata.test.ts`, 9):**
- El mozo cobra en efectivo mientras el comensal paga lo mismo con la app: se cobra una sola vez.
- La misma clave de pago con otro carrito no cobra lo nuevo, y otra persona no puede usar esa clave.
- Tres reembolsos parciales del 60% al mismo tiempo: pasa uno solo. El resto exacto sí se devuelve; un peso más, no.
- Pagar varios pedidos juntos y reembolsar todo: todos quedan reembolsados (el error de arriba).
- Un reembolso que la pasarela rechaza libera la reserva y se puede volver a intentar; confirmar dos veces no cambia nada.
- Un reembolso al mismo tiempo que el cierre de caja: el cierre no cambia después.
- **La auditoría sí detecta descuadres:** se descuadra a propósito, dentro de una transacción que después se deshace (un reembolso inventado, un cobro duplicado con monto alterado, un pedido en cocina sin pagar, otro "pagado" sin pago y un cierre falseado), y tiene que dar las 7 alarmas que corresponden.
- Después de todo, la auditoría sale vacía en toda la base.

Con estas pruebas, los casos del plan quedan cubiertos entre las pruebas de f2a a f2e: pago repetido, pagos al mismo tiempo, pago tardío, reembolso doble y dos personas pagando lo último.

**Resultados:**
- Base desechable: 137 de 137 de seguridad y 57 de 57 de navegador.
- Base de pruebas: 124 de seguridad (más 13 que solo corren en la desechable). La auditoría de la plata sale vacía.

---

## 2026-10-14 — Fase 2.D: día de negocio y cierre de caja con conciliación automática ✅
**Antes:**
- La función `reconcile-payments` contaba el día en UTC. En Chile eso es de 21:00 a 20:59, así que una noche de bar quedaba partida en dos.
- Dejaba fuera el efectivo y no cuadraba nada contra lo contado en el cajón.

**Ahora (migración `20261014040000_cierre_caja.sql`):**
- **Día de negocio:** cada sucursal tiene una hora de corte (`corte_dia`, por defecto 06:00 de Chile). Lo que pasa entre las 06:00 y las 05:59 del día siguiente es un solo día, también con el cambio de horario de invierno. Cada pago y cada reembolso queda anotado en su día al ocurrir; el reembolso cuenta el día en que se devolvió la plata.
- **`resumen_caja`:** la base calcula la conciliación en vivo:
  - lo que se cobró por la app, en efectivo y por POS;
  - los reembolsos de cada medio y los cobros que la app devolvió sola;
  - lo que debería haber en cada medio y el total neto;
  - las **propinas por mozo**, ya descontado lo reembolsado (cuánto fue en efectivo);
  - avisos antes de cerrar: pedidos sin cobrar, pagos sin confirmar por la pasarela, pedidos con alerta y mesas abiertas.
- **`cerrar_caja`:** la caja anota el efectivo contado (y el POS, si quiere). La base calcula la diferencia:
  - si no cuadra, **exige una nota** que la explique;
  - el cierre guarda todo lo que se cuadró y queda **bloqueado**: un disparador impide cambiarlo, y no se puede cerrar dos veces ni cerrar un día que no ha empezado;
  - se registra en la auditoría;
  - dos cierres al mismo tiempo dejan uno solo.
- **Lo que llega después de cerrar** (un pago tardío, un reembolso) cae en el día siguiente, así que el cierre nunca cambia. Un candado sobre la sucursal ordena los pagos y el cierre.
- La app contra la pasarela: con el proveedor simulado, la pasarela deposita lo mismo. La comparación real llega en la fase 4.
- Se retiró la función `reconcile-payments`, de `config.toml` y de la base de pruebas.

**Pantalla de Caja:**
- El selector ahora es el "día de negocio".
- La pestaña "Cierre de caja" muestra el cuadre por medio. La diferencia aparece al escribir lo contado (verde "Cuadra" o rojo "Faltan/Sobran $X"), con avisos, propinas por mozo, confirmación antes de cerrar e historial de cierres.

**Pruebas:**
- `tests/seguridad/f2d-cierre-caja.test.ts`: 7 pruebas.
  - Cuadre exacto de app, efectivo, POS, reembolsos y propinas.
  - Cierre con diferencia y nota, bloqueado, visible después y auditado.
  - Dos cierres a la vez: uno solo.
  - No se cierra un día futuro ni con montos negativos; mozo, cocina, comensal, anónimo y dueño ajeno no ven ni cierran; las funciones internas están cerradas.
  - Lo que llega después del cierre cae al día siguiente.
  - El corte de las 06:00, en verano y en invierno.
- `f1-10` usa el cierre nuevo.
- `e2e/caja.spec.ts`: un comensal paga con la app y otro en efectivo al mozo. La cajera ve el cuadre, anota $1.000 menos y le pide explicarlo; cierra un día pasado y queda con candado.
- **Base desechable:** toda la batería. **Base de pruebas:** 118 de seguridad (más 10 que solo corren en la desechable).

---

## 2026-10-14 — Fase 2.C: reembolsos atómicos ✅
**Antes:**
- reembolsaban solo el dueño o el administrador;
- se llamaba al proveedor y después se anotaba;
- dos reembolsos al mismo tiempo podían devolver más de lo cobrado;
- la lealtad se buscaba por un correo parecido (`ilike`).

**Ahora (migración `20261014030000_reembolsos.sql`, `refund-payment` publicada de nuevo):**
1. **`reservar_reembolso`**:
   - valida el rol: dueño, administrador, encargado o **caja** (brief 5.4);
   - exige motivo, de 5 a 500 letras;
   - **bloquea el pago y cuenta los reembolsos en curso**, así que nunca se devuelve más de lo cobrado (consumo más propina), ni con dos pedidos a la vez.
2. La plata se devuelve por la pasarela o, en pagos en **efectivo o POS, en el local** (`devolucion = local`), sin llamar a la pasarela.
3. **`confirmar_reembolso`** deja todo junto: el pago queda "reembolsado" o "reembolso parcial"; si es total, los pedidos de ese pago quedan "reembolsados"; la sesión descuenta lo devuelto; y la **auditoría** guarda quién, con qué rol, cuánto y por qué. Es idempotente: si falla la devolución, la reserva se libera.
- La lealtad solo se revierte en el primer reembolso total, y por coincidencia exacta del correo.
- Caja muestra "POS" como medio de pago.

**Queda para la 2.D:** las propinas por mozo, calculadas por el servidor dentro del cierre de caja.

**Pruebas:**
- `tests/seguridad/f2c-reembolsos.test.ts`: 5 pruebas.
  - Reembolso en partes por la caja, pedido reembolsado al completar, auditoría y nada de más.
  - **Dos reembolsos totales a la vez: uno solo.**
  - Sin motivo, con monto de más o sin rol (mozo, cocina, comensal, sin sesión): no.
  - El efectivo se devuelve en el local.
  - Nadie escribe reembolsos ni pagos desde el navegador.
- `e2e/caja-reembolso.spec.ts`: un comensal paga y la cajera lo reembolsa con motivo. Queda "Reembolsado" y aparece en la pestaña Reembolsos.
- **Base desechable:** 121 de seguridad y 57 de navegador. **Base de pruebas:** 114 de seguridad (más 7 que solo corren en la desechable).

---

## 2026-10-14 — Fase 2.B: pagar al mozo y cuenta abierta ✅
**Decisión del fundador (1 de octubre):** al pagar, el comensal puede elegir "Pagar al mozo" (efectivo o POS) o, en locales con cuenta abierta, "Agregar a mi cuenta". Es un respaldo: lo principal sigue siendo pagar en la app.

**Base (migración `20261014020000_pagar_al_mozo.sql`):**
- **`pedir_sin_pagar(código, productos, forma)`:** el comensal pide sin pagar en la app.
  - El precio sale de `calcular_precios` y la base numera el pedido.
  - **"mozo":** queda por cobrar. **En prepago no pasa a cocina** hasta que se cobre (regla 1).
  - **"cuenta":** solo en locales con cuenta abierta; va directo a cocina y se paga al final.
  - Contra el abuso: máximo 3 pedidos esperando al mozo por persona, y solo quien está en la mesa.
- **`registrar_cobro_mozo(pedidos, efectivo|pos, propina, recibido)`:** el mozo (en sus mesas o en las libres), la caja, el encargado o el dueño registran el cobro.
  - Queda como pago, con quién cobró (`staff_id`) y la propina.
  - Calcula el vuelto, y rechaza un monto recibido que no alcanza o una propina absurda.
  - Bloquea los pedidos: **dos personas no registran el mismo cobro**.
  - Deja el registro en el historial del pedido.
- **`orders.forma_pago`** (app, mozo, cuenta): cómo eligió pagar cada pedido.

**App:**
- **Pago del comensal:** bajo "Pagar con tarjeta", en texto secundario, "💵 Prefiero pagarle al mozo (efectivo o tarjeta)" y, en cuenta abierta, "🧾 Agregar a mi cuenta y pagar al final". Cada uno lleva a su pantalla de confirmación.
- **Seguimiento:** el pedido muestra "💳 Por pagar al mozo" hasta que se cobre, y cambia solo cuando el mozo registra el cobro.
- **Mozo:**
  - la tarjeta "💳 Por cobrar" trae el botón "Cobrar";
  - en el detalle, la caja "Por cobrar" muestra el total con "💵 Efectivo" y "💳 POS";
  - el cobro pide propina y recibido, muestra el vuelto (o lo que falta) y registra.
- **Pagar lo pendiente al final** (cuenta abierta): cada comensal paga solo lo suyo (cotización tipo "pedidos" de la 2.A).

**Pruebas:**
- `tests/seguridad/f2b-pagar-al-mozo.test.ts`: 5 pruebas.
  - Pagar al mozo en prepago: no pasa a cocina hasta cobrar; después sí, con vuelto, registro y sin doble cobro.
  - **Dos personas registrando el mismo cobro a la vez: uno solo.**
  - Permisos (cocina, invitado y mesa de otro mozo no; caja sí) y montos válidos.
  - Tope de 3 pedidos esperando.
  - Cuenta abierta: no en prepago; en cuenta abierta va a cocina, y **cada uno paga lo suyo al final**.
- `e2e/pagar-al-mozo.spec.ts`, con tres pantallas a la vez:
  - el comensal elige "pagarle al mozo" y queda "Por pagar al mozo";
  - la cocina lo ve "esperando pago";
  - el mozo cobra en efectivo con vuelto;
  - el comensal ve "Recibido ✓" y la cocina lo recibe para preparar.
- **Base desechable:** 116 de seguridad y 56 de navegador. **Base de pruebas:** 109 de seguridad (más 7 que solo corren en la desechable).

---

## 2026-10-14 — Fase 2.A: núcleo del pago ✅
**Antes:** `process-payment` cobraba primero y después escribía el pedido y el pago por separado. Si algo fallaba entremedio podía quedar un cobro sin pedido o un pedido sin pago. El precio no se congelaba, y dos personas pagando lo mismo a la vez podían cobrar dos veces.

**Ahora, en cuatro pasos:**
1. **Cotización** (`cotizaciones`, `cotizar`, `crear_cotizacion`):
   - el servidor calcula el precio con `calcular_precios` y lo congela por 10 minutos;
   - en "pagar lo pendiente", toma por defecto **solo los pedidos del propio comensal** (cada persona paga lo suyo, regla 8).
2. **Intento reservado antes de cobrar** (`intentos_pago`, `reservar_intento_pago`): la clave única queda guardada antes de llamar al medio de pago.
   - El mismo pago repetido (doble toque, mala señal) responde lo de antes y no cobra otra vez.
   - No se puede empezar a pagar con una cotización vencida ni con otro pago en curso.
3. **Cobro** (simulado; la pasarela real llega en la fase 4).
4. **Confirmación atómica** (`confirmar_pago`): pedido, productos, pago, sesión, mesa y popularidad se escriben juntos o no se escribe nada.
   - Es idempotente: si la pasarela avisa dos veces, no se duplica nada.
   - **Pago tardío** con el monto correcto: se respeta el precio congelado.
   - **Monto que no calza:** se devuelve automáticamente.
   - **Dos personas pagando lo mismo** de la mesa: a la segunda se le devuelve la plata.
   - **Producto agotado** mientras alguien pagaba: se respeta el pedido y `orders.alerta` lo avisa en la cocina con "🚨".
   - **Cada pago guarda el mozo que atendía la mesa** (`payments.staff_id`), para el informe de propinas por mozo y turno (brief 7). También guarda quién pagó (`user_id`).

**App:**
- **Pago del comensal:** al abrir el pago, el servidor cotiza y la pantalla muestra **"🔒 Precio asegurado por 10 minutos"** con el total del servidor.
  - Si algo se agotó o una opción no es válida, avisa antes de pagar y no deja pagar.
  - Si el precio venció, cotiza de nuevo y avisa si cambió.
  - La clave del pago es la misma para el mismo intento.
- **Cocina:** muestra la alerta de producto agotado después de pagado.
- `process-payment` reescrito sobre los cuatro pasos (y publicado). Sigue aceptando el pedido directo del carrito, que cotiza en el servidor.

**Pruebas:**
- `tests/seguridad/f2a-pago.test.ts`: 9 pruebas.
  - La cotización congela, es solo del comensal y nadie la escribe.
  - **Si el dueño sube el precio después de cotizar, se cobra el congelado.**
  - **El mismo pago 5 veces al mismo tiempo: un solo cobro.**
  - **Dos pagos de la misma cotización a la vez: uno solo.**
  - **Dos personas pagando lo mismo: a la segunda se le devuelve.**
  - Producto agotado durante el pago: se respeta, con alerta.
  - Mozo y propina en el pago.
  - En la base desechable: cotización vencida rechazada; **pago tardío** respetado e idempotente; **monto que no calza** devuelto sin crear pago.
- **Base desechable:** 111 de seguridad y 55 de navegador. **Base de pruebas:** 104 de seguridad (más 7 que solo corren en la desechable).

---

## 2026-10-13 — Fase 1.10: compuerta de seguridad ✅ · Fase 1 terminada
**Barrido completo antes de tocar la plata.** El estado de partida era bueno: todas las tablas con reglas de acceso, y las únicas lecturas públicas son la carta, la marca, los planes y las funciones globales, a propósito. Se cerró lo que quedaba:
- **Pagos, reembolsos y cierres:** antes los veía cualquier miembro del local (también cocina y mozos), con el correo del cliente. Ahora solo dueño, administrador, encargado y caja (y Tablio). El navegador no puede escribirlos (regla 2 del brief).
- **El mozo sigue viendo "pagado hace…"** gracias a la nueva columna `orders.paid_at`, que escribe solo el servidor, sin acceso a los pagos.
- **Funciones antiguas** (`get_tenant_id`, `is_tenant_member`, `has_staff_role`, `has_backoffice_role`): cualquiera, incluso sin sesión, podía llamarlas. Ninguna regla las usa ya, así que se cerraron. `is_platform_admin` queda solo para usuarios con sesión.
- **Permisos sobrantes** de escritura sin sesión en `platform_admins` y `tenant_members` (las reglas ya lo impedían; segunda capa).
- **Pagos sin identidad:** `process-payment` aceptaba un pago sin sesión. Ahora todo pago queda ligado a una persona (invitado o cliente).
- **Cierre de caja (N10):** `reconcile-payments` lo podía hacer cualquier miembro, incluso un mozo, y un día cerrado se podía rehacer.
  - Ahora solo concilian caja, encargado, administrador y dueño, y un día cerrado no se reabre ni se sobrescribe.
  - En la pantalla de Caja, el día cerrado muestra "🔒 Caja cerrada" con los botones bloqueados.
  - El cierre completo con conciliación automática llega en la fase 2.
- **Alta de mozos con invitación** (`register-waiter`):
  - la invitación se reserva de forma atómica: dos personas no la usan a la vez;
  - si falla el acceso real o la ficha, no queda una cuenta a medias;
  - los errores salen en español.
- `list-tenant-users` ya no muestra errores técnicos.
- Funciones del servidor publicadas de nuevo: `process-payment`, `reconcile-payments`, `register-waiter` y `list-tenant-users`.

**Auditoría automática, en cada cambio:** `auditoria_seguridad()` (solo superadmin) revisa la base y devuelve lo que encuentre:
- tablas sin reglas;
- reglas "para todos" fuera de las públicas a propósito;
- escrituras para el rol público;
- reglas con funciones antiguas;
- permisos de escritura sin sesión;
- funciones `SECURITY DEFINER` sin ruta de búsqueda fija;
- funciones llamables sin sesión fuera de las públicas a propósito (ver la mesa del QR, ver una invitación);
- plata o registros escribibles desde el navegador.

Se probó abriendo a propósito cinco agujeros dentro de una transacción que después se deshizo: los detectó todos. La prueba nueva exige que la auditoría salga vacía, en la base desechable y en la real.

**Asesor de Supabase:** sin errores. Lo que marca a propósito: las dos funciones públicas, las que la app llama con sesión y el acceso de invitados. "Contraseñas filtradas" requiere el plan Pro.

**Migración:** `20261013030000_compuerta_seguridad.sql`.

**Pruebas:**
- `tests/seguridad/f1-10-compuerta.test.ts`: 9 pruebas.
  - La auditoría sale vacía, y solo la corre el superadmin.
  - **Barrido de 31 tablas sensibles sin sesión:** nada se lee ni se escribe.
  - El invitado no ve nada del personal ni de la plata.
  - Pagos por rol.
  - Pago sin sesión rechazado.
  - Cierre de caja: el mozo no; la caja sí; un día cerrado no se cambia.
  - Las funciones antiguas están cerradas.
  - **Una invitación usada por dos personas a la vez sirve para una sola.**
- `e2e/caja.spec.ts`: la caja concilia, cierra y el día queda bloqueado; el mozo no entra a la caja.
- **Base desechable:** 102 de seguridad y 55 de navegador. **Base de pruebas:** 97 de seguridad (más 5 que solo corren con "Local Ajeno").

**Fase 1 completa (1.1 a 1.10):** cada dominio (pedidos, mesas, comensal, configuración, plataforma, precios) quedó con las reglas en la base y los cambios importantes por el servidor, con registro y pruebas de ataque que corren en cada cambio. Lo siguiente es la fase 2: el núcleo de la plata.

---

## 2026-10-13 — Ajuste: pantalla del mozo para autoservicio (colores y cronómetros) ✅
**Aclaración del fundador:** el flujo principal es autoservicio en prepago. El comensal pide y paga con el QR, y el mozo sobre todo lleva a la mesa lo que ya está pagado y listo. Tomar pedidos a mano o cobrar en efectivo existe, pero como respaldo.

**Cambios en la pantalla de mesas del mozo:**
- **Cada mesa tiene un color, un estado y un cronómetro:**

  | Estado | Color | Cronómetro |
  |---|---|---|
  | 🔔 Llamando | rojo | llamó hace… |
  | ✅ Listo para llevar | verde | listo hace… |
  | 🧾 Pide la cuenta | violeta | pidió hace… |
  | 💳 Por cobrar | ámbar | esperando pago hace… |
  | 🍳 En cocina | azul | pagado hace… |
  | Sentados | neutro | hace… |
  | Libre | gris | — |

- **El cronómetro pasa a amarillo y después a rojo** si la mesa espera demasiado. Por ejemplo, un plato listo hace más de 3 minutos se pone amarillo, y a los 7 se pone rojo porque se enfría.
- Cada mesa con pedidos muestra también **"Pidió hace… · pagó hace…"**. Los cronómetros avanzan solos.
- **Orden:** primero lo urgente (llamados, comida lista, cuenta, cobros); dentro de cada color, las mesas propias y la que más espera.
- **Resumen arriba por color**, que sirve de leyenda: "Listo para llevar · 1", "En cocina · 2"…
- **Una sola acción por tarjeta:**
  - "Entregado ✓" (cualquier mozo, aunque la mesa no esté a su nombre);
  - "Voy en camino" para un llamado;
  - "Cobrar y cerrar mesa" cuando piden la cuenta.
- **"Tomar pedido a mano" queda como opción secundaria** dentro del detalle de la mesa ("Para quien prefiere pedirle al mozo"). **"Tomar mesa"** también pasa al detalle.
- El detalle ya no repite "Mesa 3 · Mesa 3" y dice "Sentados hace…".

**Pruebas:**
- `e2e/mozo-mesa.spec.ts` y `e2e/pedido-mozo.spec.ts`, ajustadas: el pedido a mano no aparece en las tarjetas y se llega por el detalle.
- `e2e/recorridos/mozo-colores.spec.ts`: recorrido con fotos en la base desechable, con mesas en todos los estados y horas adelantadas, para que se vean los cronómetros en amarillo y rojo.
- **Base desechable:** 93 de seguridad y 53 de navegador.

---

## 2026-10-13 — Fase 1.9: precios y pedido del mozo por el servidor ✅
**Lo que cambió:**
- **Un solo cálculo de precios en la base: `calcular_precios()`.** Lo usan el pago del comensal (`process-payment`, publicada de nuevo) y el pedido del mozo. Rechaza:
  - opciones inventadas (antes se cobraban a $0 y llegaban igual a cocina, **N6**), repetidas o faltantes (por ejemplo, el punto de la carne);
  - demasiadas opciones en un grupo;
  - productos agotados u ocultos;
  - productos fuera del día o el horario de su categoría (con horarios que cruzan la medianoche);
  - cantidades fuera de 1 a 20;
  - local inactivo o sucursal cerrada (**N7**).

  Los mensajes llegan en español al comensal y al mozo.
- **El pedido del mozo lo crea el servidor: `crear_pedido_mozo()`.** Antes el navegador del mozo escribía el pedido con sus propios precios (3.7 del diagnóstico). Ahora el servidor:
  - valida el rol (mozo, encargado, administrador o dueño; no cocina ni caja) y que la mesa sea suya o esté libre;
  - abre la mesa si hace falta y calcula precios;
  - numera el pedido y lo deja anotado en el registro de eventos.

  En prepago, el pedido queda "esperando pago" y la cocina no lo prepara hasta que se cobre (el cobro del mozo llega en la fase 2). En cuenta abierta va directo a cocina.
- **Se cerró la inserción provisoria** de pedidos y productos pedidos que quedó en la fase 1.4. Desde el navegador ya nadie crea pedidos.
- **Número de pedido sin choques:** un contador por sucursal (`siguiente_numero_pedido`). Antes era "contar pedidos + 1", y dos pedidos al mismo tiempo podían repetir número. El reinicio del demo también reinicia el contador.

**App:**
- **Pedido del mozo, rehecho:**
  - **elige las opciones de cada plato** (obligatorias marcadas; el botón dice qué falta), con extras y nota para cocina;
  - el resumen muestra opciones y notas;
  - al confirmar avisa el número y el total que calculó el servidor, y si hay que cobrar para que pase a cocina.
- **Botón nuevo "Tomar pedido"** en las mesas del mozo. La pantalla de pedido manual existía, pero ningún botón llevaba a ella.
- **Detalles que salieron al revisar las fotos del recorrido:**
  - la mesa del mozo decía "🍳 En cocina" con un pedido que en realidad esperaba el cobro; ahora dice **"💳 Por cobrar"**;
  - en el panel de pedidos del dueño, los pedidos sin cobrar llevan la etiqueta **"Por cobrar"**, y cada producto muestra las opciones elegidas ("Tres cuartos · Palta") y la nota.
  - en el detalle de un plato aparecía un "0" suelto bajo el nombre (plato sin ventas y tiempo de preparación en cero). Ya no aparece.

**Pruebas:**
- `tests/seguridad/f1-9-precios.test.ts`: 8 pruebas.
  - Nadie crea pedidos directo.
  - Pedido del mozo con opciones y extras: total, número, registro y espera de pago.
  - Opciones inventadas, faltantes, repetidas o de más; agotados; cantidades; productos ajenos; pedido vacío.
  - Solo el personal de sala, y en sus mesas.
  - **Seis pedidos al mismo tiempo, sin números repetidos.**
  - **El pago del comensal:** rechaza opciones inventadas o faltantes, cobra los extras reales y, con un **pago repetido con la misma clave**, no cobra dos veces.
  - Sucursal cerrada.
  - El dueño de otro local no toma pedidos en el demo.
- Las pruebas de las fases 1.4 a 1.6 que creaban pedidos sin pagar escribiendo directo ahora usan `crear_pedido_mozo`.
- `e2e/pedido-mozo.spec.ts` (en celular):
  - el mozo toma la mesa y toca "Tomar pedido";
  - la hamburguesa no se puede agregar sin el punto de la carne;
  - elige punto, palta y nota, suma un agua y revisa el resumen;
  - confirma y la cocina lo ve "esperando pago".
- **Recorrido con fotos** (pedido del fundador): `foto()` en `e2e/apoyo/recorrido.ts` guarda fotos con `RECORRIDO=<carpeta>`.
- **Base desechable:** 93 de seguridad y 53 de navegador. **Base de pruebas:** 89 de seguridad (más 4 que solo corren con "Local Ajeno"). Estilo: bajaron los errores.

**Conciliación al cerrar la caja** (recordatorio del fundador): queda en el plan como parte del cierre de caja.
- **Fase 2:** cuadra lo cobrado en la app, el efectivo, el POS y los reembolsos, y marca las diferencias.
- **Fase 4:** se agrega lo que deposita la pasarela.

Ya no queda "a mano en el piloto".

---

## 2026-10-13 — Fase 1.8: plataforma y backoffice ✅
**Lo que estaba abierto y se cerró:**
- **Pagos a la vista:** cualquiera, sin sesión, leía los pagos de las mesas abiertas, con el correo del cliente.
- **Ventas:**
  - un vendedor desactivado seguía viendo y editando sus prospectos;
  - un vendedor podía pasarle sus prospectos a otro y firmar actividades a nombre de otro. Ahora la base firma cada actividad con la ficha de quien la crea, y el historial no se reescribe.
- **Equipo de Tablio:**
  - el jefe de ventas podía cambiar el rol, la cuenta o el correo de cualquier miembro. Ahora solo edita y activa o desactiva a sus vendedores, y solo invita vendedores;
  - rol, cuenta y correo los cambia solo el superadmin;
  - cada uno edita su propio perfil;
  - activar o desactivar queda en la auditoría.
  - La regla antigua se consultaba a sí misma (posible error de "recursión infinita", N14). Ahora usa funciones auxiliares que revisan que el miembro esté activo.
- **Finanzas** lee el embudo de ventas sin poder editarlo (antes no lo veía y sus números salían en cero).
- **Soporte:** cualquier miembro del local, incluso un mozo, veía y creaba tickets. Ahora solo dueño, administrador y encargado, firmados con su propia cuenta.
- **Planes:** los cambia solo el superadmin; siguen públicos porque son la oferta de Tablio.
- **Datos del negocio que vivían en el navegador** (regla de calidad 6) y se perdían al cambiar de computador:
  - los gastos de Tablio pasaron a la tabla `gastos_tablio` (finanzas y superadmin);
  - zonas de venta, comisiones y alertas pasaron a `configuracion_tablio` (las cambia el superadmin y las lee el equipo).
- **Modo soporte registrado (N3):**
  - cuando el superadmin entra al panel de un local, queda en la auditoría;
  - cuando el superadmin o el jefe "ve como" a otro miembro, también.

  Solo puede hacerlo quien corresponde.
- **Registro de vendedores** (`register-seller`, publicada de nuevo):
  - la invitación se reserva de forma atómica: dos personas no pueden usar el mismo enlace;
  - si el superadmin ya había creado la ficha con ese correo, se vincula en vez de duplicarse;
  - los errores salen en español.

**Migración:** `20261013010000_plataforma_backoffice.sql`.

**⚠️ El proyecto de Supabase estaba pausado.** El plan gratis pausa el proyecto tras 7 días sin uso, y habían pasado 11, así que la app y el demo no tenían base. Se reactivó (no cambia datos) y se revisó que todo siguiera igual: las funciones de la base, las del servidor y la configuración de acceso, con los límites por IP.
- Para que no se repita, la nueva revisión diaria de salud (`.github/workflows/salud.yml`) revisa cada mañana que la app, la base y el inicio de sesión respondan. Si algo falla, GitHub avisa por correo, y de paso el proyecto no queda inactivo.
- Antes del piloto conviene el plan Pro (F.8 del plan maestro).

**Pruebas:**
- `tests/seguridad/f1-8-plataforma.test.ts`: 9 pruebas.
  - Sin sesión no se ven pagos ni nada de Tablio.
  - Prospectos: el vendedor trabaja solo los suyos y la firma la pone la base.
  - Roles, cuentas y correos del equipo protegidos; cada uno edita su perfil.
  - Desactivar quita el acceso al instante y queda registrado.
  - El jefe invita solo vendedores.
  - Finanzas: embudo de solo lectura y gastos en la base.
  - La configuración de Tablio la cambia solo el superadmin.
  - Tickets de soporte por rol.
  - El modo soporte queda en la auditoría.
- `e2e/backoffice.spec.ts`: finanzas registra un gasto, que sigue ahí en otra pestaña (sin nada en el navegador), y lo borra.
- **Base desechable:** 85 de seguridad y 52 de navegador. **Base de pruebas:** 82 de seguridad (más 3 que solo corren con "Local Ajeno").
- El contenedor local de funciones del servidor se cayó una vez después de reiniciar Docker (todas respondían 503). Se reinició el entorno y todo pasó.

---

## 2026-10-02 — Fase 1.7: configuración del local ✅
**Lo que estaba abierto y se cerró:**
- **Datos privados de todos los locales a la vista:** cualquiera, sin iniciar sesión, leía RUT, correo, teléfono y estado del plan.
  - Ahora lo público de un local es solo su marca: nombre, colores, logo, portada y mensaje de bienvenida.
  - Los datos completos los leen solo el superadmin y el equipo de Tablio, con la función `tenants_privado()`.
- **El costo de cada plato** (los márgenes del local) era público. Ya no lo lee nadie desde la app; tendrá su pantalla con permisos cuando haga falta.
- **El equipo de todos los locales** era público. Ahora lo ve solo el personal de ese local.
- **Cualquier miembro, también un mozo, podía:**
  - cambiar el plan y el estado del local;
  - editar la carta, la sucursal y el programa de lealtad;
  - escribir en la auditoría (cualquiera podía, incluso sin sesión).

  Ahora:
  - la marca y la sucursal las editan dueño y administrador;
  - la carta y la lealtad, dueño, administrador y encargado;
  - el plan y la activación del local, solo Tablio (`sa_activar_local`, con registro);
  - la auditoría solo la escriben el servidor y las funciones de la base.
- **Desactivar a alguien del equipo no le quitaba el acceso.** Solo cambiaba su ficha, y podía seguir operando.
  - Ahora `activar_personal` también le quita el acceso real (`tenant_members`) **al instante**, aunque tenga la sesión abierta, y libera sus mesas.
  - `actualizar_personal` cambia nombre y rol respetando la jerarquía: el dueño nombra hasta administrador y el administrador hasta encargado; nadie se cambia su propio rol.
  - Todo queda en la auditoría.
- **La ficha del equipo la creaba el navegador.** Ahora la crea `create-tenant-user` junto con la cuenta (función publicada de nuevo).
- **Invitaciones:** las crean dueño o administrador, solo para mozo, cocina o caja.
- **Clientes de lealtad y premios:** dueño, administrador, encargado y caja; ya no la cocina ni el mozo.
- **Nada apunta a otro local:** por ejemplo, un plato no puede ir en la categoría de otro local. Lo valida la base en carta, estaciones, sucursales, equipo, invitaciones y lealtad.
- **Fotos de la carta:** las suben y borran quienes editan la carta (antes, cualquier miembro). Precios negativos, rechazados. Las ventas de cada plato las cuenta solo el servidor.
- **Reinicio del demo:** también borra el registro de mesas que dejan las pruebas.
- **Asesor de seguridad de Supabase:**
  - sin errores;
  - las funciones que solo usan los disparadores ya no se pueden llamar directo;
  - dos funciones quedaron con ruta de búsqueda fija.

  Las advertencias que quedan son esperadas: funciones que la app llama a propósito y el acceso de invitados. "Contraseñas filtradas" requiere el plan Pro (fase 5).

**Migraciones:** `20261002080000_configuracion_local.sql`, `20261002081000_ajustes_asesor_seguridad.sql`, `20261002082000_fotos_carta.sql`.

**App:**
- Las pantallas de superadmin, ventas y finanzas leen los datos completos con `rpc('tenants_privado')`. El superadmin activa o desactiva locales con `sa_activar_local`.
- **Equipo:** editar y activar o desactivar por el servidor, con mensajes claros si no se puede.

**Plan:** se guardó el plan vigente en `docs/MASTER_PLAN.md` (`PLAN_FASES.md` queda como histórico). Incluye las ideas de experiencia, cada una en su fase, según lo que más vende y lo que aprovecha lo ya construido:
- la mesa en vivo, "otra ronda" y sellos animados, en la fase 3;
- invitar una ronda, dividir un plato, niveles, juegos y premios, en la fase 7;
- la noche de trivia, en la fase 8;
- la comunidad, en la fase 9.

**Pruebas:**
- `tests/seguridad/f1-7-configuracion.test.ts`: 11 pruebas.
  - Carta y marca públicas, pero sin costos ni datos privados.
  - Sin ser del local no se ve el equipo ni nada privado.
  - El mozo no edita carta, marca ni lealtad; el administrador sí edita la carta.
  - El plan no lo cambia nadie del local. La auditoría nadie la escribe.
  - Desactivar quita el acceso al instante. Los roles respetan la jerarquía.
  - Invitaciones con tope de rol y fotos de la carta.
  - El comensal sigue viendo la carta.
  - El dueño de otro local no mete platos en la carta del demo.
- `e2e/equipo.spec.ts`:
  - el dueño desactiva y vuelve a activar a un mozo;
  - en la base desechable, crea la cuenta de un mozo y aparece vinculado.
- **Base desechable:** 76 de seguridad y 51 de navegador. **Base de pruebas:** 73 de seguridad (más 3 que solo corren con "Local Ajeno").

---

## 2026-10-02 — Fase 1.6: acciones del comensal sin cámara ✅
**Decisión del fundador:** nada con cámara. "Llamar al mozo" y "pedir la cuenta" ya no piden escanear la tarjeta de la mesa.

**Base (migración `20261002070000_acciones_comensal.sql`):**
- **Llamar al mozo** (`llamar_mozo`): lo reemplaza la validación del servidor (antes la hacía la cámara).
  - Solo puede llamar quien está registrado en la sesión abierta de esa mesa.
  - Si ya hay una llamada pendiente, no se duplica.
  - Límite de 6 llamadas por persona cada 10 minutos, contra el abuso a distancia.
  - El comensal puede cancelar su llamada; un extraño no (`cancelar_llamado`).
- **Pedir la cuenta** (`pedir_cuenta`):
  - **El total lo calcula la base**: lo que la mesa tiene sin pagar. Antes lo mandaba el navegador.
  - La propina no puede superar la cuenta.
  - Si ya hay una cuenta pedida, se actualiza en vez de duplicarse.
  - Sin nada pendiente, avisa "Tu mesa no tiene nada pendiente de pago 🎉".
- **El personal atiende** con `atender_llamado` y `atender_cuenta` (la cocina no). Queda quién y cuándo, y quién llamó.
- **Reglas de acceso:** se eliminaron la inserción y la lectura públicas de llamadas y cuentas, y la escritura directa del personal. Leen el personal y el comensal de esa sesión.
- **Límites de Supabase subidos** (`supabase/config.toml`, `[auth.rate_limit]`), verificados en la base real:
  - invitados: 1.000 por hora por IP (antes 30);
  - inicios de sesión: 300 cada 5 minutos (antes 30);
  - renovaciones de sesión: 1.000;
  - verificaciones: 300.

  En un bar todos los comensales del wifi comparten la IP: con 30, el comensal 31 de la noche quedaba fuera. La herramienta 2.72 sí los maneja (se revisó la diferencia antes de aplicar: solo cambiaron esos 4 valores).

**App:**
- **Seguimiento:** "Llamar al mozo" pide el motivo y listo. Se quitó todo el escáner.
  - **Al cerrarse la mesa, el comensal ve "¿Cómo estuvo tu experiencia?" y califica.** Antes solo pasaba si había pedido la cuenta, y en prepago nunca ocurría; además lo sacaba de la pantalla a los 8 segundos.
- **Cuenta:** sin cámara. Muestra "Ya pagado" y "Por pagar", igual que la base. "Pedir la cuenta al mozo" es un botón. Sin código de mesa, invita a abrir la carta desde el QR.
- **Mozo:** atender llamada y cuenta por el servidor.
- **El comensal espera a quedar registrado en la mesa antes de buscar sus pedidos.** Antes, si entraba directo por el link del seguimiento, a veces veía "No encontramos tu pedido" por llegar antes que el registro.
- Se quitaron las librerías de lectura de QR (`@zxing`): ya nada usa la cámara.

**Pruebas:**
- `tests/seguridad/f1-6-acciones-comensal.test.ts`: 5 pruebas.
  - Nadie escribe llamadas ni cuentas directo.
  - Solo quien está en la mesa llama, sin duplicados; el mozo atiende y la cocina no.
  - Cancelar solo el propio, y el límite contra abusos.
  - Pedir la cuenta: total de la base, propina con tope, sin duplicar, mesa esperando y atención por rol.
- `e2e/mozo-mesa.spec.ts` (ahora **una visita completa con dos navegadores**):
  - el comensal paga y llama al mozo sin cámara;
  - el mozo ve 🔔, toma la mesa y atiende (el comensal lo ve al instante);
  - el mozo cierra la mesa y el comensal califica.
- En el computador local, las pruebas de navegador corren de a una: con 8 GB, Docker y dos navegadores se quedaban sin memoria y la base local se caía. En CI siguen en paralelo.
- **Base desechable:** 65 de seguridad y 49 de navegador. **Base de pruebas:** 63 de seguridad (más 2 que solo corren con "Local Ajeno"). Estilo: 119 errores (bajaron 2), 26 advertencias.

---

## 2026-10-02 — Fase 1.5: dominio mesas y sesiones ✅
**Base (migración `20261002060000_dominio_mesas.sql`):**
- **Se cerró la lectura pública de mesas.** Cualquiera podía listar todas las mesas de todos los locales **con su código QR** y entrar a cualquier mesa a distancia. Ahora:
  - el personal ve las de su local;
  - el comensal solo la mesa donde está sentado;
  - quien tiene el QR en la mano usa `ver_mesa(código)`, que devuelve esa mesa y su sesión, sin el código.
- **Nadie escribe directo el estado de una mesa ni su sesión.** Se eliminaron la escritura pública de mesas y la inserción y modificación públicas de sesiones. El dueño solo edita la configuración (número, nombre, zona, capacidad, posición).
- **Funciones del servidor**, cada una valida el rol y deja registro en `table_events`, que nadie puede editar:
  - `abrir_mesa`: el mozo que abre una mesa sin mozo queda a cargo.
  - `tomar_mesa`: **la mesa de otro mozo no se toma: se transfiere.**
  - `transferir_mesa`: la hace el mozo a cargo o un encargado, y solo a alguien que atienda mesas en esa sucursal.
  - `cerrar_mesa`: entrega lo que ya está listo, completa la cuenta, atiende las llamadas pendientes y libera la mesa. **Si quedan pedidos sin pagar, el mozo no puede cerrar; un encargado sí, con motivo, y queda registrado cuánto se perdió.**
  - `calificar_mesa`: el comensal califica su visita (abierta o cerrada hace menos de 3 horas); un extraño no.
- **El total de la sesión lo calcula la base** (la suma de sus pedidos no cancelados). Antes lo escribía el navegador del mozo.
- Pedir la cuenta deja la mesa "esperando la cuenta" por la base. Las mesas nuevas reciben un código QR largo generado por la base; uno corto se rechaza.

**App:** `src/lib/mesa.ts`.
- **Mozo:** tomar, transferir y cerrar por el servidor, con mensajes claros si algo no se puede. **Nuevo botón "Cerrar mesa"** en el detalle de la mesa: en prepago nadie pide la cuenta, así que antes las mesas quedaban ocupadas para siempre. Para transferir solo aparece quien puede atender mesas.
- **Pedido manual del mozo:** abre la mesa con `abrir_mesa`. Ya no calcula ni escribe el total.
- **Comensal** (carta, seguimiento, cuenta y pago): su mesa con `verMesa`; la calificación con `calificar_mesa`. **El seguimiento muestra el estado del pedido en palabras** ("Recibido ✓", "En cocina 🍳"…), aunque haya un solo pedido.
- **Mesas en el panel:** el código QR lo genera la base. Si una mesa con historial no se puede borrar, se avisa en vez de decir "eliminada".
- `process-payment` ya no escribe el total de la sesión (lo hace la base) y se volvió a publicar.

**Pruebas:**
- `tests/seguridad/f1-5-mesas.test.ts`: 10 pruebas.
  - Sin sesión no se leen mesas, códigos ni sesiones, ni se escriben.
  - `ver_mesa` muestra solo esa mesa y sin su código.
  - El comensal no lista las mesas ni toca su sesión.
  - El personal no escribe estado ni mozo directo, y el dueño sí edita la configuración.
  - Tomar y transferir siguen sus reglas y quedan registrados.
  - Cerrar con pedidos sin pagar sigue sus reglas, y el total lo calcula la base.
  - Al cerrar una mesa pagada se entrega lo listo, y la calificación sigue sus reglas.
  - La caja cierra mesas; el registro es inmodificable.
  - El código QR lo genera la base.
  - El dueño de otro local no ve ni toca nada.
- `e2e/mozo-mesa.spec.ts`: un comensal paga, y **el mozo toma la mesa y la cierra desde su pantalla**.
- **Base desechable:** 60 de seguridad y 49 de navegador. **Base de pruebas:** 55 de seguridad pasaron; 3 chocaron con el límite de Supabase de invitados por hora por IP (el riesgo del wifi del bar). Pasaron después de subir los límites (fase 1.6). Estilo: 121 errores (bajó 1).

---

## 2026-10-02 — Fase 1.4: dominio pedidos ✅
**Base (migración `20261002050000_dominio_pedidos.sql`):**
- **Estaciones** (`stations`): configurables por sucursal. Cada sucursal tiene su estación predeterminada "Cocina", y las nuevas la reciben solas (trigger). Cada categoría puede ir a una estación. Base para separar barra y cocina (fase 3.1).
- **Estado por producto** (`order_items.status`, `station_id`, horas de inicio, listo y entrega). La estación se asigna sola desde la categoría o la predeterminada. El estado del pedido es el de su producto más atrasado.
- **Registro de eventos** (`order_events`): cada cambio con la hora del servidor, quién lo hizo, su rol, cuántos productos cambiaron y el motivo. Solo crece: nadie lo escribe, edita ni borra desde la app.
- **`cambiar_estado_pedido(pedido, estado, estación?, motivo?)`**, la única forma de cambiar estados:
  - **Roles:** en cocina y listo, solo cocina, encargado, administrador o dueño. Entregado lo pueden marcar también los mozos, **pero el mozo solo entrega lo que cocina marcó listo**. Cancelar exige encargado o más, con motivo.
  - **En prepago, la base no deja preparar un pedido sin pagar** (regla 1 del brief, ahora exigida por la base y no solo por la pantalla).
  - Solo avanza: nunca vuelve atrás. Si se repite el mismo clic, no hace nada.
- **`marcar_agotado(producto, sí/no)`**: cocina, encargado, administrador o dueño.
- **Reglas de acceso:** se eliminaron la lectura, la inserción y la modificación públicas de `orders` y `order_items`. Leen el personal del local, **el comensal solo los pedidos de su sesión de mesa** y el superadmin. Nadie modifica directo, ni siquiera el dueño. Queda provisoria la inserción del personal para el pedido manual del mozo, hasta la 1.9.

**App:** `src/lib/pedidos.ts` (cambios de estado con mensajes en español).
- **KDS:** avanzar y marcar agotado por el servidor; si falla, avisa y recarga.
- **Panel de pedidos del dueño:** avanzar y cancelar por el servidor. Cancelar pide el motivo. El aviso ya no muestra el estado en inglés.
- **Mozo:** ya no puede mandar a cocina ni marcar listo (contra el brief); ve "Esperando cocina" o "En preparación" y solo puede marcar entregado lo que está listo. Al cerrar una mesa se entrega lo listo, y lo que sigue en cocina se queda en la cocina.
- **Seguimiento, cuenta y pago:** registran al comensal en su mesa al abrirse, para que pueda ver sus pedidos aunque entre por el link directo.

**Pruebas:**
- `tests/seguridad/f1-4-pedidos.test.ts`: 10 pruebas.
  - Un anónimo no puede marcar un pedido como pagado (el ataque del problema 2), y ni el dueño puede escribir directo.
  - Sin sesión no se leen pedidos; el comensal ve los de su mesa y no los de otra.
  - El mozo no maneja estados de cocina; la cocina sí, y el mozo entrega lo listo. No se vuelve atrás, y todo queda con hora.
  - En prepago, la cocina no prepara lo no pagado.
  - Cancelar exige rol y motivo, y queda registrado.
  - El registro de eventos es inmodificable; el comensal no cambia estados; agotado según rol; el dueño de otro local no ve ni toca nada.
- `e2e/seguimiento-en-vivo.spec.ts`: **con dos navegadores, el comensal ve su pedido pasar de Recibido a En cocina, Listo y Entregado sin recargar, mientras la cocina lo avanza.** El tiempo real sigue funcionando con la lectura cerrada.
- Las pruebas de seguridad inician sesión una sola vez por rol y por corrida, en un solo proceso, para no chocar con los límites de Supabase.
- **Base desechable:** 50 de seguridad y 48 de navegador. **Base de pruebas:** 49 de seguridad (más 1 que solo corre con "Local Ajeno") y 48 de navegador. Estilo: 122 errores (bajó 1), nuevo tope.

**⚠️ Hallazgo: límites de Supabase por IP.** Una corrida falló por los límites de inicios de sesión y de invitados por IP. **En un bar, todos los comensales del wifi comparten la misma IP**, y el límite de invitados por defecto (unos 30 por hora por IP) bloquearía al comensal 31 de la noche. Hay que subirlos en el panel (Authentication → Rate Limits); la herramienta de línea de comandos instalada no los maneja. Se probó la versión 2.119 de la herramienta (Homebrew): quedó colgada esperando permiso del Llavero de macOS, así que se desinstaló y se volvió a la 2.72 sin aplicar nada.

---

## 2026-10-02 — Fase 1.3: identidad del comensal (invitado o cliente) ✅
**Decisión del fundador:** el comensal paga sin registrarse; quien quiera, guarda su cuenta para juntar sellos. Registro con **correo, Google o Apple**. La pantalla tiene que ser excelente.

**Auth manejado desde el repositorio:** `supabase config push` respondiendo "no" muestra la diferencia entre la configuración real y `config.toml` **sin aplicar nada**. Así se copió exactamente la configuración real de Auth y se cambió solo lo decidido:
- **URL del sitio** `https://table-tray-qr.vercel.app` y direcciones de retorno (Vercel, vistas previas, local). Era un pendiente desde la fase 0.
- **Comensales anónimos** activados y **unión de cuentas** activada (para pasar de invitado a cliente con Google o Apple).
- Códigos de **6 dígitos** (antes 8).
- Verificado: después de aplicar, no queda ninguna diferencia. Un invitado puede entrar en la base real.
- **Plantillas de correo en español con código** (`supabase/templates/`): listas, pero **Supabase no permite cambiarlas en el plan gratis con el correo incluido**. Quedan comentadas en `config.toml` hasta tener un servicio de correo. Mientras tanto, el correo trae un enlace en vez de un código.

**Base (migración `20261002040000_identidad_comensal.sql`):**
- **Una sola sesión abierta por mesa** (índice único): dos comensales que escanean a la vez comparten la misma.
- Tabla **`comensales_mesa`**: quién está en cada sesión de mesa, con alias opcional. El comensal ve solo su fila; el personal del local ve a los comensales de su local; nadie escribe directo.
- **`unirse_a_mesa(qr, alias)`**: valida el código de la mesa, abre o reutiliza la sesión y registra al comensal. Solo con sesión (invitado o cliente).
- **`orders.user_id`**: quién hizo cada pedido (base para "mis pedidos" y para que cada uno pague lo suyo).
- **`loyalty_customers.user_id`**: sellos ligados a la cuenta.
- `mi_perfil()` ahora dice si la sesión es de un invitado (`es_anonimo`).

**Funciones:**
- `process-payment`: anota quién pagó (`orders.user_id`). Suma sellos **solo a clientes registrados con correo verificado, usando el correo de su cuenta**; ignora el correo que mande el navegador. La búsqueda del cliente es exacta (antes `ilike`). Si dos comensales abren la sesión de una mesa al mismo tiempo, usa la que quedó. **Cierra N4.**
- `loyalty-status`: solo el cliente registrado ve **sus** sellos (antes cualquiera veía los de cualquier correo).

**App del comensal:**
- Al abrir la carta con el QR, si no hay sesión se crea una de invitado y el comensal entra a la mesa (`useTableSession`).
- **Hoja "Guarda tus sellos"** (`CuentaComensal`), con el color del local:
  - Google, Apple o correo. El invitado se convierte en cliente sin perder nada.
  - Si el correo ya tiene cuenta, entra a ella con un código.
  - Si confirma tocando el enlace del correo en otra pestaña, al volver se actualiza solo y ve "¡Listo!".
  - Incluye el texto de consentimiento y el derecho a borrar datos (Ley 21.719).
  - El cliente registrado ve su cuenta y puede cerrar sesión (vuelve a ser invitado).
- **Carta:** botón "Sellos" para el invitado o la inicial del correo para el cliente.
- **Pago (checkout y cuenta):** el campo de correo escrito a mano se reemplazó por el bloque de sellos (`BloqueSellos`). El cliente ve sus sellos como casillas y sus premios para canjear; el invitado ve la invitación a guardar su cuenta. Después de pagar, el invitado ve "Guarda tus sellos".
- Se quitó el correo guardado en el navegador (`tablio_guest_email`).

**Pruebas:**
- `tests/seguridad/f1-3-comensal.test.ts`: 10 pruebas. Entrar a la mesa (sin sesión no; código falso no; dos invitados comparten sesión con identidades propias; volver a entrar no duplica); cada comensal ve solo lo suyo; el personal ve a los comensales; nadie escribe directo; el invitado figura como anónimo; sellos solo con cuenta verificada (sin sesión 401, invitado 401, un invitado que manda el correo de otra persona no suma sellos y el pedido queda a su nombre).
- `e2e/comensal-cuenta.spec.ts`: el invitado ve "Sellos" y la invitación en el pago. **En la base desechable, el invitado guarda su cuenta con su correo real tocando el enlace** (con el buzón de prueba Mailpit, que ahora también levanta la integración continua) y queda como cliente.
- **Base desechable:** 40 de seguridad y 48 de navegador. **Base de pruebas:** 40 de seguridad y 46 de navegador. Revisión de tipos, compilación y estilo (sin errores nuevos) en verde.

**Pendientes para que el registro funcione con comensales reales (fundador):**
1. **Servicio de correo (SMTP, por ejemplo Resend):** el correo incluido en Supabase solo llega a direcciones del equipo. Con el servicio se activan además las plantillas con código. Es un servicio externo nuevo y necesita su aprobación.
2. **Google:** credenciales OAuth en Google Cloud.
3. **Apple:** cuenta de desarrollador de Apple (pago anual) y credenciales.
4. A futuro: limpiar periódicamente los invitados viejos sin actividad, y evaluar un captcha contra abuso.

---

## 2026-10-02 — Fase 1.2: un solo modelo de roles y una sola puerta de entrada ✅
**Decisión del fundador:** el mozo entra con email y contraseña (el PIN se puede agregar después sin rehacer nada).

**Base (migración `20261002030000_modelo_roles.sql`):**
- `tenant_members` es la fuente de verdad del rol. Lista cerrada: `owner`, `admin`, `manager`, `cashier`, `waiter`, `kitchen` (restricción en la base). `staff_users` queda como perfil (nombre, mesas asignadas) y usa la misma lista. Las invitaciones solo pueden ser para encargado, cajero, mozo o cocina.
- Se normalizaron los roles existentes: `staff` (lo creaba `create-tenant-user` sin rol real) pasa al rol del perfil de personal, y `host` pasa a mozo.
- `is_tenant_member()` ya no cuenta miembros desactivados.
- `get_tenant_id()` deja de elegir un local al azar (N11): toma la membresía activa más antigua.
- Nueva `tiene_rol(local, roles)`: base de las reglas de acceso por rol de las próximas subfases.
- Nueva **`mi_perfil()`**: devuelve en una sola consulta quién es el usuario, si es superadmin, su rol de backoffice y sus locales (con rol, sucursal y perfil de personal). Es la **única** forma en que la app resuelve el rol.

**Funciones:** `create-tenant-user` recibe el rol y valida quién puede asignar cuál (superadmin: cualquiera; dueño: hasta administrador; administrador: hasta encargado). La membresía se crea con el rol real, ya no con "staff".

**App:**
- `SesionContext` (nuevo, en la raíz de la app): sesión única desde `mi_perfil()`.
- `src/lib/roles.ts` (nuevo): nombres de los roles, secciones del panel por rol y a dónde llega cada uno al entrar.
- Login único: `UnifiedLoginPage` usa la sesión. **Cocina entra directo a su pantalla**; el **cajero**, a Caja; el mozo, a su panel. `/mozo/login` redirige a `/login`. Se borraron `MozoLoginPage` y `AdminLoginPage`. Todos los enlaces y cierres de sesión llevan a `/login`.
- **Panel del mozo:** su identidad sale de la sesión, no de `sessionStorage` (cierra N2), y **entra una sola vez** (cierra N16). Si recarga la página, sigue conectado.
- **Panel del local:** `AdminContext` usa la sesión. Ahora el acceso de soporte exige ser superadmin según la base: antes bastaba un dato en el navegador para ver el panel (cierra la parte visible de N3; el registro de la suplantación llega en la 1.8). `AdminGuard` deja abrir solo las secciones del rol, y el menú se filtra igual. El encargado no ve Equipo ni Sucursal; el cajero solo ve Caja, Pedidos y Mesas; mozo y cocina van a sus pantallas.
- KDS, superadmin, finanzas, jefe de ventas y vendedor deciden el acceso con la misma sesión.
- Equipo: roles reales (mozo, cocina, cajero, encargado; se quitó "host"), y el rol se envía al crear la cuenta.
- Superadmin → Configuración: el alta de accesos usa `create-tenant-user` en vez del registro público (`signUp`), que además cambiaba la sesión del superadmin.

**Demo:** nueva cuenta **cajero** (`cajero@demo.tablio.test`). `crear_demo.py --solo-cuenta` agrega una cuenta a un demo ya cargado.

**Pruebas:**
- `tests/seguridad/f1-2-roles.test.ts`: 14 pruebas. `mi_perfil` (anónimo no puede; cada rol aparece bien), `tiene_rol`, rechazo de roles inventados, invitaciones no pueden ser para dueño, y quién puede asignar qué rol.
- En navegador: cada rol llega a su panel, incluidos cocina directo al KDS y el cajero a Caja; el cajero no puede abrir Equipo; el mozo entra una vez y sobrevive a recargar; el login viejo del mozo redirige al único.
- **Base desechable:** 30 de seguridad y 42 de navegador. **Base de pruebas:** 30 de seguridad y 44 de navegador. Revisión de tipos y compilación en verde. Estilo: 123 errores (bajó 1) y 30 advertencias; queda como nuevo tope.

---

## 2026-10-02 — Fase 0.2 terminada y fase 0.5: base desechable para pruebas
**Corte (0.2) ✅:**
- `fase-2-migracion` se unió a `main` sin conflictos (nadie había escrito en `main`).
- **`https://table-tray-qr.vercel.app` usa el Supabase propio**: comprobado en el código publicado, y con 36 de 36 pruebas de navegador contra ese link, incluido un pedido con pago simulado.
- Al aplicar la unión, git borró el `.env` del computador (la rama lo sacaba del repositorio). Se recuperó desde el historial; ahora está fuera de git.

**Docker (0.5):** se instaló **Colima** (`brew install colima docker`) en vez de Docker Desktop: cumple lo mismo y no necesita contraseña ni ventanas. Corre con 4 CPU, 6 GB y 40 GB de disco (`colima start`).

**Supabase local:** `supabase start` reconstruye la base **desde cero con las 24 migraciones del repositorio, sin errores**. Eso confirma que el arreglo de la regla cambiada a mano en Lovable funciona.

**Pruebas contra una base desechable:**
- `scripts/pruebas-base-local.sh` (`bun run test:local`): reconstruye la base local, carga el demo y un segundo local mínimo ("Local Ajeno", para probar aislamiento) con contraseñas nuevas, y corre las pruebas de seguridad y de navegador contra esa base.
- `crear_demo.py` acepta `--salida` y `--local-ajeno`.
- Las pruebas leen la base y las credenciales desde variables de entorno (`VITE_SUPABASE_*`, `DEMO_CREDENCIALES`, `E2E_PORT`, `E2E_BASE_DATOS`). Las del local migrado de Lovable se saltan en la base desechable.
- Resultado local: **16 de 16 de seguridad y 34 de navegador** en verde.

**Integración continua:** el trabajo "base desechable" levanta Supabase local en GitHub y corre ahí todas las pruebas, incluidas las que usan cuentas del demo. **La integración continua ya no escribe en la base de pruebas real.**

**Reinicio del demo:** migración `20261002020000_reiniciar_demo.sql`, con la función `reiniciar_demo()` (solo superadmin; solo toca el demo; deja registro en `audit_logs`) y el comando `bun run demo:reiniciar`. Tiene 3 pruebas de seguridad. Se usó en la base de pruebas: borró los 8 pedidos que habían dejado las pruebas.

---

## 2026-10-02 — Fase 0.2: corte con Lovable
**Decisiones del fundador:** Lovable desconectado de GitHub; instalar Docker; aprobadas las políticas de pago tardío (respetar el precio congelado si el monto coincide y está dentro de un margen; si no, reembolso automático) y de producto agotado (respetar el pedido y avisar a cocina). El cierre del registro público lo hará él más adelante. El login del mozo sigue pendiente: se avanza con email y contraseña, y el PIN se puede agregar después sin rehacer nada.

**Vercel:**
- Proyecto enlazado localmente (`.vercel/`, fuera de git).
- Variables `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (marcada como pública: es la clave anónima que usa el navegador) y `VITE_SUPABASE_PROJECT_ID` cargadas en producción, vista previa y desarrollo, apuntando al proyecto propio.

**`.env` fuera del repositorio (pendiente de la 1.1, N13):** se quita del control de versiones y queda solo en el computador. Se agrega `.env.example` sin valores. La integración continua lo genera con los valores públicos de la base de pruebas.

**Unión de ramas:** `fase-2-migracion` → `main`. Desde aquí `https://table-tray-qr.vercel.app` usa el Supabase propio. La app de Lovable (`tabliochile.lovable.app`) queda congelada con la base vieja como respaldo por 30 días.

---

## 2026-10-02 — Fase 1.1: contención inmediata ✅ (con dos pendientes)
**Primero las pruebas (`tests/seguridad/f1-1-contencion.test.ts`, 13 ataques):** se escribieron antes de arreglar nada. Corrieron en rojo: 10 de 13 ataques funcionaban.

**⚠️ Error mío al correrlas en rojo:** tres de los ataques escriben en la base, y como los huecos estaban abiertos, funcionaron. Eso confirmó en vivo los problemas 1 y 5 del diagnóstico: el dueño del demo quedó como dueño de "La parrillada", y alguien sin sesión creó la cuenta `x@demo.tablio.test` y la metió en ese local. Se borraron exactamente esas filas (`privado/limpieza_pruebas_2026-10-01.sql`); los conteos volvieron a 14 usuarios y 8 miembros. **Regla nueva:** las pruebas de ataque que escriben solo se corren con el arreglo ya aplicado.

**Arreglos:**
- Migración `20261002010000_contencion_inmediata.sql`:
  - Se elimina el alta pública de miembros (`tenant_members_public_insert`). El superadmin y las funciones del servidor siguen pudiendo dar de alta.
  - Se **borra la columna `staff_users.pin`** (había un PIN en texto plano legible por cualquiera; ningún código la usaba).
  - Las invitaciones de mozo y de backoffice dejan de poder leerse y modificarse sin sesión.
  - Nueva función `ver_invitacion_mozo(token)`: devuelve solo el local, el rol y el estado de esa invitación.
  - Tabla `support_chat_uso` y función `registrar_uso_chat`, cerradas al navegador: límite de 60 mensajes por usuario y por día.
- `create-tenant-user`: exige sesión. Con local: solo superadmin o dueño o administrador activo de ese local. Sin local: solo superadmin. Valida que la sucursal pertenezca al local. Busca usuarios existentes en todas las páginas (antes fallaba con más de 50). Mensajes en español.
- `support-chat`: exige sesión y aplica el límite diario. La pantalla de soporte manda el token de la sesión en vez de la clave pública.
- `MozoJoinPage` usa `ver_invitacion_mozo` en vez de leer la tabla.
- Se borraron del repositorio `create-platform-admin` y `create-jefe-ventas` (nunca se publicaron en el proyecto nuevo).

**Comprobado:** 13 de 13 pruebas de seguridad en verde; revisión de tipos, compilación y tope de estilo (124) en verde; **36 pruebas de navegador** en verde, incluida una nueva (`e2e/invitacion-mozo.spec.ts`: el link de invitación muestra el local y una invitación falsa se rechaza); la base quedó sin columna de PIN, sin las 5 reglas abiertas y sin filas de más. Las pruebas de seguridad se agregaron a la integración continua.

**Pendientes de la 1.1:**
- **Cerrar el registro público de cuentas** en Supabase Auth. La herramienta de Supabase solo permite empujar toda la configuración de Auth a la vez y podría pisar otros ajustes sin avisar. Hay que hacerlo desde el panel o actualizar la herramienta.
- **Sacar `.env` del repositorio**: se hace en el corte (0.2), configurando las variables en Vercel, para no cambiar ahora la base de la producción de Lovable.

---

## 2026-10-01 — Fase 0 en marcha: decisiones de producto, un solo gestor de dependencias e integración continua
**Decisiones del fundador:**
- No hay MVP: se construye el producto completo; las fases solo ordenan dependencias.
- Se mantienen todas las formas de pagar, ordenadas en un solo flujo desde el QR: "Pagar ahora" (destacado), "Pagar al mozo" (efectivo o POS: el mozo cobra y registra, y recién ahí va a cocina) y "Agregar a mi cuenta" (solo en locales con cuenta abierta). Calza con el brief (secciones 4 y 5.1).
- "Llamar al mozo" sin cámara. Se eliminan todos los escaneos con cámara.
- Por qué existe hoy la cámara y "pedir la cuenta": Lovable construyó primero (marzo) un modelo de cuenta abierta con escaneo de cámara como prueba de presencia, y después (agosto) el checkout con pago previo, sin limpiar lo anterior. Conviven los dos.

**Vercel:** conectado por el fundador. Proyecto `table-tray-qr`: la rama principal publica en `https://table-tray-qr.vercel.app` (**todavía con la base de Lovable**, porque `.env` de `main` apunta allá) y la rama `fase-2-migracion` publica vistas previas con la base nueva (protegidas con el login de Vercel). El cambio a la base nueva en producción ocurre al unir las ramas (0.2), después de desconectar Lovable de GitHub.

**0.3 Un solo gestor de dependencias ✅:** se borraron `package-lock.json` y `bun.lockb`. Solo queda `bun.lock`; Vercel instala con bun (`vercel.json`).

**0.4 Integración continua ✅ (pendiente de su primera corrida en GitHub):**
- `.github/workflows/ci.yml`: en cada cambio de `main` o de las ramas `fase-*`, instala con bun, revisa tipos, aplica el tope de estilo, compila, corre las pruebas unitarias y después las de navegador (con Chromium). Si algo falla, guarda el informe de Playwright.
- Comandos nuevos: `bun run typecheck` y `bun run lint:tope`. El tope de estilo queda en 124 errores y 29 advertencias (todo heredado de Lovable): nunca puede subir, y cuando baje se actualiza.
- Local: compila, la prueba unitaria pasa y **34 pruebas de navegador pasan** (2 se saltan porque necesitan el código de una mesa de Lovable).

**Vista previa local:** se detuvo sola al llegar al tiempo máximo de una tarea en segundo plano. Se levanta con `bun run dev`.

---

## 2026-10-01 — Migración aplicada, datos cargados, funciones publicadas y local de demo
El fundador inició sesión en la CLI de Supabase (`supabase login`) y pidió que lo hiciera todo Claude Code.

**Estructura:**
- `supabase link` al proyecto `iznwvklzmyhzalabgfxl`. Se corrigió solo el historial (`migration repair`): las 5 migraciones aplicadas con el conector quedaron con los nombres del repositorio. No se tocó ninguna tabla.
- `supabase db push`: se aplicaron de la 6 a la 22.
- **Hallazgo:** la `20260328030145` falla en una base nueva porque crea `backoffice_members_jefe_read`, que ya existe. En Lovable alguien la borró o renombró a mano entre la 20 y la 21 (el historial de Lovable guarda las mismas instrucciones que el repositorio). Se agregó `20260327024212_deriva_lovable_jefe_read.sql`, que registra ese cambio manual. Con eso las migraciones del repositorio reproducen la base real desde cero.
- **Comprobado igual a Lovable:** tipos generados idénticos a `types.ts`; 124 de 124 reglas equivalentes (comparadas dentro de la base); 34 tablas con RLS, 6 funciones, 6 triggers, 8 índices, 67 relaciones, 6 restricciones de unicidad, las mismas 6 tablas con tiempo real y el mismo bucket. Los permisos de lectura y escritura de la app están.

**Usuarios y datos:** cargados desde el respaldo con la CLI (archivo "seed" temporal; las contraseñas cifradas no pasaron por el chat). Se cargan primero los usuarios y después las identidades. Conteos iguales al respaldo: 5 usuarios con su contraseña de siempre (camino A), 5 identidades, 1 local, 2 mesas, 2 pedidos, 4 productos pedidos, 3 miembros, 3 personal, etc.

**Fotos:** las 6 subidas a `menu-images` con la misma ruta (`supabase storage cp`). Responden en la dirección nueva. Las 3 direcciones de los datos se cambiaron al proyecto nuevo; ninguna apunta ya a Lovable.

**Funciones:** 9 publicadas con `supabase functions deploy --use-api`, con `verify_jwt = false`. Responden igual que en Lovable (errores en español por datos faltantes). `create-platform-admin` y `create-jefe-ventas` no existen (404). `support-chat` responde "Error en el servicio de IA" hasta que se cargue `ANTHROPIC_API_KEY` (el fundador la cargará después).

**App:** `.env` apunta al proyecto nuevo (clave pública clásica, igual que antes). El `.env` de Lovable quedó respaldado en `migracion-privada:/env_lovable.backup`, para volver atrás.

**Local de demo "Demo Tablio"** (`/demo-tablio`): `scripts/demo/crear_demo.py` genera el SQL y las credenciales en `privado/` (fuera de git). Incluye 9 cuentas (dueño, administrador, 2 mozos, cocina, superadmin, jefa de ventas, vendedor y finanzas) con correos `@demo.tablio.test` (dominio reservado, nunca envía correos) y contraseñas al azar, una sucursal en prepago, 6 categorías, 24 productos, 8 grupos de modificadores, 10 mesas y lealtad. Todavía sin fotos. Cómo entrar: `docs/DEMO_ACCESS.md`.

**Pruebas (Playwright) contra la base nueva: 32 de 32 que corren pasan** (2 se saltan porque necesitan el código de una mesa de Lovable por variable de entorno; con él, también pasan):
- humo (5 × 2 tamaños);
- local de Lovable carga con fotos del almacenamiento nuevo;
- los 9 roles del demo entran y llegan a su panel;
- recorrido completo: el comensal pide un Pisco Sour y paga → cocina lo acepta, lo marca listo y entregado. Verificado en la base: pedido #1 pagado $5.500 (pago `approved`, simulado) y con las tres horas registradas.

**Error heredado encontrado por las pruebas:** el mozo tiene que entrar dos veces (DIAGNOSTICO N16). No se arregla ahora (migrar tal cual). Se resuelve con el login único (paso 4.1).

**Pendiente de la fase 2:** URL del sitio y direcciones de retorno de Auth (cuando exista la dirección de Vercel), publicar en Vercel, clave de Claude, revisión pantalla por pantalla con el fundador, desconectar Lovable de GitHub y unir la rama con `main`.

---

## 2026-10-01 — Migración en curso: estructura (1-5 aplicadas) y preparación del resto
Autorizado por el fundador ("vamos con todo"): copiar la base tal cual, incluidas las reglas inseguras.

**Estructura en la base nueva:**
- ✅ Migraciones 1, 2, 3, 4 y 5 aplicadas con el conector, **una por una**: 22 tablas y 52 reglas.
- ⛔ La 6 quedó rechazada: tiene instrucciones que borran reglas para reemplazarlas (`DROP POLICY`), y el conector pide una confirmación humana que esta sesión no puede dar. No se intentó rodearla.
- 📄 `migracion/aplicar_migraciones_6_a_22.sql`: las 17 migraciones que faltan, copiadas tal cual de los archivos del repositorio, en una sola transacción (todo o nada). Al final deja el historial de migraciones con los mismos nombres del repositorio, para que la CLI de Supabase lo reconozca. **Lo aplica el fundador** en el SQL Editor de Supabase.

**Preparado (sin tocar la base):**
- `supabase/config.toml`: apunta al proyecto nuevo y declara `verify_jwt = false` en las 9 funciones que se publican, igual que en Lovable.
- `supabase/functions/support-chat/index.ts`: usa Claude Haiku 4.5 (`claude-haiku-4-5`) con el SDK oficial de Anthropic (`npm:@anthropic-ai/sdk@0.131.0`) y traduce la respuesta al formato que ya espera la pantalla. Usa el secreto `ANTHROPIC_API_KEY`. Mismas instrucciones del asistente. Se prueba al publicarla.
- `scripts/copy_a_insert.py`: convierte los datos del respaldo en instrucciones de carga.
- En `migracion-privada:/` (fuera de git): `carga_auth.sql` (5 usuarios con contraseña cifrada y sus 5 identidades; las columnas coinciden exactamente con el proyecto nuevo), `carga_public_ordenada.sql` (43 filas, ordenadas según las relaciones entre tablas) y `fotos/` (las 6 fotos, con el mismo tamaño que figura en el respaldo).
- Estos cambios van en la rama `fase-2-migracion`, no en `main`: mientras Lovable siga conectado podría publicar solo los cambios de `main` en su propio proyecto (el chat dejaría de funcionar allá y perderíamos la referencia del "antes").

---

## 2026-10-01 — Respaldo completo de Lovable, vista previa y estética
**Respaldo:** el fundador dejó en `migracion-privada:/` (el nombre de la carpeta termina en dos puntos) el respaldo oficial de Lovable (`tabliochile_261001.backup`, formato de Postgres 17 comprimido). La carpeta queda fuera de git.
- Para leerlo se instalaron con Homebrew `libpq` y `postgresql@18` (solo las herramientas; no se inició ninguna base local).
- Trae los datos de las 34 tablas, los usuarios **con sus contraseñas cifradas**, sus identidades, los metadatos de las fotos y el historial de migraciones.
- Se extrajeron, dentro de la misma carpeta privada, `datos_public.sql` (datos) y `auth_users.sql` (usuarios).
- **Filas:** 1 local ("La parrillada", `/la-parrillada`), 1 sucursal, 2 mesas, 2 categorías, 2 productos, 2 pedidos con 4 productos, 2 sesiones, 2 cuentas pedidas, 3 miembros, 3 personal, 3 invitaciones de mozo, 3 de backoffice, 1 lead con 2 actividades, 1 miembro de backoffice, 1 superadmin, 1 plan, 4 flags y 1 programa de lealtad. 0 pagos.
- **Contraseñas:** como vienen cifradas, se usa el **camino A**: los 5 usuarios conservan su contraseña. No hace falta restablecer nada ni crear contraseñas temporales.
- 3 direcciones de fotos apuntan al almacenamiento de Lovable: se reemplazan en el paso 6.

**Vista previa:**
- Local: `bun run dev` → `http://localhost:8080`, o desde el celular en la misma red wifi con la IP del computador. Usa la base que diga `.env` (hoy, Lovable).
- Publicada: `vercel.json` listo (instala con bun, compila y redirige todas las rutas a la app, para que funcionen los links directos como `/la-parrillada/menu`). Al conectar el repositorio en Vercel, cada cambio tendrá su propio link de vista previa.

**Estética:** se agregó a `CLAUDE.md` una sección con las reglas de diseño actuales (componentes, colores, tipografía, color de cada local, modo oscuro) para que todo lo nuevo se vea igual.

---

## 2026-10-01 — Playwright instalado e intento de aplicar la estructura
**Playwright (pruebas en navegador):**
- `@playwright/test` 1.63 como dependencia de desarrollo, más el navegador Chromium.
- `playwright.config.ts`: prueba en tamaño computador y celular, con zona horaria de Chile. Levanta la app local, o apunta a una app publicada con `E2E_BASE_URL`.
- `e2e/humo.spec.ts`: 5 pruebas de humo que solo abren pantallas (login, raíz, ruta inexistente, KDS sin sesión, panel del dueño sin sesión). **10 de 10 pasan** (5 pruebas × 2 tamaños). Corrieron contra la app actual, que todavía usa la base de Lovable, solo leyendo.
- Comando: `bun run test:e2e`.

**Intento de aplicar las migraciones en la base nueva (`iznwvklzmyhzalabgfxl`) — quedó a medias:**
- Las mandé en paralelo, cuando deben ir una tras otra. **Error mío.**
- El sistema de permisos de Claude Code bloqueó dos migraciones: la 1 (crea las tablas principales) y la 2 (crea las políticas públicas que permiten, por ejemplo, que cualquiera se agregue a un local). El motivo: recrear a propósito políticas inseguras en una base nueva. Está bien que lo frene; lo tiene que autorizar el fundador.
- Otras 4 fallaron porque dependían de la 1, y una quedó rechazada.
- **Estado actual de la base nueva:** solo se aplicó `m20260308175521_platform_admins` (la tabla `platform_admins` y la función `is_platform_admin()`). Todo lo demás sigue vacío. No hay datos.
- Pendiente: decisión del fundador sobre cómo seguir (ver la conversación del 1 de octubre). Cuando se retome, las migraciones van **una por una y en orden**, y la que ya se aplicó se salta.

---

## 2026-10-01 — Exportación de Lovable recibida (parcial) y comparada
Archivos en `migracion/lovable/`. `usuarios.sql` y los datos quedan fuera de git porque tienen datos personales.

**Recibido:**
- `esquema_real.sql`: estructura real de la base de Lovable.
- `usuarios.sql`: 5 usuarios, **sin contraseñas cifradas** (Lovable no las entrega).
- `storage.txt`: 6 fotos, unos 12,5 MB.
- `config.txt`: configuración de Auth y de las funciones.

**Falta:** `datos.sql`. Lovable dice que hay que usar la exportación oficial (Cloud → Advanced settings → Export data) o pedirle las 34 tablas en CSV, una por una.

**Comparación del esquema real con las 22 migraciones del repositorio: coinciden.**
- 34 tablas con las mismas columnas, tipos, valores por defecto y obligatoriedad. Las únicas diferencias son de formato: `double precision` contra `float`, `DEFAULT NULL` contra sin valor por defecto.
- 67 relaciones entre tablas, iguales (incluido qué pasa al borrar).
- 6 restricciones de unicidad, 8 índices, 6 funciones, 6 triggers y las 6 tablas con tiempo real: iguales.
- 124 políticas (120 de tablas y 4 de fotos), equivalentes. En 6 de ellas Postgres escribe `leads.id` donde la migración dice `id`: es lo mismo.
- **Conclusión:** nadie tocó la base de Lovable a mano por fuera de las migraciones. Aplicar las 22 migraciones reproduce la base tal cual.

**Hallazgos que cambian el plan:**
1. **Las funciones de servidor en Lovable no verifican la sesión en la entrada** (`verify_jwt = false`). Supabase, por defecto, sí la verifica. Para que funcionen igual, `supabase/config.toml` tiene que declarar `verify_jwt = false` para cada una. No es un arreglo: es lo necesario para que se comporten como hoy. Además, las claves públicas nuevas de Supabase no sirven para esa verificación, así que también hace falta por eso.
2. **Permisos (`GRANT`):** la sección vino vacía en la exportación. Después de aplicar las migraciones hay que comprobar que la app pueda leer y escribir como hoy, porque los proyectos nuevos de Supabase pueden no dar permisos automáticos.
3. **Registro público:** Lovable no pudo ver si está abierto. En el proyecto nuevo se deja como viene por defecto, y se suma a la fase 3 cerrarlo, porque la app no tiene formulario de registro y todas las cuentas se crean desde el servidor.
4. **Usuarios:** 2 de los 5 correos (`joaquin@gmail.com`, `anto@gmail.com`) parecen inventados para pruebas. Si se les manda "olvidé mi contraseña", el correo le llegaría a un desconocido. Pendiente: decidir con el fundador.

---

## 2026-10-01 — Proyecto Supabase nuevo creado
- El fundador creó el proyecto **"Tablio"** (`iznwvklzmyhzalabgfxl`) en **São Paulo (`sa-east-1`)**, plan gratis. Está vacío y activo.
- Un primer intento quedó en Oregon (`us-west-2`). Se descartó antes de usarlo, porque la región no se puede cambiar después y São Paulo está mucho más cerca de Chile.
- El proyecto nuevo usa **Postgres 17**. Las migraciones usan SQL estándar; si alguna falla por la versión, se anota aquí.
- Se agregó `.mcp.json` con el conector de Supabase de este proyecto. Solo contiene el identificador, ninguna clave. Se autoriza con `/mcp` en una sesión interactiva.
- Todavía no se tocó la base: falta la exportación de Lovable.

---

## 2026-10-01 — Plan: un solo gestor de dependencias
- Se agregó el paso **4.8** a `docs/PLAN_FASES.md`: dejar solo **bun** como gestor de dependencias.
- Motivo: el repositorio tiene tres archivos de versiones y solo uno está al día. `bun.lock` es del 10 de agosto de 2026 y calza con `package.json`. `package-lock.json` (npm) es de marzo de 2026, y `bun.lockb` (formato viejo de bun) es de la plantilla original. Con varios archivos, una herramienta como Vercel puede instalar versiones distintas a las probadas.
- Qué se hará en la fase 4: borrar `package-lock.json` y `bun.lockb`, confirmar que Vercel instala con bun y actualizar `CLAUDE.md`.
- Mientras tanto, instalar siempre con `bun install --frozen-lockfile`.

---

## 2026-10-01 — Fase 2 (migración): aprobación y paso 0

### Decisiones aprobadas por el fundador
- **Supabase propio:** organización "Tablio", proyecto en São Paulo, plan gratis. Lo crea el fundador y da acceso por el conector de Supabase.
- **Hosting:** Vercel.
- **Chat de soporte:** Claude Haiku 4.5 (`claude-haiku-4-5`). El fundador crea la clave con tope de gasto mensual y la carga como secreto `ANTHROPIC_API_KEY` en Supabase.
- **Usuarios:** si Lovable no entrega las contraseñas cifradas, se restablecen.
- **Estados:** se quedan en inglés dentro de la base. El paso 4.3 pasa a ser una capa de traducción para las pantallas. Motivo: renombrarlos obliga a tocar funciones, filtros y tiempo real, con riesgo de romper algo, y el usuario ve lo mismo.
- **Dominio definitivo:** se agrega como hito en `docs/PLAN_FASES.md`. Último momento razonable: al empezar la fase 5. Siempre antes de imprimir un QR real.

### ⚠️ Única excepción a "migrar tal cual"
**`create-platform-admin` y `create-jefe-ventas` no se publican en el proyecto Supabase nuevo.**
- **Por qué:** no verifican quién las llama. Cualquiera puede crear con ellas un superadministrador o un jefe de ventas (problema N1 de `docs/DIAGNOSTICO.md`).
- **Por qué no afecta la comparación antes y después:** ninguna pantalla las usa (no aparecen en ningún `functions.invoke` de `src/`).
- **Qué sigue:** el código queda en el repositorio hasta el paso 3.1, donde se borra.

### Paso 0 — Congelar y respaldar ✅
- **Etiqueta git `pre-migracion`** en el commit `3226116` ("Añadió auditoría de seguridad"), el último que llegó desde Lovable. Por ahora es solo local; se sube a GitHub con el primer push.
- **Dependencias:** `npm ci` falla porque `package-lock.json` está desactualizado (último cambio en marzo de 2026; le faltan, entre otros, `@supabase/supabase-js`, `framer-motion` y `zustand`). Lovable usa **bun**, y `bun.lock` sí está al día. Se instaló con `bun install --frozen-lockfile` (509 paquetes, sin cambiar ningún archivo del repositorio).
- **Situación de partida (sin cambios de código):**
  - `npm run build`: ✅ compila. Aviso: el archivo principal pesa 2,2 MB (600 KB comprimido); se puede dividir más adelante.
  - `npx tsc --noEmit`: ✅ sin errores de tipos.
  - `npm run test`: ✅ 1 de 1 (es una prueba de ejemplo que no prueba nada).
  - `npm run lint`: ⚠️ 153 avisos (124 errores, 29 advertencias), heredados de Lovable. No bloquean la compilación. Se ordenan en la fase 4.
- **Pendiente para seguir:** el proyecto Supabase nuevo (lo crea el fundador) y la exportación de Lovable (ya pedida). **No se toca ninguna base hasta tener las dos cosas.**

---

## 2026-10-01 — Fase 1: diagnóstico
- Se guardaron `docs/vision/TABLIO_BRIEF_v3.md` y `ESTADO_LOVABLE.md`.
- Se crearon `CLAUDE.md`, `docs/DIAGNOSTICO.md`, `docs/PLAN_MIGRACION.md` y `docs/PLAN_FASES.md`.
- Sin cambios de código ni de base de datos.
