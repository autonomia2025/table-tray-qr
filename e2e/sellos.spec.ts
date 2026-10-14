import { test, expect, devices } from "@playwright/test";
import { cuenta, entrar, entrarComoCliente, foto, linkMesa } from "./apoyo/recorrido";

// Fase 3.7 — Sellos que se sienten. El cliente del demo llega con 4 sellos: al pagar hoy, el quinto "cae",
// completa la tarjeta y aparece el premio con su código; la mozo lo entrega escribiendo ese código.
test.skip(!cuenta("cliente") || !cuenta("waiter"), "Faltan las cuentas del demo");
test.skip(({ isMobile }) => !isMobile, "Es una pantalla del celular");

test("al pagar, el sello cae en la tarjeta; con la tarjeta completa, la mozo entrega el premio con el código", async ({ browser }) => {
  test.setTimeout(150_000);
  const celCtx = await browser.newContext({ ...devices["Pixel 7"] });
  const cliente = await celCtx.newPage();
  await entrarComoCliente(cliente);
  await cliente.goto(linkMesa(1)!);

  // El de la carta (arriba puede estar en "Lo de siempre", que lo agrega directo)
  await cliente.getByText("Barros Luco", { exact: true }).last().click();
  await cliente.getByRole("button", { name: /Agregar al carrito/ }).click();
  await cliente.getByText("Ver pedido").click();
  await cliente.getByRole("button", { name: /Ir a pagar/ }).click();
  // Antes de pagar ya sabe qué suma este pago
  await expect(cliente.getByText(/Este pago suma tu sello|completas tu tarjeta|Hoy ya sumaste tu sello/)).toBeVisible({ timeout: 15_000 });
  await foto(cliente, "120-cliente-antes-de-pagar");
  await cliente.getByRole("button", { name: /Pagar con tarjeta/ }).click();
  await expect(cliente.getByText("¡Pago listo!")).toBeVisible({ timeout: 20_000 });

  const tarjeta = cliente.getByTestId("tarjeta-sellos");
  await expect(tarjeta).toBeVisible({ timeout: 15_000 });
  await cliente.waitForTimeout(600); // a mitad de la caída
  await foto(cliente, "121-cliente-sello-cayendo");
  await cliente.waitForTimeout(1800);
  await tarjeta.scrollIntoViewIfNeeded();
  await foto(cliente, "122-cliente-tarjeta-completa");

  // El premio con su código (si hoy ya había completado la tarjeta en otra prueba, igual está por retirar)
  const codigo = (await tarjeta.getByTestId("codigo-premio").first().innerText()).trim();
  expect(codigo).toMatch(/^[A-Z2-9]{4}$/);

  // La mozo abre la mesa 1 y ve el premio por entregar
  const mozoCtx = await browser.newContext({ ...devices["Pixel 7"] });
  const mozo = await mozoCtx.newPage();
  await entrar(mozo, "waiter");
  await expect(mozo).toHaveURL(/\/mozo\/mesas/, { timeout: 15_000 });
  await mozo.locator("div.rounded-xl").filter({ has: mozo.locator("span.text-4xl", { hasText: /^1$/ }) }).first().click();
  const premios = mozo.getByTestId("premios-mesa");
  await expect(premios).toBeVisible({ timeout: 15_000 });
  await foto(mozo, "123-mozo-premio-en-la-mesa");

  // Un código equivocado no sirve; el que muestra el cliente, sí
  await premios.getByRole("button", { name: "Entregar" }).first().click();
  await premios.getByLabel("Código del premio").fill("ZZZZ");
  await premios.getByRole("button", { name: "Confirmar" }).click();
  await expect(mozo.getByText("El código no corresponde a este premio").first()).toBeVisible();
  await premios.getByLabel("Código del premio").fill(codigo);
  await foto(mozo, "124-mozo-escribe-el-codigo");
  await premios.getByRole("button", { name: "Confirmar" }).click();
  await expect(mozo.getByText(/Entregado: /).first()).toBeVisible();

  // En el celular del cliente, ese premio ya no aparece
  await cliente.goto(linkMesa(1)!.replace("/menu", "/tracking"));
  await expect(cliente.getByTestId("tarjeta-sellos")).toBeVisible({ timeout: 15_000 });
  await expect(cliente.getByTestId("tarjeta-sellos").getByText(codigo)).toHaveCount(0);
  await celCtx.close();
  await mozoCtx.close();
});
