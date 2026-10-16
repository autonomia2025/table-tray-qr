# Cómo probar la demo de Tablio

Este archivo explica cómo entrar. **Las contraseñas no están aquí**: viven en `privado/DEMO_CREDENCIALES.md`, que no se sube a GitHub. Si no lo tienes, pídeselo a quien administra el proyecto o vuelve a generarlo con `python3 scripts/demo/crear_demo.py` (eso crea contraseñas nuevas; después hay que recargar el demo).

## Dónde está la app

| Dónde | Dirección | Base de datos |
|---|---|---|
| En tu computador | `http://localhost:8080` (se levanta con `bun run dev`) | La que diga `.env` (hoy, el Supabase propio) |
| En el celular, misma red wifi | `http://<IP del computador>:8080` | Igual que la anterior |
| Publicada | Pendiente: Vercel (paso 2.10) | — |

## Local de demo: "Demo Tablio"

- **Carta del comensal:** cada mesa tiene su propio link (está en el archivo de credenciales). Hay 10 mesas: 1 a 6 en el interior y 7 a 10 en la terraza.
- **Portada:** `/demo-tablio`
- **Sucursal:** Barrio Italia, en modo **prepago** (cocina solo ve lo pagado).
- **Carta:** cervezas, tragos, sin alcohol, picoteo, platos y postres, con 24 productos, modificadores (punto de la carne, tamaño de papas, pisco y bebida) y alérgenos. **Todavía no tiene fotos.**
- **Lealtad:** 5 visitas = un schop gratis; cuenta una visita por día desde $3.000.
- **Pagos:** simulados. No se cobra plata real.

### Cuentas (todas entran por `/login`)

| Rol | Correo | Llega a |
|---|---|---|
| Dueño | `dueno@demo.tablio.test` | `/admin/demo-tablio/inicio` |
| Administrador | `admin@demo.tablio.test` | `/admin/demo-tablio/inicio` |
| Mozo 1 (Camila) | `mozo1@demo.tablio.test` | `/mozo/mesas` |
| Mozo 2 (Diego) | `mozo2@demo.tablio.test` | `/mozo/mesas` |
| Cocina y barra | `cocina@demo.tablio.test` | Directo a la pantalla de cocina: `/kds?branch=aebe7faa-0e29-5aa9-83c2-1e1b336f1554` |
| Cajero | `cajero@demo.tablio.test` | `/admin/demo-tablio/caja` (solo ve Caja, Pedidos y Mesas) |
| Superadmin | `superadmin@demo.tablio.test` | `/superadmin` |
| Jefa de ventas | `jefe@demo.tablio.test` | `/jefe-ventas/dashboard` |
| Vendedor | `vendedor@demo.tablio.test` | `/vendedor/mi-dia` |
| Finanzas | `finanzas@demo.tablio.test` | `/finanzas/revenue` |
| Cliente (comensal con cuenta) | `cliente@demo.tablio.test` | No entra por `/login` (es un cliente, no del equipo). Lo usan las pruebas automáticas; llega con 4 sellos de la historia de ejemplo. |

Los correos usan el dominio reservado `.test`: no existen y nunca se le manda un correo a nadie. Por eso "¿Olvidaste tu contraseña?" no sirve para estas cuentas.

> ⚠️ La cuenta de superadmin del demo ve **todos** los locales de la base. Cuando haya locales reales, se separa la base de pruebas de la de producción (paso 4.7) o se elimina esta cuenta.

## Demo de venta en 5 minutos (sugerencia)

