import { test, expect } from "@playwright/test";
import { cuenta, entrar, foto } from "./apoyo/recorrido";

// Fase 5.4 — Salud de la plataforma: el superadmin ve el estado, la historia por hora, la plata en
// movimiento, las auditorías, los locales y los relojes automáticos.
test.skip(!cuenta("superadmin"), "Falta privado/DEMO_CREDENCIALES.md");
test.skip(({ isMobile }) => isMobile, "Pantalla de escritorio; se prueba una vez");

test("el superadmin ve la salud de la plataforma", async ({ page }) => {
  await entrar(page, "superadmin");
  await expect(page).toHaveURL(/\/superadmin/, { timeout: 15_000 });
  await page.getByRole("button", { name: "Salud" }).first().click();
  const salud = page.getByTestId("salud-plataforma");
  await expect(salud.getByText(/Todo en orden|Hay cosas para revisar|Hay un problema/)).toBeVisible({ timeout: 20_000 });
  await expect(salud.getByText("Revisar pagos que no vuelven")).toBeVisible();
  await expect(salud.getByText("Auditorías automáticas (hallazgos)")).toBeVisible();
  await foto(page, "200-superadmin-salud");
  await page.getByRole("button", { name: "Revisar ahora" }).click();
  await expect(salud.getByText(/Revisado:/)).toBeVisible();
});
