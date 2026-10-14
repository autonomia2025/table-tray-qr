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
