import { test, expect, devices } from "@playwright/test";
import { cuenta, entrar, entregarBoletasDelMozo, foto, ingresarCodigo, linkMesa } from "./apoyo/recorrido";

// Fase 4.3 (etapa 1) — Transferencia y boleta del local. El dueño anota sus datos para transferir; el mozo
// cobra por transferencia mostrándolos; la boleta (del sistema del local) queda pendiente y se le recuerda
// al mozo y a la caja hasta que alguien la marca como entregada.
test.skip(!cuenta("waiter"), "Falta privado/DEMO_CREDENCIALES.md");
test.skip(({ isMobile }) => isMobile, "Varias pantallas a la vez; se prueba una vez");

const DATOS = "Banco Demo · Cuenta Corriente 0012345\nRUT 76.000.000-0 · Demo Tablio SpA";

test("cobro por transferencia: el mozo muestra los datos y la boleta queda por entregar hasta marcarla", async ({ page, browser }) => {
  test.setTimeout(150_000);
  await entregarBoletasDelMozo();

  // El dueño anota los datos para transferir (Sucursal)
  await entrar(page, "owner");
  await expect(page).toHaveURL(/\/admin\/demo-tablio/, { timeout: 15_000 });
  await page.goto("/admin/demo-tablio/sucursal");
  const datos = page.getByLabel("Datos para transferir");
  await expect(datos).toBeVisible({ timeout: 15_000 });
  await datos.fill(DATOS);
  await expect(page.getByLabel("Recordar la boleta en efectivo y transferencia")).toBeChecked();
  await datos.scrollIntoViewIfNeeded();
  await foto(page, "160-dueno-datos-transferencia");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("Cambios guardados").first()).toBeVisible({ timeout: 10_000 });

  // Un comensal de la mesa 10 elige pagarle al mozo
  const cel = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  const comensal = await cel.newPage();
  await comensal.goto(linkMesa(10)!);
  await comensal.getByText("Agua mineral", { exact: true }).first().click();
  await comensal.getByRole("button", { name: /Agregar al carrito/ }).click();
  await comensal.getByText("Ver pedido").click();
  await comensal.getByRole("button", { name: /Ir a pagar/ }).click();
  await expect(comensal.getByRole("button", { name: /efectivo, tarjeta o transferencia/ })).toBeVisible({ timeout: 20_000 });
  await comensal.getByRole("button", { name: /Prefiero pagarle al mozo/ }).click();
  await ingresarCodigo(comensal, 10);
  await expect(comensal.getByText("¡Pedido enviado!")).toBeVisible({ timeout: 20_000 });
  await cel.close();

  // El mozo cobra por transferencia: ve los datos del local y la boleta
  const mozoCtx = await browser.newContext({ ...devices["Pixel 7"] });
  const mozo = await mozoCtx.newPage();
  await entrar(mozo, "waiter");
  await expect(mozo).toHaveURL(/\/mozo\/mesas/, { timeout: 15_000 });
  const tarjeta = mozo.locator("div.rounded-xl").filter({ has: mozo.locator("span.text-4xl", { hasText: /^10$/ }) }).first();
  await tarjeta.getByRole("button", { name: "Cobrar" }).click();
  await expect(mozo.getByText(/Por cobrar: \$/)).toBeVisible({ timeout: 10_000 });
  await foto(mozo, "161-mozo-tres-medios");
  await mozo.getByRole("button", { name: "📲 Transferencia" }).click();
  await expect(mozo.getByText("Banco Demo · Cuenta Corriente 0012345")).toBeVisible();
  await expect(mozo.getByText("Entregué la boleta")).toBeVisible();
  await foto(mozo, "162-mozo-cobro-transferencia");
  await mozo.getByRole("button", { name: "Registrar cobro" }).click();
  await expect(mozo.getByText(/Recuerda entregar la boleta/).first()).toBeVisible({ timeout: 15_000 });

  // Arriba en sus mesas le queda el recordatorio (después de cobrar se vuelve a abrir la ficha de la mesa)
  await mozo.getByRole("dialog").getByRole("button", { name: "Cerrar", exact: true }).click();
  await expect(mozo.getByRole("dialog")).toHaveCount(0);
  const pendientes = mozo.locator("li").filter({ hasText: /Mesa 10 · .* · Transferencia/ });
  await expect(pendientes.first()).toBeVisible({ timeout: 15_000 });
  await mozo.evaluate(() => window.scrollTo(0, 0));
  await foto(mozo, "163-mozo-boletas-por-entregar");

  // La caja ve la transferencia como canal propio y la boleta que falta
  await page.goto("/admin/demo-tablio/caja");
  await page.getByRole("tab", { name: "Cierre de caja" }).click();
  const enCaja = page.getByTestId("boletas-pendientes").locator("li").filter({ hasText: /Mesa 10 · .* · Transferencia/ });
  await expect(enCaja).toHaveCount(1, { timeout: 20_000 });
  await expect(page.getByRole("cell", { name: "Transferencia", exact: true })).toBeVisible();
  await foto(page, "164-caja-boletas-y-transferencia");
  await page.getByRole("cell", { name: "Transferencia", exact: true }).scrollIntoViewIfNeeded();
  await foto(page, "164b-caja-cuadre-con-transferencia");

  // El mozo entrega la boleta y la marca: se va de su lista y de la caja
  await expect(pendientes).toHaveCount(1);
  await pendientes.getByRole("button", { name: "Ya la entregué" }).click();
  await expect(pendientes).toHaveCount(0, { timeout: 15_000 });
  await page.reload();
  await page.getByRole("tab", { name: "Cierre de caja" }).click();
  await expect(page.getByTestId("boletas-pendientes")).toBeVisible({ timeout: 20_000 });
  await expect(enCaja).toHaveCount(0, { timeout: 15_000 });
  await foto(page, "165-caja-boleta-entregada");
  await mozoCtx.close();

  // Deja la sucursal como estaba
  await page.goto("/admin/demo-tablio/sucursal");
  await page.getByLabel("Datos para transferir").fill("");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("Cambios guardados").first()).toBeVisible({ timeout: 10_000 });
});
