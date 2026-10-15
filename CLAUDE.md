# CLAUDE.md — Reglas de trabajo en Tablio

Este archivo lo lee Claude Code al empezar cada sesión. Resume cómo se trabaja en este repositorio.
Si algo de aquí contradice `docs/vision/TABLIO_BRIEF_v3.md`, **gana el brief**.

## Antes de empezar cualquier tarea

1. **`docs/vision/TABLIO_BRIEF_v3.md`**: qué es Tablio y a dónde vamos. Las secciones 4 (reglas que no se negocian) y 9 (calidad) mandan.
2. **`docs/MASTER_PLAN.md`**: el plan vigente, en qué fase estamos y qué paso toca (`docs/PLAN_FASES.md` es histórico).
3. **`docs/DIAGNOSTICO.md`**: problemas conocidos del código actual, con archivo y línea.
4. **`ESTADO_LOVABLE.md`**: la auditoría que hizo Lovable. Es útil, pero tiene errores corregidos en el diagnóstico.

**Fase actual:** fase 0 terminada; fase 1.1 (contención) y 1.2 (roles y login único) hechas. 1.3 (identidad del comensal), 1.4 (dominio pedidos), 1.5 (mesas y sesiones), 1.6 (acciones del comensal sin cámara), 1.7 (configuración del local), 1.8 (plataforma y backoffice), 1.9 (precios y pedido del mozo) y 1.10 (compuerta de seguridad) hechas: **fase 1 terminada**. Fase 2 (núcleo de la plata: pago, pagar al mozo, reembolsos, cierre de caja y compuerta de la plata) **terminada**. Fase 3 (operación de sala) **terminada**: 3.1 (turnos y propina), 3.2 (estaciones y KDS robusto), 3.3 (control del equipo), 3.4 (la mesa en vivo), 3.4b (app instalable y avisos) y 3.5 (código de presencia, cuenta abierta controlada y unir mesas) 3.6 (reportes en el servidor e inicio del dueño), 3.7 (sellos que se sienten) y 3.8 (compuerta) hechas. Pista P (calidad) hecha. Fase 4 (dinero real) **terminada**: 4.1 (pasarelas por local, Transbank completo), 4.3 etapa 1 (transferencia y boleta del local por marcar), 4.4 (pagos que no vuelven y conciliación con Transbank), 4.5 (privacidad del comensal), 4.6 (excepciones de la caja) y 4.7 (compuerta). En pausa por decisión del fundador: 4.2 Mercado Pago y 4.2b Apple Pay/Google Pay con Klap. Esperan el dominio: los correos con Resend y Campañas. Después del piloto: 4.3 etapa 2 (boleta electrónica con proveedor). Fase 5 (producción y piloto) en curso: 5.1 (alta del local por Tablio) y 5.2 (primeros pasos del dueño e importar la carta) hechas. Siguiente: 5.3 (prueba de carga). 5.6 y 5.7 esperan al fundador. Campañas por correo aprobada (15 de octubre), espera el dominio. Se trabaja sobre `main`. Antes: 2 (migración), casi lista. La base nueva (`iznwvklzmyhzalabgfxl`) ya tiene estructura, datos, fotos, funciones y el local de demo, y `.env` apunta a ella. Falta: Vercel, Auth (URL del sitio), la clave de Claude, la revisión con el fundador y unir la rama `fase-2-migracion` con `main`. Credenciales del demo en `privado/` (fuera de git); cómo entrar en `docs/DEMO_ACCESS.md`.

**Decisiones tomadas:** Supabase propio (organización "Tablio", São Paulo, plan gratis) · hosting en Vercel · chat de soporte con Claude Haiku 4.5 · `create-platform-admin` y `create-jefe-ventas` no se publican en el proyecto nuevo (única excepción a "migrar tal cual") · los estados se quedan en inglés en la base, con una capa de traducción en pantalla · el dominio definitivo se decide antes de imprimir QR reales (último momento: inicio de la fase 5).

## Quién es el usuario

El fundador **no es desarrollador**. Todo se le explica en español simple, sin jerga. Si hay que usar un término técnico, se explica en una frase. Las decisiones se le presentan con una recomendación clara, no como una lista de opciones.

## Stack

- Frontend: React 18 + Vite + TypeScript + Tailwind + shadcn/ui. Carrito en Zustand (`src/store/cartStore.ts`), datos con React Query.
- Backend: Supabase (Postgres + Auth + Realtime + Storage + Edge Functions en Deno).
- Hoy la base vive en Lovable Cloud (proyecto `ooyvkdjlerehvtivorec`). La fase 2 la mueve al Supabase propio **`iznwvklzmyhzalabgfxl`** (São Paulo, Postgres 17), hoy vacío.

