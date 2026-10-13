import { test, expect, devices } from "@playwright/test";
import { cuenta, entrar, foto } from "./apoyo/recorrido";

// Fase 1.9 — El mozo toma un pedido con opciones desde su celular; el servidor calcula el precio.
// En prepago el pedido queda esperando el cobro, y la cocina lo ve como "esperando pago".

test.skip(!cuenta("waiter"), "Falta privado/DEMO_CREDENCIALES.md");
// Una sola vez (en celular, que es donde trabaja el mozo).
test.skip(({ isMobile }) => !isMobile, "Se prueba una vez, en celular");

test("el mozo toma un pedido con opciones obligatorias y extras; la cocina lo ve esperando pago", async ({ page, browser }) => {
  test.setTimeout(90_000);
  await entrar(page, "waiter");
  await expect(page).toHaveURL(/\/mozo\/mesas/, { timeout: 15_000 });

  const tarjeta = page.locator("div.rounded-xl").filter({ has: page.locator("span.text-4xl", { hasText: /^8$/ }) }).first();
  await expect(tarjeta).toBeVisible({ timeout: 15_000 });
  // Lo principal es el QR: tomar el pedido a mano es una opción secundaria, dentro de la mesa
  await expect(tarjeta.getByRole("button", { name: /Tomar pedido/ })).toHaveCount(0);
  await tarjeta.click();
  const tomarMesa = page.getByRole("dialog").getByRole("button", { name: "Tomar mesa", exact: true });
  if (await tomarMesa.isVisible()) await tomarMesa.click();
  await expect(page.getByRole("button", { name: /Tomar pedido a mano/ })).toBeVisible({ timeout: 10_000 });
  await foto(page, "01-mozo-mesa-tomar-pedido-a-mano");
  await page.getByRole("button", { name: /Tomar pedido a mano/ }).click();
  await expect(page.getByText(/Pedido manual · Mesa 8/)).toBeVisible({ timeout: 10_000 });
  await foto(page, "02-mozo-carta");

  // Hamburguesa: el punto de la carne es obligatorio
  await page.getByRole("button", { name: /Platos/ }).click();
  await page.getByRole("button", { name: "Agregar Hamburguesa Tablio" }).click();
  const agregarBloqueado = page.getByRole("button", { name: /Elige punto de la carne/ });
  await expect(agregarBloqueado).toBeDisabled();
  await foto(page, "03-mozo-opciones-obligatorias");
  await page.getByRole("button", { name: /Tres cuartos/ }).click();
  await page.getByRole("button", { name: /Palta/ }).click();
  await page.getByPlaceholder("Nota para cocina (opcional)").fill("sin cebolla");
  await foto(page, "04-mozo-opciones-elegidas");
  await page.getByRole("button", { name: /^Agregar · / }).click();

  // Agua: sin opciones, se agrega directo
  await page.getByRole("button", { name: /Sin alcohol/ }).click();
  await page.getByRole("button", { name: "Agregar Agua mineral" }).click();

  await page.getByRole("button", { name: "Ver pedido" }).click();
  await expect(page.getByText("Tres cuartos · Palta")).toBeVisible();
  await expect(page.getByText('"sin cebolla"')).toBeVisible();
  await foto(page, "05-mozo-resumen-pedido");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: /Confirmar pedido · / }).click();
  const aviso = page.getByText(/Pedido #\d+ creado · /).first();
  await expect(aviso).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/cóbralo para que pase a cocina/).first()).toBeVisible();
  // La mesa dice que hay que cobrar (no "en cocina")
  await expect(tarjeta.getByText("💳 Por cobrar")).toBeVisible({ timeout: 10_000 });
  await foto(page, "06-mozo-pedido-creado");

  // La cocina (pantalla fija de escritorio) lo ve como "esperando pago", no para preparar
  const cocinaCtx = await browser.newContext({ ...devices["Desktop Chrome"] });
  const kds = await cocinaCtx.newPage();
  await entrar(kds, "kitchen");
  await expect(kds).toHaveURL(/\/kds\?branch=/, { timeout: 15_000 });
  await expect(kds.getByText(/esperando pago/)).toBeVisible({ timeout: 15_000 });
  await foto(kds, "07-cocina-esperando-pago");
  await cocinaCtx.close();

  // El dueño lo ve marcado "Por cobrar", con las opciones elegidas
  const duenoCtx = await browser.newContext({ ...devices["Desktop Chrome"] });
  const admin = await duenoCtx.newPage();
  await entrar(admin, "owner");
  await expect(admin).toHaveURL(/\/admin\/demo-tablio\//, { timeout: 15_000 });
  await admin.goto("/admin/demo-tablio/pedidos");
  await expect(admin.getByText("Por cobrar").first()).toBeVisible({ timeout: 15_000 });
  await expect(admin.getByText("Tres cuartos · Palta").first()).toBeVisible();
  await duenoCtx.close();
});
