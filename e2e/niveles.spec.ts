import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { DEMO } from "../tests/seguridad/entorno";
import { entrar, entrarComoCliente, foto, linkMesa } from "./apoyo/recorrido";

// Fase 7.5 — Niveles y rachas: el dueño los activa en Lealtad con sus premios; el cliente ve su nivel y su
// racha en la tarjeta. Solo en la base desechable (cambia el programa del demo y lo deja como estaba).
test.skip(process.env.E2E_BASE_DATOS !== "local", "Solo en la base desechable (cambia el programa de lealtad del demo)");
test.skip(({ isMobile }) => isMobile, "Dos pantallas a la vez; se prueba una vez");

const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();

test.afterAll(() => {
  sql(`UPDATE loyalty_programs SET niveles_activos = false, premio_plata = NULL, premio_oro = NULL, racha_semanas = NULL,
       racha_dia = NULL, racha_premio = NULL, nivel_plata = 4, nivel_oro = 8 WHERE tenant_id = '${DEMO.tenant}'`);
});

test("el dueño activa niveles y rachas, y el cliente los ve en su tarjeta", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await entrar(page, "owner");
  await expect(page).toHaveURL(/\/admin\/demo-tablio\//, { timeout: 15_000 });
  await page.goto("/admin/demo-tablio/lealtad");
  const bloque = page.getByTestId("niveles-rachas");
  await expect(bloque).toBeVisible({ timeout: 15_000 });
  await bloque.getByRole("switch").click();
  await bloque.getByLabel("Premio al llegar a Plata").fill("Postre de la casa");
  await bloque.getByLabel("Premio al llegar a Oro").fill("Tabla para compartir");
  await bloque.getByRole("combobox", { name: "Racha" }).click();
  await page.getByRole("option", { name: "3 semanas seguidas" }).click();
  await bloque.getByLabel("Premio de la racha").fill("Papas fritas gratis");
  await bloque.scrollIntoViewIfNeeded();
  await foto(page, "290-dueno-niveles-y-rachas");
  await page.getByRole("button", { name: "Guardar programa" }).click();
  await expect(page.getByText("Programa de lealtad guardado").first()).toBeVisible({ timeout: 10_000 });
  expect(sql(`SELECT niveles_activos || '|' || racha_semanas FROM loyalty_programs WHERE tenant_id = '${DEMO.tenant}' AND is_active`)).toBe("true|3");

  // El cliente paga en la mesa 1 y ve su tarjeta con su nivel y su racha
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
  const nivel = cliente.getByTestId("nivel-racha");
  await expect(nivel).toContainText("Nivel", { timeout: 15_000 });
  await expect(nivel).toContainText("semanas seguidas");
  await nivel.scrollIntoViewIfNeeded();
  await foto(cliente, "291-cliente-ve-su-nivel-y-racha");
  await ctx.close();
});
