import { test, expect, devices, type Page } from "@playwright/test";
import { cuenta, entrar, foto, linkMesa, reembolsarUltimoPagoWebpay } from "./apoyo/recorrido";

// Fase 4.1 — Webpay de punta a punta contra el ambiente de pruebas de Transbank: el dueño conecta su
// pasarela, el cliente paga en Webpay con la tarjeta de prueba y vuelve a Tablio con su pedido pagado.
// Depende de Transbank: se corre a pedido (PAGOS_REALES=1), no en cada cambio.
test.skip(!process.env.PAGOS_REALES, "Se corre a pedido: PAGOS_REALES=1 (usa el ambiente de pruebas de Transbank)");
test.skip(!cuenta("owner"), "Falta privado/DEMO_CREDENCIALES.md");
test.skip(({ isMobile }) => isMobile, "Se prueba una vez");

/** Página de pago de Webpay (integración): tarjeta de prueba de Transbank y autenticación del banco de prueba. */
async function pagarEnWebpay(p: Page) {
  await expect(p).toHaveURL(/webpay3gint\.transbank\.cl/, { timeout: 30_000 });
  await p.locator("#tarjetas").click();
  await p.locator("#card-number").fill("4051885600446623");
  await p.getByRole("button", { name: "Continuar" }).click();
  await p.locator("#card-exp").pressSequentially("1230", { delay: 60 });
  await p.locator("#card-cvv").pressSequentially("123", { delay: 60 });
  await p.getByRole("button", { name: "Continuar" }).click();
  await foto(p, "141-webpay-tarjeta");
  await p.getByRole("button", { name: "Pagar" }).click();
  await p.locator("#rutClient").fill("111111111", { timeout: 30_000 });
  await p.locator("#passwordClient").fill("123");
  await p.locator("input[type=submit]").click();
  await p.locator("#vci").selectOption("TSY", { timeout: 30_000 });
  await p.locator("input[type=submit]").click();
}

test("el dueño conecta Webpay; el cliente paga en Webpay y vuelve con su pedido pagado", async ({ browser }) => {
  test.setTimeout(240_000);
  const duenoCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const dueno = await duenoCtx.newPage();
  await entrar(dueno, "owner");
  await expect(dueno).toHaveURL(/\/admin\/demo-tablio\//, { timeout: 15_000 });
  await dueno.goto("/admin/demo-tablio/sucursal");
  const pagos = dueno.getByTestId("pagos-sucursal");
  await expect(pagos.getByText("Cómo te pagan con la app")).toBeVisible({ timeout: 15_000 });
  // Si quedó conectada de una corrida anterior, se parte desde cero
  const previa = pagos.getByRole("button", { name: "Desconectar" });
  if (await previa.isVisible().catch(() => false)) {
    await previa.click();
    await expect(previa).toHaveCount(0, { timeout: 10_000 });
  }
  await pagos.getByRole("button", { name: /Webpay \(Transbank\).*código de comercio/ }).click();
  await foto(dueno, "139-dueno-conectar-webpay");
  await pagos.getByRole("button", { name: "Probar con las claves de prueba de Transbank" }).click();
  await expect(pagos.getByText(/Webpay \(Transbank\) conectado/)).toBeVisible({ timeout: 30_000 });
  await foto(dueno, "140-dueno-webpay-conectado");

  try {
    const celCtx = await browser.newContext({ ...devices["Pixel 7"] });
    const cliente = await celCtx.newPage();
    await cliente.goto(linkMesa(6)!);
    await cliente.getByText("Barros Luco", { exact: true }).last().click();
    await cliente.getByRole("button", { name: /Agregar al carrito/ }).click();
    await cliente.getByText("Ver pedido").click();
    await cliente.getByRole("button", { name: /Ir a pagar/ }).click();
    const boton = cliente.getByRole("button", { name: "Pagar con Webpay" });
    await expect(boton).toBeVisible({ timeout: 15_000 });
    await boton.scrollIntoViewIfNeeded();
    await foto(cliente, "141a-cliente-pagar-con-webpay");
    await boton.click();
    await pagarEnWebpay(cliente);

    // Vuelve a Tablio: el pago se confirma en el servidor y el pedido pasa a cocina
    await expect(cliente.getByText("¡Pago listo!")).toBeVisible({ timeout: 45_000 });
    await expect(cliente.getByText(/Comprobante TBK-/)).toBeVisible();
    await foto(cliente, "142-cliente-pago-listo-webpay");
    await celCtx.close();

    // El dueño devuelve ese pago: la plata vuelve por Transbank (no en el local)
    const devolucion = await reembolsarUltimoPagoWebpay();
    expect(devolucion).toEqual({ status: 200, estado: "refunded" });
  } finally {
    await dueno.goto("/admin/demo-tablio/sucursal");
    const desconectar = dueno.getByTestId("pagos-sucursal").getByRole("button", { name: "Desconectar" });
    await desconectar.waitFor({ timeout: 15_000 });
    await desconectar.click();
    await expect(dueno.getByText("Pasarela desconectada").first()).toBeVisible({ timeout: 10_000 });
    await duenoCtx.close();
  }
});