## Comandos

```bash
bun install --frozen-lockfile   # instalar dependencias (bun es el único gestor; solo existe bun.lock)
bun run dev          # app local en http://localhost:8080
bun run typecheck    # revisión de tipos
bun run build        # compilar (debe pasar antes de decir "listo")
bun run lint:tope    # estilo: falla si hay más errores que el tope heredado (scripts/ci/lint-tope.json)
bun run test         # pruebas unitarias
bun run test:e2e     # pruebas en navegador (Playwright); las del demo usan privado/DEMO_CREDENCIALES.md
bun run test:seguridad   # ataques del diagnóstico contra la base que diga .env: deben fallar (tests/seguridad/)
bun run test:local       # TODO contra una base desechable: Supabase local (colima + `supabase start -x studio,imgproxy,logflare,vector,supavisor`; con colima, vector no puede montar el socket de Docker), migraciones desde cero, demo nuevo
bun run demo:reiniciar   # deja limpio el local de demo en la base que diga .env (solo superadmin)
```

Supabase (después de la migración, con la CLI enlazada al proyecto propio):

```bash
supabase migration new <nombre>        # crear migración
supabase db push                        # aplicar migraciones al proyecto
supabase gen types typescript --linked > src/integrations/supabase/types.ts
supabase functions deploy <nombre>      # publicar una edge function
```

## Mapa del código

| Qué | Dónde |
|---|---|
| Rutas | `src/App.tsx` |
| Comensal (QR, menú, carrito, pago, seguimiento) | `src/pages/*.tsx` (raíz de pages) |
| Dueño | `src/pages/admin/*`, contexto `src/contexts/AdminContext.tsx` |
| Mozo | `src/pages/mozo/*`, contexto `src/contexts/WaitersContext.tsx` |
| Cocina (KDS) | `src/pages/KDSPage.tsx` |
| Backoffice Tablio | `src/pages/{seller,jefe-ventas,finanzas,superadmin}/*` |
| Cliente Supabase y tipos (autogenerados) | `src/integrations/supabase/` |
| Esquema de la base | `supabase/migrations/*.sql` |
| Funciones de servidor | `supabase/functions/*/index.ts` |
| Proveedor de pagos (simulado, aislado) | `supabase/functions/_shared/provider.ts` |

## Decisiones de producto del fundador (1 de octubre de 2026)

