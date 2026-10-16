import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { DEMO } from "../tests/seguridad/entorno";
import { entrar, foto } from "./apoyo/recorrido";

// Fase 7.9 — Módulos por plan: el superadmin ve qué trae cada plan y apaga un módulo para un local, con motivo;
// el dueño de ese local deja de verlo. Solo en la base desechable (cambia los módulos del demo y los deja como estaban).
test.skip(process.env.E2E_BASE_DATOS !== "local", "Solo en la base desechable (cambia los módulos del demo)");
test.skip(({ isMobile }) => isMobile, "Pantallas de escritorio; se prueba una vez");

const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();
test.afterAll(() => sql(`DELETE FROM tenant_feature_flags WHERE tenant_id = '${DEMO.tenant}'`));

test("el superadmin apaga Campañas para un local y su dueño deja de verlas", async ({ page, browser }) => {
  test.setTimeout(90_000);
  await entrar(page, "superadmin");
  await expect(page).toHaveURL(/\/superadmin/, { timeout: 15_000 });
  await page.getByRole("button", { name: "Planes y módulos" }).first().click();
  const planes = page.getByTestId("modulos-planes");
  await expect(planes.getByText("Raspe y gana")).toBeVisible({ timeout: 15_000 });
  await expect(planes.getByText("Hasta 12 mesas")).toBeVisible();
  await foto(page, "320-superadmin-planes-y-modulos");

  const local = page.getByTestId("modulos-local");
  await local.getByRole("combobox", { name: "Local" }).click();
  await page.getByRole("option", { name: "Demo Tablio", exact: true }).click();
  await local.getByLabel("Motivo del ajuste").fill("Demo sin campañas por un rato");
  await local.getByRole("combobox", { name: "Ajuste de Campañas" }).click();
  await page.getByRole("option", { name: "Apagado" }).click();
  await expect(page.getByText("Módulo ajustado").first()).toBeVisible({ timeout: 10_000 });
  await local.getByRole("combobox", { name: "Ajuste de Campañas" }).scrollIntoViewIfNeeded();
  await foto(page, "321-superadmin-apaga-campanas");
  expect(sql(`SELECT is_enabled FROM tenant_feature_flags WHERE tenant_id = '${DEMO.tenant}' AND flag_key = 'campanas'`)).toBe("f");

  // El dueño ya no ve Campañas en su menú, y si entra directo se le explica
  const ctx = await browser.newContext();
  const dueno = await ctx.newPage();
  await entrar(dueno, "owner");
  await expect(dueno).toHaveURL(/\/admin\/demo-tablio\//, { timeout: 15_000 });
  await expect(dueno.getByRole("button", { name: "Lealtad" }).first()).toBeVisible({ timeout: 15_000 });
  await expect(dueno.getByRole("button", { name: "Campañas" })).toHaveCount(0);
  await dueno.goto("/admin/demo-tablio/campanas");
  await expect(dueno.getByTestId("modulo-no-incluido")).toBeVisible({ timeout: 15_000 });
  await foto(dueno, "322-dueno-sin-campanas");
  await ctx.close();
});
