import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { DEMO } from "../tests/seguridad/entorno";
import { entrar, entrarComoCliente, foto, linkMesa } from "./apoyo/recorrido";

// Fase 7.7 — Premio sorpresa al pagar (raspe y gana): el dueño lo activa en Lealtad con su premio, cada cuánto
// se gana y su tope del mes; el cliente con cuenta paga y raspa su tarjeta. Solo en la base desechable (cambia
// el programa del demo y lo deja como estaba).
test.skip(process.env.E2E_BASE_DATOS !== "local", "Solo en la base desechable (cambia el programa de lealtad del demo)");
test.skip(({ isMobile }) => isMobile, "Dos pantallas a la vez; se prueba una vez");

const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();

test.afterAll(() => {
  sql(`UPDATE loyalty_programs SET sorpresa_activa = false, sorpresa_premio = NULL, sorpresa_uno_de = 10, sorpresa_tope_mes = 20,
       sorpresa_monto_minimo = 0 WHERE tenant_id = '${DEMO.tenant}'`);
});

test("el dueño activa el raspe y gana, y el cliente raspa su tarjeta al pagar", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await entrar(page, "owner");
  await expect(page).toHaveURL(/\/admin\/demo-tablio\//, { timeout: 15_000 });
  await page.goto("/admin/demo-tablio/lealtad");
  const bloque = page.getByTestId("sorpresa-config");
  await expect(bloque).toBeVisible({ timeout: 15_000 });
  await bloque.getByRole("switch").click();
  // El premio no puede ser alcohol
  await bloque.getByLabel("Premio", { exact: true }).fill("Pisco sour gratis");
  await page.getByRole("button", { name: "Guardar programa" }).click();
  await expect(page.getByText("no puede ser alcohol").first()).toBeVisible({ timeout: 10_000 });
  await bloque.getByLabel("Premio", { exact: true }).fill("Postre de la casa");
  await bloque.getByLabel("Gana 1 de cada").fill("2");
  await bloque.getByLabel("Máximo de premios al mes").fill("30");
  await bloque.scrollIntoViewIfNeeded();
  await foto(page, "310-dueno-raspe-y-gana");
  await page.getByRole("button", { name: "Guardar programa" }).click();
  await expect(page.getByText("Programa de lealtad guardado").first()).toBeVisible({ timeout: 10_000 });
  expect(sql(`SELECT sorpresa_activa || '|' || sorpresa_uno_de || '|' || sorpresa_tope_mes FROM loyalty_programs WHERE tenant_id = '${DEMO.tenant}' AND is_active`)).toBe("true|2|30");

  // El cliente paga en la mesa 1 y raspa (los raspes de hoy de otras pruebas se anulan antes)
  const cli = "(SELECT id FROM auth.users WHERE email = 'cliente@demo.tablio.test')";
  sql(`UPDATE loyalty_rewards SET status = 'anulado', anulado_at = now() WHERE status = 'earned' AND id IN (SELECT premio_id FROM raspes WHERE anulado_at IS NULL AND user_id = ${cli});
       UPDATE raspes SET anulado_at = now() WHERE anulado_at IS NULL AND user_id = ${cli}`);
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  const cliente = await ctx.newPage();
  await entrarComoCliente(cliente);
  await cliente.goto(linkMesa(1)!);
  await cliente.getByText("Barros Luco", { exact: true }).last().click();
  await cliente.getByRole("button", { name: /Agregar al carrito/ }).click();
  await cliente.getByText("Ver pedido").click();
  await cliente.getByRole("button", { name: /Ir a pagar/ }).click();
  await cliente.getByRole("button", { name: /Pagar con tarjeta/ }).click();
  await expect(cliente.getByText("¡Pago listo!")).toBeVisible({ timeout: 20_000 });
  const raspe = cliente.getByTestId("raspe");
  await expect(raspe).toBeVisible({ timeout: 15_000 });
  await raspe.scrollIntoViewIfNeeded();
  await foto(cliente, "311-cliente-tiene-un-raspe");

  // Raspa con el dedo, de lado a lado
  const lienzo = raspe.getByLabel("Tarjeta para raspar");
  const caja = (await lienzo.boundingBox())!;
  for (let fila = 8; fila < caja.height; fila += 18) {
    await cliente.mouse.move(caja.x + 4, caja.y + fila);
    await cliente.mouse.down();
    await cliente.mouse.move(caja.x + caja.width - 4, caja.y + fila, { steps: 12 });
    await cliente.mouse.up();
  }
  const resultado = raspe.getByTestId("raspe-resultado");
  await expect(resultado).toContainText(/¡Ganaste Postre de la casa!|Esta vez no tocó/, { timeout: 10_000 });
  const gano = sql(`SELECT gano FROM raspes WHERE anulado_at IS NULL AND user_id = (SELECT id FROM auth.users WHERE email = 'cliente@demo.tablio.test') ORDER BY created_at DESC LIMIT 1`) === "t";
  await expect(resultado).toContainText(gano ? "¡Ganaste" : "Esta vez no tocó");
  if (gano) await expect(cliente.getByTestId("tarjeta-sellos").getByText("Premio sorpresa:")).toBeVisible({ timeout: 10_000 });
  await foto(cliente, "312-cliente-raspo");
  await ctx.close();
});
