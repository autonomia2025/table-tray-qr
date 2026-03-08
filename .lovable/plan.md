

## Plan: Agregar vibración al recibir notificaciones del mozo

### Cambio

En `src/pages/mozo/MozoNotificacionesPage.tsx`, agregar `navigator.vibrate(200)` junto al `playSound()` en los handlers de INSERT de realtime.

### Archivo a modificar

| Archivo | Cambio |
|---|---|
| `src/pages/mozo/MozoNotificacionesPage.tsx` | Agregar llamada a `navigator.vibrate()` en los callbacks de INSERT |

