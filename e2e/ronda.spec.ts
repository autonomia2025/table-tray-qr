import { test, expect } from "@playwright/test";
import { foto, liberarMesa, linkMesa } from "./apoyo/recorrido";

// Fase 7.4 — Invitar una ronda: en una mesa con dos personas, una pide "para la mesa" y la paga ella; la
// otra lo ve en su pantalla ("Camila invitó una ronda"). Paga con la app (simulada en el demo).
test.skip(!linkMesa(6), "Falta privado/DEMO_CREDENCIALES.md");
// En la base real las pruebas corren de a dos y esta comparte mesa con otras: ahí la cubren las de seguridad.
test.skip(process.env.E2E_BASE_DATOS !== "local", "Solo en la base desechable (dos celulares en una mesa compartida)");
test.skip(({ isMobile }) => isMobile, "Dos celulares a la vez; se prueba una vez");

test("una persona invita una ronda y el resto de la mesa la ve", async ({ browser }) => {
  test.setTimeout(120_000);
  await liberarMesa(6);
  const celular = () => browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  const ctxDiego = await celular();
  const ctxCamila = await celular();
  const diego = await ctxDiego.newPage();
  const camila = await ctxCamila.newPage();

  // Diego llega primero a la mesa (abre la carta con el QR)
  await diego.goto(linkMesa(6)!);
  await expect(diego.getByText("Empanaditas de queso (6)").first()).toBeVisible({ timeout: 20_000 });

  // Camila pide unas empanaditas para la mesa
  await camila.goto(linkMesa(6)!);
  await camila.getByText("Empanaditas de queso (6)", { exact: true }).last().click();
  await camila.getByRole("button", { name: /Agregar al carrito/ }).click();
  await camila.getByText("Ver pedido").click();
  await camila.getByRole("button", { name: /Ir a pagar/ }).click();
  const ronda = camila.getByTestId("es-ronda");
  await expect(ronda).toBeVisible({ timeout: 15_000 });
  await ronda.getByRole("switch").click();
  await expect(ronda.getByRole("switch")).toBeChecked();
  await foto(camila, "260-camila-invita-una-ronda");
  await camila.getByRole("button", { name: /Pagar con tarjeta/ }).click();
  await expect(camila.getByText("¡Pago listo!")).toBeVisible({ timeout: 20_000 });
  await camila.getByText("Ver estado de mi pedido").click();

  // Camila se pone su nombre en la mesa (así la ven los demás)
  await camila.getByText("Ponte un nombre").click();
  await camila.getByLabel("Tu nombre en la mesa").fill("Camila");
  await camila.getByRole("button", { name: "Listo" }).click();
  await expect(camila.getByTestId("rondas-mesa")).toContainText("Invitaste una ronda", { timeout: 15_000 });

  // Diego pide algo para él y, en su seguimiento, ve la ronda de Camila
  await diego.getByText("Agua mineral", { exact: true }).last().click();
  await diego.getByRole("button", { name: /Agregar al carrito/ }).click();
  await diego.getByText("Ver pedido").click();
  await diego.getByRole("button", { name: /Ir a pagar/ }).click();
  await diego.getByRole("button", { name: /Pagar con tarjeta/ }).click();
  await expect(diego.getByText("¡Pago listo!")).toBeVisible({ timeout: 20_000 });
  await diego.getByText("Ver estado de mi pedido").click();
  await expect(diego.getByTestId("rondas-mesa")).toContainText("Camila invitó una ronda", { timeout: 20_000 });
  await expect(diego.getByTestId("rondas-mesa")).toContainText("Empanaditas de queso (6)");
  await foto(diego, "261-diego-ve-la-ronda");

  await ctxDiego.close();
  await ctxCamila.close();
});
