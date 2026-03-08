

## Plan: QR automáticos al crear restaurante y mesas

### Problema actual
- Al crear un restaurante no se genera ningún QR "de mesa" (el que se pega en la mesa física para acceder al menú).
- Al crear una mesa ya se genera el `qr_token` (tarjeta), pero la página QR no muestra nada si no hay mesas.
- La página QR mezcla dos conceptos: el QR "mesa" (URL al menú) depende de que existan mesas.

### Cambios propuestos

**1. QR Page — Agregar sección "QR Menú General" (el que se pega en la mesa)**

En `src/pages/admin/QRPage.tsx`:
- Agregar una sección prominente arriba de las tabs que muestre **un solo QR general** del restaurante: `/{slug}/menu`. Este es el QR que se pega en TODAS las mesas físicas — no necesita parámetro `?mesa=`.
- Botones de descargar PNG e imprimir para este QR general.
- Las tabs existentes de "QR Mesa" (con `?mesa=N`) se pueden **eliminar o renombrar** a solo "QR Tarjeta" ya que el QR general reemplaza el concepto de QR por mesa.

**2. Tab "QR Tarjeta" — ya funciona**

Cada mesa ya genera su `qr_token` al crearse en `MesasPage.tsx`. La tab de tarjetas en QRPage ya lista las mesas con su token. No requiere cambios.

**3. Restructura de la página QR**

La nueva estructura sería:
- **Sección superior**: QR Menú General (único, `/{slug}/menu`) con preview grande, botón descargar y botón imprimir.
- **Sección inferior**: Tabla de QR Tarjetas por mesa (la tab "tarjeta" actual), mostrando cada mesa con su token QR.
- Se eliminan las tabs y se muestra todo en una sola vista con dos secciones claras.

### Archivos a modificar
- `src/pages/admin/QRPage.tsx` — Reestructurar: QR general arriba + tabla de tarjetas abajo, sin tabs.

### Sin cambios en DB
No se requieren migraciones. El `qr_token` ya se genera al crear mesas y la URL del menú se construye dinámicamente desde el slug.

