# Plan de migración: de Lovable Cloud a un Supabase propio

Fase 2 del plan · Estado: **aprobada el 1 de octubre de 2026** · Paso 0 hecho · Esperando el proyecto Supabase y la exportación de Lovable

## La regla de esta fase

**Se migra tal cual, sin corregir nada.** La base nueva tiene que quedar idéntica a la de Lovable, incluidos sus problemas de seguridad. Así podemos comparar antes y después y saber que cualquier diferencia viene de la migración y no de un arreglo. Los arreglos empiezan en la fase 3, justo después.

Solo se cambian tres cosas, porque fuera de Lovable no funcionarían:
1. La dirección y la clave de la base que usa la app (`.env`).
2. El proveedor de IA del chat de soporte (`LOVABLE_API_KEY` deja de servir).
3. Las direcciones de las imágenes del menú, que hoy apuntan al almacenamiento de Lovable.

**Única excepción aprobada:** `create-platform-admin` y `create-jefe-ventas` **no se publican** en el proyecto nuevo. Ninguna pantalla las usa (así que no cambia la comparación antes y después) y permiten que cualquiera cree un superadministrador. Queda anotado en `docs/BUILD_LOG.md`. Se borran del repositorio en el paso 3.1.

## En simple: qué vamos a hacer

Hoy la app usa una base de datos que Lovable administra por nosotros. Vamos a crear una base **nuestra** en Supabase (la misma tecnología que usa Lovable por dentro), copiarle la estructura, los datos, los usuarios y las funciones, y cambiar la app para que use la nueva. La base vieja queda intacta unas semanas como respaldo.

**Buena noticia:** casi no hay datos (1 local, 2 mesas, 2 pedidos, unos 7 usuarios). Lo pesado es la estructura, y esa ya está completa en el repositorio.

---

## 1. Qué se migra

