import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";

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