- **No hay MVP:** se construye el producto completo. Las fases solo ordenan dependencias; ninguna funcionalidad queda "para después".
- **El flujo principal es autoservicio en prepago:** el comensal pide y paga con el QR; el mozo sobre todo lleva a la mesa lo que la cocina dejó listo. Tomar pedidos a mano y cobrar en efectivo existen, pero como respaldo: nunca se muestran como lo principal.
- **Un solo QR hace todo.** Al pagar, el comensal elige: **"Pagar ahora"** (destacado; va pagado directo a cocina), **"Pagar al mozo"** (efectivo o POS; el mozo cobra, lo registra y recién ahí va a cocina) o, solo en locales con cuenta abierta, **"Agregar a mi cuenta"** (paga su propia cuenta al final, en la app o con el mozo).
- **Nada con cámara.** "Llamar al mozo" y "pedir la cuenta" son botones, sin escanear.
- **El comensal paga sin registrarse (invitado) y puede guardar su cuenta** (correo con código o enlace, Google o Apple) para juntar sellos. Su identidad de invitado se convierte en su cuenta: no pierde nada. Los sellos solo se suman con cuenta verificada.
- **Estados de pedidos:** solo con `cambiar_estado_pedido()` (`src/lib/pedidos.ts`). Nadie escribe directo en `orders` ni en `order_items`.
- **Mesas y sesiones:** abrir, tomar, transferir y cerrar solo con las funciones de `src/lib/mesa.ts`. El comensal resuelve su mesa con `verMesa(código)`: la lectura directa de `tables` está cerrada para él. El total de la sesión lo calcula la base.
- **Auth se maneja desde `supabase/config.toml`**, incluidos los límites por IP (`[auth.rate_limit]`: en un bar todos comparten la IP del wifi). Antes de empujar, revisar siempre la diferencia: `printf 'n\n' | supabase config push`.
- **Precios:** salen solo de `calcular_precios()` en la base (la usan `process-payment` y `crear_pedido_mozo`). El número de pedido sale de `siguiente_numero_pedido()`. El mozo crea pedidos con `crearPedidoMozo` (`src/lib/pedidos.ts`); nadie inserta pedidos desde el navegador.
- **Auditoría automática:** `auditoria_seguridad()` (solo superadmin) lista tablas sin reglas, reglas "para todos", funciones expuestas sin sesión y plata escribible desde el navegador. La prueba `f1-10-compuerta` exige que salga vacía: si una migración nueva abre algo, la integración continua falla. Una excepción a propósito se anota en la propia función, con su motivo.
- **Cómo se paga (fase 2.A):** `cotizar`/`crear_cotizacion` congela el precio 10 minutos → `reservar_intento_pago` reserva la clave única ANTES de cobrar → se cobra → `confirmar_pago` escribe pedido, pago, mesa y sesión de una vez (idempotente, sirve para el aviso tardío de una pasarela). Pago tardío con el monto correcto se respeta; si no calza, o si otra persona ya pagó lo mismo, se devuelve solo. Producto agotado durante el pago: se respeta y `orders.alerta` avisa a cocina. Cada pago guarda `staff_id` (el mozo de la mesa).
- **Pagar al mozo / agregar a mi cuenta (fase 2.B):** el comensal usa `pedirSinPagar` (`pedir_sin_pagar`, máximo 3 pedidos esperando al mozo por persona; "cuenta" solo en locales `open_tab`). El mozo, la caja, el encargado o el dueño registran el cobro con `registrarCobroMozo` (`registrar_cobro_mozo`, efectivo o POS, con propina y vuelto): queda como pago con `staff_id` de quien cobró, y en prepago recién ahí pasa a cocina. `orders.forma_pago` dice cómo eligió pagar (app, mozo, cuenta).
- **Reembolsos (fase 2.C):** `refund-payment` llama a `reservar_reembolso` (rol dueño, administrador, encargado o caja; motivo de 5 a 500 letras; bloquea el pago y nunca supera lo cobrado), devuelve por la pasarela o en el local (efectivo/POS) y confirma con `confirmar_reembolso` (pago, pedidos, sesión y auditoría juntos, idempotente).
- **Caja (fase 2.D):** el día de negocio va de la hora de corte de la sucursal (`branches.corte_dia`, 06:00 de Chile) a la misma hora del día siguiente. Cada pago y reembolso queda en su `dia_negocio` al ocurrir. La conciliación la calcula la base: `resumen_caja` (en vivo o, si el día está cerrado, lo guardado) y `cerrar_caja` (lo contado, diferencias con nota obligatoria, cierre bloqueado por `proteger_cierre`; lo que llega después cae en el día siguiente). No usar `created_at` en UTC para agrupar plata por día.
- **Compuerta de la plata (fase 2.E):** `auditoria_plata()` (solo superadmin) revisa que todo calce: reembolsos contra pagos, estados, pedidos pagados sin pago o cobrados dos veces, montos, cocina sin pago en prepago, intentos sin resolver y cierres que cambiaron. La prueba `f2e-compuerta-plata` exige que salga vacía y que detecte un descuadre hecho a propósito. Cada pago guarda todos sus pedidos en `payments.pedidos`: usarlo en vez de `order_id` para saber qué cubre un pago.
- **Propinas (decisión del fundador, 14 de octubre de 2026):** la propina es del mozo que tomó la mesa; el cliente no elige. `payments.staff_id` es ese mozo, aunque cobre la caja (quién cobró va en `provider_payload.cobrado_por`). Si nadie había tomado la mesa al pagar, va al primer mozo que la tome en esa visita; en una transferencia, lo ya pagado queda con el mozo anterior. Lo hacen los disparadores `atribuir_propina` (al guardar un pago) y `al_asignar_mozo` (al tomar la mesa); cada pago guarda además su `turno_id`.
- **Estaciones (fase 3.2):** cada sucursal tiene estaciones (`stations`; la principal no se borra ni se desactiva) y cada categoría elige la suya (`categories.station_id`, vacío = la principal). Cada producto del pedido guarda su estación y su estado; `cambiar_estado_pedido(pedido, estado, estación)` avanza solo lo de esa estación y el pedido queda en el estado del producto más atrasado. El mozo entrega solo lo que está listo. El KDS elige su estación (`?estacion=`, recordada en el equipo) y recupera todo al volver internet.
- **Mesa en vivo (fase 3.4):** el comensal ve sus productos por estación, el tiempo estimado (`_minutos_plato`: mediana real de 30 días o el tiempo del dueño, más la fila de su estación) y quién está en su mesa con `mi_mesa_en_vivo`; "lo de siempre" con `lo_de_siempre` (pedido en 2 visitas o más, disponible y sin opciones obligatorias). "Otra ronda" (`otraRonda` en `src/lib/mesaEnVivo.ts`) copia un pedido al carrito: el precio lo vuelve a calcular el servidor.
- **Mesas (fase 3.5):**
  - **Código de presencia:** 4 números por mesa, en la tabla `codigos_mesa`, que solo lee el personal (el comensal puede leer la fila de su mesa, así que el código no va ahí). Se pide según `branches.pedir_codigo` (`sin_pagar` por defecto, `siempre` o `nunca`) y lo exigen disparadores en `orders` y `cotizaciones`. Se confirma con `confirmar_presencia` (5 intentos fallidos bloquean 10 minutos) y se cambia con `cambiar_codigos_mesa`.
  - **Cuenta abierta:** límite por persona en `branches.limite_cuenta_persona`. Al cerrar una mesa, lo que queda sin pagar se marca `orders.perdido_at` y queda en la auditoría (`mesa_sin_pagar`). `riesgo_cuenta_abierta` muestra lo que se arriesga y lo perdido.
  - **Unir mesas:** `unir_mesas` y `separar_mesa`, con `tables.unida_a`. Toda entrada del comensal por QR resuelve la mesa principal con `_mesa_del_qr`. Los pedidos guardan su mesa física. Al cerrar la principal se liberan las unidas.
