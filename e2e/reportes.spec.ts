import { test, expect } from "@playwright/test";
import { cuenta, entrar, foto } from "./apoyo/recorrido";

// Fase 3.6 — El inicio del dueño cuenta cómo le fue al local y los reportes los calcula la base.
// El demo trae 4 semanas de ventas de ejemplo (_sembrar_historia_demo), así que hay historia que contar.
test.skip(!cuenta("owner"), "Falta privado/DEMO_CREDENCIALES.md");
test.skip(({ isMobile }) => isMobile, "Se prueba una vez, en escritorio");

test("el dueño entra y ve en palabras cómo le fue; en reportes ve ventas, platos, cocina y horas", async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  await entrar(page, "owner");

  // Entra directo al inicio, que cuenta la historia del último día con ventas
  await expect(page).toHaveURL(/\/admin\/demo-tablio\/inicio/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: /Así le fue a/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Hoy llevas")).toBeVisible();
  const historia = page.locator("section").filter({ has: page.getByRole("heading", { name: /Lo de anoche|Tu último día con ventas/ }) });
  await expect(historia).toBeVisible();
  await expect(historia.getByText(/vendiste \$/)).toBeVisible();
  await expect(historia.getByText(/plato estrella/)).toBeVisible();
  // La chorrillana de ejemplo viene lenta: el inicio lo avisa
  await expect(page.getByText(/Chorrillana para 2.*está tardando/)).toBeVisible();
  await foto(page, "100-dueno-inicio");

  // Reportes: últimos 30 días
  await page.getByRole("link", { name: "Ver reportes" }).click();
  await expect(page).toHaveURL(/\/reportes/);
  await page.getByRole("button", { name: "30 días" }).click();
  await expect(page.getByRole("button", { name: "30 días" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Ventas por día")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Cómo te pagaron")).toBeVisible();
  await foto(page, "101-reportes-resumen");

  await page.getByRole("tab", { name: "Platos" }).click();
  await expect(page.getByText("Lo que más vendes")).toBeVisible();
  await expect(page.getByText("Chorrillana para 2").first()).toBeVisible();
  await foto(page, "102-reportes-platos");

  await page.getByRole("tab", { name: "Cocina" }).click();
  await expect(page.getByText("Qué traba la cocina")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Chorrillana para 2" })).toBeVisible();
  await foto(page, "103-reportes-cocina");

  await page.getByRole("tab", { name: "Horas" }).click();
  await expect(page.getByText("Tu momento más fuerte")).toBeVisible();
  await foto(page, "104-reportes-horas");

  await page.getByRole("tab", { name: "Mesas y zonas" }).click();
  await expect(page.getByText("Por zona")).toBeVisible();
  await foto(page, "105-reportes-zonas");

  // En el celular del dueño, el inicio se lee igual de bien
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/demo-tablio/inicio");
  await expect(page.getByRole("heading", { name: /Así le fue a/ })).toBeVisible({ timeout: 15_000 });
  await foto(page, "106-dueno-inicio-celular");
  await ctx.close();
});

test("la caja no ve el inicio ni los reportes: entra directo a la caja", async ({ browser }) => {
  test.skip(!cuenta("cashier"), "Falta la cuenta de caja");
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await entrar(page, "cashier");
  await expect(page).toHaveURL(/\/caja/, { timeout: 15_000 });
  await page.goto("/admin/demo-tablio/reportes");
  await expect(page.getByText("Lo que más vendes")).toHaveCount(0);
  await ctx.close();
});
