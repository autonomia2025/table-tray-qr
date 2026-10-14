import { test, expect, devices } from "@playwright/test";
import { cuenta, entrar, foto, linkMesa } from "./apoyo/recorrido";

// Fase 2.D — Cierre de caja con conciliación automática: la base cuadra lo cobrado (app, efectivo,
// POS) menos los reembolsos; la caja anota lo contado, la diferencia sale sola y el cierre queda
// bloqueado. Fase 1.10: el mozo no entra a la caja.
test.skip(!cuenta("cashier"), "Falta privado/DEMO_CREDENCIALES.md");
test.skip(({ isMobile }) => isMobile, "Pantalla de escritorio; se prueba una vez");

const pesos = (texto: string) => parseInt(texto.replace(/\D/g, ""), 10) || 0;

test("la caja cuadra sola, exige explicar las diferencias y el cierre queda bloqueado", async ({ page, browser }) => {
  test.setTimeout(150_000);
  // Un comensal paga con la app (mesa 7) y otro le paga al mozo en efectivo (mesa 8)
  const cel = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  for (const [mesa, forma] of [[7, "app"], [8, "mozo"]] as const) {
    const comensal = await cel.newPage();
    await comensal.goto(linkMesa(mesa)!);
    await comensal.getByText("Agua mineral", { exact: true }).first().click();
    await comensal.getByRole("button", { name: /Agregar al carrito/ }).click();
    await comensal.getByText("Ver pedido").click();
    await comensal.getByRole("button", { name: /Ir a pagar/ }).click();
    if (forma === "app") {
      await comensal.getByRole("button", { name: /Pagar con tarjeta/ }).click();
      await expect(comensal.getByText("¡Pago listo!")).toBeVisible({ timeout: 20_000 });
    } else {
      await comensal.getByRole("button", { name: /Prefiero pagarle al mozo/ }).click();
      await expect(comensal.getByText("¡Pedido enviado!")).toBeVisible({ timeout: 20_000 });
    }
    await comensal.close();
  }
  await cel.close();

  const mozoCtx = await browser.newContext({ ...devices["Pixel 7"] });
  const mozo = await mozoCtx.newPage();
  await entrar(mozo, "waiter");
  await expect(mozo).toHaveURL(/\/mozo\/mesas/, { timeout: 15_000 });
  const tarjeta = mozo.locator("div.rounded-xl").filter({ has: mozo.locator("span.text-4xl", { hasText: /^8$/ }) }).first();
  await tarjeta.getByRole("button", { name: "Cobrar" }).click();
  await mozo.getByRole("button", { name: "💵 Efectivo" }).click();
  await mozo.getByRole("button", { name: "Registrar cobro" }).click();
  await expect(mozo.getByText(/✅ Cobrado \$/).first()).toBeVisible({ timeout: 15_000 });
  await mozoCtx.close();

  // La cajera abre el cierre del día de hoy: los números ya están cuadrados por la base
  await entrar(page, "cashier");
  await expect(page).toHaveURL(/\/admin\/demo-tablio\/caja/, { timeout: 15_000 });
  await page.getByRole("tab", { name: "Cierre de caja" }).click();
  const filaEfectivo = page.locator("tr").filter({ has: page.getByRole("cell", { name: "Efectivo", exact: true }) });
  await expect(filaEfectivo).toBeVisible({ timeout: 20_000 });
  const esperado = pesos(await filaEfectivo.locator("td").nth(3).innerText());
  expect(esperado).toBeGreaterThan(0);
  await expect(page.getByText("Propinas por mozo")).toBeVisible();
  await foto(page, "60-cierre-cuadre-del-dia");

  // Contó $1.000 menos: la diferencia aparece sola y pide explicarla
  await page.getByLabel("Efectivo contado").fill(String(esperado - 1000));
  await expect(filaEfectivo.getByText("Faltan $1.000")).toBeVisible();
  await expect(page.getByText("La caja no cuadra: explica la diferencia en las notas.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Cerrar caja del día" })).toBeDisabled();
  await foto(page, "61-cierre-faltan-1000");
  await page.getByLabel("Efectivo contado").fill(String(esperado));
  await expect(filaEfectivo.getByText("Cuadra")).toBeVisible();
  await expect(page.getByRole("button", { name: "Cerrar caja del día" })).toBeEnabled();

  // El cierre en sí se prueba en un día pasado (así el demo sigue abierto hoy)
  const dia = `20${10 + Math.floor(Math.random() * 15)}-0${1 + Math.floor(Math.random() * 9)}-1${Math.floor(Math.random() * 9)}`;
  await page.getByLabel("Día de negocio").fill(dia);
  await expect(filaEfectivo.locator("td").nth(3)).toHaveText("$0", { timeout: 15_000 });
  await page.getByLabel("Efectivo contado").fill("0");
  await page.getByRole("button", { name: "Cerrar caja del día" }).click();
  await expect(page.getByText("¿Cerrar la caja del día?")).toBeVisible();
  await foto(page, "62-cierre-confirmar");
  await page.getByRole("button", { name: "Cerrar caja", exact: true }).click();
  await expect(page.getByText("Caja cerrada · no se puede cambiar")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel("Efectivo contado")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cerrar caja del día" })).toHaveCount(0);
  await expect(page.getByRole("cell", { name: dia })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await foto(page, "63-cierre-bloqueado");
});

test("el mozo no puede entrar a la caja", async ({ page }) => {
  await entrar(page, "waiter");
  await expect(page).toHaveURL(/\/mozo\/mesas/, { timeout: 15_000 });
  await page.goto("/admin/demo-tablio/caja");
  await expect(page).not.toHaveURL(/\/caja/, { timeout: 15_000 });
  await foto(page, "32-mozo-sin-acceso-a-caja");
});
