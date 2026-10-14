import { test, expect, devices, type Page, type Browser } from "@playwright/test";
import { cuenta, entrar, foto, linkMesa } from "./apoyo/recorrido";

// Fase 3.4 — La mesa en vivo, desde el celular del comensal: su pedido por estación con tiempo estimado,
// el aviso cuando algo queda listo, su nombre en la mesa, "otra ronda" con un toque y "lo de siempre".
test.skip(!cuenta("kitchen"), "Falta privado/DEMO_CREDENCIALES.md");
test.skip(({ isMobile }) => !isMobile, "Pantallas del comensal: se prueba una vez, en celular");

async function pedirYPagar(page: Page, mesa: number, productos: string[]) {
  await page.goto(linkMesa(mesa)!);
  for (const p of productos) {
    await page.getByText(p, { exact: true }).first().click();
    await page.getByRole("button", { name: /Agregar al carrito/ }).click();
  }
  await page.getByText("Ver pedido").click();
  await page.getByRole("button", { name: /Ir a pagar/ }).click();
  await page.getByRole("button", { name: /Pagar con tarjeta/ }).click();
  await expect(page.getByText("¡Pago listo!")).toBeVisible({ timeout: 20_000 });
  return (await page.getByText(/Tu pedido #\d+/).innerText()).match(/#(\d+)/)![1].padStart(3, "0");
}

async function mozoCierraMesa(browser: Browser, mesa: number) {
  const ctx = await browser.newContext({ ...devices["Pixel 7"] });
  const mozo = await ctx.newPage();
  await entrar(mozo, "waiter");
  await expect(mozo).toHaveURL(/\/mozo\/mesas/, { timeout: 15_000 });
  await mozo.locator("div.rounded-xl").filter({ has: mozo.locator("span.text-4xl", { hasText: new RegExp(`^${mesa}$`) }) }).first().click();
  await mozo.getByRole("button", { name: "Cerrar mesa", exact: true }).click();
  await mozo.getByRole("button", { name: "Sí, cerrar mesa" }).click();
  await expect(mozo.getByText("✅ Mesa cerrada").first()).toBeVisible({ timeout: 10_000 });
  await ctx.close();
}

test("el comensal ve su pedido por estación, recibe el aviso de lo listo y repite la ronda", async ({ page, browser }) => {
  test.setTimeout(150_000);
  const numero = await pedirYPagar(page, 2, ["Agua mineral", "Barros Luco"]);
  await page.getByRole("button", { name: "Ver estado de mi pedido" }).click();
  await expect(page.getByText(/Listo en aprox\. \d+ min/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Agua mineral.*Recibido en Barra/)).toBeVisible();

  // Se pone un nombre en la mesa
  await page.getByRole("button", { name: /En tu mesa/ }).click();
  await page.getByLabel("Tu nombre en la mesa").fill("Juan");
  await page.getByRole("button", { name: "Listo", exact: true }).click();
  await expect(page.getByRole("button", { name: /En tu mesa: Tú \(Juan\)/ })).toBeVisible({ timeout: 10_000 });
  await foto(page, "100-comensal-pedido-por-estacion");

  // La barra deja lista el agua: el comensal recibe el aviso y ve que la comida sigue en la cocina
  const kdsCtx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const kds = await kdsCtx.newPage();
  await entrar(kds, "kitchen");
  await expect(kds).toHaveURL(/\/kds\?branch=/, { timeout: 15_000 });
  await kds.getByRole("group", { name: "Estación" }).getByRole("button", { name: "Barra", exact: true }).click();
  const tarjeta = kds.locator("div.mb-3").filter({ hasText: `#${numero}` });
  await tarjeta.getByRole("button", { name: "ACEPTAR" }).click();
  await tarjeta.getByRole("button", { name: "LISTO" }).click();
  await kdsCtx.close();
  await expect(page.getByText(/Ya está listo: Agua mineral\. Sigue en Cocina: Barros Luco/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/🔔 Ya está listo: Agua mineral/).first()).toBeVisible();
  await foto(page, "101-comensal-aviso-agua-lista");

  // Otra ronda: el mismo pedido al carrito con un toque
  await page.getByRole("button", { name: /Otra ronda/ }).click();
  await expect(page).toHaveURL(/\/cart/, { timeout: 10_000 });
  await expect(page.getByText("Agua mineral").first()).toBeVisible();
  await expect(page.getByText("Barros Luco").first()).toBeVisible();
  await foto(page, "102-comensal-otra-ronda-en-el-carrito");
});

test("quien vuelve encuentra «lo de siempre» arriba de la carta", async ({ page, browser }) => {
  test.setTimeout(150_000);
  // Dos visitas distintas pidiendo un mote con huesillo
  for (let visita = 0; visita < 2; visita++) {
    await pedirYPagar(page, 2, ["Mote con huesillo"]);
    await mozoCierraMesa(browser, 2);
  }
  // Tercera visita: la carta lo ofrece de una
  await page.goto(linkMesa(2)!);
  const siempre = page.getByRole("region", { name: "⭐ Lo de siempre" });
  await expect(siempre).toBeVisible({ timeout: 20_000 });
  await expect(siempre.getByText("Mote con huesillo")).toBeVisible();
  await foto(page, "103-comensal-lo-de-siempre");
  await siempre.getByRole("button", { name: "Agregar Mote con huesillo" }).click();
  await expect(page.getByText("Mote con huesillo al carrito").first()).toBeVisible();
});
