import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { entrar, foto } from "./apoyo/recorrido";

// Fase 8.2 — Métricas de finanzas desde cobros reales: ingresos, clientes y abandono con cohortes. Arma seis
// meses de cobros de ejemplo en tres locales: solo en la base desechable (y los borra al terminar).
test.skip(process.env.E2E_BASE_DATOS !== "local", "Solo en la base desechable (arma cobros de ejemplo)");
test.skip(({ isMobile }) => isMobile, "Pantallas de escritorio; se prueba una vez");

const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();
const limpiar = () => sql(`DELETE FROM cobros_mensualidad; DELETE FROM suscripciones_local`);
test.afterAll(limpiar);

test("finanzas ve ingresos, clientes y abandono calculados con los cobros", async ({ page }) => {
  limpiar();
  // Tres locales: dos siguen (79 y 129 mil) y uno canceló el mes pasado; cobros pagados mes a mes
  sql(`WITH t AS (SELECT id, row_number() OVER (ORDER BY created_at) n FROM tenants ORDER BY created_at LIMIT 3),
            hoy AS (SELECT date_trunc('month', (now() AT TIME ZONE 'America/Santiago'))::date AS m)
       INSERT INTO suscripciones_local (tenant_id, precio_mensual, dia_cobro, desde, cancelada_at)
       SELECT t.id, CASE t.n WHEN 1 THEN 79000 WHEN 2 THEN 129000 ELSE 99000 END, 1,
              (SELECT m FROM hoy) - make_interval(months => (7 - t.n::int)),
              CASE WHEN t.n = 3 THEN (SELECT m FROM hoy) - interval '20 days' END
         FROM t`);
  sql(`INSERT INTO cobros_mensualidad (tenant_id, periodo, monto, vence_el, estado, pagado_at, medio)
       SELECT s.tenant_id, p::date, s.precio_mensual, p::date + 10, 'pagado', now(), 'transferencia'
         FROM suscripciones_local s,
              generate_series(s.desde, date_trunc('month', coalesce(s.cancelada_at, now()) AT TIME ZONE 'America/Santiago')::date - interval '1 month', interval '1 month') p`);
  sql(`INSERT INTO cobros_mensualidad (tenant_id, periodo, monto, vence_el)
       SELECT tenant_id, date_trunc('month', (now() AT TIME ZONE 'America/Santiago'))::date, precio_mensual, (now() AT TIME ZONE 'America/Santiago')::date + 5
         FROM suscripciones_local WHERE cancelada_at IS NULL`);

  await entrar(page, "finanzas");
  await expect(page).toHaveURL(/\/finanzas/, { timeout: 15_000 });
  await page.goto("/finanzas/revenue");
  await expect(page.getByTestId("mrr")).toHaveText("$208.000", { timeout: 15_000 });
  await foto(page, "340-finanzas-ingresos");
  await page.getByRole("button", { name: "Clientes" }).click();
  await expect(page.getByTestId("clientes-activos")).toHaveText("2", { timeout: 15_000 });
  await foto(page, "341-finanzas-clientes");
  await page.getByRole("button", { name: "Abandono" }).click();
  await expect(page.getByTestId("cohortes")).toBeVisible({ timeout: 15_000 });
  await foto(page, "342-finanzas-abandono-y-cohortes");
});
