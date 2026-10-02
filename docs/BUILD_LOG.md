# Bitácora de construcción — Tablio

Qué cambió, cuándo y por qué. Lo más reciente va arriba.

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
