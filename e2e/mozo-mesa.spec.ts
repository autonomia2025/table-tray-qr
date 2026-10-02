import { test, expect } from "@playwright/test";
import fs from "node:fs";

// Fase 1.5 — El mozo toma una mesa y la cierra desde su pantalla; todo pasa por el servidor.
const archivo = process.env.DEMO_CREDENCIALES ?? "privado/DEMO_CREDENCIALES.md";
const texto = fs.existsSync(archivo) ? fs.readFileSync(archivo, "utf-8") : "";
const mozo = texto.match(/^\| waiter \| `([^`]+)` \| `([^`]+)` \|$/m);
const mesa6 = texto.match(/^\| 6 \| \w+ \| `([^`]+)` \|$/m)?.[1];

test.skip(!texto, "Falta privado/DEMO_CREDENCIALES.md");
// Una sola vez (no en paralelo en celular y escritorio): ambas usarían la misma mesa.
test.skip(({ isMobile }) => isMobile, "Se prueba una vez, en escritorio");

test("el mozo toma la mesa de un comensal que pagó y la cierra cuando se va", async ({ browser }) => {
  // Comensal: pide y paga en la mesa 6
  const comensalCtx = await browser.newContext();
  const comensal = await comensalCtx.newPage();
  await comensal.goto(mesa6!);
  await comensal.getByText("Agua mineral", { exact: true }).first().click();
  await comensal.getByRole("button", { name: /Agregar al carrito/ }).click();
  await comensal.getByText("Ver pedido").click();
  await comensal.getByRole("button", { name: /Ir a pagar/ }).click();
  await comensal.getByRole("button", { name: /Pagar con tarjeta/ }).click();
  await expect(comensal.getByText("¡Pago listo!")).toBeVisible({ timeout: 20_000 });
  await comensalCtx.close();

  // Mozo
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(mozo![1]);
  await page.locator('input[type="password"]').fill(mozo![2]);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/mozo\/mesas/, { timeout: 15_000 });

  const tarjeta = page.locator("div.rounded-xl").filter({ has: page.locator("span.text-4xl", { hasText: /^6$/ }) }).first();
  const tomar = tarjeta.getByRole("button", { name: "Tomar mesa →" });
  if (await tomar.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await tomar.click();
    await expect(page.getByText("Mesa tomada").first()).toBeVisible();
  }
  await expect(tarjeta.getByText("YO")).toBeVisible({ timeout: 10_000 });

  await tarjeta.click();
  await page.getByRole("button", { name: "Cerrar mesa", exact: true }).click();
  await page.getByRole("button", { name: "Sí, cerrar mesa" }).click();
  await expect(page.getByText("✅ Mesa cerrada").first()).toBeVisible({ timeout: 10_000 });
  // La mesa queda libre y sin mozo: se puede volver a tomar
  await expect(tarjeta.getByRole("button", { name: "Tomar mesa →" })).toBeVisible({ timeout: 10_000 });
  await expect(tarjeta.getByText("YO")).toHaveCount(0);
  await ctx.close();
});
