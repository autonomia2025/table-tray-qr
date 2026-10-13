import { test, expect } from "@playwright/test";
import { cuenta, entrar, foto } from "./apoyo/recorrido";

// Fase 1.10 — La caja la manejan la caja, el encargado y el dueño. Un día cerrado queda bloqueado.
test.skip(!cuenta("cashier"), "Falta privado/DEMO_CREDENCIALES.md");
test.skip(({ isMobile }) => isMobile, "Pantalla de escritorio; se prueba una vez");

test("la caja concilia y cierra el día; después queda bloqueado", async ({ page }) => {
  test.setTimeout(60_000);
  await entrar(page, "cashier");
  await expect(page).toHaveURL(/\/admin\/demo-tablio\/caja/, { timeout: 15_000 });
  await page.getByRole("tab", { name: "Conciliación" }).click();
  await foto(page, "30-caja-conciliacion");

  const cerrar = page.getByRole("button", { name: "Cerrar caja del día" });
  if (await cerrar.isEnabled()) {
    await page.getByRole("button", { name: /Generar conciliación/ }).click();
    await expect(page.getByText("Conciliación actualizada").first()).toBeVisible({ timeout: 15_000 });
    await cerrar.click();
    await expect(page.getByText("Caja cerrada").first()).toBeVisible({ timeout: 15_000 });
  }
  await expect(page.getByText("🔒 Caja cerrada")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Este día ya está cerrado y no se puede cambiar.")).toBeVisible();
  await expect(cerrar).toBeDisabled();
  await foto(page, "31-caja-dia-cerrado");
});

test("el mozo no puede entrar a la caja", async ({ page }) => {
  await entrar(page, "waiter");
  await expect(page).toHaveURL(/\/mozo\/mesas/, { timeout: 15_000 });
  await page.goto("/admin/demo-tablio/caja");
  await expect(page).not.toHaveURL(/\/caja/, { timeout: 15_000 });
  await foto(page, "32-mozo-sin-acceso-a-caja");
});
