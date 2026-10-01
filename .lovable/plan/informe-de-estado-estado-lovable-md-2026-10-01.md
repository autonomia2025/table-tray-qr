# Informe de estado: ESTADO_LOVABLE.md

Solo auditoría. No se modifica código, base de datos ni configuración. Se entrega un único documento descargable `/mnt/documents/ESTADO_LOVABLE.md`, en español simple con detalle técnico.

## Cómo se recopila la evidencia
- Lectura de todas las rutas (`src/App.tsx`) y de cada página, contexto y hook, para clasificar cada pantalla como: conectada a la base / datos simulados o de prueba / solo visual.
- Consultas de solo lectura a la base: columnas y tipos, llaves foráneas, políticas RLS completas (texto de cada política), GRANTs, funciones, triggers, buckets y publicaciones realtime.
- Lectura de cada función de servidor en `supabase/functions/*`.
- Lista de nombres de secretos configurados (sin valores) y búsqueda de servicios externos en el código.
- Búsquedas de código duplicado, estados mezclados inglés/español, funciones sin uso, textos técnicos visibles, y conteo de filas de prueba vs reales (solo cantidades, sin datos personales).
- Resultados del linter y del escaneo de seguridad existentes.

## Secciones del documento
1. Inventario de roles y pantallas (ruta, qué hace, estado real).
2. Modelo de datos completo (tablas, columnas, relaciones, RLS, funciones, triggers, funciones de servidor).
3. Flujos de negocio paso a paso, indicando exactamente dónde y quién confirma un pago.
4. Backoffice interno (vendedor, jefe de ventas, finanzas, superadmin): qué hace y qué datos usa.
5. Integraciones y secretos: qué existe, qué variables necesita, qué está configurado de verdad (el proveedor de pagos actual es simulado; se confirmará en el código).
6. Inconsistencias y problemas con referencias a archivo y línea.
7. Riesgos de dinero: respuestas a las 5 preguntas con citas del código y de las políticas.
8. Lo valioso para rescatar.

Todo lo que no se pueda verificar se marcará explícitamente como "no verificable".

## Detalles técnicos
- Sin contraseñas, tokens ni datos personales en el documento.
- Se agrega un anexo con el SQL de políticas tal como existe en la base, para recrearlas en el nuevo repositorio.
