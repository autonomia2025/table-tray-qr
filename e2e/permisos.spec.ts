import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { DEMO } from "../tests/seguridad/entorno";
import { entrar, foto } from "./apoyo/recorrido";

// Fase 6.3 — Permisos por rol: el dueño le da a la caja los reportes y le quita devolver plata; la cajera
// ve Reportes en su menú y ya no ve el botón «Reembolsar». Solo en la base desechable (los permisos del
// demo se dejan de fábrica al terminar, directo en esa base).
test.skip(process.env.E2E_BASE_DATOS !== "local", "Solo en la base desechable (deja los permisos de fábrica directo en la base)");
test.skip(({ isMobile }) => isMobile, "Pantalla de escritorio; se prueba una vez");

const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();

test.afterAll(() => { sql(`DELETE FROM permisos_rol WHERE tenant_id = '${DEMO.tenant}'`); });

test("el dueño ajusta los permisos de la caja y la cajera ve solo lo que puede", async ({ page, browser }) => {
  test.setTimeout(120_000);
  sql(`DELETE FROM permisos_rol WHERE tenant_id = '${DEMO.tenant}'`);

  await entrar(page, "owner");
  await expect(page).toHaveURL(/\/admin\/demo-tablio\//, { timeout: 15_000 });
  await page.goto("/admin/demo-tablio/equipo");
  const permisos = page.getByTestId("permisos-roles");
  await expect(permisos.getByText("Permisos por rol")).toBeVisible({ timeout: 15_000 });
  const reportesCaja = permisos.getByRole("switch", { name: "Ver reportes · Cajero" });
  const devolverCaja = permisos.getByRole("switch", { name: "Devolver plata · Cajero" });
  await expect(reportesCaja).not.toBeChecked();
  await expect(devolverCaja).toBeChecked();
  // Devolver plata no se le puede dar al mozo: no tiene interruptor
  await expect(permisos.getByRole("switch", { name: "Devolver plata · Mozo" })).toHaveCount(0);

  await reportesCaja.click();
  await expect(reportesCaja).toBeChecked({ timeout: 10_000 });
  await devolverCaja.click();
  await expect(devolverCaja).not.toBeChecked({ timeout: 10_000 });
  await permisos.evaluate((e) => e.scrollIntoView({ block: "start" }));
  await foto(page, "240-dueno-permisos-por-rol");

  // La cajera: Reportes aparece en su menú y el botón de reembolsar ya no está
  const ctx = await browser.newContext();
  const cajera = await ctx.newPage();
  await entrar(cajera, "cashier");
  await expect(cajera).toHaveURL(/\/admin\/demo-tablio\/caja/, { timeout: 15_000 });
  await expect(cajera.getByRole("button", { name: "Reportes" }).first()).toBeVisible({ timeout: 15_000 });
  await expect(cajera.getByText("Sin pagos este día").or(cajera.locator("tbody tr").first())).toBeVisible({ timeout: 15_000 });
  await expect(cajera.getByRole("button", { name: /Reembolsar/ })).toHaveCount(0);
  await foto(cajera, "241-caja-sin-reembolsar-con-reportes");
  await cajera.getByRole("button", { name: "Reportes" }).first().click();
  await expect(cajera).toHaveURL(/\/reportes/, { timeout: 15_000 });
  await ctx.close();
});
