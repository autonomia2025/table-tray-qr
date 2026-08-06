# Un QR por mesa + checkout con pago desde el menú actual

Se mantiene el menú que ya existe (categorías, buscador, detalle de plato, carrito). Lo que cambia es cómo se entra y cómo se cierra: el QR de la mesa lleva directo al menú con la mesa ya identificada, y el carrito se cierra pagando — sin escanear un segundo QR ni confirmar dos veces.

## 1. QR: uno por mesa, y nada más

Hoy la sección QR muestra dos cosas: un "QR Menú General" igual para todas las mesas y un "QR Tarjeta" por mesa que sirve para confirmar pedidos. Eso se elimina.

Queda una sola sección: **un QR por mesa**, que apunta a `/{slug}/menu?t={qr_token}`.

- Tabla de mesas con: número, nombre, zona, estado y acciones (ver, descargar PNG, imprimir).
- Vista de tarjeta lista para imprimir: nombre del local, "Mesa N", el QR, y la instrucción "Escanea, pide y paga desde tu teléfono".
- Imprimir todas en una hoja (grilla de tarjetas), y descargar todas como PNG individuales.
- Aviso claro si una mesa no tiene QR generado.

## 2. Entrada: escanear = estar en la mesa

Al abrir `/{slug}/menu?t=token`:

- Se resuelve la mesa por su token, se abre o se une a la sesión activa de esa mesa y queda guardado en el dispositivo (no hay que volver a escanear).
- Se muestra una marca discreta "Mesa 7" en el encabezado del menú.
- Sin código de presencia: escanear el QR basta para pedir.
- Si el token no es válido o la mesa no existe, se muestra un mensaje simple con opción de reintentar.

## 3. Checkout: pedir y pagar en un solo paso

Se elimina la pantalla de confirmación con cámara (`/{slug}/confirm`) y el escaneo del QR de tarjeta. El carrito lleva a un **checkout** único:

1. **Resumen** del pedido propio (solo lo que esta persona agregó).
2. **Upsell**: 2–3 sugerencias del mismo local (acompañamientos y bebidas del menú activo) que se agregan con un toque, sin salir del checkout.
3. **Lealtad**: campo de email opcional. Si el email ya existe en el local, se muestra el progreso ("3 de 5 visitas · te falta 2 para tu bebida gratis") y, si hay una recompensa disponible, se ofrece canjearla en este pago.
4. **Propina** sugerida (0/5/10/15%).
5. **Pago**: Apple Pay / Google Pay cuando el dispositivo lo soporta, tarjeta como alternativa (adaptador simulado actual).
6. **Confirmación**: el pedido se crea recién cuando el servidor confirma el pago aprobado. Pantalla de éxito con número de pedido, sellos ganados y botón "Pedir otra ronda" que vuelve al menú con la mesa ya cargada.

Si el pago falla o se cancela, el carrito queda intacto y se puede reintentar.

## 4. Solo lo pagado se produce

- El pedido nace pagado: no existe pedido "confirmado sin pagar" en el camino del comensal.
- El KDS sigue recibiendo únicamente pedidos con pago aprobado.
- En sucursales configuradas como "cuenta abierta" se mantiene el comportamiento actual (pedir ahora, pagar al final desde `/{slug}/pay`); el checkout con pago inmediato es el modo por defecto en prepago.

## Detalles técnicos

- `src/pages/admin/QRPage.tsx`: reescritura. Un QR por mesa con URL `${origin}/${slug}/menu?t=${qr_token}`; se quita el QR general y el bloque de "QR tarjeta para confirmar". Impresión en grilla con `@media print`.
- Entrada por token: hook compartido (`useTableSession`) que lee `?t=`, resuelve la mesa (`tables.qr_token`), abre/une la sesión activa (`table_sessions`) y guarda `tableToken`/`tenantId`/`branchId`/`tableNumber` en `cartStore`. Lo usan `MenuPage`, `CartPage` y el checkout.
- Nueva página `src/pages/CheckoutPage.tsx` en `/{slug}/checkout`, que reemplaza a `ConfirmPage`. `src/pages/ConfirmPage.tsx` se elimina junto con su ruta y la dependencia de escaneo en ese flujo; `CartPage` navega a `/checkout`.
- Creación de pedido + cobro en un solo paso servidor: se extiende `process-payment` para aceptar un carrito (items validados y re-precificados contra `menu_items` en el servidor), crear `orders` + `order_items` con `payment_status = 'paid'` y registrar el `payment`, todo bajo la clave de idempotencia existente. El cliente nunca fija el precio.
- Upsell: consulta a `menu_items` disponibles del menú activo, priorizando categorías de bebidas/acompañamientos y `total_orders`.
- Lealtad en checkout: `loyalty-status` para el progreso por email y el canje ya soportado por `process-payment` (`redeem_reward_id`).
- `PayPage` se mantiene para el modo cuenta abierta y para pagar saldo pendiente de la sesión.

## Orden de trabajo

1. Sección QR nueva (un QR por mesa, tarjetas imprimibles).
2. Entrada por token en el menú y sesión de mesa persistente.
3. Checkout con upsell, lealtad, propina y pago; eliminación del flujo de doble confirmación.
4. Creación de pedido pagado en el servidor y ajuste del KDS/tracking.