- **Avisos al celular (fase 3.4b):**
  - **Instalable:** la app se instala sin tienda (`public/manifest.webmanifest`, íconos y `public/sw.js`, que solo recibe avisos y no guarda caché). En la carta y el seguimiento, `manifiestoDelLocal` la deja con el nombre del local, abriendo esa mesa.
  - **Suscripción:** el comensal guarda su suscripción con `guardar_suscripcion_push` (tabla `suscripciones_push`, cada uno ve solo las suyas).
  - **Envío:** `cambiarEstadoPedido` llama a la función `avisar-listo` al marcar algo listo; avisa una sola vez por producto (`order_items.avisado_at`).
  - **Implementación:** cifrado y firma propios en `supabase/functions/_shared/webpush.ts` (RFC 8291 y 8292, solo WebCrypto). La librería `npm:web-push` botaba el servidor de funciones con claves inválidas.
  - **Claves VAPID:** secretas en Supabase (`VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY` y `VAPID_SUBJECT`); en local, en `supabase/functions/.env` (fuera de git). La pública también está en `src/lib/push.ts`. Si cambian, hay que cambiar las dos.
  - **Prueba de entrega real:** con Firefox y el servicio de Mozilla, `AVISOS_REALES=1` (`e2e/avisos-reales.spec.ts`).
- **Control del equipo (fase 3.3):** tiempos objetivo por sucursal (`branches.objetivo_llamado_min`, `objetivo_retiro_min`, `objetivo_pedido_min`; se editan en Sucursal y la sucursal solo deja cambiar columnas listadas en su GRANT) dan el semáforo del mozo, la alerta de lo listo que nadie lleva y el cumplimiento. `order_items.delivered_by` (quién entregó) y `table_sessions.staff_id` (mozo a cargo al cerrar, dueño de la calificación) los llenan disparadores. `ranking_equipo` (dueño, administrador, encargado) y `mi_desempeno` (el mozo) calculan todo en la base. Metas en `metas_mozo` (una general o por mozo; el reinicio del demo no las borra).
- **Turnos (fase 3.1):** `abrir_turno`, `cerrar_turno` (el propio sin mesas a cargo, o un encargado con motivo), `mi_turno` y `turnos_sucursal` (`src/lib/turnos.ts`). Tomar una mesa sin turno lo abre solo. Un turno abierto por persona (índice único).
- **Reportes (fase 3.6):** salen solo de la base: `reporte_local` y `historia_del_local` (`src/lib/reportes.ts`), por día de negocio. Ventas = cobrado menos reembolsado, sin propinas. Nada de sumar pedidos en el navegador. Los ven dueño, administrador y encargado; la entrada del dueño es Inicio. `reiniciar_demo` siembra 4 semanas de ejemplo con `_sembrar_historia_demo` (solo el demo y solo días anteriores a hoy).
- **Sellos (fase 3.7):**
  - **Quién los suma:** la base, al guardarse un pago aprobado (disparador `sumar_sellos` → `_sellos_pago`), para la app y para el cobro del mozo. Nunca el navegador ni una edge function. Un problema con los sellos jamás tumba un pago.
  - **Límites:** uno por cliente y día de negocio (índice único en `movimientos_lealtad`), desde `loyalty_programs.monto_minimo` y solo con cuenta verificada.
  - **Lo que ve el cliente:** `mis_sellos` (`src/lib/sellos.ts`) da los sellos retroactivos de las últimas 48 horas y la tarjeta. La animación está en `TarjetaSellos`.
  - **Reembolso total:** lo anula el disparador `anular_sellos`.
  - **Premios:** los entrega el personal con `entregar_premio(premio, código)`. El código lo muestra el cliente; las vistas del personal no lo muestran.
