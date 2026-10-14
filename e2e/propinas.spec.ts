import { test, expect, devices } from "@playwright/test";
import { cuenta, entrar, foto, linkMesa } from "./apoyo/recorrido";

// Propinas (art. 64 del Código del Trabajo y decisión del fundador del 14 de octubre de 2026): la cuenta
// sugiere 10% (marcado), con 15%, 20%, otro monto y "sin propina" a la vista. El local ve cuánto le
// debe a cada mozo y el plazo de 7 días hábiles, y registra cuando se lo paga; el mozo lo ve en su perfil.
test.skip(!cuenta("owner") || !cuenta("waiter"), "Faltan las cuentas del demo");
test.skip(({ isMobile }) => isMobile, "Se prueba una vez, en escritorio");

test("el cliente ve 10% sugerido y puede no dejar propina; el local paga las propinas al equipo y la mozo lo ve", async ({ browser }) => {
  test.setTimeout(150_000);

  // El cliente en el pago: 10% viene marcado y "sin propina" está a la vista
  const celCtx = await browser.newContext({ ...devices["Pixel 7"] });
  const cliente = await celCtx.newPage();
  await cliente.goto(linkMesa(3)!);
  await cliente.getByText("Barros Luco", { exact: true }).last().click();
  await cliente.getByRole("button", { name: /Agregar al carrito/ }).click();
  await cliente.getByText("Ver pedido").click();
  await cliente.getByRole("button", { name: /Ir a pagar/ }).click();
  const selector = cliente.getByTestId("selector-propina");
  await expect(selector.getByRole("button", { name: /^10%/ })).toHaveAttribute("aria-pressed", "true");
  await expect(selector.getByRole("button", { name: "Sin propina" })).toBeVisible();
  await selector.scrollIntoViewIfNeeded();
  await foto(cliente, "130-cliente-propina-sugerida");
  await selector.getByRole("button", { name: "Sin propina" }).click();
  await expect(selector.getByRole("button", { name: /Sin propina ✓/ })).toBeVisible();
  await selector.getByRole("button", { name: /^Otro/ }).click();
  await selector.getByLabel("Monto de propina").fill("2500");
  await expect(cliente.getByText("$11.400").first()).toBeVisible(); // $8.900 del Barros Luco + $2.500
  await celCtx.close();

  // El dueño en Caja → Propinas del equipo: lo pendiente por mozo, con plazo; registra un pago
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const dueno = await ctx.newPage();
  await entrar(dueno, "owner");
  await expect(dueno).toHaveURL(/\/admin\/demo-tablio\//, { timeout: 15_000 });
  await dueno.goto("/admin/demo-tablio/caja");
  await dueno.getByRole("tab", { name: "Propinas del equipo" }).click();
  const panel = dueno.getByTestId("propinas-por-pagar");
  await expect(panel.getByText("Propinas por pagar al equipo")).toBeVisible({ timeout: 15_000 });
  await expect(panel.getByText(/plazo hasta|venció/).first()).toBeVisible();
  await foto(dueno, "131-dueno-propinas-por-pagar");
  await panel.getByRole("button", { name: "Registrar pago" }).first().click();
  await dueno.getByRole("button", { name: "Transferencia" }).click();
  await dueno.getByLabel("Nota").fill("Transferencia 1234");
  await foto(dueno, "132-dueno-registra-pago");
  await dueno.getByRole("button", { name: "Confirmar pago" }).click();
  await expect(dueno.getByText(/en propinas a /).first()).toBeVisible({ timeout: 10_000 });
  await expect(panel.getByText("Últimos pagos al equipo")).toBeVisible();
  await ctx.close();

  // La mozo ve en su perfil lo que le deben y lo que le pagaron
  const mozoCtx = await browser.newContext({ ...devices["Pixel 7"] });
  const mozo = await mozoCtx.newPage();
  await entrar(mozo, "waiter");
  await expect(mozo).toHaveURL(/\/mozo\/mesas/, { timeout: 15_000 });
  await mozo.goto("/mozo/perfil");
  const mias = mozo.getByTestId("mis-propinas");
  await expect(mias).toBeVisible({ timeout: 15_000 });
  await mias.scrollIntoViewIfNeeded();
  await foto(mozo, "133-mozo-mis-propinas");
  await mozoCtx.close();
});