| Pieza | Qué es, en simple | De dónde sale | Cómo se migra |
|---|---|---|---|
| **Esquema** (34 tablas) | La estructura: tablas, columnas, relaciones | `supabase/migrations/` (22 archivos) | Se aplican las migraciones en orden con la CLI de Supabase |
| **Políticas RLS** (120 + 4 de Storage) | Las reglas de quién puede ver o tocar qué | Las mismas migraciones | Se crean solas al aplicar las migraciones. Se comparan con el Anexo A de `ESTADO_LOVABLE.md` |
| **Funciones SQL** (6) | `get_tenant_id`, `is_tenant_member`, `is_platform_admin`, `has_backoffice_role`, `has_staff_role`, `update_updated_at_column` | Migraciones | Igual que lo anterior |
| **Triggers** (6) | Actualizan la fecha de modificación | Migraciones | Igual que lo anterior |
| **Realtime** (6 tablas) | Actualizaciones en vivo en cocina, mozo y comensal | Migración `20260307214709_...sql` | Se crea solo. Se verifica la publicación `supabase_realtime` |
| **Storage** (bucket `menu-images`) | Las fotos del menú | Bucket público en Lovable | El bucket lo crea la migración. Los archivos se descargan desde sus direcciones públicas y se suben con la misma ruta |
| **Datos** | Filas de las 34 tablas | Base de Lovable | Exportación pedida a Lovable (ver paso 1). Se cargan conservando los mismos identificadores |
| **Usuarios** (Auth) | Las cuentas que inician sesión | `auth.users` de Lovable | Se recrean con el **mismo identificador**, para que sigan calzando con `tenant_members`, `staff_users`, etc. (ver paso 4) |
| **Edge functions** (9 de 11 + `_shared`) | La lógica de servidor: pagos, reembolsos, altas | `supabase/functions/` | `supabase functions deploy`, con la misma configuración de verificación. **No se publican** `create-platform-admin` ni `create-jefe-ventas` (excepción aprobada) |
| **Secretos** | Claves que usan las funciones | Lovable Cloud | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` y `SUPABASE_DB_URL` los pone Supabase automáticamente. `LOVABLE_API_KEY` se reemplaza (sección 4) |
| **Configuración de Auth** | Correos, direcciones de retorno, registro abierto o cerrado | Lovable Cloud | Se copia a mano en el panel de Supabase |
| **Frontend** | La app que ve la gente | Hoy la publica Lovable | Se publica en **Vercel** |

---

## 2. Orden de trabajo

Cada paso termina con una comprobación. Si algo falla dos veces, me detengo y te explico.

### Paso 0 — Congelar y respaldar (30 min) ✅ hecho el 1 de octubre de 2026
1. **Desde aquí, nadie edita en Lovable.** Lovable hace commits a este repositorio y podría pisar el trabajo.
2. ✅ Etiqueta `pre-migracion` en el commit `3226116` (solo local por ahora).
3. ✅ Dependencias instaladas con `bun install --frozen-lockfile` (el `package-lock.json` de npm está desactualizado; el de bun es el bueno). `npm run build` compila. Resultado en `docs/BUILD_LOG.md`.

### Paso 1 — Exportar desde Lovable (lo haces tú, con un mensaje que te dejo listo)
Lovable no nos da acceso directo a su base, pero su asistente sí puede leerla, como hizo en la auditoría. Le pides lo del **Anexo 1** de este documento y me pasas los archivos que entregue:
- datos de las 34 tablas en formato SQL;
- usuarios (`auth.users`): identificador, email y, si lo permite, el hash de la contraseña;
- el esquema real de la base, para comparar con el repositorio;
- la lista de archivos del bucket `menu-images`;
- la configuración de Auth y de cada edge function.

### Paso 2 — Crear el proyecto Supabase (15 min)
- Región: **São Paulo (`sa-east-1`)**, la más cercana a Chile.
- Plan: **Free** mientras migramos y probamos. **Pro** (unos US$25 al mes) antes del primer local real, para tener respaldos diarios y que el proyecto no se pause por inactividad.
- **Decidido:** lo creas tú con el correo de la empresa, organización "Tablio", plan gratis, y me das acceso por el conector de Supabase.
- ✅ **Hecho:** proyecto "Tablio", identificador `iznwvklzmyhzalabgfxl`, São Paulo, Postgres 17, vacío.

### Paso 3 — Estructura (1 h)
1. Enlazo la CLI de Supabase al proyecto nuevo y aplico las 22 migraciones en orden (`supabase db push`).
   - Dos migraciones tocan datos (`20260309050435` borra pedidos y `20260319151617` copia personal). Sobre una base vacía no hacen nada: está bien.
2. **Comprobaciones:**
   - genero los tipos desde la base nueva y los comparo con `src/integrations/supabase/types.ts`: tienen que ser idénticos;
   - comparo las políticas de la base nueva (`pg_policies`) con el Anexo A: 120 iguales, más las 4 de Storage;
   - comparo con el esquema real que entregue Lovable (paso 1). Si Lovable tiene algo que no está en las migraciones, lo agrego como migración nueva y lo anoto.

### Paso 4 — Usuarios (1 h)
**Actualización:** el respaldo oficial trae las contraseñas cifradas, así que se usa el **camino A**.

Hay dos caminos, según lo que Lovable entregue:
- **A (ideal):** si entrega los hashes de contraseña, inserto los usuarios con su mismo identificador y su misma contraseña. Nadie nota nada.
- **B:** si no los entrega, creo cada usuario con su **mismo identificador** y email, y cada persona define una contraseña nueva con "¿Olvidaste tu contraseña?". Como son usuarios de prueba, esto es simple.

**Comprobación:** cada usuario de `tenant_members`, `staff_users`, `platform_admins` y `backoffice_members` tiene su cuenta.

### Paso 5 — Datos (1 h)
1. Cargo los datos respetando el orden de las relaciones: planes → locales → restaurantes → sucursales → menús → categorías → productos → modificadores → mesas → personal → sesiones → pedidos → pagos → lealtad → backoffice.
2. Los identificadores se conservan tal cual. Los `qr_token` de las mesas también, así que los QR siguen siendo válidos.
3. **Comprobación:** cuento filas por tabla y comparo con lo exportado (la auditoría dice: 1 local, 1 sucursal, 2 mesas, 2 pedidos, 0 pagos, 3 miembros, 3 personal, 1 lead, 1 miembro de backoffice).

### Paso 6 — Fotos del menú (30 min)
1. El bucket es público, así que descargo cada foto desde la dirección que ya está guardada en `menu_items.image_url` y la subo al bucket nuevo con la misma ruta (`<tenant_id>/...`).
2. Reemplazo en `menu_items.image_url` (y en `tenants.logo_url` y `cover_image_url` si apuntan a Lovable) el dominio viejo por el nuevo. Es el único cambio de datos, y es obligatorio: si no, las fotos se caen cuando se apague Lovable.

### Paso 7 — Edge functions y secretos (1 h)
1. Publico **9 de las 11** funciones **sin cambiar su código**, salvo `support-chat` (sección 4). `create-platform-admin` y `create-jefe-ventas` no se publican (excepción aprobada).
2. Lovable confirmó que todas usan `verify_jwt = false`. Lo declaro en `supabase/config.toml` para cada función, porque el valor por defecto de Supabase es el contrario. Es lo necesario para que funcionen igual que hoy.
3. El único secreto propio, `ANTHROPIC_API_KEY`, lo cargas tú en el panel de Supabase.
4. **Comprobación:** llamo a cada función desde la app (sección 5).

### Paso 8 — Configuración de Auth (20 min)
- URL del sitio y direcciones de retorno (`/reset-password`), con el dominio del hosting nuevo.
- Plantillas de correo y registro abierto o cerrado: igual que en Lovable.
- Correo: al principio sirve el correo incluido de Supabase (manda pocos correos por hora). Para producción hará falta un proveedor de correo, pero eso se decide en una fase posterior.

### Paso 9 — Apuntar la app a la base nueva y publicarla (1 h)
1. Cambio `.env` con la dirección y la clave pública del proyecto nuevo. El archivo `src/integrations/supabase/client.ts` no cambia.
2. Los plugins de Lovable en `vite.config.ts` se quedan por ahora (solo actúan en desarrollo o dentro de Lovable). Se sacan en la fase 4.
3. Publico la app en **Vercel**. Al principio con la dirección gratuita que entrega Vercel (`algo.vercel.app`).
4. **Importante sobre los QR:** el QR se arma con el dominio desde el que se abre el panel (`QRPage.tsx:32`). Si cambia el dominio, **los QR impresos con el dominio anterior dejan de funcionar.** Hoy no hay QR reales impresos. La decisión del dominio definitivo y su plazo están en `docs/PLAN_FASES.md` (hito "Dominio definitivo").

### Paso 10 — Comprobación completa (2 a 3 h, contigo)
La lista de la sección 5, pantalla por pantalla.

### Paso 11 — Cierre
1. Desconectar la sincronización de Lovable con GitHub, para que no vuelva a escribir en el repositorio.
2. Dejar el proyecto de Lovable **intacto 30 días** como respaldo. No borrar nada.
3. Crear `docs/DEMO_ACCESS.md` (cómo entrar a la demo) y completar `docs/BUILD_LOG.md` (qué se hizo).
4. Actualizar `CLAUDE.md` con la fase nueva.

**Si algo sale mal:** volver atrás es cambiar `.env` a los valores de Lovable. La base vieja sigue intacta.

**Duración estimada:** 1 a 2 días de trabajo, más el tiempo de respuesta de Lovable con la exportación.

---

## 3. Qué necesito de ti

**Decidido el 1 de octubre de 2026:**
- **Supabase:** cuenta con el correo de la empresa, organización "Tablio", proyecto en São Paulo, plan gratis. Lo creas tú y me das acceso por el conector.
- **Hosting:** Vercel.
- **Chat de soporte:** Claude Haiku 4.5. Tú creas la clave con tope de gasto mensual y la cargas como secreto en Supabase.
- **Usuarios:** si Lovable no entrega las contraseñas cifradas, se restablecen (camino B).
- **Exportación:** ya pedida a Lovable.

Pendiente: el dominio definitivo (ver `docs/PLAN_FASES.md`).

| # | Qué | Para qué | Cómo |
|---|---|---|---|
| 1 | **Cuenta de Supabase** con el email de la empresa | Ser dueños de la base | Registrarse en supabase.com y crear una organización "Tablio" |
| 2 | **Acceso para mí** | Crear el proyecto, aplicar migraciones y publicar funciones | Una de dos: **(a)** autorizar el conector de Supabase en Claude (lo más simple), o **(b)** crear un *Access Token* en supabase.com → Account → Access Tokens y dejarlo en una variable de entorno local, **no en el chat** |
| 3 | **Contraseña de la base** | Que la CLI aplique migraciones | Se define al crear el proyecto. Guárdala en tu gestor de contraseñas |
| 4 | **La exportación de Lovable** | Datos, usuarios y esquema real | Pegarle a Lovable el mensaje del Anexo 1 y pasarme lo que entregue |
| 5 | **Aprobar el proveedor de IA** del chat de soporte y crear su clave | Reemplazar `LOVABLE_API_KEY` | Ver sección 4. Es un servicio externo nuevo, así que necesita tu aprobación |
| 6 | **Elegir dónde se publica la app** (hosting) | Hoy la publica Lovable | Recomiendo **Vercel**: gratis para empezar, se conecta a GitHub y publica cada cambio solo. Alternativas: Netlify o Cloudflare Pages. También es un servicio externo nuevo |
| 7 | **Dominio** (por ejemplo `tablio.cl`) y acceso a su DNS | Dirección definitiva de la app y de los QR | Puede esperar, pero tiene que estar antes de imprimir QR reales |
| 8 | **Lista de usuarios de prueba** y su rol | Confirmar que todos quedaron bien | Te la armo desde la exportación y tú la confirmas |
| 9 | **Visto bueno** para que las contraseñas se restablezcan si Lovable no entrega los hashes | Camino B del paso 4 | Un "sí" alcanza |

**Nunca me pegues en el chat** la clave `service_role`, la contraseña de la base ni tokens de acceso. Se guardan en variables de entorno o en el panel de Supabase.

---

## 4. Cómo reemplazamos `LOVABLE_API_KEY` en el chat de soporte

**Hoy:** `support-chat` llama a la IA de Lovable (modelo Gemini) y le devuelve a la pantalla las respuestas en formato "OpenAI", palabra por palabra (`SoportePage.tsx:41-46`).

**Recomendación: usar Claude (Anthropic) con el modelo Claude Haiku 4.5** (`claude-haiku-4-5-20251001`). Es rápido, barato y de sobra bueno para soporte en español.

- Anthropic ofrece una **entrada compatible con el formato OpenAI**. Con eso el cambio en `supabase/functions/support-chat/index.ts` es mínimo: la dirección, la clave (`ANTHROPIC_API_KEY` en vez de `LOVABLE_API_KEY`) y el nombre del modelo.
- **La pantalla no se toca** y las instrucciones del asistente (el texto de soporte) quedan iguales.
- Antes de darlo por listo, pruebo que las respuestas lleguen palabra por palabra igual que hoy. Si la entrada compatible da problemas, la alternativa es traducir el formato dentro de la función, sin tocar la pantalla.
- Costo: se paga por uso. Con el volumen de un chat de soporte es bajo.
- Lo que necesitas: crear una cuenta en console.anthropic.com, cargar saldo y generar una clave. La clave la cargas tú como secreto en Supabase (o me das acceso y la cargo yo sin verla en el chat).

**Alternativa de cambio mínimo:** seguir con Gemini usando una clave propia de Google AI Studio, que también tiene entrada compatible con OpenAI.

**Qué no se arregla todavía:** el chat no verifica quién lo usa, así que cualquiera puede gastar la clave. Se corrige en la fase 3. Mientras tanto, conviene ponerle un **tope de gasto mensual** a la clave nueva desde el panel del proveedor.

---

## 5. Cómo comprobamos que todo funciona igual

Cada prueba se hace **dos veces**: en la app de Lovable (antes) y en la app nueva (después). El resultado tiene que ser el mismo. Si algo cambia, la migración no está terminada.

### 5.1 Comprobaciones automáticas (las hago yo)
- [ ] `npm run build` pasa.
- [ ] Los tipos generados desde la base nueva son idénticos a `types.ts`.
- [ ] Las políticas de la base nueva son idénticas al Anexo A (120) más las 4 de Storage.
- [ ] El conteo de filas por tabla coincide con la exportación.
- [ ] Las 6 tablas están en la publicación de tiempo real.
- [ ] Las 9 funciones publicadas responden. `create-platform-admin` y `create-jefe-ventas` **no existen** en el proyecto nuevo.
- [ ] Todas las fotos del menú cargan (ninguna dirección apunta a Lovable).

### 5.2 Comensal (en el celular, escaneando el QR de una mesa)
| # | Pantalla | Qué hacer | Qué debe pasar |
|---|---|---|---|
| C1 | `/:slug` | Abrir la portada del local | Colores, logo y portada del local |
| C2 | `/:slug/menu?t=…` | Escanear el QR de la mesa | Carta por categorías con fotos. Un QR inválido muestra el aviso |
| C3 | `/:slug/item/:id` | Abrir un plato con modificadores | Modificadores, alérgenos y precio que cambia al elegir |
| C4 | `/:slug/cart` | Agregar 2 platos y cambiar cantidades | Total correcto |
| C5 | `/:slug/checkout` | Elegir propina, poner email de lealtad y pagar con tarjeta | "¡Pago listo!" con número de pedido |
| C6 | `/:slug/checkout` | Pagar con Apple Pay o Google Pay (si el equipo lo permite) | Igual que C5 |
| C7 | `/:slug/tracking` | Mirar el pedido mientras cocina lo avanza | El estado cambia **solo**, sin recargar |
| C8 | `/:slug/tracking` | Llamar al mozo y luego cancelar | Le llega al mozo y desaparece al cancelar |
| C9 | `/:slug/bill` | Ver la cuenta de la mesa y pedirla | Cuenta correcta. El mozo recibe el aviso con sonido |
| C10 | `/:slug/pay` | Pagar un pedido manual pendiente (cuenta abierta) | Queda pagado |
| C11 | Lealtad | Volver a pagar con el mismo email | Suma un sello o puntos |

### 5.3 Mozo
| # | Pantalla | Qué hacer | Qué debe pasar |
|---|---|---|---|
| M1 | `/mozo/join/:token` | Registrarse con una invitación nueva | Cuenta creada y entra al panel |
| M2 | `/login` y `/mozo/login` | Entrar con email y contraseña | Llega a `/mozo/mesas` |
| M3 | `/mozo/mesas` | Ver el tablero, tomar una mesa y transferirla | Orden por urgencia. La mesa cambia de mozo |
| M4 | `/mozo/notificaciones` | Recibir un llamado y una cuenta pedida | Llegan en vivo, con sonido |
| M5 | `/mozo/pedido-manual/:mesa` | Crear un pedido manual | Aparece en cocina y en la mesa |
| M6 | `/mozo/mesas` | Cerrar la mesa (confirmación en 2 pasos) | Mesa libre, sesión cerrada |
| M7 | `/mozo/perfil` | Cerrar sesión | Vuelve al login |

### 5.4 Cocina (KDS)
| # | Qué hacer | Qué debe pasar |
|---|---|---|
| K1 | Abrir `/kds?branch=…` con sesión del local | 3 columnas, botón de sonido |
| K2 | Pagar un pedido como comensal | Aparece solo, con sonido y temporizador |
| K3 | Avanzar el pedido: nuevo → en cocina → listo | Cambia de columna. El comensal lo ve en C7 |
| K4 | Marcar un producto agotado | Desaparece o queda "agotado" en la carta del comensal |
| K5 | Sucursal en prepago | Los pedidos no pagados no se ven, solo el contador |

### 5.5 Dueño (`/admin/:slug/…`)
| # | Pantalla | Qué hacer | Qué debe pasar |
|---|---|---|---|
| D1 | Login | Entrar como dueño | Llega a `mesas` |
| D2 | `mesas` | Ver el semáforo y crear una mesa | Mesa nueva con QR |
| D3 | `pedidos` | Avanzar y cancelar un pedido con motivo | Cambia el estado |
| D4 | `menu` | Crear una categoría y un plato con foto, y editar un precio | Se guarda, la foto sube, la carta se actualiza |
| D5 | `equipo` | Crear una invitación y activar o desactivar un mozo | Link de invitación válido |
| D6 | `qr` | Ver, descargar e imprimir los QR | El QR abre la carta de esa mesa en el **dominio nuevo** |
| D7 | `sucursal` | Cambiar entre prepago y cuenta abierta | Se guarda. El KDS se comporta según el modo |
| D8 | `caja` | Ver pagos, conciliar el día y reembolsar un pago | Conciliación generada. Reembolso registrado con motivo |
| D9 | `lealtad` | Activar el programa y cambiar el premio | Se guarda. El comensal lo ve en el checkout |
| D10 | `reportes` | Revisar cada pestaña y exportar un CSV | Números coherentes. El CSV abre en Excel |
| D11 | `soporte` | Preguntar algo al chat y crear un ticket | El chat responde **en vivo** con el proveedor nuevo. Ticket creado |
| D12 | Olvidé mi contraseña | Pedir el correo y restablecer | Llega el correo y el link lleva al dominio nuevo |

### 5.6 Backoffice Tablio
| # | Panel | Qué hacer | Qué debe pasar |
|---|---|---|---|
| B1 | Superadmin `/superadmin/tenants` | Ver los locales, crear uno de prueba y entrar como soporte | Local creado con dueño. La suplantación abre su panel |
| B2 | Superadmin `equipo`, `metricas`, `flags`, `config` | Recorrer y cambiar un flag | Se guarda |
| B3 | Vendedor `/vendedor/*` | Registrar una visita y mover un lead en el pipeline | Se guarda |
| B4 | Jefe de ventas `/jefe-ventas/*` | Ver el equipo, crear una invitación y revisar comisiones | Se guarda |
| B5 | `/backoffice/join/:token` | Registrarse como vendedor | Cuenta creada |
| B6 | Finanzas `/finanzas/*` | Recorrer revenue, clientes, churn y costos | Mismos números que antes |

### 5.7 Lo que *también* tiene que seguir igual (aunque esté mal)
Como migramos sin arreglar, los problemas del diagnóstico deben seguir ahí. Esto confirma que no cambiamos nada sin querer. Lo compruebo yo con consultas controladas, sin dañar datos:
- la lectura pública de pedidos sigue funcionando sin sesión;
- las 120 políticas son las mismas.

Se arreglan en la fase 3.

---

## Anexo 1 — Mensaje para pedirle la exportación a Lovable

Copia y pega esto en el chat de Lovable del proyecto:

> Necesito exportar todo lo de Lovable Cloud para moverlo a otro proyecto de Supabase. **No modifiques nada: solo lectura.** Entrégame estos archivos descargables:
>
> 1. `datos.sql`: `INSERT` de **todas las filas** de las 34 tablas del esquema `public`, ordenados para respetar las llaves foráneas, conservando los `id` originales.
> 2. `usuarios.sql`: de `auth.users`, las columnas `id`, `email`, `encrypted_password`, `email_confirmed_at`, `created_at`, `raw_app_meta_data` y `raw_user_meta_data`. Si no puedes incluir `encrypted_password`, entrégalo sin esa columna y avísame.
> 3. `esquema_real.sql`: el esquema completo de `public` tal como está en la base (tablas, columnas, índices, funciones, triggers, políticas, `GRANT`), como lo entregaría `pg_dump --schema-only`.
> 4. `storage.txt`: la lista de objetos del bucket `menu-images` con su ruta.
> 5. `config.txt`: la configuración de Auth (URL del sitio, URLs de redirección, si el registro público está abierto, proveedores activos, plantillas de correo personalizadas) y el valor de `verify_jwt` de cada edge function.
> 6. Confirma en una línea si hay algún secreto configurado además de `LOVABLE_API_KEY`.
