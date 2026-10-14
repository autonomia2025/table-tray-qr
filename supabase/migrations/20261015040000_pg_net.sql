-- Fase 4.4 — El reloj de revisión de pagos llama a la función revisar-pagos con pg_net. En Supabase
-- local viene activada, pero en el proyecto real no: sin ella el reloj fallaba en silencio.
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
