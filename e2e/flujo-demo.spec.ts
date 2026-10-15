import { test, expect } from "@playwright/test";
import fs from "node:fs";

// Recorrido completo en el local de demo, contra la base real:
// el comensal pide y paga desde la mesa → el pedido llega a cocina → cocina lo acepta,
// lo marca listo y entregado. Crea un pedido y un pago simulado en "Demo Tablio".
const archivo = process.env.DEMO_CREDENCIALES ?? "privado/DEMO_CREDENCIALES.md";
const texto = fs.existsSync(archivo) ? fs.readFileSync(archivo, "utf-8") : "";
const cuenta = (rol: string) => {
  const m = texto.match(new RegExp(`^\\| ${rol} \\| \`([^\`]+)\` \\| \`([^\`]+)\` \\|$`, "m"));
  return m ? { correo: m[1], clave: m[2] } : null;
};
const mesa = (n: number) => texto.match(new RegExp(`^\\| ${n} \\| \\w+ \\| \`([^\`]+)\` \\|$`, "m"))?.[1];
const SUCURSAL_DEMO = "aebe7faa-0e29-5aa9-83c2-1e1b336f1554"; // fija: scripts/demo/crear_demo.py

test.describe.configure({ mode: "serial" });
test.skip(!texto, "Falta privado/DEMO_CREDENCIALES.md");

let numeroPedido = "";

test("el comensal pide un Pisco Sour y paga con tarjeta", async ({ page }) => {
  await page.goto(mesa(3)!);
  await page.getByText("Pisco Sour", { exact: true }).first().click();
  await page.getByRole("button", { name: /Agregar al carrito/ }).click();
  await page.getByText("Ver pedido").click();
  await page.getByRole("button", { name: /Ir a pagar/ }).click();
  await page.getByRole("button", { name: /Pagar con tarjeta/ }).click();
  await expect(page.getByText("¡Pago listo!")).toBeVisible({ timeout: 20_000 });
  const confirmacion = await page.getByText(/Tu pedido #\d+/).textContent();
  numeroPedido = confirmacion!.match(/#(\d+)/)![1];
  expect(numeroPedido).not.toBe("");
});

test("cocina recibe el pedido y lo avanza hasta entregado", async ({ page }) => {
  const c = cuenta("kitchen")!;
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(c.correo);
  await page.locator('input[type="password"]').fill(c.clave);
  await page.locator('button[type="submit"]').click();
  // Cocina entra directo a su pantalla (fase 1.2)
  await expect(page).toHaveURL(new RegExp(`/kds\\?branch=${SUCURSAL_DEMO}`), { timeout: 15_000 });
  // Todo dentro de la tarjeta de ESTE pedido: con otras pruebas en paralelo, un botón suelto podría ser de otro
  const tarjeta = page.locator("div.mb-3").filter({ hasText: `#${numeroPedido.padStart(3, "0")}` }).filter({ hasText: "Pisco Sour" });
  await expect(tarjeta).toBeVisible({ timeout: 15_000 });
  await tarjeta.getByRole("button", { name: "ACEPTAR" }).click();
  await tarjeta.getByRole("button", { name: "LISTO" }).click();
  await tarjeta.getByRole("button", { name: /ENTREGADO/ }).click();
  // La tarjeta de este pedido desaparece (otras pruebas en paralelo pueden tener sus propios pedidos listos)
  await expect(tarjeta).toHaveCount(0, { timeout: 10_000 });
});
