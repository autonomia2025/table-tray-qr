# Mesa como punto de venta + Lealtad

Convertir cada mesa en un punto de venta: el comensal escanea el QR, pide y paga desde su celular. Solo los pedidos pagados llegan a la cocina (KDS) y a los ingresos del local. Además, un programa de lealtad por email pensado para bares y cafeterías.

El panel del dueño actual se mantiene tal cual; solo se le agregan secciones nuevas.

## 1. Pago desde la mesa (prepago)

Flujo del comensal:

```text
Escanea QR -> Menú -> Carrito -> Pantalla de pago
   -> ingresa email (opcional, para lealtad)
   -> paga -> pago aprobado -> pedido entra a KDS
   -> pago rechazado -> pedido queda pendiente, no llega a cocina
```

- Pantalla de pago nueva con resumen, propina sugerida (0/5/10/15%) y campo de email.
- Por ahora el cobro es **simulado**: una pasarela de prueba dentro de la app que aprueba o rechaza (con opción de forzar rechazo para probar). Todo el resto del sistema — registro de pago, control de acceso a cocina, ingresos, lealtad — funciona como en producción, así que cuando conectes Mercado Pago, Transbank o Stripe solo se reemplaza el paso del cobro.
- Comprobante en pantalla al finalizar, con número de pedido y monto pagado.

## 2. Dos modos de cobro, elegibles por local

En la configuración de la sucursal, el dueño elige:

- **Prepago obligatorio**: cada pedido se paga al confirmarlo. Sin pago aprobado no entra a cocina.
- **Cuenta abierta**: el comensal pide libremente y paga todo al final desde la app (o pide la cuenta al mozo, como hoy).

El KDS y el panel de mozo respetan el modo del local: en prepago, los pedidos no pagados aparecen en un estado "esperando pago" separado y no ocupan la cocina.

## 3. Ingresos solo de lo pagado

- Nueva sección **Caja / Ingresos** en el panel del dueño: ventas pagadas del día, por método, propinas, ticket promedio, y detalle por mesa y pedido.
- Los reportes existentes suman únicamente pagos aprobados; los pedidos no pagados o rechazados quedan fuera.
- Cada local ve solo sus propios ingresos (aislamiento por tenant y sucursal, como ya funciona el resto del sistema).

## 4. Lealtad por email

Identificación sin contraseña: el comensal escribe su email al pagar y queda reconocido en ese local. La próxima vez que escanee un QR del mismo local, el email se recuerda automáticamente y se le muestra su progreso.

Dos programas, y cada local elige cuál usar (o ninguno):

- **Sellos por visita**: 1 sello por visita pagada. Al llegar a N visitas (configurable, ej. 5) se desbloquea una recompensa definida por el local (ej. bebida gratis).
- **Puntos por gasto**: acumula X puntos por cada $1.000 gastados, canjeables por un descuento o producto.

En la app del comensal:
- Barra de progreso ("3 de 5 visitas · te falta 2 para tu café gratis").
- Recompensa disponible aplicable en el siguiente pago, con confirmación del mozo o canje automático.

En el panel del dueño, nueva sección **Lealtad**:
- Activar/desactivar programa, elegir tipo, meta y recompensa.
- Lista de clientes con email, visitas, gasto total, última visita y recompensas canjeadas.
- Exportable a CSV, como los demás reportes.

## 5. Privacidad

Los emails de clientes quedan aislados por local: un restaurante nunca ve los clientes de otro. Se guarda un consentimiento simple al momento de ingresar el email.

## Detalles técnicos

- Nuevas tablas: `payments` (pedido, sesión, monto, propina, método, estado, referencia externa), `loyalty_programs` (config por tenant/sucursal), `loyalty_customers` (email + tenant, visitas, puntos, último acceso), `loyalty_rewards` (recompensas ganadas/canjeadas). Todas con RLS por `tenant_id` y GRANTs explícitos.
- Nuevos campos: `branches.payment_mode` (`prepaid` | `open_tab`), `orders.payment_status` (`unpaid` | `paid` | `failed`).
- El KDS filtra por `payment_status = 'paid'` cuando la sucursal está en prepago; sin cambios cuando es cuenta abierta.
- El cobro se implementa en una edge function `process-payment` con un adaptador "simulado" aislado, para cambiar de proveedor sin tocar el resto del flujo.
- La acumulación de lealtad ocurre en el servidor al confirmar el pago, no en el cliente, para evitar manipulación.
- Reportes e ingresos se recalculan desde `payments`, no desde el carrito local.

## Orden de trabajo

1. Base de datos: pagos, lealtad, campos nuevos y políticas de acceso.
2. Flujo de pago del comensal (pantalla, propina, email, comprobante).
3. Bloqueo de cocina e ingresos según pago.
4. Configuración de modo de cobro por sucursal.
5. Programa de lealtad: progreso del comensal y panel del dueño.
