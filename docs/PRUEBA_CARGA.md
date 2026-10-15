# Prueba de carga: un viernes lleno (fase 5.3)

**Qué se prueba.** Un local de 40 mesas con su carta.
- Entran comensales por el QR, miran la carta, piden y pagan en 2 rondas (con pausas como una persona), miran su mesa en vivo y algunos llaman al mozo.
- Al mismo tiempo, 10 pantallas escuchan en vivo (cocina, mozos y caja) y una cocina avanza los pedidos.
- Se mide cuánto tarda cada paso, cuántos fallan y cuánto demora un pedido pagado en aparecer en la pantalla de cocina.
- Al final, las tres auditorías tienen que seguir vacías.

**Cómo se corre.** `bun run carga` (o `COMENSALES=80 bun run carga`).
- Solo contra la base desechable de este computador: el guion se niega a correr contra la real.
- Requiere `supabase start` y el demo cargado. Código: `scripts/carga/viernes.ts`.

## Resultados (15 de octubre de 2026, en un MacBook con Supabase local)

Los comensales llegan repartidos en los primeros segundos y hacen todo en menos de medio minuto. Es mucho más intenso que un bar real: incluso un bar lleno reparte sus pagos en horas.

| Comensales | Duración | Pagos por minuto | Pagos que resultaron | Pagar (mediana) | Pagar (95 de 100) | Llegada a cocina (95 de 100) | Avisos en vivo perdidos | Auditorías |
|---|---|---|---|---|---|---|---|---|
| 50 | 17 s | 348 | 100 de 100 | 0.4 s | 0.6 s | 0.2 s | 59 | vacías |
| 150 | 23 s | 794 | 300 de 300 | 2.3 s | 5.2 s | 7.0 s | 160 | vacías |
| 300 | 25 s | 586 | 244 de 532 | 5.3 s | 6.8 s | 7.0 s | 105 | vacías |

**Cómo leerlo.**
- **50 comensales (unos 350 pagos por minuto, varias veces el peak de un bar real):** todo funciona, sin un solo error de pago. Pagar tarda menos de 1 segundo y el pedido aparece en cocina casi al instante. Algunos avisos en vivo se pierden, y las pantallas se ponen al día solas.
- **150 comensales (unos 800 pagos por minuto):** todos los pagos resultan, pero más lentos (5 segundos en el peor caso). Una parte de los avisos en vivo no llega a las pantallas; ahora las pantallas se ponen al día solas cada 15 segundos (cocina) o 20 segundos (mozo).
- **300 comensales entrando a la vez:** la red interna de este computador se satura (el intermediario entre las funciones y la base corta conexiones). Los pagos que no alcanzan:
  - piden reintentar ("Hay mucho movimiento…"), o
  - quedan "en revisión" y la revisión automática los resuelve.
- **En los tres casos las auditorías de la plata quedaron vacías:** ni con sobrecarga se cobró dos veces ni se descuadró un peso.

## Lo que se encontró y se corrigió

1. **Bloqueos mutuos entre operaciones de la misma mesa.** Llamar al mozo, pedir la cuenta o pedir sin pagar, justo cuando otra persona de la mesa pagaba, podía bloquear a las dos. La base cortaba una y el pago quedaba "en revisión". Ahora todas las funciones toman primero la mesa, después la visita y después los pedidos (migración `20261015110000_orden_bloqueos`). La prueba `tests/seguridad/f5-3-mesa-llena.test.ts` lo provoca a propósito.
2. **Mensajes falsos bajo carga.** Con el servidor ocupado, el pago podía decir "QR no válido", "este local no recibe pagos" o "abre la carta desde el QR". Ahora dice "Hay mucho movimiento en este momento. Intenta de nuevo en unos segundos." Reintentar es seguro: la misma clave de pago no cobra dos veces.
3. **La pantalla del mozo multiplicaba la carga.** Cada aviso de cualquier mesa la hacía recargar todo; con varios mozos, eran muchas consultas por segundo. Ahora junta los avisos en una recarga (como máximo una por segundo) y se pone al día sola cada 20 segundos.
4. **La cocina se ponía al día cada 30 segundos** si perdía un aviso; ahora cada 15.

## Lo que falta medir en producción (paso 5.6)

- Esta prueba corre en un computador: la base real tiene otra capacidad. Hay que repetirla en el proyecto de producción, con el plan pagado, antes del piloto.
- **Conexiones en vivo:** cada comensal con su seguimiento abierto usa 1 conexión, y cada pantalla del personal otra. Un bar lleno (150 personas mirando su pedido y 10 pantallas) son unas 160 a la vez. Según los límites publicados por Supabase, el plan gratis admite unas 200 y el pagado unas 500 (con más, pagando aparte). Con varios locales llenos a la vez hará falta el plan pagado, y más adelante quizás que el seguimiento del comensal consulte cada pocos segundos en vez de quedar conectado.