- **Compuerta de la operación (fase 3.8):** `auditoria_operacion()` (solo superadmin) revisa turnos y propinas, estaciones, estado de pedidos contra sus productos, mesas, sesiones, mesas unidas, códigos de presencia y sellos. La prueba `f3-8-compuerta` exige que salga vacía y que detecte un descuadre hecho a propósito. Si una regla nueva cambia lo que es "coherente", se actualiza la auditoría en el mismo cambio.
- **Reglas de acceso nuevas:** usar `(SELECT auth.uid())` y no `auth.uid()` suelto (se calcula una vez por consulta). Toda llave que usen las pantallas en vivo lleva índice.
- **Propinas (art. 64 del Código del Trabajo; decisión del fundador del 14 de octubre de 2026):**
  - **En el pago:** se sugiere al menos 10%. Hay un solo selector (`SelectorPropina`): 10% marcado, 15%, 20%, otro monto y "sin propina" a la vista.
  - **Es del trabajador:** sin descuentos de ningún tipo. Con tarjeta, se entrega en 7 días hábiles.
  - **Lo que hace Tablio:** lleva la cuenta (`propinas_por_pagar`, `pagar_propinas`, `mis_propinas_por_cobrar`, tabla `liquidaciones_propina`). Nunca mueve la plata.
- **Pasarelas (fase 4.1):**
  - **Cada local conecta su cuenta:** la plata va directo a ella. La conexión vive en `conexiones_pago`, con la clave cifrada en Vault y nunca legible desde el navegador. Se conecta con la función `conectar-pago`, que prueba las claves antes de guardarlas.
  - **Cómo se cobra:** `process-payment` usa la pasarela activa (`_pasarela_sucursal`). Con Transbank manda al cliente a Webpay, y `pago-retorno` confirma de forma idempotente y lo devuelve a la app; solo se vuelve a direcciones de Tablio.
  - **Sin pasarela:** un local real no cobra con la app. Lo simulado solo existe con `branches.pagos_simulados`, y esa marca nunca la cambia el navegador.
  - **Adaptadores por pasarela:** en `supabase/functions/_shared/pasarelas/`.
  - **Pagos que no vuelven:** `revisar-pagos` los resuelve (pg_cron cada 5 minutos, con la clave `cron_revisar_pagos` de la bóveda, y `url_funciones` por ambiente).
  - **Conciliación al cerrar la caja:** `conciliar-pasarela` compara cada pago con la pasarela.
  - **Al desconectar una pasarela:** la clave se guarda 120 días, solo para revisiones y devoluciones.
- **Excepciones de la caja (fase 4.6, brief 5.4):**
  - **La bandeja:** `excepciones_caja` (dueño, administrador, encargado, caja) arma una sola lista: cobro sin pedido por devolver (`devolucion_fallida`), reembolso que la pasarela rechazó (`reembolso_fallido`), monto que no calza con Transbank (`diferencia_pasarela`), boleta de un día anterior sin marcar (`boleta_atrasada`) y pago que salió a Webpay sin confirmar (`pago_sin_confirmar`). Está en Caja → Excepciones, con aviso en Inicio y en el cierre.
  - **Resolver:** `resolver_excepcion(tipo, id, acción, nota, folio)`; resolver a mano exige nota (5 a 500 letras) y queda en `audit_logs` (`excepcion_resuelta`). Los reintentos van por las funciones: `revisar-pagos` (con la sesión de la caja) y `refund-payment`.
  - **Devoluciones automáticas:** `confirmar_pago` guarda `intentos_pago.monto_devolver`. Quien llama a la pasarela anota el resultado con `_anotar_devolucion_intento`. `revisar-pagos` reintenta las fallidas (`_devoluciones_por_reintentar`, hasta 6 veces en 7 días), y antes de devolver pregunta el estado a Transbank para no devolver dos veces. `auditoria_plata` marca `devolucion_sin_resolver` después de 7 días.
  - **Diferencias:** `conciliar-pasarela` las guarda con `_anotar_conciliacion` en `diferencias_pasarela` (abierta, revisada o corregida). "Transbank no respondió" no cuenta como diferencia.