1. En tu celular, abre el link de la mesa 3. Pide un Pisco Sour y unas papas XL, y paga con tarjeta.
2. En el computador, con la cuenta de cocina, abre el KDS: el pedido llega solo. Acéptalo y márcalo listo.
3. En el celular del comensal, el estado cambia en vivo.
4. En el celular del comensal, toca "Llamar al mozo" (sin escanear nada). Con la cuenta del mozo (Camila), la mesa aparece con 🔔: tómala y toca "Atender llamada"; el comensal lo ve al instante.
5. Cuando se van, el mozo abre la mesa y toca "Cerrar mesa". El comensal ve "¿Cómo estuvo tu experiencia?" y califica.
6. La pantalla del mozo muestra cada mesa con su color y su cronómetro: rojo si llaman, verde si hay algo listo para llevar, ámbar si falta cobrar, azul si está en cocina. Como respaldo, dentro del detalle de una mesa está **"Tomar pedido a mano"**: elige una hamburguesa (el punto de la carne es obligatorio) con palta. El precio lo calcula el servidor. En prepago, el pedido queda "esperando pago" en la cocina hasta que se cobre (el cobro del mozo llega en la fase 2).
7. **Pagar al mozo:** en el pago, el comensal toca "Prefiero pagarle al mozo". Su pedido queda "💳 Por pagar al mozo" y la cocina lo ve "esperando pago". El mozo abre la mesa, toca "💵 Efectivo" o "💳 POS", anota la propina y lo recibido (calcula el vuelto) y registra el cobro: el pedido pasa a cocina.
8. **Cierre de caja:** con la cuenta de la cajera, abre Caja → "Cierre de caja". Tablio ya sumó lo cobrado por la app, en efectivo y por POS, y restó los reembolsos. Anota el efectivo contado: si falta o sobra plata, lo marca en rojo y pide explicarlo en las notas antes de cerrar. Abajo están las propinas por mozo. Al cerrar, el día queda con candado y ya no se puede cambiar (lo que llegue después cuenta para el día siguiente). Para no cerrar el día del demo, prueba el cierre eligiendo un día pasado.
9. **Turnos y propinas:** con la cuenta de Camila, arriba en Mesas aparece "Empezar turno" (o empieza solo al tomar una mesa). Un cliente paga con propina; cuando Camila toma esa mesa, la propina aparece en su barra verde "En turno". En Perfil ve su turno (duración, mesas, ventas, propinas) y no puede terminarlo mientras tenga mesas a cargo. El dueño ve todos los turnos con sus propinas en Equipo → Turnos.
10. **Cocina y barra:** abre el KDS en dos pantallas con la cuenta de cocina y elige arriba "Barra" en una y "Cocina" en la otra. Pide desde la mesa un agua y un Barros Luco: el agua aparece solo en la barra y el sándwich solo en la cocina. Cuando la barra marca lista el agua, Camila ve la mesa "Listo en Barra · lo demás sigue en preparación" y puede llevarla al tiro. Las estaciones se crean en Sucursal → Estaciones, y cada categoría elige la suya en Carta ("Se prepara en").
11. **Control del equipo:** en Equipo, "Desempeño del equipo" muestra a cada mozo (mesas cerradas, entregas, ventas, ticket, propinas, cuánto tarda en responder y en llevar lo listo, con semáforo, y su calificación) por hoy, 7 o 30 días. Debajo se ponen metas (el demo trae una general: $150.000 diarios). Camila ve el avance en su Perfil. Si algo listo pasa del objetivo (Sucursal → Tiempos objetivo, 5 minutos en el demo), su pantalla muestra "Hay pedidos listos esperando" y suena, y la cocina marca la tarjeta en rojo.
12. **La mesa en vivo (comensal):** pide un agua y un Barros Luco y abre "Ver estado de mi pedido":
    - aparece "Listo en aprox. 12 min" y cada producto con su estación;
    - toca "En tu mesa" para ponerte un nombre.

    Cuando la barra deja lista el agua, el comensal recibe el aviso y lee "Ya está listo: Agua mineral. Sigue en Cocina: Barros Luco". "Otra ronda" copia el pedido al carrito. Si pides lo mismo en dos visitas, la tercera vez la carta te ofrece "⭐ Lo de siempre" arriba.
13. **Aviso con el celular bloqueado (pruébalo en tu teléfono):**
    - **Android (Chrome):** abre el link de una mesa (por ejemplo la mesa 1), pide y paga. En el seguimiento toca "🔔 Avísame cuando esté listo, aunque bloquee el celular" y acepta. Bloquea el teléfono. Con la cuenta de cocina, en el KDS, acepta y marca LISTO: llega "Demo Tablio · Ya está listo: …". Al tocarlo se abre tu pedido. Arriba también aparece "📲 Instalar la app".
    - **iPhone (iOS 16.4 o más nuevo):** en Safari abre el link de la mesa, toca Compartir → "Agregar a inicio", abre Tablio desde el ícono nuevo y sigue los mismos pasos. Apple solo entrega avisos a la app instalada.
14. **Código de mesa:** para pagarle al mozo, la app pide los 4 números de la mesa.
    - En el demo, los ves en QR (columna Código; también salen en las tarjetas impresas) o en el detalle de la mesa del mozo ("Código 1234").
    - Un código equivocado se rechaza, y 5 intentos fallidos bloquean 10 minutos.
    - En Sucursal se elige cuándo pedirlo: solo para pedir sin pagar (recomendado), siempre o nunca.
