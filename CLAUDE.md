# CLAUDE.md — Reglas de trabajo en Tablio

Este archivo lo lee Claude Code al empezar cada sesión. Resume cómo se trabaja en este repositorio.
Si algo de aquí contradice `docs/vision/TABLIO_BRIEF_v3.md`, **gana el brief**.

## Antes de empezar cualquier tarea

1. **`docs/vision/TABLIO_BRIEF_v3.md`**: qué es Tablio y a dónde vamos. Las secciones 4 (reglas que no se negocian) y 9 (calidad) mandan.
2. **`docs/PLAN_FASES.md`**: en qué fase estamos y qué paso toca.
3. **`docs/DIAGNOSTICO.md`**: problemas conocidos del código actual, con archivo y línea.
4. **`ESTADO_LOVABLE.md`**: la auditoría que hizo Lovable. Es útil, pero tiene errores corregidos en el diagnóstico.

**Fase actual:** fase 0 terminada; fase 1.1 (contención) y 1.2 (roles y login único) hechas. 1.3 (identidad del comensal: invitado o cliente) hecha. Siguiente: 1.4 (dominio pedidos). Se trabaja sobre `main`. Antes: 2 (migración), casi lista. La base nueva (`iznwvklzmyhzalabgfxl`) ya tiene estructura, datos, fotos, funciones y el local de demo, y `.env` apunta a ella. Falta: Vercel, Auth (URL del sitio), la clave de Claude, la revisión con el fundador y unir la rama `fase-2-migracion` con `main`. Credenciales del demo en `privado/` (fuera de git); cómo entrar en `docs/DEMO_ACCESS.md`.

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
bun run test:local       # TODO contra una base desechable: Supabase local (colima + `supabase start`), migraciones desde cero, demo nuevo
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
- **Un solo QR hace todo.** Al pagar, el comensal elige: **"Pagar ahora"** (destacado; va pagado directo a cocina), **"Pagar al mozo"** (efectivo o POS; el mozo cobra, lo registra y recién ahí va a cocina) o, solo en locales con cuenta abierta, **"Agregar a mi cuenta"** (paga su propia cuenta al final, en la app o con el mozo).
- **Nada con cámara.** "Llamar al mozo" y "pedir la cuenta" son botones, sin escanear.
- **El comensal paga sin registrarse (invitado) y puede guardar su cuenta** (correo con código o enlace, Google o Apple) para juntar sellos. Su identidad de invitado se convierte en su cuenta: no pierde nada. Los sellos solo se suman con cuenta verificada.
- **Auth se maneja desde `supabase/config.toml`.** Antes de empujar, revisar siempre la diferencia: `printf 'n\n' | supabase config push`.
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
- Los estados de pedidos y mesas están en inglés (`confirmed`, `in_kitchen`, `waiting_bill`...) y **se quedan así en la base** (decisión del 1 de octubre de 2026). Lo que ve el usuario pasa siempre por una sola capa de traducción (se crea en el paso 4.3). No renombrar estados en la base.

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
- Mensajes al usuario en español, sin `error.message` crudo de Supabase.
- Migraciones con nombre descriptivo: `supabase migration new cerrar_rls_pedidos`.
