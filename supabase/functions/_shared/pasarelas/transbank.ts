/**
 * Transbank Webpay Plus (API REST v1.2). Cada local usa su propio código de comercio y su clave:
 * la plata va directo a su cuenta (regla 9). Flujo: crear → el cliente paga en Webpay → Webpay lo
 * devuelve a pago-retorno → confirmar (commit) → si no calza, devolver (refund).
 */

export type Ambiente = "integracion" | "produccion";
export interface CredTransbank {
  codigo_comercio: string;
  api_key: string;
}

const BASES: Record<Ambiente, string> = {
  integracion: "https://webpay3gint.transbank.cl",
  produccion: "https://webpay3g.transbank.cl",
};
const RUTA = "/rswebpaytransaction/api/webpay/v1.2/transactions";

/** Claves públicas del ambiente de pruebas de Transbank (las publica Transbank para integrar). */
export const TRANSBANK_PRUEBA: CredTransbank = {
  codigo_comercio: "597055555532",
  api_key: "579B532A7440BB0C9079DED94D31EA1615BACEB56610332264630D42D0A36B1C",
};

export const urlFormulario = (ambiente: Ambiente) => `${BASES[ambiente]}/webpayserver/initTransaction`;

export class ErrorTransbank extends Error {
  constructor(public status: number, mensaje: string) {
    super(mensaje);
  }
}

async function llamar(ambiente: Ambiente, cred: CredTransbank, metodo: string, ruta: string, cuerpo?: unknown) {
  const r = await fetch(`${BASES[ambiente]}${RUTA}${ruta}`, {
    method: metodo,
    headers: {
      "Tbk-Api-Key-Id": cred.codigo_comercio,
      "Tbk-Api-Key-Secret": cred.api_key,
      "Content-Type": "application/json",
    },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const texto = await r.text();
  let datos: Record<string, unknown> = {};
  try {
    datos = texto ? JSON.parse(texto) : {};
  } catch {
    datos = { error_message: texto.slice(0, 200) };
  }
  if (!r.ok) throw new ErrorTransbank(r.status, String(datos.error_message ?? `HTTP ${r.status}`));
  return datos;
}

/** La orden de compra de Webpay (máx. 26 caracteres) sale del id del intento. */
export const ordenDeIntento = (intentoId: string) => intentoId.replaceAll("-", "").slice(0, 26);

export async function crear(
  ambiente: Ambiente,
  cred: CredTransbank,
  p: { ordenCompra: string; sesion: string; monto: number; retorno: string },
) {
  const d = await llamar(ambiente, cred, "POST", "", {
    buy_order: p.ordenCompra,
    session_id: p.sesion.slice(0, 61),
    amount: p.monto,
    return_url: p.retorno,
  });
  return { token: String(d.token), url: String(d.url) };
}

export interface ResultadoTransbank {
  status?: string;
  response_code?: number;
  amount?: number;
  authorization_code?: string;
  buy_order?: string;
  payment_type_code?: string;
  installments_number?: number;
  card_detail?: { card_number?: string };
}

export const aprobado = (r: ResultadoTransbank) => r.status === "AUTHORIZED" && r.response_code === 0;

export async function estado(ambiente: Ambiente, cred: CredTransbank, token: string) {
  return (await llamar(ambiente, cred, "GET", `/${token}`)) as ResultadoTransbank;
}

/**
 * Confirma el pago (commit). Si ya se había confirmado (el cliente recargó la página o llegó dos
 * veces), consulta el estado: la confirmación en la base es idempotente.
 */
export async function confirmar(ambiente: Ambiente, cred: CredTransbank, token: string) {
  try {
    return (await llamar(ambiente, cred, "PUT", `/${token}`)) as ResultadoTransbank;
  } catch (e) {
    if (e instanceof ErrorTransbank && e.status === 422) return await estado(ambiente, cred, token);
    throw e;
  }
}

export async function devolver(ambiente: Ambiente, cred: CredTransbank, token: string, monto: number) {
  try {
    const d = await llamar(ambiente, cred, "POST", `/${token}/refunds`, { amount: monto });
    return { ok: true, referencia: `TBK-${String(d.type ?? "REFUND")}-${String(d.authorization_code ?? Date.now())}` };
  } catch (e) {
    console.error("transbank refund", e instanceof Error ? e.message : e);
    return { ok: false, referencia: null };
  }
}

/** Prueba las claves: crear una transacción no cobra nada (queda sin pagar y vence sola). */
export async function verificar(ambiente: Ambiente, cred: CredTransbank) {
  try {
    await crear(ambiente, cred, { ordenCompra: `verif${Date.now()}`.slice(0, 26), sesion: "verificacion", monto: 50, retorno: "https://tablio.cl/verificacion" });
    return { ok: true as const };
  } catch (e) {
    const status = e instanceof ErrorTransbank ? e.status : 0;
    return { ok: false as const, error: status === 401 ? "Transbank no reconoce ese código de comercio con esa clave." : "No pudimos comunicarnos con Transbank. Intenta de nuevo." };
  }
}
