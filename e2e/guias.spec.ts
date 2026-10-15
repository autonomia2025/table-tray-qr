import { test, expect, devices } from "@playwright/test";
import { cuenta, entrar, foto } from "./apoyo/recorrido";

// Fase 5.5 — Guías de capacitación: cada rol abre su guía con el botón "?" y la puede imprimir.
test.skip(!cuenta("waiter"), "Falta privado/DEMO_CREDENCIALES.md");
test.skip(({ isMobile }) => isMobile, "Se prueban las tres pantallas una vez");

test("el mozo, el dueño y la cocina abren su guía, y se puede imprimir", async ({ page, browser }) => {
  test.setTimeout(90_000);
  // Mozo, en su celular
  const cel = await browser.newContext({ ...devices["Pixel 7"] });
  const mozo = await cel.newPage();
  await entrar(mozo, "waiter");
  await expect(mozo).toHaveURL(/\/mozo\/mesas/, { timeout: 15_000 });
  await mozo.getByRole("button", { name: "Cómo se usa" }).click();
  await expect(mozo.getByRole("dialog").getByText("Cómo se usa: Mozo")).toBeVisible();
  await expect(mozo.getByRole("dialog").getByText("Lleva lo que está listo")).toBeVisible();
  await foto(mozo, "210-mozo-guia");
  await cel.close();

  // Dueño
  await entrar(page, "owner");
  await expect(page).toHaveURL(/\/admin\/demo-tablio\//, { timeout: 15_000 });
  await page.getByRole("button", { name: "Cómo se usa" }).first().click();
  await expect(page.getByRole("dialog").getByText("Cómo se usa: Dueño o administrador")).toBeVisible();
  await foto(page, "211-dueno-guia");

  // La cocina
  const kdsCtx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const kds = await kdsCtx.newPage();
  await entrar(kds, "kitchen");
  await expect(kds).toHaveURL(/\/kds/, { timeout: 15_000 });
  await kds.getByRole("button", { name: "Cómo se usa" }).click();
  await expect(kds.getByRole("dialog").getByText("Cómo se usa: Cocina y barra")).toBeVisible();
  await foto(kds, "212-cocina-guia");
  await kdsCtx.close();

  // La guía imprimible (sin sesión: es la misma para todos los locales)
  const libre = await browser.newContext();
  const ayuda = await libre.newPage();
  await ayuda.goto("/ayuda/caja");
  await expect(ayuda.getByRole("heading", { name: "Guía para caja" })).toBeVisible({ timeout: 15_000 });
  await expect(ayuda.getByText("Cerrar la caja")).toBeVisible();
  await foto(ayuda, "213-guia-imprimible-caja");
  await libre.close();
});
