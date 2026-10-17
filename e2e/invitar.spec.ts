import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { DEMO } from "../tests/seguridad/entorno";
import { entrar, foto, liberarMesa, linkMesa } from "./apoyo/recorrido";

// Fase 9.1 — Invitar un trago a otra mesa: el dueño lo activa en Sucursal; desde la carta, alguien de la mesa 3
// invita a la mesa 4; la mesa 4 acepta; recién ahí la mesa 3 paga y el pedido va a la otra mesa.
// Solo en la base desechable (cambia la sucursal del demo y paga de verdad, simulado).
test.skip(process.env.E2E_BASE_DATOS !== "local", "Solo en la base desechable (cambia la sucursal del demo)");
test.skip(({ isMobile }) => isMobile, "Tres pantallas a la vez; se prueba una vez");

const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();
test.afterAll(() => sql(`UPDATE branches SET invitar_mesas = false WHERE id = '${DEMO.sucursal}'`));

test("una mesa invita algo a otra, que acepta; recién ahí se paga", async ({ page, browser }) => {
  test.setTimeout(150_000);
  await liberarMesa(3);
  await liberarMesa(4);
  await entrar(page, "owner");
  await expect(page).toHaveURL(/\/admin\/demo-tablio\//, { timeout: 15_000 });
  await page.goto("/admin/demo-tablio/sucursal");
  const config = page.getByTestId("invitar-mesas-config");
  await expect(config).toBeVisible({ timeout: 15_000 });
  await config.getByRole("switch").click();
  await config.scrollIntoViewIfNeeded();
  await foto(page, "360-dueno-activa-invitar");
  await page.getByRole("button", { name: /Guardar/ }).first().click();
  await expect(page.getByText("Cambios guardados").first()).toBeVisible({ timeout: 10_000 });

  const celular = { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true };
  const ctxA = await browser.newContext(celular);
  const ana = await ctxA.newPage();
  const ctxB = await browser.newContext(celular);
  const beto = await ctxB.newPage();
  await beto.goto(linkMesa(4)!);
  await expect(beto.getByText("Barros Luco", { exact: true }).last()).toBeVisible({ timeout: 20_000 });
  await ana.goto(linkMesa(3)!);

  // Ana invita a la mesa 4 desde la carta
  await ana.getByRole("button", { name: "Invitar algo a otra mesa" }).click({ timeout: 25_000 });
  await ana.getByTestId("elegir-mesa").getByRole("button", { name: "Mesa 4" }).click({ timeout: 15_000 });
  await ana.getByPlaceholder("Busca en la carta").fill("Pisco");
  await ana.getByTestId("elegir-producto").getByRole("button", { name: /Pisco Sour/ }).click();
  await ana.getByLabel("Mensaje para la otra mesa").fill("¡Salud desde la mesa del rincón!");
  await foto(ana, "361-ana-invita-a-la-mesa-4");
  await ana.getByRole("button", { name: "Enviar invitación" }).click();
  await expect(ana.getByTestId("invitacion-enviada")).toContainText("Esperando su respuesta", { timeout: 10_000 });

  // Beto la ve en su carta y la acepta
  await beto.reload();
  const recibida = beto.getByTestId("invitacion-recibida");
  await expect(recibida).toContainText("La mesa 3", { timeout: 20_000 });
  await foto(beto, "362-beto-recibe-la-invitacion");
  await recibida.getByRole("button", { name: "Aceptar" }).click();
  await expect(recibida).toContainText("Aceptaste", { timeout: 10_000 });

  // Ana paga (recién ahora) y el pedido va a la mesa 4
  await ana.reload();
  await ana.getByRole("button", { name: "Pagar la invitación" }).click({ timeout: 20_000 });
  await expect(ana.getByTestId("invitacion-a-pagar")).toContainText("Pisco Sour", { timeout: 15_000 });
  await foto(ana, "363-ana-paga-la-invitacion");
  await ana.getByRole("button", { name: /^Pagar \$/ }).click();
  await expect(ana.getByText("¡Invitación pagada!")).toBeVisible({ timeout: 20_000 });
  expect(sql(`SELECT t.number || '|' || o.payment_status FROM invitaciones_mesa i JOIN orders o ON o.id = i.order_id JOIN tables t ON t.id = o.table_id
              WHERE i.tenant_id = '${DEMO.tenant}' ORDER BY i.created_at DESC LIMIT 1`)).toBe("4|paid");
  await beto.reload();
  await expect(beto.getByTestId("invitacion-recibida")).toContainText("Va en camino", { timeout: 20_000 });
  await foto(beto, "364-beto-ya-viene");
  await ctxA.close();
  await ctxB.close();
});