15. **Unir mesas:** con Camila, abre una mesa y toca "🔗 Unir con otra mesa". La otra aparece como "Unida a la mesa X" y su QR entra a la mesa principal. "✂️ Separar" las vuelve a dividir, y al cerrar la principal se liberan solas.
16. **Cuenta abierta controlada:** en Mesas, el dueño ve "Lo que todavía no se paga": lo que arriesga ahora y lo perdido en 30 días, con el motivo de cada mesa que se fue sin pagar. En cuenta abierta, cada persona tiene un límite (Sucursal).
17. **Inicio del dueño:** al entrar, el dueño ve "Así le fue a Demo Tablio": cuánto vendió anoche comparado con el mismo día de la semana pasada, el plato estrella, la zona y la hora más fuertes, quién vendió más, las propinas y la calificación. Abajo aparecen los avisos; el demo trae la chorrillana saliendo lenta. El demo tiene 4 semanas de ventas de ejemplo (se vuelven a sembrar al reiniciarlo); hoy parte en cero.
18. **Reportes:** con 30 días se ven las ventas por día, cómo te pagaron, los platos que más vendes, qué traba la cocina, el mapa de calor de horas y las zonas. Se exporta a CSV. Muestra también Caja: el pago que hiciste quedó registrado.
19. **Sellos que se sienten:** paga desde una mesa con tu propio correo guardado (Sellos → Continuar con mi correo). En "¡Pago listo!" el sello cae en la tarjeta y vibra el celular; uno por día, desde $3.000. Si pagas como invitado, la tarjeta muestra el sello "fantasma": al guardar tu cuenta, ese sello cae. Al completar 5, aparece el premio con un código de 4 letras. Con Camila, abre la mesa: "Un premio para entregar"; escribe el código que muestra el cliente y queda entregado (el dueño lo ve en Lealtad).

20. **Propinas:** al pagar, el 10% viene marcado; se puede elegir 15%, 20%, otro monto o "sin propina". En Caja → "Propinas del equipo", el dueño ve cuánto le debe a cada mozo y hasta cuándo tiene plazo (7 días hábiles), y registra el pago. La mozo lo ve en Perfil → "Mis propinas". El demo trae pagadas las semanas anteriores y pendientes los últimos días.

21. **Pagar con Webpay de prueba:**
    - con el dueño, en Sucursal → "Cómo te pagan con la app" → Webpay (Transbank) → "Probar con las claves de prueba de Transbank";
    - desde una mesa, "Pagar con Webpay" → Tarjetas → `4051 8856 0044 6623`, vencimiento cualquier fecha futura, CVV `123` → Pagar;
    - en el banco de prueba, RUT `11.111.111-1` y clave `123` → Aceptar → vuelves a Tablio con "¡Pago listo!" y el comprobante TBK;
    - es el ambiente de pruebas de Transbank: no se cobra plata real;
    - en Caja → Cierre de caja, "Verificar con Transbank" compara cada pago con Webpay del día con Transbank;
    - al terminar, "Desconectar" (el demo vuelve a pagos simulados). Reiniciar el demo también lo desconecta.
22. **Transferencia y boleta del local:**
    - con el dueño, en Sucursal → "Datos para transferir", anota banco, cuenta y RUT; "Recordar la boleta en efectivo y transferencia" viene encendido;
    - un comensal elige "Prefiero pagarle al mozo"; Camila abre la mesa y toca "📲 Transferencia": ve los datos para mostrárselos al cliente;
    - abajo, "Entregué la boleta" (con su número, opcional). Si no la marca, queda arriba en sus mesas en "Boletas por entregar", con "Ya la entregué";
    - en Caja → Cierre de caja aparecen las boletas por entregar de los últimos 7 días y la fila "Transferencia" en el cuadre (se revisa en la cartola, no se cuenta en el cajón);
    - con la app o con POS no se pide boleta: el comprobante del pago vale como boleta si el local lo declara en el SII.

23. **Excepciones de la caja:** en Caja → Excepciones (con un número cuando hay algo pendiente) aparece lo que la app no pudo resolver sola. Por ejemplo: un cobro sin pedido que la pasarela no devolvió, una diferencia con Transbank, una boleta de ayer sin marcar o un reembolso rechazado. Cada una tiene su botón; lo que se resuelve a mano pide escribir qué pasó. El Inicio del dueño y el cierre de caja avisan cuántas hay. En el demo normalmente está vacía ("Todo en orden").

24. **Dar de alta un local nuevo** (superadmin, en `/superadmin/tenants` → "Nuevo"): nombre, dirección en Tablio, dueño, correo, mesas y cómo cobra. Se crea completo (mesas con su QR y código, carta vacía) y aparece el enlace para el dueño, para copiar o mandar por WhatsApp. El dueño lo abre, elige su contraseña y queda en su panel. En el detalle del local se ve si ya lo activó, o se crea un enlace nuevo. **Ojo:** en la base real esto crea un local de verdad.

