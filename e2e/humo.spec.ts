import { test, expect } from "@playwright/test";

// Pruebas de humo: solo abren pantallas. No escriben nada en la base.

test("el login carga con email y contraseña", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await expect(page.locator('input[type="password"]')).toBeVisible();
});

test("la ruta raíz muestra el login", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('input[type="email"]')).toBeVisible();
});

test("una ruta inexistente no rompe la app", async ({ page }) => {
  const errores: string[] = [];
  page.on("pageerror", (e) => errores.push(e.message));
  await page.goto("/esta-ruta/no/existe");
  await expect(page.locator("body")).not.toBeEmpty();
  expect(errores).toEqual([]);
});

test("el KDS sin sesión pide iniciar sesión", async ({ page }) => {
  await page.goto("/kds");
  await expect(page.getByRole("button")).not.toHaveCount(0);
});

test("el panel del dueño sin sesión manda al login", async ({ page }) => {
  await page.goto("/admin/local-que-no-existe/mesas");
  await expect(page).toHaveURL(/\/login$/);
});

test("el login viejo del mozo lleva al login único", async ({ page }) => {
  await page.goto("/mozo/login");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator('input[type="email"]')).toBeVisible();
});
