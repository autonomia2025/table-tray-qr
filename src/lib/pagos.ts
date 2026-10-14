import { supabase } from "@/integrations/supabase/client";
import { mensajeError } from "@/lib/errores";

// Pasarelas de pago de cada local (fase 4.1). Cada local conecta su propia cuenta; la plata va directo
// a esa cuenta y Tablio nunca la toca. Sin pasarela conectada, un local real no cobra con la app.

export type Proveedor = "transbank" | "mercadopago" | "simulado";

export interface PasarelaMesa {
  proveedor: Proveedor | null;
  /** Ambiente de pruebas o demostración: no se cobra plata real */
  prueba: boolean;
}

export interface ConexionPago {
  id: string;
  proveedor: Exclude<Proveedor, "simulado">;
  ambiente: "integracion" | "produccion";
  estado: "activa" | "desconectada";
  etiqueta: string;
  conectado_por_nombre: string | null;
  verificado_at: string | null;
  created_at: string;
}

export interface ResultadoIntento {
  estado: "reservado" | "aprobado" | "rechazado" | "reembolsado";
  monto: number;
  propina: number;
  motivo: string | null;
  referencia: string | null;
  order_number: number | null;
}

/** Dónde mandar al cliente para pagar en la pasarela (formulario que se envía solo). */
export interface Redireccion {
  url: string;
  campos: Record<string, string>;
}

type Resultado<T> = { ok: true; dato: T } | { ok: false; error: string };

export const NOMBRE_PROVEEDOR: Record<Proveedor, string> = {
  transbank: "Webpay (Transbank)",
  mercadopago: "Mercado Pago",
  simulado: "Pago simulado (demostración)",
};

export async function pasarelaDeMesa(qr: string): Promise<PasarelaMesa | null> {
  const { data, error } = await supabase.rpc("pasarela_de_mesa", { _qr_token: qr });
  if (error) return null;
  return data as unknown as PasarelaMesa;
}

export async function resultadoIntento(intento: string): Promise<ResultadoIntento | null> {
  const { data, error } = await supabase.rpc("resultado_intento", { _intento_id: intento });
  if (error) return null;
  return data as unknown as ResultadoIntento;
}

/** Espera a que el pago que volvió de la pasarela quede resuelto (unos segundos como máximo). */
export async function esperarResultado(intento: string, intentos = 12): Promise<ResultadoIntento | null> {
  for (let i = 0; i < intentos; i++) {
    const r = await resultadoIntento(intento);
    if (r && r.estado !== "reservado") return r;
    await new Promise((ok) => setTimeout(ok, 1000));
  }
  return resultadoIntento(intento);
}

/** Manda al cliente a la página de pago de la pasarela (Webpay pide un formulario con el token). */
export function irAPasarela(r: Redireccion) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = r.url;
  for (const [k, v] of Object.entries(r.campos)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = k;
    input.value = v;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

export async function conexionesPago(sucursal: string): Promise<ConexionPago[]> {
  const { data } = await supabase
    .from("conexiones_pago")
    .select("id, proveedor, ambiente, estado, etiqueta, conectado_por_nombre, verificado_at, created_at")
    .eq("branch_id", sucursal)
    .order("created_at", { ascending: false })
    .limit(5);
  return (data as unknown as ConexionPago[]) ?? [];
}

export async function conectarTransbank(
  sucursal: string,
  p: { ambiente: "integracion" | "produccion"; codigoComercio?: string; apiKey?: string; usarClavesDePrueba?: boolean },
): Promise<Resultado<{ etiqueta: string }>> {
  const { data, error } = await supabase.functions.invoke("conectar-pago", {
    body: {
      branch_id: sucursal, proveedor: "transbank", ambiente: p.ambiente,
      codigo_comercio: p.codigoComercio, api_key: p.apiKey, usar_claves_de_prueba: p.usarClavesDePrueba === true,
    },
  });
  if (error) {
    const cuerpo = await (error as { context?: Response }).context?.json?.().catch(() => null);
    return { ok: false, error: mensajeError({ message: cuerpo?.error }, "No se pudo conectar. Revisa los datos e intenta de nuevo.") };
  }
  return { ok: true, dato: (data as { conexion: { etiqueta: string } }).conexion };
}

export async function desconectarPago(conexion: string): Promise<Resultado<null>> {
  const { error } = await supabase.rpc("desconectar_pago", { _conexion_id: conexion });
  if (error) return { ok: false, error: mensajeError(error) };
  return { ok: true, dato: null };
}

export interface Conciliacion {
  dia: string;
  pagos: number;
  diferencias: number;
  detalle: { pago_id: string; referencia: string | null; monto: number; calza: boolean; detalle: string }[];
}

/** Compara cada pago con Webpay del día con lo que dice Transbank (fase 4.4). */
export async function conciliarPasarela(sucursal: string, dia: string): Promise<Resultado<Conciliacion>> {
  const { data, error } = await supabase.functions.invoke("conciliar-pasarela", { body: { branch_id: sucursal, dia } });
  if (error) {
    const cuerpo = await (error as { context?: Response }).context?.json?.().catch(() => null);
    return { ok: false, error: mensajeError({ message: cuerpo?.error }, "No se pudo verificar con la pasarela. Intenta de nuevo.") };
  }
  return { ok: true, dato: data as Conciliacion };
}
