import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json, UUID_RE } from "../_shared/http.ts";
import { charge, refund, PROVIDER_NAME, type PaymentMethod } from "../_shared/provider.ts";
import * as transbank from "../_shared/pasarelas/transbank.ts";
import { appPermitida, codificarApp, urlFunciones } from "../_shared/urls.ts";

interface Pasarela {
  proveedor: "simulado" | "transbank" | "mercadopago";
  ambiente?: transbank.Ambiente;
  conexion_id?: string;
  credenciales?: Record<string, string>;
}

const METHODS: PaymentMethod[] = ["apple_pay", "google_pay", "card", "cash"];

/** Los mensajes de la base vienen en español para el comensal; si llega algo técnico, uno genérico. */
function mensajeComensal(mensaje?: string): string {
  if (!mensaje || /[a-z]+_[a-z]+|violates|permission|function|syntax/i.test(mensaje)) {
    return "No pudimos procesar tu pedido. Intenta de nuevo.";
  }
  return mensaje;
}

interface CartModifierIn {
  groupName?: string;
  modifierName?: string;
}
interface CartItemIn {
  menu_item_id?: string;
  quantity?: number;
  modifiers?: CartModifierIn[];
  notes?: string;
}

// Con el servidor ocupado (un peak), se le pide al cliente reintentar: nunca se le dice algo falso
// ("QR no válido", "este local no cobra con la app") por una consulta que no alcanzó a responder.
const OCUPADO = "Hay mucho movimiento en este momento. Intenta de nuevo en unos segundos.";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Quién paga (fase 1.3): invitado o cliente, según su sesión. Sin sesión, nadie.
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
    const { data: quien, error: errQuien } = token ? await admin.auth.getUser(token) : { data: { user: null }, error: null };
    const comensal = quien?.user ?? null;
    // Si no se pudo consultar la sesión (servidor ocupado), no es que la persona no tenga sesión (fase 5.3)
    if (!comensal && errQuien && !(errQuien.status && errQuien.status >= 400 && errQuien.status < 500)) {
      return json({ error: OCUPADO }, 503);
    }
    // Fase 1.10: todo pago queda ligado a una persona (invitado o cliente). Todo comensal tiene sesión.
    if (!comensal) return json({ error: "Abre la carta desde el QR de tu mesa para pagar." }, 401);
    // Los sellos solo se suman a clientes registrados, con el correo verificado de su cuenta.
    // Antes se aceptaba cualquier correo escrito a mano (DIAGNOSTICO N4).
    const correoVerificado =
      comensal && !comensal.is_anonymous && comensal.email && comensal.email_confirmed_at
        ? comensal.email.toLowerCase()
        : "";

    const body = await req.json().catch(() => ({}));

    const tableToken = typeof body?.table_token === "string" ? body.table_token.trim() : "";
    const cotizacionId = typeof body?.cotizacion_id === "string" && UUID_RE.test(body.cotizacion_id) ? body.cotizacion_id : null;
    const orderId = typeof body?.order_id === "string" ? body.order_id : null;
    const orderIds: string[] = Array.isArray(body?.order_ids)
      ? body.order_ids.filter((x: unknown) => typeof x === "string" && UUID_RE.test(x)).slice(0, 50)
      : [];
    const method: PaymentMethod = METHODS.includes(body?.method) ? body.method : "card";
    const tipRaw = Number.isFinite(body?.tip_amount) ? Math.round(body.tip_amount) : 0;
    const email = correoVerificado;
    // La clave única del pago la manda la app; si no viene, cada llamada es un intento distinto.
    const idempotencyKey =
      typeof body?.idempotency_key === "string" && body.idempotency_key.length >= 8 && body.idempotency_key.length <= 100
        ? body.idempotency_key
        : crypto.randomUUID();
    const cartItems: CartItemIn[] = Array.isArray(body?.cart_items) ? body.cart_items.slice(0, 50) : [];
    const orderNotes =
      typeof body?.order_notes === "string" ? body.order_notes.trim().slice(0, 300) : "";

    if (!tableToken || tableToken.length > 200) return json({ error: "Mesa inválida" }, 400);
    if (orderId && !UUID_RE.test(orderId)) return json({ error: "Pedido inválido" }, 400);
    if (tipRaw < 0 || tipRaw > 5_000_000) return json({ error: "Propina inválida" }, 400);
    if (method === "cash") return json({ error: "El efectivo se le paga al mozo." }, 400);

    const { data: table, error: errMesa } = await admin
      .from("tables")
      .select("id, number, tenant_id, branch_id")
      .eq("qr_token", tableToken)
      .maybeSingle();
    if (errMesa) return json({ error: OCUPADO }, 503);
    if (!table) return json({ error: "QR de mesa no válido" }, 404);

    /* ---------- 0. Cómo cobra este local (fase 4.1): su pasarela, simulado (demo) o nada ---------- */
    const { data: pas, error: errPas } = await admin.rpc("_pasarela_sucursal", { _branch_id: table.branch_id });
    if (errPas) return json({ error: OCUPADO }, 503);
    const pasarela = pas as Pasarela | null;
    if (!pasarela) {
      return json({ error: "Este local todavía no recibe pagos con la app. Pídele la cuenta al mozo." }, 409);
    }
    if (pasarela.proveedor === "mercadopago") {
      return json({ error: "Este medio de pago todavía no está disponible. Pídele la cuenta al mozo." }, 409);
    }
    // Para volver a la app después de pagar en la pasarela (solo a la app de Tablio)
    const app = appPermitida(req.headers.get("Origin")) ?? appPermitida(Deno.env.get("URL_APP"));
    const volverA = body?.volver_a === "pay" ? "pay" : "checkout";

    /* ---------- 1. Cotización: el precio congelado (fase 2.A) ---------- */
    let cotizacion = cotizacionId;
    // Un pago repetido con la misma clave usa la cotización de la primera vez (no se cotiza de nuevo).
    if (!cotizacion) {
      const { data: previo } = await admin
        .from("intentos_pago")
        .select("cotizacion_id, user_id")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (previo && previo.user_id === comensal.id) cotizacion = previo.cotizacion_id;
    }
    if (!cotizacion) {
      const { data: cot, error: cotErr } = await admin.rpc("crear_cotizacion", {
        _user_id: comensal.id,
        _qr_token: tableToken,
        _items: cartItems.length
          ? cartItems.map((ci) => ({
              menu_item_id: ci.menu_item_id,
              quantity: ci.quantity,
              modifiers: Array.isArray(ci.modifiers)
                ? ci.modifiers.slice(0, 20).map((m) => ({ groupName: m?.groupName, modifierName: m?.modifierName }))
                : [],
              notes: typeof ci.notes === "string" ? ci.notes : null,
            }))
          : null,
        _order_ids: orderIds.length ? orderIds : orderId ? [orderId] : null,
        _notas: orderNotes || null,
      });
      if (cotErr || !cot) return json({ error: mensajeComensal(cotErr?.message) }, 409);
      cotizacion = (cot as { id: string }).id;
    }

    /* ---------- 2. Reservar el intento ANTES de cobrar (regla 4) ---------- */
    const { data: reserva, error: resErr } = await admin.rpc("reservar_intento_pago", {
      _cotizacion_id: cotizacion,
      _user_id: comensal.id,
      _idempotency_key: idempotencyKey,
      _metodo: method,
      _propina: tipRaw,
    });
    if (resErr || !reserva) return json({ error: mensajeComensal(resErr?.message) }, 409);
    const intento = reserva as { id: string; estado: string; repetido: boolean; monto: number; propina: number; payment_id?: string };

    if (intento.repetido) {
      // Mismo pago repetido: se responde lo de antes, sin cobrar otra vez.
      if (intento.estado === "aprobado" && intento.payment_id) {
        const { data: previo } = await admin.from("payments").select("*").eq("id", intento.payment_id).single();
        const { data: ped } = previo?.order_id
          ? await admin.from("orders").select("id, order_number").eq("id", previo.order_id).single()
          : { data: null };
        return json({ payment: previo, duplicate: true, approved: true, order: ped, table_number: table.number });
      }
      if (intento.estado === "reservado") {
        // Ya salió a la pasarela y no terminó: se le vuelve a mostrar la misma página de pago
        const { data: it } = await admin.from("intentos_pago").select("token_externo").eq("id", intento.id).single();
        if (it?.token_externo && pasarela.proveedor === "transbank") {
          return json({ approved: false, pendiente: true, intento_id: intento.id,
            redirigir: { url: transbank.urlFormulario(pasarela.ambiente!), campos: { token_ws: it.token_externo } } });
        }
        return json({ error: "Tu pago se está procesando. Espera un momento." }, 409);
      }
      return json({ error: intento.estado === "rechazado" ? "Pago rechazado" : "Este pago fue devuelto", duplicate: true }, 402);
    }

    /* ---------- 3a. Pasarela real: el cliente paga en la página de la pasarela ---------- */
    if (pasarela.proveedor === "transbank") {
      if (!app) return json({ error: "No pudimos abrir el pago. Vuelve a abrir la carta desde el QR." }, 400);
      try {
        const cred = pasarela.credenciales as unknown as transbank.CredTransbank;
        const retorno = `${urlFunciones()}/pago-retorno?a=${codificarApp(app)}&v=${volverA}`;
        const { token: tbk, url } = await transbank.crear(pasarela.ambiente!, cred, {
          ordenCompra: transbank.ordenDeIntento(intento.id),
          sesion: comensal.id,
          monto: intento.monto + intento.propina,
          retorno,
        });
        await admin.rpc("_anotar_token_intento", {
          _intento_id: intento.id, _conexion_id: pasarela.conexion_id, _proveedor: "transbank", _token: tbk,
        });
        return json({ approved: false, pendiente: true, intento_id: intento.id, redirigir: { url, campos: { token_ws: tbk } } });
      } catch (e) {
        console.error("transbank crear", e instanceof Error ? e.message : e);
        // No se cobró nada: el intento se cierra para que pueda volver a intentarlo
        await admin.rpc("confirmar_pago", {
          _intento_id: intento.id, _aprobado: false, _monto_cobrado: 0, _proveedor: "transbank", _referencia: null, _payload: {},
        });
        return json({ error: "No pudimos conectar con Webpay. Intenta de nuevo en un momento." }, 502);
      }
    }

    /* ---------- 3. Cobro (simulado: locales de demostración) ---------- */
    const result = await charge({ amount: intento.monto, tip: intento.propina, method, reference: intento.id, email });

    /* ---------- 4. Confirmación atómica: pedido, pago, mesa y sesión juntos ---------- */
    const { data: conf, error: confErr } = await admin.rpc("confirmar_pago", {
      _intento_id: intento.id,
      _aprobado: result.approved,
      _monto_cobrado: result.approved ? intento.monto : 0,
      _proveedor: PROVIDER_NAME,
      _referencia: result.externalReference,
      _payload: result.payload,
      _correo: email || null,
    });
    if (confErr || !conf) {
      // El cobro ya ocurrió pero no se pudo registrar: el intento queda "reservado" y se puede
      // confirmar después con la misma clave (el aviso de la pasarela lo resuelve en la fase 4).
      console.error("confirmar_pago error", confErr);
      return json({ error: "Tu pago quedó en revisión. No lo vuelvas a intentar: te avisaremos." }, 500);
    }
    const confirmacion = conf as {
      estado: string; nuevo: boolean; payment_id?: string; order_id?: string; order_number?: number;
      motivo?: string; reembolsar?: number;
    };

    if (confirmacion.estado === "rechazado") {
      return json({ approved: false, error: result.declineReason ?? "Pago rechazado" }, 402);
    }
    if (confirmacion.estado === "reembolsado") {
      // Monto que no calza o ya pagado por otra persona: se devuelve automáticamente.
      if (confirmacion.reembolsar && confirmacion.reembolsar > 0) {
        const devuelto = await refund(result.externalReference, confirmacion.reembolsar);
        // Queda anotado si resultó (fase 4.6): si no, la caja lo ve en sus excepciones
        await admin.rpc("_anotar_devolucion_intento", { _intento_id: intento.id, _ok: devuelto.ok, _referencia: devuelto.externalReference });
      }
      return json({ approved: false, refunded: true, error: confirmacion.motivo ?? "Te devolvimos el dinero" }, 409);
    }

    const { data: payment } = await admin.from("payments").select("*").eq("id", confirmacion.payment_id!).single();
    const amount = intento.monto;
    const createdOrder = confirmacion.order_number
      ? { id: confirmacion.order_id!, order_number: confirmacion.order_number }
      : null;

    // Los sellos los suma la base al guardarse el pago (disparador sumar_sellos, fase 3.7).

    return json({
      payment,
      approved: true,
      table_number: table.number,
      order: createdOrder,
    });
  } catch (err) {
    console.error("process-payment error", err);
    return json({ error: "Error procesando el pago" }, 500);
  }
});
