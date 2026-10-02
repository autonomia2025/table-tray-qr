import { test, expect } from "@playwright/test";
import fs from "node:fs";

// Fase 1.4 — Con la lectura pública de pedidos cerrada, el comensal sigue viendo su pedido
// en vivo (sin recargar) mientras la cocina lo avanza. Dos navegadores a la vez.
const archivo = process.env.DEMO_CREDENCIALES ?? "privado/DEMO_CREDENCIALES.md";
const texto = fs.existsSync(archivo) ? fs.readFileSync(archivo, "utf-8") : "";
const cocina = texto.match(/^\| kitchen \| `([^`]+)` \| `([^`]+)` \|$/m);
const mesa10 = texto.match(/^\| 10 \| \w+ \| `([^`]+)` \|$/m)?.[1];

test.skip(!texto, "Falta privado/DEMO_CREDENCIALES.md");

test("el comensal ve su pedido pasar de Recibido a En cocina, Listo y Entregado sin recargar", async ({ browser }) => {
  test.setTimeout(90_000); // dos navegadores a la vez
  // Comensal: pide y paga, y queda en el seguimiento
  const comensalCtx = await browser.newContext();
  const comensal = await comensalCtx.newPage();
  await comensal.goto(mesa10!);
  await comensal.getByText("Limonada menta jengibre", { exact: true }).first().click();
  await comensal.getByRole("button", { name: /Agregar al carrito/ }).click();
  await comensal.getByText("Ver pedido").click();
  await comensal.getByRole("button", { name: /Ir a pagar/ }).click();
  await comensal.getByRole("button", { name: /Pagar con tarjeta/ }).click();
  await expect(comensal.getByText("¡Pago listo!")).toBeVisible({ timeout: 20_000 });
  const numero = (await comensal.getByText(/Tu pedido #\d+/).textContent())!.match(/#(\d+)/)![1];
  await comensal.getByRole("button", { name: "Ver estado de mi pedido" }).click();
  await expect(comensal.getByText("Recibido ✓").first()).toBeVisible({ timeout: 15_000 });

  // Cocina: entra y avanza el pedido
  const cocinaCtx = await browser.newContext();
  const kds = await cocinaCtx.newPage();
  await kds.goto("/login");
  await kds.locator('input[type="email"]').fill(cocina![1]);
  await kds.locator('input[type="password"]').fill(cocina![2]);
  await kds.locator('button[type="submit"]').click();
  await expect(kds).toHaveURL(/\/kds\?branch=/, { timeout: 15_000 });
  const tarjeta = (boton: string | RegExp) =>
    kds.locator("div").filter({ hasText: `#${numero}` }).filter({ has: kds.getByRole("button", { name: boton }) }).last();

  await tarjeta("ACEPTAR").getByRole("button", { name: "ACEPTAR" }).click();
  await expect(comensal.getByText("En cocina 🍳").first()).toBeVisible({ timeout: 15_000 });

  await tarjeta("LISTO").getByRole("button", { name: "LISTO" }).click();
  await expect(comensal.getByText("¡Listo para entregar! 🔔").first()).toBeVisible({ timeout: 15_000 });

  await tarjeta(/ENTREGADO/).getByRole("button", { name: /ENTREGADO/ }).click();
  await expect(comensal.getByText("Entregado ✓").first()).toBeVisible({ timeout: 15_000 });

  await comensalCtx.close();
  await cocinaCtx.close();
});
