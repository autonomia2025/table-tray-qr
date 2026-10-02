import { test, expect } from "@playwright/test";
import fs from "node:fs";

// Fases 1.5 y 1.6 — Una visita completa, sin cámara, con dos navegadores a la vez:
// el comensal paga, llama al mozo; el mozo toma la mesa, atiende la llamada y la cierra;
// el comensal ve todo en vivo y califica su visita.
const archivo = process.env.DEMO_CREDENCIALES ?? "privado/DEMO_CREDENCIALES.md";
const texto = fs.existsSync(archivo) ? fs.readFileSync(archivo, "utf-8") : "";
const mozo = texto.match(/^\| waiter \| `([^`]+)` \| `([^`]+)` \|$/m);
const mesa6 = texto.match(/^\| 6 \| \w+ \| `([^`]+)` \|$/m)?.[1];

test.skip(!texto, "Falta privado/DEMO_CREDENCIALES.md");
// Una sola vez (no en paralelo en celular y escritorio): ambas usarían la misma mesa.
test.skip(({ isMobile }) => isMobile, "Se prueba una vez, en escritorio");

test("visita completa: pagar, llamar al mozo sin cámara, atender, cerrar la mesa y calificar", async ({ browser }) => {
  test.setTimeout(90_000); // dos navegadores a la vez
  // Comensal: pide y paga en la mesa 6, y queda en el seguimiento
  const comensalCtx = await browser.newContext();
  const comensal = await comensalCtx.newPage();
  await comensal.goto(mesa6!);
  await comensal.getByText("Agua mineral", { exact: true }).first().click();
  await comensal.getByRole("button", { name: /Agregar al carrito/ }).click();
  await comensal.getByText("Ver pedido").click();
  await comensal.getByRole("button", { name: /Ir a pagar/ }).click();
  await comensal.getByRole("button", { name: /Pagar con tarjeta/ }).click();
  await expect(comensal.getByText("¡Pago listo!")).toBeVisible({ timeout: 20_000 });
  await comensal.getByRole("button", { name: "Ver estado de mi pedido" }).click();
  await expect(comensal.getByText("Recibido ✓").first()).toBeVisible({ timeout: 15_000 });

  // Llama al mozo: elige el motivo y listo (ya no se escanea nada)
  await comensal.getByRole("button", { name: /Llamar al mozo/ }).click();
  await comensal.getByRole("button", { name: "Necesito ayuda" }).click();
  await expect(comensal.getByText("Mozo notificado — viene en camino")).toBeVisible({ timeout: 10_000 });

  // Mozo
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(mozo![1]);
  await page.locator('input[type="password"]').fill(mozo![2]);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/mozo\/mesas/, { timeout: 15_000 });

  const tarjeta = page.locator("div.rounded-xl").filter({ has: page.locator("span.text-4xl", { hasText: /^6$/ }) }).first();
  await expect(tarjeta.getByText("🔔")).toBeVisible({ timeout: 15_000 });
  const tomar = tarjeta.getByRole("button", { name: "Tomar mesa →" });
  if (await tomar.isVisible()) {
    await tomar.click();
    await expect(page.getByText("Mesa tomada").first()).toBeVisible();
  }
  await expect(tarjeta.getByText("YO")).toBeVisible({ timeout: 10_000 });

  // Atiende la llamada: el comensal lo ve al instante
  await tarjeta.getByRole("button", { name: "Atender llamada" }).click();
  await expect(comensal.getByText("Mozo atendió tu llamada")).toBeVisible({ timeout: 15_000 });

  // Cierra la mesa cuando se van
  await tarjeta.click();
  await page.getByRole("button", { name: "Cerrar mesa", exact: true }).click();
  await page.getByRole("button", { name: "Sí, cerrar mesa" }).click();
  await expect(page.getByText("✅ Mesa cerrada").first()).toBeVisible({ timeout: 10_000 });
  await expect(tarjeta.getByRole("button", { name: "Tomar mesa →" })).toBeVisible({ timeout: 10_000 });
  await expect(tarjeta.getByText("YO")).toHaveCount(0);

  // El comensal ve el cierre y califica su visita
  await expect(comensal.getByText("¿Cómo estuvo tu experiencia?")).toBeVisible({ timeout: 15_000 });
  await comensal.getByRole("button", { name: "★" }).nth(4).click();
  await expect(comensal.getByText(/Gracias por calificarnos/)).toBeVisible();

  await ctx.close();
  await comensalCtx.close();
});
