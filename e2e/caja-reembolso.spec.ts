import { test, expect } from "@playwright/test";
import { cuenta, entrar, foto, linkMesa } from "./apoyo/recorrido";

// Fase 2.C — La caja reembolsa un pago con motivo; queda registrado y no se puede repetir de más.
test.skip(!cuenta("cashier"), "Falta privado/DEMO_CREDENCIALES.md");
test.skip(({ isMobile }) => isMobile, "Pantalla de escritorio; se prueba una vez");

test("la caja reembolsa un pago con motivo y queda registrado", async ({ page, browser }) => {
  test.setTimeout(90_000);
  // Un comensal paga en la mesa 10
  const cel = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  const comensal = await cel.newPage();
  await comensal.goto(linkMesa(10)!);
  await comensal.getByText("Agua mineral", { exact: true }).first().click();
  await comensal.getByRole("button", { name: /Agregar al carrito/ }).click();
  await comensal.getByText("Ver pedido").click();
  await comensal.getByRole("button", { name: /Ir a pagar/ }).click();
  await comensal.getByRole("button", { name: /Pagar con tarjeta/ }).click();
  await expect(comensal.getByText("¡Pago listo!")).toBeVisible({ timeout: 20_000 });
  await cel.close();

  // La cajera lo reembolsa
  await entrar(page, "cashier");
  await expect(page).toHaveURL(/\/admin\/demo-tablio\/caja/, { timeout: 15_000 });
  const fila = page.locator("tr").filter({ has: page.getByRole("button", { name: /Reembolsar/ }) }).first();
  await expect(fila).toBeVisible({ timeout: 20_000 });
  await foto(page, "50-caja-ingresos");
  await fila.getByRole("button", { name: /Reembolsar/ }).click();
  await page.getByPlaceholder("Ej: producto no entregado").fill("El cliente pidió dos veces por error");
  await foto(page, "51-caja-reembolso-motivo");
  await page.getByRole("button", { name: "Confirmar reembolso" }).click();
  await expect(page.getByText("Reembolso registrado").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Reembolsado").first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole("tab", { name: "Reembolsos" }).click();
  await expect(page.getByText("El cliente pidió dos veces por error")).toBeVisible();
  await foto(page, "52-caja-reembolsos-registrados");
});
