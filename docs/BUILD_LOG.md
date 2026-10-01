# Bitácora de construcción — Tablio

Qué cambió, cuándo y por qué. Lo más reciente va arriba.

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
