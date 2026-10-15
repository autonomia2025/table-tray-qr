import { test, expect, devices } from "@playwright/test";
import { cuenta, entrar, liberarMesa, foto, ingresarCodigo, linkMesa } from "./apoyo/recorrido";

// Fase 2.B — "Pagar al mozo": el comensal pide sin pagar en la app, el mozo cobra en efectivo
// (con vuelto) y recién entonces el pedido llega a la cocina. Tres pantallas a la vez.
test.skip(!cuenta("waiter"), "Falta privado/DEMO_CREDENCIALES.md");
test.skip(({ isMobile }) => !isMobile, "Se prueba una vez, en celular");

test("pagar al mozo en efectivo: el pedido pasa a cocina recién al registrar el cobro", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await liberarMesa(9);
  // Comensal en la mesa 9
  await page.goto(linkMesa(9)!);
  await page.getByText("Agua mineral", { exact: true }).first().click();
  await page.getByRole("button", { name: /Agregar al carrito/ }).click();
  await page.getByText("Ver pedido").click();
  await page.getByRole("button", { name: /Ir a pagar/ }).click();
  await expect(page.getByText("🔒 Precio asegurado por 10 minutos")).toBeVisible({ timeout: 20_000 });
  await foto(page, "40-comensal-opciones-de-pago");
  await page.getByRole("button", { name: /Prefiero pagarle al mozo/ }).click();
  // Para pedir sin pagar, la app pide el código impreso en la mesa (fase 3.5)
  await ingresarCodigo(page, 9);
  await expect(page.getByText("¡Pedido enviado!")).toBeVisible({ timeout: 20_000 });
  await foto(page, "41-comensal-pedido-enviado");
  await page.getByRole("button", { name: "Ver estado de mi pedido" }).click();
  await expect(page.getByText("💳 Por pagar al mozo").first()).toBeVisible({ timeout: 15_000 });
  await foto(page, "42-comensal-por-pagar");

  // Cocina: todavía no lo prepara
  const cocinaCtx = await browser.newContext({ ...devices["Desktop Chrome"] });
  const kds = await cocinaCtx.newPage();
  await entrar(kds, "kitchen");
  await expect(kds.getByText(/esperando pago/)).toBeVisible({ timeout: 20_000 });

  // Mozo: cobra en efectivo con vuelto
  const mozoCtx = await browser.newContext({ ...devices["Pixel 7"] });
  const mozo = await mozoCtx.newPage();
  await entrar(mozo, "waiter");
  await expect(mozo).toHaveURL(/\/mozo\/mesas/, { timeout: 15_000 });
  const tarjeta = mozo.locator("div.rounded-xl").filter({ has: mozo.locator("span.text-4xl", { hasText: /^9$/ }) }).first();
  await expect(tarjeta.getByText("💳 Por cobrar")).toBeVisible({ timeout: 15_000 });
  await foto(mozo, "43-mozo-mesa-por-cobrar");
  await tarjeta.getByRole("button", { name: "Cobrar" }).click();
  await expect(mozo.getByText(/Por cobrar: \$/)).toBeVisible({ timeout: 10_000 });
  await mozo.getByRole("button", { name: "💵 Efectivo" }).click();
  await mozo.getByLabel("Recibido en efectivo (opcional)").fill("10000");
  await expect(mozo.getByText(/Vuelto: \$/)).toBeVisible();
  await foto(mozo, "44-mozo-cobro-efectivo");
  await mozo.getByRole("button", { name: "Registrar cobro" }).click();
  await expect(mozo.getByText(/✅ Cobrado \$/).first()).toBeVisible({ timeout: 15_000 });
  await foto(mozo, "45-mozo-cobrado");

  // El comensal ve que ya está pagado y la cocina lo recibe para preparar
  await expect(page.getByText("Recibido ✓").first()).toBeVisible({ timeout: 20_000 });
  await expect(kds.getByText("Mesa 9").first()).toBeVisible({ timeout: 20_000 });
  await foto(kds, "46-cocina-recibe-pagado");
  await cocinaCtx.close();
  await mozoCtx.close();
});