25. **Primeros pasos y pegar la carta:**
    - un local recién activado ve en su Inicio "Para abrir tu local": marca, carta, equipo, cobro, QR, pedido de prueba y abrir. Cada paso tiene su botón y se marca solo. El demo ya los tiene casi todos hechos;
    - en Menú → "Pegar carta" se pega la carta entera: un título por categoría terminado en dos puntos y un plato por línea con su precio al final (o columnas copiadas de una planilla). Antes de importar se ve cómo quedó y qué líneas no se entendieron.

26. **Guías de capacitación:** el botón "?" (abajo a la izquierda en el panel; arriba en el celular, en la pantalla del mozo y en la cocina) abre la guía corta del rol. Las guías imprimibles están en `/ayuda/dueno`, `/ayuda/caja`, `/ayuda/mozo` y `/ayuda/cocina`, sin necesidad de entrar.

27. **Tablet compartida:**
    - el mozo crea su PIN en Perfil → "Mi PIN para tablets";
    - el dueño, en Equipo → "Tablets compartidas", toca "Activar este dispositivo como tablet" y después "Abrir la pantalla de la tablet" (o entra a `/tablet`);
    - en la tablet, cada mozo toca su nombre y escribe su PIN; al terminar, "Cambiar de mozo". Tras 4 minutos sin uso, vuelve sola a pedir el PIN;
    - desde Equipo se desactiva una tablet o se borra el PIN de alguien.
28. **Cortes de turno (varios cierres al día):** como cajera, en Caja → "Cierre de caja", toca "Hacer corte de turno", ponle nombre (por ejemplo "Turno mañana"), escribe el efectivo contado y "Guardar corte". Lo que se cobre después es del turno siguiente; al cerrar el día se cuenta solo desde el último corte y el cierre suma todos.
29. **Permisos por rol:** como dueño, en Equipo → "Permisos por rol", activa "Ver reportes" para Cajero y desactiva "Devolver plata". Al volver a entrar como cajera, verás Inicio y Reportes en el menú y ya no el botón "Reembolsar". Para dejarlo como venía, vuelve a mover los interruptores (o usa el reinicio del demo).
30. **Campañas:** como dueño, en "Campañas", escribe un título y un mensaje, elige "Frecuentes" (el cliente de ejemplo `cliente@demo.tablio.test` aceptó promociones y es frecuente) y toca "Enviar campaña". Los avisos salen solo entre las 10:00 y las 22:00, y hay un máximo de 4 campañas cada 30 días. Si el cliente de ejemplo instaló la app en su celular, le llega el aviso, que abre la promoción y permite darse de baja. Los resultados (abiertos, quienes volvieron y lo que gastaron en 7 días) aparecen en la misma página.

## Experiencia del comensal (invitado o cliente)

- Al abrir la carta de una mesa, el comensal entra como **invitado**: puede pedir y pagar sin registrarse.
- Arriba a la derecha aparece **"Sellos"**: ahí guarda su cuenta con su correo, Google o Apple. Al pagar, si es invitado, ve la invitación "Guarda tus sellos".
- **Hoy, en la base real:** el registro con correo manda un **enlace** (no un código), y el correo incluido en Supabase **solo llega a direcciones del equipo**. Para comensales reales hace falta un servicio de correo (pendiente). Google y Apple muestran "muy pronto" hasta configurar sus credenciales.
- Ya registrado, el cliente ve su inicial arriba a la derecha, qué suma cada pago y su tarjeta de sellos (también en el seguimiento del pedido, donde el sello cae cuando el mozo registra un cobro).

## Dejar el demo limpio

Antes de una demo de venta o de una ronda de pruebas:

```bash
bun run demo:reiniciar
```

Borra pedidos, pagos, sesiones, llamados, lealtad e invitaciones del demo, deja las mesas libres y la carta disponible, y vuelve a sembrar 4 semanas de ventas de ejemplo (días anteriores a hoy) para que el inicio y los reportes tengan qué mostrar. No toca la carta, el equipo ni otros locales. Solo funciona con la cuenta superadmin del demo.

## Pruebas automáticas

```bash
bun run test:e2e                      # todas
bunx playwright test e2e/flujo-demo.spec.ts   # solo el recorrido completo
```

- `e2e/humo.spec.ts`: cada pantalla abre sin romperse.
- `e2e/demo-roles.spec.ts`: cada rol del demo entra y llega a su panel.
- `e2e/flujo-demo.spec.ts`: el comensal paga → cocina acepta, marca listo y entregado. **Crea un pedido real (con pago simulado) en el demo.**
- `e2e/migracion.spec.ts`: el local de prueba que vino de Lovable ("La parrillada") carga con sus fotos.
