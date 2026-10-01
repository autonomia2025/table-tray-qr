import { test, expect } from "@playwright/test";

// Comprueba la app contra la base migrada usando el local de prueba que venía de Lovable.
// Solo lee: no crea pedidos ni cambia nada.
// E2E_SLUG y E2E_QR_TOKEN se pasan por variable de entorno (el token de mesa no va en el código).
const slug = process.env.E2E_SLUG ?? "la-parrillada";
const token = process.env.E2E_QR_TOKEN;
const proyecto = process.env.E2E_SUPABASE_REF ?? "iznwvklzmyhzalabgfxl";

test("la portada del local carga desde la base nueva", async ({ page }) => {
  await page.goto(`/${slug}`);
  await expect(page.getByText(/la parrillada/i).first()).toBeVisible();
});

test("la carta de la mesa muestra productos y fotos del almacenamiento nuevo", async ({ page }) => {
  test.skip(!token, "Falta E2E_QR_TOKEN");
  const fotos: string[] = [];
  page.on("response", (r) => {
    if (r.url().includes("/storage/v1/object/public/menu-images/")) fotos.push(`${r.status()} ${r.url()}`);
  });
  await page.goto(`/${slug}/menu?t=${token}`);
  await expect(page.locator("text=/\\$\\s?[0-9.]+/").first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(fotos.length).toBeGreaterThan(0);
  for (const f of fotos) {
    expect(f).toContain(proyecto);
    expect(f.startsWith("200")).toBeTruthy();
  }
});
