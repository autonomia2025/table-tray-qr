import { test, expect, devices } from "@playwright/test";
import { codigoMesa, cuenta, entrar, foto, liberarMesa, linkMesa } from "./apoyo/recorrido";

// Fase 3.5 — El código de la mesa prueba que el cliente está ahí (para pedir sin pagar); el mozo lo ve
// y une mesas para un grupo; el dueño ve los códigos y cuánto arriesga en lo que todavía no se paga.
test.skip(!cuenta("waiter"), "Falta privado/DEMO_CREDENCIALES.md");
test.skip(({ isMobile }) => !isMobile, "Se prueba una vez, en celular");

test("el cliente ingresa el código de su mesa para pagarle al mozo; el mozo une mesas; el dueño ve códigos y riesgo", async ({ page, browser }) => {
  test.setTimeout(150_000);
  // Parte de mesas libres y separadas (una corrida cortada a la mitad puede haberlas dejado unidas)
  await liberarMesa(6);
  await liberarMesa(7);
  const codigo = await codigoMesa(6);

  // El cliente pide un agua y elige pagarle al mozo: la app pide el código de la mesa
  await page.goto(linkMesa(6)!);
  await page.getByText("Agua mineral", { exact: true }).first().click();
  await page.getByRole("button", { name: /Agregar al carrito/ }).click();
  await page.getByText("Ver pedido").click();
  await page.getByRole("button", { name: /Ir a pagar/ }).click();
  await page.getByRole("button", { name: /Prefiero pagarle al mozo/ }).click();
  await expect(page.getByText("Código de tu mesa")).toBeVisible({ timeout: 10_000 });
  await foto(page, "110-comensal-pide-codigo");
  // Un código equivocado (alguien desde su casa con una foto del QR no lo sabe)
  await page.getByLabel("Código de 4 números de tu mesa").fill(codigo === "0000" ? "1111" : "0000");
  await expect(page.getByText(/no es el código de tu mesa/)).toBeVisible({ timeout: 10_000 });
  await foto(page, "111-comensal-codigo-equivocado");
  await page.getByLabel("Código de 4 números de tu mesa").fill(codigo);
  await expect(page.getByText("¡Pedido enviado!")).toBeVisible({ timeout: 20_000 });

  // El mozo ve el código en el detalle de la mesa y une la 7 a la 6 para un grupo
  const mozoCtx = await browser.newContext({ ...devices["Pixel 7"] });
  const mozo = await mozoCtx.newPage();
  await entrar(mozo, "waiter");
  await expect(mozo).toHaveURL(/\/mozo\/mesas/, { timeout: 15_000 });
  const mesa6 = mozo.locator("div.rounded-xl").filter({ has: mozo.locator("span.text-4xl", { hasText: /^6$/ }) }).first();
  await mesa6.click();
  await expect(mozo.getByRole("dialog").getByText(`Código ${codigo}`)).toBeVisible({ timeout: 10_000 });
  await foto(mozo, "112-mozo-ve-codigo");
  await mozo.getByRole("button", { name: "🔗 Unir con otra mesa" }).click();
  await mozo.getByRole("button", { name: "Unir la mesa 7" }).click();
  await expect(mozo.getByText("Mesas 6 y 7 unidas").first()).toBeVisible({ timeout: 10_000 });
  await expect(mesa6.getByText("🔗 Con mesa 7")).toBeVisible({ timeout: 10_000 });
  await foto(mozo, "113-mozo-mesas-unidas");
  // Las separa (deja el demo como estaba)
  const mesa7 = mozo.locator("div.rounded-xl").filter({ has: mozo.locator("span.text-4xl", { hasText: /^7$/ }) }).first();
  await mesa7.click();
  await mozo.getByRole("button", { name: /Separar de la mesa 6/ }).click();
  await expect(mozo.getByText("Mesa 7 separada").first()).toBeVisible({ timeout: 10_000 });
  await mozoCtx.close();

  // El dueño: códigos en la pantalla de QR y lo que se arriesga en Mesas
  const duenoCtx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
  const dueno = await duenoCtx.newPage();
  await entrar(dueno, "owner");
  await expect(dueno).toHaveURL(/\/admin\/demo-tablio\//, { timeout: 15_000 });
  await dueno.goto("/admin/demo-tablio/qr");
  await expect(dueno.getByRole("cell", { name: codigo }).first()).toBeVisible({ timeout: 15_000 });
  await foto(dueno, "114-dueno-codigos-de-mesa");
  await dueno.goto("/admin/demo-tablio/mesas");
  await expect(dueno.getByText("Lo que todavía no se paga")).toBeVisible({ timeout: 15_000 });
  await foto(dueno, "115-dueno-riesgo");
  await duenoCtx.close();
});