- **Compuerta del dinero real (fase 4.7):** `auditoria_plata` también revisa las pasarelas: `pago_pasarela_sin_rastro`, `intento_sin_conexion`, `conexion_sin_clave`, `clave_vencida`, `pago_simulado_en_local_real` y `diferencia_de_otro_local`. `auditoria_operacion` revisa la privacidad: `consentimiento_sin_cuenta`. La prueba `f4-7-compuerta` exige las tres auditorías vacías y que detecten un descuadre hecho a propósito.
- **Alta del local (fase 5.1):**
  - **Crear:** `crear_local` (superadmin, jefe de ventas o vendedor; `_puede_dar_alta`) crea todo en una sola transacción: local, sucursal cerrada y sin cobros simulados, carta, mesas con QR (el código y la estación principal los crean disparadores) y, si viene de un posible cliente, lo marca convertido. Nadie inserta locales desde el navegador.
  - **El dueño:** activa su cuenta en `/activar/:token` con la función `activar-local`. El enlace es de un solo uso y dura 14 días; se reserva antes de crear la cuenta. Si ya tiene cuenta con ese correo, entra y se le suma el local. Tablio nunca elige su contraseña.
  - **Enlaces:** viven en `activaciones_local`, que no se lee desde el navegador. `ver_activacion` es pública a propósito (anotada en `auditoria_seguridad`). `nuevo_enlace_activacion` anula el anterior y `estado_activaciones` muestra el estado sin el enlace.
- **Primeros pasos (fase 5.2):** `primeros_pasos(sucursal)` (dueño, administrador o encargado) calcula en la base lo que le falta al local: marca, carta (3 platos o más), equipo, cobro con la app, QR (`branches.qr_listos_at`, que se marca al descargar o imprimir), pedido de prueba y abrir. `marcar_paso` marca los QR y oculta o muestra la lista. La carta se pega con `importar_carta`: todo o nada, hasta 300 platos, crea las categorías que faltan y no repite platos. El lector de la carta pegada es `leerCartaPegada` (`src/lib/primerosPasos.ts`, con pruebas).
- **Privacidad (fase 4.5, Ley 21.719):**
  - **Lo que hace el comensal:** `mis_datos` (ver y descargar), `guardar_consentimiento` (promociones, aparte y desmarcado) y la función `borrar-mi-cuenta`.
  - **Al borrar una persona:** sus datos personales se eliminan y la plata del local queda sin su nombre (FKs a `auth.users` en `SET NULL`).
  - **Tablas nuevas con datos de una persona:** se agregan a `mis_datos` y a `_borrar_datos_comensal`.
  - **Invitados:** se borran solos a los 90 días.
