import fs from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";

/**
 * Fotos del recorrido de cada fase (pedido del fundador, 13 de octubre de 2026).
 * Solo se toman con RECORRIDO=<carpeta>; en las corridas normales no hacen nada.
 */
export async function foto(page: Page, nombre: string) {
  const carpeta = process.env.RECORRIDO;
  if (!carpeta) return;
  fs.mkdirSync(carpeta, { recursive: true });
  await page.waitForTimeout(400); // deja terminar las animaciones
  await page.screenshot({ path: path.join(carpeta, `${nombre}.png`) });
}

/** Credenciales del demo (privado/, fuera de git). */
export function cuenta(rol: string): { correo: string; clave: string } | null {
  const archivo = process.env.DEMO_CREDENCIALES ?? "privado/DEMO_CREDENCIALES.md";
  const texto = fs.existsSync(archivo) ? fs.readFileSync(archivo, "utf-8") : "";
  const m = texto.match(new RegExp(`^\\| ${rol} \\| \`([^\`]+)\` \\| \`([^\`]+)\` \\|$`, "m"));
  return m ? { correo: m[1], clave: m[2] } : null;
}

export function linkMesa(numero: number): string | null {
  const archivo = process.env.DEMO_CREDENCIALES ?? "privado/DEMO_CREDENCIALES.md";
  const texto = fs.existsSync(archivo) ? fs.readFileSync(archivo, "utf-8") : "";
  return texto.match(new RegExp(`^\\| ${numero} \\| \\w+ \\| \`([^\`]+)\` \\|$`, "m"))?.[1] ?? null;
}

export async function entrar(page: Page, rol: string) {
  const c = cuenta(rol)!;
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(c.correo);
  await page.locator('input[type="password"]').fill(c.clave);
  await page.locator('button[type="submit"]').click();
}

/** URL y clave pública de la base que usa la app (las mismas que el navegador). */
function baseDeDatos() {
  const env = Object.fromEntries((fs.existsSync(".env") ? fs.readFileSync(".env", "utf-8") : "")
    .split("\n").filter((l) => l.includes("=")).map((l) => {
      const [k, ...v] = l.split("=");
      return [k.trim(), v.join("=").trim().replace(/^"|"$/g, "")];
    }));
  return {
    url: process.env.VITE_SUPABASE_URL ?? env.VITE_SUPABASE_URL,
    clave: process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_PUBLISHABLE_KEY,
  };
}

/** Código de presencia de una mesa del demo (fase 3.5): lo lee el dueño, como en su pantalla de QR. */
export async function codigoMesa(numero: number): Promise<string> {
  const { createClient } = await import("@supabase/supabase-js");
  const { url, clave } = baseDeDatos();
  const dueno = createClient(url, clave, { auth: { persistSession: false } });
  const c = cuenta("owner")!;
  await dueno.auth.signInWithPassword({ email: c.correo, password: c.clave });
  const { data: mesa } = await dueno.from("tables").select("id").eq("number", numero).eq("branch_id", SUCURSAL_DEMO).single();
  const { data } = await dueno.from("codigos_mesa").select("codigo").eq("table_id", mesa!.id).single();
  return data!.codigo as string;
}
const SUCURSAL_DEMO = "aebe7faa-0e29-5aa9-83c2-1e1b336f1554";

/** Si la app pide el código de la mesa, lo escribe (como haría el cliente leyendo su mesa). */
export async function ingresarCodigo(page: Page, numero: number) {
  await expect(page.getByText("Código de tu mesa")).toBeVisible({ timeout: 10_000 });
  await page.getByLabel("Código de 4 números de tu mesa").fill(await codigoMesa(numero));
}

/**
 * Entra como el cliente del demo en la app del comensal (fase 3.7). El login del personal no sirve para
 * clientes, así que se inicia sesión aparte y se deja la sesión en el navegador, como la dejaría la app.
 */
export async function entrarComoCliente(page: Page) {
  const { createClient } = await import("@supabase/supabase-js");
  const { url, clave } = baseDeDatos();
  const c = cuenta("cliente")!;
  const sb = createClient(url, clave, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email: c.correo, password: c.clave });
  if (error || !data.session) throw new Error("No se pudo entrar como cliente del demo");
  const llave = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  await page.addInitScript(([k, v]) => {
    if (!window.localStorage.getItem(k)) window.localStorage.setItem(k, v);
  }, [llave, JSON.stringify(data.session)] as const);
}

/** Devuelve completo el último pago con Webpay del demo, como lo haría el dueño desde Caja (fase 4.1). */
export async function reembolsarUltimoPagoWebpay(): Promise<{ status: number; estado: string | null }> {
  const { createClient } = await import("@supabase/supabase-js");
  const { url, clave } = baseDeDatos();
  const dueno = createClient(url, clave, { auth: { persistSession: false } });
  const c = cuenta("owner")!;
  const { data: sesion } = await dueno.auth.signInWithPassword({ email: c.correo, password: c.clave });
  const { data: pago } = await dueno.from("payments").select("id").eq("branch_id", SUCURSAL_DEMO).eq("provider", "transbank")
    .order("created_at", { ascending: false }).limit(1).single();
  const r = await fetch(`${url}/functions/v1/refund-payment`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: clave, Authorization: `Bearer ${sesion.session!.access_token}` },
    body: JSON.stringify({ payment_id: pago!.id, reason: "Prueba de devolución por Webpay" }),
  });
  const { data: despues } = await dueno.from("payments").select("status").eq("id", pago!.id).single();
  return { status: r.status, estado: despues?.status ?? null };
}

/** Conciliación con Transbank del día de negocio de hoy (fase 4.4), como el botón de la caja. */
export async function conciliarHoyConTransbank(): Promise<{ pagos: number; diferencias: number }> {
  const { createClient } = await import("@supabase/supabase-js");
  const { url, clave } = baseDeDatos();
  const dueno = createClient(url, clave, { auth: { persistSession: false } });
  const c = cuenta("owner")!;
  const { data: sesion } = await dueno.auth.signInWithPassword({ email: c.correo, password: c.clave });
  const dia = new Date(Date.now() - 6 * 3_600_000).toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
  const r = await fetch(`${url}/functions/v1/conciliar-pasarela`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: clave, Authorization: `Bearer ${sesion.session!.access_token}` },
    body: JSON.stringify({ branch_id: SUCURSAL_DEMO, dia }),
  });
  return await r.json();
}
