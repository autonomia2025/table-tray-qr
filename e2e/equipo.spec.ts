import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";

// Fase 1.7 — La pantalla Equipo usa las funciones del servidor: desactivar quita el acceso,
// y crear una cuenta crea también su ficha en el equipo.
const archivo = process.env.DEMO_CREDENCIALES ?? "privado/DEMO_CREDENCIALES.md";
const texto = fs.existsSync(archivo) ? fs.readFileSync(archivo, "utf-8") : "";
const dueno = texto.match(/^\| owner \| `([^`]+)` \| `([^`]+)` \|$/m);

test.skip(!texto, "Falta privado/DEMO_CREDENCIALES.md");
test.skip(({ isMobile }) => isMobile, "Pantalla de escritorio; se prueba una vez");

async function entrarComoDueno(page: Page) {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(dueno![1]);
  await page.locator('input[type="password"]').fill(dueno![2]);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/admin\/demo-tablio\//, { timeout: 15_000 });
  await page.goto("/admin/demo-tablio/equipo");
}

test("el dueño desactiva y vuelve a activar a un mozo", async ({ page }) => {
  await entrarComoDueno(page);
  const fila = page.locator("tr").filter({ hasText: "Diego (mozo)" });
  const interruptor = fila.getByRole("switch");
  await expect(interruptor).toBeChecked({ timeout: 15_000 });
  await interruptor.click();
  await expect(page.getByText("Diego (mozo) desactivado").first()).toBeVisible();
  await expect(interruptor).not.toBeChecked();
  await interruptor.click();
  await expect(page.getByText("Diego (mozo) activado").first()).toBeVisible();
  await expect(interruptor).toBeChecked();
});

test("el dueño crea la cuenta de un mozo y aparece en el equipo, vinculada", async ({ page }) => {
  test.skip(process.env.E2E_BASE_DATOS !== "local", "Solo en la base desechable (crea cuentas)");
  const nombre = `Mozo Prueba ${Date.now() % 100000}`;
  await entrarComoDueno(page);
  await page.getByRole("button", { name: /Agregar mozo/ }).click();
  await page.getByPlaceholder("Juan Pérez").fill(nombre);
  await page.getByPlaceholder("juan@email.com").fill(`mozo-${Date.now()}@demo.tablio.test`);
  await page.getByPlaceholder("Mínimo 6 caracteres").fill("clave-de-prueba-123");
  await page.getByRole("dialog").getByRole("button", { name: /Guardar|Crear|Agregar/ }).last().click();
  await expect(page.getByText("Cuenta creada con correo y contraseña").first()).toBeVisible({ timeout: 15_000 });
  const fila = page.locator("tr").filter({ hasText: nombre });
  await expect(fila).toBeVisible();
  await expect(fila.getByText("Vinculado")).toBeVisible();
});
