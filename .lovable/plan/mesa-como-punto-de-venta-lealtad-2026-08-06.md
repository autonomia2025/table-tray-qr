# Mesa como punto de venta + Lealtad

Convertir cada mesa en un punto de venta: el comensal escanea el QR de esa mesa, se abre (o se une a) la sesión de esa mesa, pide y paga desde su celular. Solo lo pagado llega a cocina (KDS) y a los ingresos del local. Además, un programa de lealtad por email pensado para bares y cafeterías.

El panel del dueño actual se mantiene tal cual; solo se le agregan secciones nuevas.

## 1. Un QR por mesa = una sesión de pago

```text
QR mesa 7 -> sesión activa de mesa 7
   -> varios comensales pueden unirse al mismo QR
   -> cada uno pide y paga lo suyo (o alguien paga todo)
   -> la sesión se cierra cuando todo está pagado
```

- El QR de la mesa es fijo; lo que cambia es la sesión activa asociada. Al escanear, la app resuelve la sesión abierta de esa mesa o crea una nueva.
- Cada pago queda ligado a la sesión y a la mesa, para que el dueño vea exactamente qué se pagó en cada mesa y cuándo.
- Soporte para pagos parciales: la sesión muestra pagado vs pendiente en tiempo real, para el comensal y para el mozo.

## 2. Pago desde el celular

Pantalla de pago con resumen, propina sugerida (0/5/10/15%), campo de email (opcional, para lealtad) y comprobante en pantalla al finalizar.

Métodos:
- **Apple Pay** y **Google Pay** como opción principal (botón nativo del navegador, sin escribir tarjeta).
- Tarjeta como alternativa.

Por ahora el cobro es **simulado**: los botones de wallet usan la API de pagos del navegador en modo de prueba y la aprobación se resuelve en el backend con un adaptador simulado. Todo el resto del sistema — registro de pago, bloqueo de cocina, ingresos, conciliación, reembolsos, lealtad — funciona como en producción, así que al conectar el proveedor real (Mercado Pago, Transbank o Stripe) solo se reemplaza el adaptador de cobro. Apple Pay y Google Pay reales requieren además validar el dominio con el proveedor; queda listo para ese paso.

## 3. Dos modos de cobro, elegibles por local

En la configuración de la sucursal el dueño elige:

- **Prepago obligatorio**: cada pedido se paga al confirmarlo. Sin pago aprobado no entra a cocina.
- **Cuenta abierta**: se pide libremente y se paga todo al final desde la app (o con el mozo, como hoy).

El KDS y el panel de mozo respetan el modo: en prepago los pedidos no pagados quedan en "esperando pago" y no ocupan la cocina.

## 4. Ingresos, conciliación y reembolsos

Nueva sección **Caja** en el panel del dueño, con tres partes:

- **Ingresos**: ventas pagadas del día, por método (Apple Pay, Google Pay, tarjeta, efectivo), propinas, ticket promedio, detalle por mesa, sesión y pedido. Solo pagos aprobados; lo no pagado o rechazado queda fuera de los reportes.
- **Conciliación**: cierre de caja por día y por turno, comparando lo registrado en la app contra lo liquidado por el proveedor. Cada pago guarda su referencia externa y su estado, y se marcan las diferencias (pago aprobado sin liquidar, monto distinto, duplicado) para revisarlas. Exportable a CSV.
- **Reembolsos**: reembolso total o parcial de un pago desde el detalle de la sesión, con motivo obligatorio, quién lo autorizó y registro en el historial. El reembolso descuenta de los ingresos del día y revierte los puntos de lealtad asociados. Solo dueño/admin puede reembolsar; el mozo puede solicitarlo.

Cada local ve solo sus propios ingresos (aislamiento por tenant y sucursal, como el resto del sistema).

## 5. Lealtad por email

Identificación sin contraseña: el comensal escribe su email al pagar y queda reconocido en ese local. La próxima vez que escanee un QR del mismo local, se le recuerda y ve su progreso.

Dos programas; cada local elige uno o ninguno:

- **Sellos por visita**: 1 sello por visita pagada; al llegar a N visitas (ej. 5) se desbloquea la recompensa que define el local (ej. bebida gratis).
- **Puntos por gasto**: X puntos por cada $1.000 gastados, canjeables por descuento o producto.

En la app del comensal: barra de progreso ("3 de 5 visitas · te faltan 2 para tu café gratis") y recompensa aplicable en el siguiente pago.

En el panel del dueño, sección **Lealtad**: activar/desactivar, tipo, meta y recompensa; lista de clientes con email, visitas, gasto total, última visita y canjes; exportable a CSV.

## 6. Privacidad

Los emails quedan aislados por local: un restaurante nunca ve los clientes de otro. Se guarda un consentimiento simple al ingresar el email.

## Detalles técnicos

- Nuevas tablas: `payments` (sesión, pedido, monto, propina, método, wallet, estado, referencia externa, payload del proveedor), `refunds` (pago, monto, motivo, autorizado por), `payment_settlements` (conciliación: lote del proveedor, monto liquidado, diferencias), `loyalty_programs`, `loyalty_customers`, `loyalty_rewards`. Todas con RLS por `tenant_id` y GRANTs explícitos.
- Nuevos campos: `branches.payment_mode` (`prepaid` | `open_tab`), `orders.payment_status` (`unpaid` | `paid` | `refunded` | `failed`), `table_sessions.paid_amount`.
- El KDS filtra por `payment_status = 'paid'` cuando la sucursal está en prepago.
- Edge functions: `process-payment`, `refund-payment`, `reconcile-payments`, con un adaptador de proveedor aislado (hoy simulado) para cambiar de pasarela sin tocar el resto.
- Apple Pay / Google Pay se integran vía Payment Request API en el cliente; la autorización y captura siempre se resuelven en el servidor.
- Idempotencia por sesión + intento para evitar cobros duplicados si el celular pierde señal.
- La acumulación y reversión de lealtad ocurre en el servidor al confirmar pago o reembolso.

## Orden de trabajo

1. Base de datos: pagos, reembolsos, conciliación, lealtad y políticas de acceso.
2. Sesión de mesa por QR con pagado/pendiente en tiempo real.
3. Pantalla de pago con Apple Pay, Google Pay y tarjeta (adaptador simulado).
4. Bloqueo de cocina e ingresos según pago, y modo de cobro por sucursal.
5. Caja: ingresos, conciliación y reembolsos.
6. Programa de lealtad: progreso del comensal y panel del dueño.
