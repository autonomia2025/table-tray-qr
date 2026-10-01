# Cómo probar la demo de Tablio

Este archivo explica cómo entrar. **Las contraseñas no están aquí**: viven en `privado/DEMO_CREDENCIALES.md`, que no se sube a GitHub. Si no lo tienes, pídeselo a quien administra el proyecto o vuelve a generarlo con `python3 scripts/demo/crear_demo.py` (eso crea contraseñas nuevas; después hay que recargar el demo).

## Dónde está la app

| Dónde | Dirección | Base de datos |
|---|---|---|
| En tu computador | `http://localhost:8080` (se levanta con `bun run dev`) | La que diga `.env` (hoy, el Supabase propio) |
| En el celular, misma red wifi | `http://<IP del computador>:8080` | Igual que la anterior |
| Publicada | Pendiente: Vercel (paso 2.10) | — |

## Local de demo: "Demo Tablio"

- **Carta del comensal:** cada mesa tiene su propio link (está en el archivo de credenciales). Hay 10 mesas: 1 a 6 en el interior y 7 a 10 en la terraza.
- **Portada:** `/demo-tablio`
- **Sucursal:** Barrio Italia, en modo **prepago** (cocina solo ve lo pagado).
- **Carta:** cervezas, tragos, sin alcohol, picoteo, platos y postres, con 24 productos, modificadores (punto de la carne, tamaño de papas, pisco y bebida) y alérgenos. **Todavía no tiene fotos.**
- **Lealtad:** 5 visitas = un schop gratis.
- **Pagos:** simulados. No se cobra plata real.

### Cuentas (todas entran por `/login`)

| Rol | Correo | Llega a |
|---|---|---|
| Dueño | `dueno@demo.tablio.test` | `/admin/demo-tablio/mesas` |
| Administrador | `admin@demo.tablio.test` | `/admin/demo-tablio/mesas` |
| Mozo 1 (Camila) | `mozo1@demo.tablio.test` | `/mozo/mesas` (hoy pide la clave dos veces, ver DIAGNOSTICO N16) |
| Mozo 2 (Diego) | `mozo2@demo.tablio.test` | `/mozo/mesas` |
| Cocina y barra | `cocina@demo.tablio.test` | Panel del dueño. El KDS se abre en `/kds?branch=aebe7faa-0e29-5aa9-83c2-1e1b336f1554` |
| Superadmin | `superadmin@demo.tablio.test` | `/superadmin` |
| Jefa de ventas | `jefe@demo.tablio.test` | `/jefe-ventas/dashboard` |
| Vendedor | `vendedor@demo.tablio.test` | `/vendedor/mi-dia` |
| Finanzas | `finanzas@demo.tablio.test` | `/finanzas/revenue` |

Los correos usan el dominio reservado `.test`: no existen y nunca se le manda un correo a nadie. Por eso "¿Olvidaste tu contraseña?" no sirve para estas cuentas.

> ⚠️ La cuenta de superadmin del demo ve **todos** los locales de la base. Cuando haya locales reales, se separa la base de pruebas de la de producción (paso 4.7) o se elimina esta cuenta.

## Demo de venta en 5 minutos (sugerencia)

1. En tu celular, abre el link de la mesa 3. Pide un Pisco Sour y unas papas XL, y paga con tarjeta.
2. En el computador, con la cuenta de cocina, abre el KDS: el pedido llega solo. Acéptalo y márcalo listo.
3. En el celular del comensal, el estado cambia en vivo.
4. Con la cuenta del dueño, muestra Caja (el pago quedó registrado) y Reportes.

## Pruebas automáticas

```bash
bun run test:e2e                      # todas
bunx playwright test e2e/flujo-demo.spec.ts   # solo el recorrido completo
```

- `e2e/humo.spec.ts`: cada pantalla abre sin romperse.
- `e2e/demo-roles.spec.ts`: cada rol del demo entra y llega a su panel.
- `e2e/flujo-demo.spec.ts`: el comensal paga → cocina acepta, marca listo y entregado. **Crea un pedido real (con pago simulado) en el demo.**
- `e2e/migracion.spec.ts`: el local de prueba que vino de Lovable ("La parrillada") carga con sus fotos.
