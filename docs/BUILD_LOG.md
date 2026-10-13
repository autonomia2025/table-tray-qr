# Bitácora de construcción — Tablio

Qué cambió, cuándo y por qué. Lo más reciente va arriba.

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