- **La plata** (pagos, reembolsos, cierres) la ven solo dueño, administrador, encargado y caja. El mozo usa `orders.paid_at` para sus cronómetros.
- **Después de cada fase (decisión del fundador, 15 de octubre de 2026):** se usa siempre la receta `/cerrar-fase` (`.claude/skills/cerrar-fase/SKILL.md`), sin que él la pida: pruebas completas, publicación, recorrido con fotos de Playwright (`RECORRIDO=<carpeta>` activa `foto()` de `e2e/apoyo/recorrido.ts`), reporte publicado, la etapa agregada a la **bitácora de fases** (https://claude.ai/artifact/LKBZxWS4xLC4Z8DDuNUiRV, fuente `docs/bitacora-fases.html`) y un aviso al celular. Después se sigue con la siguiente etapa, salvo que necesite algo de él (servicio externo, cuenta, regla de la sección 4, algo irreversible): entonces se salta a la siguiente que no esté bloqueada, y si todas lo están se le pregunta con una recomendación.
- **Acciones del comensal** (llamar al mozo, pedir la cuenta, calificar): solo con las funciones de `src/lib/mesa.ts`. El comensal debe estar registrado en la mesa (`useComensalEnMesa`, que avisa cuando terminó).
- **Datos del local:** lo público de `tenants` es solo la marca (nombre, colores, logo, mensaje). RUT, correo, teléfono y plan se leen con `rpc('tenants_privado')` (solo superadmin y backoffice). El costo de los platos no se lee desde la app. El equipo se cambia solo con `actualizar_personal` y `activar_personal` (desactivar quita el acceso al instante); la ficha la crea `create-tenant-user`.
- **Backoffice de Tablio:** las reglas usan `mi_miembro_backoffice()` y `es_rol_backoffice()` (solo miembros activos). Rol, cuenta y correo de un miembro solo los cambia el superadmin. La configuración de la plataforma va en `configuracion_tablio` (hook `useConfigTablio`) y los gastos en `gastos_tablio`: nada de negocio en el navegador. Entrar a un local o "ver como" un miembro se registra con `registrarAccesoSoporte` (`src/lib/soporte.ts`).
- **Plan gratis de Supabase:** pausa el proyecto tras 7 días sin uso. La revisión diaria (`.github/workflows/salud.yml`) lo mantiene activo y avisa si algo se cae. Si una conexión falla con "Could not resolve host", revisar `supabase projects list` (estado INACTIVE = pausado).
- **Resend** está aprobado para correos (transaccionales y marketing), pero aún no se configura: espera el dominio definitivo (el fundador todavía no lo tiene). Google y Apple, más adelante.
- **Boleta (15 de octubre de 2026):** siempre a nombre y RUT de cada local, nunca de Tablio. Con la app, el comprobante de la pasarela vale como boleta (el local lo declara en el SII). Efectivo y transferencia, en dos etapas: primero el local usa su sistema y Tablio solo deja marcar "boleta entregada"; después, un proveedor de boletas conectado por cada local, como las pasarelas. Tablio factura a su nombre solo la mensualidad.
- **Boleta por marcar y transferencia (fase 4.3, etapa 1):**
  - **Medios del local:** `registrar_cobro_mozo` acepta efectivo, POS o transferencia (`method = 'transfer'`), con `_boleta_entregada` y `_boleta_folio`. Los datos para transferir van en `branches.datos_transferencia`.
  - **La boleta:** `payments.boleta_estado` (`pendiente`/`entregada`, vacío si no aplica) lo fija el disparador `boleta_del_pago`: solo efectivo y transferencia del local, y solo si `branches.recordar_boleta`. Se marca después con `marcar_boleta` (quien cobró o la caja, con auditoría).
  - **Lo que falta:** `mis_boletas_pendientes` (el mozo, 24 horas) y `boletas_pendientes` (la caja, 7 días). `resumen_caja` trae el canal `transferencia` y el aviso `sin_boleta`; la transferencia suma al total pero no se cuenta en el cajón.
- **Campañas por correo (aprobadas el 15 de octubre de 2026):** sección del dueño para promociones a sus propios clientes; solo a quien aceptó promociones (`consentimientos_comensal`), con baja en cada correo, públicos listos (dormidos, frecuentes, por plato), beneficio que se activa al pagar con el QR para medir visitas y ventas, y límite de envíos por local. Nada que premie tomar más alcohol. Espera el dominio y Resend.
- **Siempre con pruebas completas.** Cada cambio pasa por la integración continua (`.github/workflows/ci.yml`).

## Reglas del producto (resumen de la sección 4 del brief)

Ningún cambio puede romper estas reglas. Si una tarea obliga a romper una, **se detiene y se pregunta**.

1. En prepago, **nada llega a cocina sin pago confirmado**. El filtro tiene que estar en la base o en el servidor, no solo en la pantalla del KDS.
2. **El pago solo lo confirma el servidor** (edge function con `service_role`). Ninguna política RLS puede permitir que el navegador escriba `payment_status`, `payments` ni `refunds`.
3. **El precio se congela antes de pagar** (cotización con vencimiento). Los precios siempre salen de la base, nunca del navegador.
4. **Un pago no se cobra ni se produce dos veces.** La idempotencia se reserva *antes* de cobrar y la protege un índice único en la base.
5. **Cada local está aislado.** Toda tabla con datos de un local lleva `tenant_id` y RLS que lo filtra. Prohibido `USING (true)` en datos de operación.
6. **Los cambios de estado importantes los hace el servidor**: pagar, preparar, entregar, cerrar, reembolsar. El navegador llama a una función (RPC o edge function) que valida y ejecuta.
7. **Todo lo sensible queda registrado** en `audit_logs`: quién, cuándo, qué y por qué.
8. **Cada persona paga lo suyo.** La mesa no es una cuenta compartida.
9. **Tablio nunca custodia la plata** de las ventas.
10. **El comensal nunca ve errores técnicos** ni mensajes en inglés.

## Reglas de calidad (sección 9 del brief, aplicadas a este código)

1. **Leer antes de tocar.** Antes de cambiar un área, revisar el código, las migraciones y las políticas RLS que la afectan. No confiar en `ESTADO_LOVABLE.md` sin verificarlo.
2. **Un cambio a la vez.** Cada cambio deja la app compilando (`npm run build`) y funcionando. Un commit por cambio lógico, con mensaje en español.
3. **No decir "listo" sin probar.**
   - Si se toca la base: crear la migración en `supabase/migrations/`, aplicarla y regenerar `types.ts`.
   - Si se toca la plata (`process-payment`, `refund-payment`, `reconcile-payments`, pedidos): probar los casos difíciles, como pago repetido con la misma clave, dos pagos al mismo tiempo, pago tardío, reembolso doble y dos personas pagando el último producto.
   - Si se toca RLS: probar como anónimo, como mozo, como dueño de *otro* local y como superadmin.
4. **Dos intentos y parar.** Si un error persiste después de dos intentos, detenerse y explicar qué pasa.
5. **Aislamiento por local en toda tabla nueva**: columna `tenant_id`, RLS activado, políticas que filtran por local. Toda función SQL nueva lleva `REVOKE EXECUTE ... FROM public, anon` salvo que deba ser pública a propósito (y entonces se documenta por qué). Las funciones `SECURITY DEFINER` llevan `SET search_path = public`.
6. **Nada importante en memoria ni en el navegador.** Hoy hay datos de negocio guardados en `localStorage`/`sessionStorage` (costos de finanzas, sesión del mozo, suplantación). No agregar más y migrar los existentes a la base.
7. **Explicar en español simple** cada cambio al fundador.
8. **Mantener al día, en el mismo cambio:**
   - `CLAUDE.md` si cambia una regla o la fase actual.
   - `docs/BUILD_LOG.md`: qué cambió y por qué (crear en el primer cambio de código).
   - `docs/DEMO_ACCESS.md`: cómo probar la demo, con URLs y usuarios de prueba (crear en la fase 2).
9. **Preguntar antes de:** cambiar una regla de la sección 4, agregar un servicio externo nuevo (pasarela, IA, hosting, correo), borrar datos, cambiar algo en producción o hacer cualquier cosa que no se pueda deshacer.

## Trampas conocidas de este código

- **No copiar las políticas RLS actuales como ejemplo.** Muchas son inseguras (`USING (true)`, `WITH CHECK (true)`). Ver `docs/DIAGNOSTICO.md`.
- `get_tenant_id()` devuelve *un* local al azar si el usuario pertenece a varios (`LIMIT 1` sin orden). No usarla en políticas nuevas sin resolver eso.
- `is_tenant_member()` no revisa `is_active`.
- `src/integrations/supabase/client.ts` y `types.ts` dicen "autogenerado": `types.ts` se regenera con la CLI y `client.ts` se puede editar después de la migración.
- La migración `20260309050435_...sql` borra pedidos. Es histórica: no volver a ejecutarla sobre una base con datos reales.
- Mientras el proyecto siga conectado a Lovable, Lovable puede hacer commits a `main`. Desde la fase 2 no se edita más en Lovable.
- Los estados de pedidos y mesas están en inglés (`confirmed`, `in_kitchen`, `waiting_bill`...) y **se quedan así en la base** (decisión del 1 de octubre de 2026). Lo que ve el usuario pasa siempre por la capa única `src/lib/estados.ts` (`textoPedido`, `textoMesa`, `textoPago`…; voz del personal o del cliente). Ninguna pantalla escribe su propio texto para un estado. No renombrar estados en la base.

## Estética (se mantiene en todo lo nuevo)

El fundador pidió explícitamente conservar el diseño actual. Toda pantalla nueva tiene que verse como parte de la misma app:

- **Componentes:** los de shadcn/ui que ya están en `src/components/ui/`. No agregar otra librería de componentes.
- **Colores:** siempre con los tokens de `src/index.css` (`bg-background`, `text-foreground`, `bg-primary`, `bg-accent`, `border`...), nunca colores escritos a mano. Naranjo Tablio `hsl(16 82% 51%)` como primario y fondo crema claro. Hay modo oscuro (`ThemeContext`), así que todo se revisa en los dos modos.
- **Color de cada local:** en las pantallas del comensal se usa el color del local (`--tenant-primary`, que sale de `tenants.primary_color`), no el naranjo de Tablio.
- **Tipografía:** Plus Jakarta Sans (cargada en `index.html`). Títulos en `font-bold` o `font-extrabold`.
- **Forma:** bordes redondeados (`--radius: 0.75rem`, tarjetas `rounded-2xl`), íconos de `lucide-react` y animaciones suaves con `framer-motion`, como en las pantallas actuales.
- **Marca:** el logo es texto: `tablio` con el punto final en naranjo (`tablio<span className="text-primary">.</span>`).
- **Celular primero** en las pantallas del comensal, del mozo y del vendedor. El KDS se diseña para pantalla fija y letra grande.
- **Textos** en español de Chile, cercanos y cortos.
- Antes de crear una pantalla, se mira una parecida que ya exista y se copia su estructura.

## Convenciones

- Montos en pesos chilenos, **enteros** (sin decimales). Formatear con `src/lib/format.ts`.
- Zona horaria del negocio: `America/Santiago`. Los cierres de caja y reportes por día usan esa zona, no UTC.
- Mensajes al usuario en español, sin `error.message` crudo: siempre `mensajeError(error, alternativo)` (`src/lib/errores.ts`). Una prueba (`src/lib/errores.test.ts`) recorre las pantallas y falla si alguna muestra un error crudo.
- Migraciones con nombre descriptivo: `supabase migration new cerrar_rls_pedidos`.
