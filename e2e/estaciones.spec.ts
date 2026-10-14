import { test, expect, devices, type Page } from "@playwright/test";
import { cuenta, entrar, foto, linkMesa } from "./apoyo/recorrido";

// Fase 3.2 — Cocina y barra por separado: cada pantalla recibe solo lo suyo y lo avanza sola; el mozo
// lleva la bebida sin esperar la comida. Y si se corta internet, la pantalla lo avisa y al volver
// recupera lo que llegó mientras tanto.
test.skip(!cuenta("kitchen"), "Falta privado/DEMO_CREDENCIALES.md");
test.skip(({ isMobile }) => isMobile, "Pantallas de cocina: se prueba una vez, en escritorio");

async function comensalPaga(page: Page, mesa: number, productos: string[]) {
  await page.goto(linkMesa(mesa)!);
  for (const p of productos) {
    await page.getByText(p, { exact: true }).first().click();
    await page.getByRole("button", { name: /Agregar al carrito/ }).click();
  }
  await page.getByText("Ver pedido").click();
  await page.getByRole("button", { name: /Ir a pagar/ }).click();
  await page.getByRole("button", { name: /Pagar con tarjeta/ }).click();
  await expect(page.getByText("¡Pago listo!")).toBeVisible({ timeout: 20_000 });
  return (await page.getByText(/Tu pedido #\d+/).innerText()).match(/#(\d+)/)![1];
}

async function pantallaCocina(page: Page, estacion: "Barra" | "Cocina") {
  await entrar(page, "kitchen");
  await expect(page).toHaveURL(/\/kds\?branch=/, { timeout: 15_000 });
  await page.getByRole("group", { name: "Estación" }).getByRole("button", { name: estacion, exact: true }).click();
  await expect(page.getByRole("button", { name: estacion, exact: true })).toHaveAttribute("aria-pressed", "true");
}

test("la barra y la cocina reciben solo lo suyo; el mozo lleva la bebida sin esperar la comida", async ({ browser }) => {
  test.setTimeout(150_000);
  const escritorio = { viewport: { width: 1280, height: 720 } };

  // Un cliente pide un agua y un Barros Luco en la mesa 6
  const celCtx = await browser.newContext({ ...devices["Pixel 7"] });
  const numero = await comensalPaga(await celCtx.newPage(), 6, ["Agua mineral", "Barros Luco"]);

  // Pantalla de la barra: solo el agua
  const barraCtx = await browser.newContext(escritorio);
  const barra = await barraCtx.newPage();
  await pantallaCocina(barra, "Barra");
  const enBarra = barra.locator("div.mb-3").filter({ hasText: `#${numero.padStart(3, "0")}` });
  await expect(enBarra.getByText("1× Agua mineral")).toBeVisible({ timeout: 15_000 });
  await expect(enBarra.getByText(/Barros Luco/)).toHaveCount(0);
  await foto(barra, "80-barra-solo-bebidas");

  // Pantalla de la cocina: solo el Barros Luco
  const cocinaCtx = await browser.newContext(escritorio);
  const cocina = await cocinaCtx.newPage();
  await pantallaCocina(cocina, "Cocina");
  const enCocina = cocina.locator("div.mb-3").filter({ hasText: `#${numero.padStart(3, "0")}` });
  await expect(enCocina.getByText("1× Barros Luco")).toBeVisible({ timeout: 15_000 });
  await expect(enCocina.getByText(/Agua mineral/)).toHaveCount(0);
  await foto(cocina, "81-cocina-solo-comida");

  // La barra acepta y deja lista el agua; la cocina sigue con lo suyo
  await enBarra.getByRole("button", { name: "ACEPTAR" }).click();
  await enBarra.getByRole("button", { name: "LISTO" }).click();
  await expect(enBarra.getByRole("button", { name: /ENTREGADO/ })).toBeVisible({ timeout: 10_000 });
  await foto(barra, "82-barra-agua-lista");
  await expect(enCocina.getByRole("button", { name: "ACEPTAR" })).toBeVisible();

  // El mozo ve "Listo en Barra" y lleva el agua; la comida sigue en la cocina
  const mozoCtx = await browser.newContext({ ...devices["Pixel 7"] });
  const mozo = await mozoCtx.newPage();
  await entrar(mozo, "waiter");
  await expect(mozo).toHaveURL(/\/mozo\/mesas/, { timeout: 15_000 });
  const tarjeta = mozo.locator("div.rounded-xl").filter({ has: mozo.locator("span.text-4xl", { hasText: /^6$/ }) }).first();
  await expect(tarjeta.getByText(/Listo en Barra/)).toBeVisible({ timeout: 15_000 });
  await expect(tarjeta.getByText(/lo demás sigue en preparación/)).toBeVisible();
  await foto(mozo, "83-mozo-listo-en-barra");
  await tarjeta.getByRole("button", { name: "Entregado ✓" }).click();
  await expect(mozo.getByText("✓ Entregado").first()).toBeVisible({ timeout: 10_000 });
  await expect(enBarra).toHaveCount(0, { timeout: 15_000 });
  await expect(enCocina.getByText("1× Barros Luco")).toBeVisible();

  // Se corta internet en la cocina: lo avisa en grande
  await cocinaCtx.setOffline(true);
  await expect(cocina.getByRole("alert").getByText(/Sin conexión/)).toBeVisible({ timeout: 10_000 });
  await foto(cocina, "84-cocina-sin-conexion");
  // Mientras tanto, otro cliente pide unas empanaditas
  const otro = await comensalPaga(await celCtx.newPage(), 7, ["Empanaditas de queso (6)"]);
  // Vuelve internet: la cocina recupera sola lo que llegó
  await cocinaCtx.setOffline(false);
  await expect(cocina.getByRole("alert")).toHaveCount(0, { timeout: 15_000 });
  await expect(cocina.locator("div.mb-3").filter({ hasText: `#${otro.padStart(3, "0")}` }).getByText(/Empanaditas/)).toBeVisible({ timeout: 20_000 });
  await foto(cocina, "85-cocina-recupera-al-volver");

  await Promise.all([celCtx.close(), barraCtx.close(), cocinaCtx.close(), mozoCtx.close()]);
});
