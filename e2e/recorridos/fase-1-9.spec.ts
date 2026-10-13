import { test, expect, devices } from "@playwright/test";
import { entrar, foto, linkMesa } from "../apoyo/recorrido";

// Recorrido con fotos de la fase 1.9 (solo con RECORRIDO=<carpeta>): el comensal pide con opciones
// y el servidor calcula el precio; el dueño ve los pedidos del mozo y del comensal.
test.skip(!process.env.RECORRIDO, "Solo para el recorrido con fotos");
test.skip(({ isMobile }) => !isMobile, "Recorrido en celular");

test("recorrido 1.9: comensal con opciones y vista del dueño", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await page.goto(linkMesa(3)!);
  await expect(page.getByText("Piscola", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await page.getByText("Piscola", { exact: true }).first().click();
  await expect(page.getByText("Pisco 40° premium")).toBeVisible({ timeout: 10_000 });
  await foto(page, "08-comensal-opciones-obligatorias");
  await page.getByText("Pisco 40° premium").click();
  await page.getByText("Ginger ale").click();
  await foto(page, "09-comensal-opciones-elegidas");
  await page.getByRole("button", { name: /Agregar al carrito/ }).click();
  await page.getByText("Ver pedido").click();
  await foto(page, "10-comensal-carrito");
  await page.getByRole("button", { name: /Ir a pagar/ }).click();
  await page.getByRole("button", { name: /Pagar con tarjeta/ }).click();
  await expect(page.getByText("¡Pago listo!")).toBeVisible({ timeout: 20_000 });
  await foto(page, "11-comensal-pago-listo");

  const ctx = await browser.newContext({ ...devices["Desktop Chrome"] });
  const admin = await ctx.newPage();
  await entrar(admin, "owner");
  await expect(admin).toHaveURL(/\/admin\/demo-tablio\//, { timeout: 15_000 });
  await admin.goto("/admin/demo-tablio/pedidos");
  await expect(admin.getByText(/Mesa 3|#0/).first()).toBeVisible({ timeout: 15_000 });
  await foto(admin, "12-dueno-pedidos");
  await ctx.close();
});
