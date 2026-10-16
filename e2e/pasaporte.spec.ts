import { test, expect } from "@playwright/test";
import { entrar, entrarComoCliente, foto, linkMesa } from "./apoyo/recorrido";

// Fase 7.6 — Pasaporte de la casa: el cliente con cuenta entra desde «Tu cuenta» (o su tarjeta de sellos) y ve lo que ha
// probado por sección, con sus insignias; el dueño lo prende o lo apaga en Lealtad. Solo mira (no cambia nada).
test("el cliente ve su pasaporte desde su cuenta", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Pantalla del comensal: se prueba en celular");
  await entrarComoCliente(page);
  await page.goto(linkMesa(10)!);
  await page.getByRole("button", { name: "Mi cuenta" }).click({ timeout: 20_000 });
  await page.getByTestId("cuenta-pasaporte").click();
  await expect(page).toHaveURL(/\/demo-tablio\/pasaporte/);
  const resumen = page.getByTestId("pasaporte-resumen");
  await expect(resumen).toContainText(/\d+ de \d+/, { timeout: 15_000 });
  await expect(page.getByTestId("insignias")).toContainText("Curioso");
  await foto(page, "300-cliente-pasaporte");
  await page.getByText("Tus insignias").scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 500);
  await foto(page, "301-cliente-pasaporte-secciones");
});

test("el dueño ve el interruptor del pasaporte en Lealtad", async ({ page, isMobile }) => {
  test.skip(isMobile, "Panel del dueño: se prueba en escritorio");
  await entrar(page, "owner");
  await expect(page).toHaveURL(/\/admin\/demo-tablio\//, { timeout: 15_000 });
  await page.goto("/admin/demo-tablio/lealtad");
  const bloque = page.getByTestId("pasaporte-config");
  await expect(bloque).toBeVisible({ timeout: 15_000 });
  await expect(bloque.getByRole("switch")).toBeChecked();
  await bloque.scrollIntoViewIfNeeded();
  await foto(page, "302-dueno-pasaporte");
});
