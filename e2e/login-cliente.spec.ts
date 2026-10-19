import { test, expect } from "@playwright/test";
import { cuenta, entrar, foto, linkMesa } from "./apoyo/recorrido";

// Cuentas de prueba del fundador (19 de octubre de 2026): un cliente con clave entra por /login, queda con su
// sesión (no tiene panel) y la carta de su mesa lo reconoce. Los clientes reales entran con código por correo.
test.skip(!cuenta("cliente"), "Falta la cuenta de cliente del demo");
test.skip(({ isMobile }) => !isMobile, "Es una pantalla del celular");

test("un cliente entra por /login y la carta de su mesa lo reconoce", async ({ page }) => {
  await entrar(page, "cliente");
  await expect(page.getByText("Entraste como cliente")).toBeVisible({ timeout: 15_000 });
  await foto(page, "330-login-cliente");

  await page.goto(linkMesa(2)!);
  await expect(page.getByRole("button", { name: "Mi cuenta" })).toBeVisible({ timeout: 15_000 });
});
