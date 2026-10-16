import { test, expect } from "@playwright/test";
import { foto, liberarMesa, linkMesa } from "./apoyo/recorrido";

// Fase 7.4b — Dividir un plato: Ana pide una tabla para compartir y la divide con Beto; cada uno paga su parte
// en su celular y la tabla pasa a cocina cuando está todo pagado.
test.skip(!linkMesa(2), "Falta privado/DEMO_CREDENCIALES.md");
// En la base real las pruebas corren de a dos y esta comparte mesa con otras: ahí la cubren las de seguridad.
test.skip(process.env.E2E_BASE_DATOS !== "local", "Solo en la base desechable (dos celulares en una mesa compartida)");
test.skip(({ isMobile }) => isMobile, "Dos celulares a la vez; se prueba una vez");

test("dos personas dividen un plato y cada una paga su parte", async ({ browser }) => {
  test.setTimeout(150_000);
  await liberarMesa(2);
  const celular = () => browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  const ctxA = await celular();
  const ctxB = await celular();
  const ana = await ctxA.newPage();
  const beto = await ctxB.newPage();

  // Beto ya está en la mesa (pidió un agua) y se puso su nombre
  await beto.goto(linkMesa(2)!);
  await beto.getByText("Agua mineral", { exact: true }).last().click();
  await beto.getByRole("button", { name: /Agregar al carrito/ }).click();
  await beto.getByText("Ver pedido").click();
  await beto.getByRole("button", { name: /Ir a pagar/ }).click();
  await beto.getByRole("button", { name: /Pagar con tarjeta/ }).click();
  await expect(beto.getByText("¡Pago listo!")).toBeVisible({ timeout: 20_000 });
  await beto.getByText("Ver estado de mi pedido").click();
  await beto.getByText("Ponte un nombre").click();
  await beto.getByLabel("Tu nombre en la mesa").fill("Beto");
  await beto.getByRole("button", { name: "Listo" }).click();

  // Ana pide la tabla y la divide con Beto
  await ana.goto(linkMesa(2)!);
  await ana.getByText("Tabla de quesos y carnes", { exact: true }).last().click();
  await ana.getByRole("button", { name: /Agregar al carrito/ }).click();
  await ana.getByText("Ver pedido").click();
  await ana.getByRole("button", { name: "Dividir" }).click();
  const elegir = ana.getByTestId("elegir-con-quien");
  await elegir.getByText("Beto").click();
  await expect(ana.getByText(/Entre 2:/)).toBeVisible();
  await foto(ana, "280-ana-divide-la-tabla");
  await ana.getByRole("button", { name: "Dividir y pagar mi parte" }).click();
  await expect(ana.getByTestId("parte-a-pagar")).toBeVisible({ timeout: 15_000 });
  await foto(ana, "281-ana-paga-su-parte");
  await ana.getByRole("button", { name: /^Pagar \$/ }).click();
  await expect(ana.getByText("¡Pagaste tu parte!")).toBeVisible({ timeout: 20_000 });

  // Beto ve la tabla dividida y paga la suya: pasa a cocina
  await beto.reload();
  const platos = beto.getByTestId("platos-divididos");
  await expect(platos).toContainText("Tabla de quesos y carnes", { timeout: 15_000 });
  await expect(platos).toContainText("Pasa a la cocina cuando todos paguen");
  await foto(beto, "282-beto-ve-su-parte");
  await platos.getByRole("button", { name: /Pagar mi parte/ }).click();
  await beto.getByRole("button", { name: /^Pagar \$/ }).click();
  await expect(beto.getByText("¡Pagaste tu parte!")).toBeVisible({ timeout: 20_000 });
  await beto.getByRole("button", { name: "Ver cómo va" }).click();
  await expect(beto.getByTestId("platos-divididos")).toContainText("Todo pagado", { timeout: 15_000 });
  await beto.getByTestId("platos-divididos").scrollIntoViewIfNeeded();
  await foto(beto, "283-todo-pagado-a-cocina");

  await ctxA.close();
  await ctxB.close();
});
