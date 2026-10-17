-- Arreglo: al reiniciar el demo, los pagos de propinas de ejemplo de la semana en curso quedaban con fecha del
-- próximo lunes (en el futuro) y aparecían como el pago más reciente del mozo. Ahora nunca quedan después de
-- ahora, y se corrigen los del demo que ya estaban así (son datos de ejemplo del local de demo).
DO $$
DECLARE
  def text;
  nuevo text;
BEGIN
  def := pg_get_functiondef('public._sembrar_propinas_pagadas_demo'::regproc);
  nuevo := replace(def, $q$((g.semana + 7)::timestamp + interval '12 hours') AT TIME ZONE 'America/Santiago');$q$,
    $q$least(((g.semana + 7)::timestamp + interval '12 hours') AT TIME ZONE 'America/Santiago', now() - interval '1 minute'));$q$);
  IF nuevo = def THEN RAISE EXCEPTION '_sembrar_propinas_pagadas_demo: no se encontró dónde'; END IF;
  EXECUTE nuevo;
END;
$$;

UPDATE public.liquidaciones_propina SET created_at = now() - interval '1 minute'
 WHERE tenant_id = '651c363f-0084-50af-9873-be98cfeaaf47' AND created_at > now();
