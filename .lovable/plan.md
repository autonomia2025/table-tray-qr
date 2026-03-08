

## Plan: Sistema de Doble QR (Mesa + Tarjeta)

### Situación actual

- **QRPage** genera un solo QR por mesa (el `qr_token`) que se usa como tarjeta
- **ConfirmPage** ya escanea el QR tarjeta para confirmar pedidos ✓
- **BillPage** ya escanea el QR tarjeta para pedir la cuenta ✓
- **TrackingPage** permite llamar al mozo SIN escanear (solo un modal con razones) ✗

### Cambios necesarios

**1. QRPage — Generar ambos QRs desde el admin**

Dividir la página en dos secciones/tabs:
- **QR Mesa** (pegado en la mesa): genera un QR con la URL `{origin}/{slug}` → solo abre el menú. Se genera automáticamente (no necesita token, es simplemente la URL del restaurante). Diseño visual con texto "Escanea para ver el menú".
- **QR Tarjeta** (la tarjeta que entrega el mozo): genera el QR con el `qr_token` existente. Diseño tipo tarjeta con texto "Escanea para confirmar tu pedido".

Ambos se pueden descargar/imprimir individualmente o en lote (grilla 3x3).

**2. TrackingPage — Llamar al mozo requiere escanear tarjeta QR**

Actualmente el botón "Llamar al mozo" abre un modal de razones y envía directo. Cambiar el flujo:
1. Usuario toca "Llamar al mozo" → se muestra modal con razones
2. Al seleccionar razón → se abre el escáner de cámara (reutilizando el mismo patrón de ConfirmPage/BillPage)
3. Al escanear el QR de la tarjeta → se valida el token y se envía la llamada al mozo
4. Esto previene llamadas falsas/accidentales

**3. Sin cambios de base de datos**

El `qr_token` ya existe en la tabla `tables`. El QR de mesa es simplemente una URL construida client-side, no necesita campo nuevo.

### Archivos a modificar

| Archivo | Cambio |
|---|---|
| `src/pages/admin/QRPage.tsx` | Agregar tabs "QR Mesa" / "QR Tarjeta", generar QR de URL para mesa |
| `src/pages/TrackingPage.tsx` | Integrar escáner QR en flujo de llamar al mozo |

