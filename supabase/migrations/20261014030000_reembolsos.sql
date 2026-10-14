-- Fase 2.C — Reembolsos atómicos y caja del cajero.
-- Antes: reembolsaba solo dueño o administrador; se llamaba al proveedor y después se anotaba, y dos
-- reembolsos al mismo tiempo podían devolver más de lo cobrado.
-- Ahora: el reembolso se reserva en la base (bloqueando el pago) ANTES de devolver la plata; nunca
-- se devuelve más de lo cobrado. El cajero también reembolsa (brief 5.4), siempre con motivo.
-- Los pagos en efectivo o POS se devuelven en el local (no pasan por la pasarela).

ALTER TABLE public.refunds ADD COLUMN IF NOT EXISTS devolucion text
  CHECK (devolucion IS NULL OR devolucion IN ('pasarela', 'local'));
ALTER TABLE public.refunds ADD COLUMN IF NOT EXISTS authorized_role text;
ALTER TABLE public.refunds ADD COLUMN IF NOT EXISTS resuelto_at timestamptz;
ALTER TABLE public.refunds DROP CONSTRAINT IF EXISTS refunds_status_check;
ALTER TABLE public.refunds ADD CONSTRAINT refunds_status_check CHECK (status IN ('pending', 'completed', 'failed'));
ALTER TABLE public.refunds DROP CONSTRAINT IF EXISTS refunds_amount_check;
ALTER TABLE public.refunds ADD CONSTRAINT refunds_amount_check CHECK (amount > 0);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Reservar el reembolso (bloquea el pago: dos reembolsos a la vez no superan lo cobrado).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reservar_reembolso(_user_id uuid, _payment_id uuid, _monto integer, _motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pago record;
  rol text;
  nombre text;
  reservado integer;
  disponible integer;
  monto integer;
  motivo_limpio text := nullif(btrim(coalesce(_motivo, '')), '');
  reembolso uuid;
BEGIN
  SELECT * INTO pago FROM public.payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pago no encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = _user_id) THEN
    rol := 'superadmin';
  ELSE
    SELECT tm.role INTO rol FROM public.tenant_members tm
     WHERE tm.user_id = _user_id AND tm.tenant_id = pago.tenant_id AND tm.is_active;
  END IF;
  IF rol IS NULL OR rol NOT IN ('owner', 'admin', 'manager', 'cashier', 'superadmin') THEN
    RAISE EXCEPTION 'Solo la caja, el encargado o el dueño pueden reembolsar' USING ERRCODE = '42501';
  END IF;
  IF motivo_limpio IS NULL OR char_length(motivo_limpio) < 5 OR char_length(motivo_limpio) > 500 THEN
    RAISE EXCEPTION 'Indica el motivo del reembolso (5 a 500 letras)' USING ERRCODE = '22023';
  END IF;
  IF pago.status NOT IN ('approved', 'partially_refunded') THEN
    RAISE EXCEPTION 'Solo se pueden reembolsar pagos aprobados' USING ERRCODE = 'P0001';
  END IF;

  SELECT coalesce(sum(amount), 0) INTO reservado FROM public.refunds WHERE payment_id = pago.id AND status = 'pending';
  disponible := pago.amount + coalesce(pago.tip_amount, 0) - coalesce(pago.refunded_amount, 0) - reservado;
  monto := coalesce(nullif(_monto, 0), disponible);
  IF disponible <= 0 THEN
    RAISE EXCEPTION 'Este pago ya está reembolsado por completo' USING ERRCODE = 'P0001';
  END IF;
  IF monto <= 0 OR monto > disponible THEN
    RAISE EXCEPTION 'Puedes reembolsar como máximo %', disponible USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(email, 'Tablio') INTO nombre FROM auth.users WHERE id = _user_id;
  INSERT INTO public.refunds (tenant_id, payment_id, amount, reason, authorized_by, authorized_by_name, authorized_role, status, devolucion)
  VALUES (pago.tenant_id, pago.id, monto, motivo_limpio, _user_id, nombre, rol, 'pending',
          CASE WHEN pago.provider = 'local' THEN 'local' ELSE 'pasarela' END)
  RETURNING id INTO reembolso;

  RETURN jsonb_build_object('refund_id', reembolso, 'monto', monto,
                            'devolucion', CASE WHEN pago.provider = 'local' THEN 'local' ELSE 'pasarela' END,
                            'referencia_pago', pago.external_reference);
END;
$$;
REVOKE ALL ON FUNCTION public.reservar_reembolso(uuid, uuid, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reservar_reembolso(uuid, uuid, integer, text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Confirmar el reembolso: todo junto (pago, pedidos, sesión, auditoría). Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.confirmar_reembolso(_refund_id uuid, _ok boolean, _referencia text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  pago record;
  total_devuelto integer;
  completo boolean;
  pedidos uuid[];
BEGIN
  SELECT * INTO r FROM public.refunds WHERE id = _refund_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reembolso no encontrado' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO pago FROM public.payments WHERE id = r.payment_id FOR UPDATE;
  IF r.status <> 'pending' THEN
    RETURN jsonb_build_object('estado', r.status, 'nuevo', false,
                              'completo', pago.status = 'refunded');
  END IF;

  IF NOT _ok THEN
    UPDATE public.refunds SET status = 'failed', resuelto_at = now(), external_reference = _referencia WHERE id = r.id;
    RETURN jsonb_build_object('estado', 'failed', 'nuevo', true, 'completo', false);
  END IF;

  total_devuelto := coalesce(pago.refunded_amount, 0) + r.amount;
  completo := total_devuelto >= pago.amount + coalesce(pago.tip_amount, 0);

  UPDATE public.refunds SET status = 'completed', resuelto_at = now(), external_reference = _referencia WHERE id = r.id;
  UPDATE public.payments
     SET refunded_amount = total_devuelto,
         status = CASE WHEN completo THEN 'refunded' ELSE 'partially_refunded' END
   WHERE id = pago.id;

  -- La sesión de la mesa refleja lo devuelto (solo la parte del consumo, no la propina).
  IF pago.session_id IS NOT NULL THEN
    UPDATE public.table_sessions
       SET paid_amount = greatest(0, coalesce(paid_amount, 0) - least(r.amount, pago.amount))
     WHERE id = pago.session_id;
  END IF;

  -- Reembolso total: los pedidos de ese pago quedan "reembolsados".
  IF completo THEN
    SELECT coalesce(array_agg(x::uuid), ARRAY[]::uuid[]) INTO pedidos
      FROM jsonb_array_elements_text(coalesce(pago.provider_payload -> 'pedidos', '[]'::jsonb)) x;
    IF pago.order_id IS NOT NULL THEN
      pedidos := pedidos || pago.order_id;
    END IF;
    UPDATE public.orders SET payment_status = 'refunded'
     WHERE id = ANY (pedidos) AND payment_status = 'paid';
  END IF;

  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (pago.tenant_id, r.authorized_by, 'reembolso', 'payment', pago.id,
          jsonb_build_object('monto', r.amount, 'motivo', r.reason, 'rol', r.authorized_role,
                             'devolucion', r.devolucion, 'completo', completo));

  RETURN jsonb_build_object('estado', 'completed', 'nuevo', true, 'completo', completo, 'monto', r.amount);
END;
$$;
REVOKE ALL ON FUNCTION public.confirmar_reembolso(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirmar_reembolso(uuid, boolean, text) TO service_role;
