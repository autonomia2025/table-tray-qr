import { test, expect } from "@playwright/test";
import { cuenta, entrar, foto } from "./apoyo/recorrido";

// Fase 5.1 — Alta del local: el superadmin crea un local completo y recibe el enlace para el dueño; el dueño
// abre el enlace, elige su contraseña y queda dentro de su panel. Solo en la base desechable (crea un local).
test.skip(process.env.E2E_BASE_DATOS !== "local", "Solo en la base desechable (crea un local de verdad)");
test.skip(({ isMobile }) => isMobile, "El superadmin trabaja en escritorio; el dueño se prueba en celular abajo");
test.skip(!cuenta("superadmin"), "Falta privado/DEMO_CREDENCIALES.md");

test("el superadmin da de alta un local y el dueño lo activa con su propia contraseña", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const id = Date.now().toString(36);
  await entrar(page, "superadmin");
  await expect(page).toHaveURL(/\/superadmin/, { timeout: 15_000 });
  await page.goto("/superadmin/tenants");
  await page.getByRole("button", { name: "Nuevo" }).click();

  await page.getByLabel("Nombre del local").fill(`La Picá de Prueba ${id}`);
  await expect(page.getByLabel("Dirección en Tablio")).toHaveValue(`la-pica-de-prueba-${id}`);
  await page.getByLabel("Nombre del dueño").fill("Carla Rojas");
  await page.getByLabel("Teléfono").fill("+56 9 1234 5678");
  await page.getByLabel("Correo del dueño").fill(`carla-${id}@demo.tablio.test`);
  await page.getByLabel("Mesas").fill("8");
  await foto(page, "180-superadmin-dar-de-alta");
  await page.getByRole("button", { name: "Crear local" }).click();

  const enlace = page.getByTestId("enlace-activacion");
  await expect(enlace).toBeVisible({ timeout: 15_000 });
  const url = (await enlace.innerText()).trim();
  expect(url).toMatch(/\/activar\/[0-9a-f]{48}$/);
  await foto(page, "181-superadmin-enlace-para-el-dueno");
  await page.getByRole("button", { name: "Listo" }).click();

  // El dueño abre el enlace en su celular
  const cel = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  const dueno = await cel.newPage();
  await dueno.goto(new URL(url).pathname);
  await expect(dueno.getByRole("heading", { name: `Activa La Picá de Prueba ${id}` })).toBeVisible({ timeout: 15_000 });
  await expect(dueno.getByLabel("Tu nombre")).toHaveValue("Carla Rojas");
  await dueno.getByLabel("Elige tu contraseña").fill("mi-clave-del-local");
  await dueno.getByLabel("Repítela").fill("mi-clave-del-local");
  await foto(dueno, "182-dueno-activa-su-local");
  await dueno.getByRole("button", { name: "Activar mi local" }).click();
  await expect(dueno.getByText(/está activado/)).toBeVisible({ timeout: 15_000 });
  await expect(dueno).toHaveURL(new RegExp(`/admin/la-pica-de-prueba-${id}/`), { timeout: 15_000 });
  await foto(dueno, "183-dueno-en-su-panel");

  // El mismo enlace ya no sirve
  const otro = await cel.newPage();
  await otro.goto(new URL(url).pathname);
  await expect(otro.getByText("Este local ya está activado")).toBeVisible({ timeout: 15_000 });
  await cel.close();

  // El superadmin ve que el dueño activó su cuenta
  await page.reload();
  await page.getByPlaceholder("Buscar cliente...").fill(id);
  await page.getByRole("button", { name: "Ver detalle" }).first().click();
  await expect(page.getByTestId("activacion-local").getByText(/Activado el/)).toBeVisible({ timeout: 15_000 });
  await foto(page, "184-superadmin-local-activado");
});
