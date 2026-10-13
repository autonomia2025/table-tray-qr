import { test, expect } from "@playwright/test";
import fs from "node:fs";

// Fase 1.8 — Los gastos de Tablio se guardan en la base: siguen ahí al recargar o al entrar
// desde otro computador (antes vivían en el navegador y se perdían).
const archivo = process.env.DEMO_CREDENCIALES ?? "privado/DEMO_CREDENCIALES.md";
const texto = fs.existsSync(archivo) ? fs.readFileSync(archivo, "utf-8") : "";
const finanzas = texto.match(/^\| finanzas \| `([^`]+)` \| `([^`]+)` \|$/m);

test.skip(!texto, "Falta privado/DEMO_CREDENCIALES.md");
test.skip(({ isMobile }) => isMobile, "Pantalla de escritorio; se prueba una vez");

test("finanzas registra un gasto, sigue ahí al recargar y lo borra", async ({ page }) => {
  test.setTimeout(60_000); // primera prueba tras publicar: el servidor puede estar despertando
  const descripcion = `Gasto de prueba ${Date.now()}`;
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(finanzas![1]);
  await page.locator('input[type="password"]').fill(finanzas![2]);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/finanzas\//, { timeout: 15_000 });
  await page.goto("/finanzas/costos");

  await expect(page.getByPlaceholder("Descripción")).toBeVisible({ timeout: 20_000 });
  await page.getByPlaceholder("Descripción").fill(descripcion);
  await page.getByPlaceholder("Monto en pesos").fill("15000");
  await page.getByRole("button", { name: /Agregar gasto/ }).click();
  await expect(page.getByText("Gasto agregado").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(descripcion)).toBeVisible({ timeout: 15_000 });

  // En una pestaña nueva (sin nada guardado en el navegador) sigue ahí
  const otra = await page.context().newPage();
  await otra.goto("/finanzas/costos");
  const fila = otra.locator("tr").filter({ hasText: descripcion });
  await expect(fila).toBeVisible({ timeout: 15_000 });
  await fila.getByRole("button").click();
  await expect(otra.getByText(descripcion)).toHaveCount(0);
});
