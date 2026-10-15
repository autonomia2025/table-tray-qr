---
name: cerrar-fase
description: Cierra una fase o etapa de Tablio de punta a punta (pruebas, publicación, recorrido con fotos, reporte, bitácora, aviso al fundador) y sigue con la siguiente. Usar SIEMPRE al terminar una etapa del plan maestro, sin que el fundador lo pida.
---

# Cerrar una fase de Tablio

El fundador pidió (15 de octubre de 2026) que cada fase termine siempre igual, sin que él tenga que acordarse
de pedirlo: el reporte con fotos le llega solo y después se sigue con la siguiente etapa.

Argumento opcional: el número de la etapa (por ejemplo `4.3`). Si no viene, sale de `docs/MASTER_PLAN.md`.

## 1. Comprobar que de verdad está terminada

Nada de esto se salta. Si algo falla: dos intentos y parar (regla de calidad 4), y se le explica al fundador.

1. `bun run typecheck`, `bun run build`, `bun run lint:tope`, `bun run test`.
2. `bun run test:local` (base desechable: migraciones desde cero, seguridad y navegador).
3. Si se tocó la base: `supabase db push`, publicar las funciones cambiadas y regenerar `types.ts`.
4. `bun run test:seguridad` y `bun run test:e2e` contra la base real y contra la app publicada.
5. Las compuertas siguen vacías: `auditoria_seguridad`, `auditoria_plata`, `auditoria_operacion`.
6. Commit en español (un cambio lógico por commit), push a `main` y revisar que la integración continua quede
   en verde (API pública de GitHub, con moderación: ver la memoria `github-ci-sin-gh`).

## 2. Documentos al día (en el mismo cambio)

- `docs/MASTER_PLAN.md`: la etapa queda ✅.
- `CLAUDE.md`: la línea **Fase actual** y cualquier regla nueva.
- `docs/BUILD_LOG.md`: qué cambió y por qué.
- `docs/DEMO_ACCESS.md`: si cambia cómo se prueba el demo.

## 3. Recorrido con fotos

- Un recorrido de Playwright en `e2e/recorridos/<etapa>.spec.ts` (o dentro de la prueba de la etapa) con
  `RECORRIDO=e2e/recorridos/fase-<etapa>` para que `foto()` guarde las imágenes.
- Celular para comensal, mozo y vendedor; pantalla grande para dueño y cocina. Modo claro y, si la pantalla es
  nueva, también oscuro.
- Las carpetas de fotos **no se suben a git** (están en `.gitignore`).

## 4. Reporte para el fundador (página publicada)

Página con la herramienta Artifact, en español simple y sin jerga:

- **Qué cambió**, contado desde lo que ve el dueño, el mozo o el comensal.
- **Fotos** del recorrido, con una línea que explica cada una.
- **Cómo se probó**, en una frase y con números (pruebas pasadas, ataques que fallaron como debían).
- **Qué queda pendiente** y qué necesita de él (si es que algo).
- Título `Tablio · Fase <etapa>`.

## 5. Bitácora de fases

La bitácora junta todos los reportes en una sola página: https://claude.ai/artifact/LKBZxWS4xLC4Z8DDuNUiRV
Su fuente es `docs/bitacora-fases.html`.

- Agregar la etapa arriba de todo, con fecha, una línea de resumen y el enlace al reporte.
- Actualizar el bloque "Ahora" (en qué se está trabajando) y "Lo que necesito de ti".
- Publicar con la misma URL: en una sesión nueva, primero `action: "read"` con esa URL y después publicar con
  `url`.

## 6. Avisarle

1. Mensaje final en el chat: 4 a 6 líneas, con los enlaces al reporte y a la bitácora.
2. `SendUserFile` con 2 o 3 fotos clave (si la herramienta está disponible).
3. `PushNotification` (status `proactive`) con una línea:
   `Tablio: terminó la fase <etapa> (<qué>). Reporte listo. Sigo con <siguiente>.`

## 7. Seguir con la siguiente etapa

Seguir sin esperar respuesta, **salvo** que la siguiente etapa necesite algo del fundador:

- un servicio externo nuevo, una cuenta o una clave (pasarela, proveedor de boletas, Resend, dominio...);
- cambiar una regla de la sección 4 del brief, borrar datos o algo que no se puede deshacer;
- una decisión de producto que él marcó como suya, o que él dijo "aún no sigas".

En esos casos se salta a la siguiente etapa que **no** esté bloqueada. Si todas lo están, se detiene y le
pregunta con una recomendación clara (no una lista de opciones). Lo bloqueado se anota en "Lo que necesito de
ti" de la bitácora.
