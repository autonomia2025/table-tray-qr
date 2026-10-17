import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { DEMO } from "../tests/seguridad/entorno";
import { entrar, foto } from "./apoyo/recorrido";

// Fase 8.1 — La mensualidad de Tablio: finanzas crea la suscripción del local, el dueño ve lo que debe (con
// aviso en Inicio) y finanzas registra el pago. Solo en la base desechable (crea suscripciones y cobros).
test.skip(process.env.E2E_BASE_DATOS !== "local", "Solo en la base desechable (crea suscripciones y cobros)");
test.skip(({ isMobile }) => isMobile, "Pantallas de escritorio; se prueba una vez");

const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();
const limpiar = () => sql(`DELETE FROM cobros_mensualidad WHERE tenant_id = '${DEMO.tenant}'; DELETE FROM suscripciones_local WHERE tenant_id = '${DEMO.tenant}';
  UPDATE tenants SET plan_id = NULL, plan_status = 'active' WHERE id = '${DEMO.tenant}';
  DELETE FROM configuracion_tablio WHERE clave = 'datos_pago_tablio'`);
test.beforeAll(limpiar);
test.afterAll(limpiar);

test("finanzas crea la suscripción, el dueño ve lo que debe y finanzas registra el pago", async ({ page, browser }) => {
  test.setTimeout(120_000);
  sql(`INSERT INTO configuracion_tablio (clave, valor) VALUES ('datos_pago_tablio', to_jsonb('Transferencia a Tablio SpA · Cuenta corriente 123456789 · RUT 77.777.777-7 · pagos@tablio.cl'::text))`);
  await entrar(page, "finanzas");
  await expect(page).toHaveURL(/\/finanzas/, { timeout: 15_000 });
  await page.goto("/finanzas/mensualidades");
  const fila = page.getByTestId("tabla-mensualidades").getByRole("row", { name: /Demo Tablio/ });
  await fila.getByRole("button", { name: "Crear suscripción" }).click();
  await page.getByRole("combobox", { name: "Plan" }).click();
  await page.getByRole("option", { name: "Hasta 12 mesas" }).click();
  await page.getByLabel("Mensualidad (pesos)").fill("79000");
  await page.getByLabel("Día de cobro").fill("1");
  await page.getByRole("button", { name: "Guardar suscripción" }).click();
  await expect(page.getByText("Suscripción guardada").first()).toBeVisible({ timeout: 10_000 });
  await expect(fila).toContainText("Al día");

  // El cobro de este mes, vencido hace 3 días (en gracia)
  sql(`INSERT INTO cobros_mensualidad (tenant_id, periodo, monto, vence_el)
       VALUES ('${DEMO.tenant}', date_trunc('month', (now() AT TIME ZONE 'America/Santiago'))::date, 79000, (now() AT TIME ZONE 'America/Santiago')::date - 3)`);
  await page.reload();
  await expect(fila).toContainText("Vencida (en gracia)", { timeout: 15_000 });
  await fila.scrollIntoViewIfNeeded();
  await foto(page, "330-finanzas-mensualidades");

  // El dueño lo ve en Inicio y en Sucursal
  const ctx = await browser.newContext();
  const dueno = await ctx.newPage();
  await entrar(dueno, "owner");
  await expect(dueno).toHaveURL(/\/admin\/demo-tablio\/inicio/, { timeout: 15_000 });
  await expect(dueno.getByText(/Tu mensualidad de Tablio/)).toBeVisible({ timeout: 15_000 });
  await dueno.getByText(/Tu mensualidad de Tablio/).scrollIntoViewIfNeeded();
  await foto(dueno, "331-dueno-aviso-mensualidad");
  await dueno.goto("/admin/demo-tablio/sucursal");
  const bloque = dueno.getByTestId("mensualidad-local");
  await expect(bloque).toContainText("$79.000", { timeout: 15_000 });
  await expect(bloque).toContainText("Cuenta corriente 123456789");
  await bloque.scrollIntoViewIfNeeded();
  await foto(dueno, "332-dueno-tu-plan-con-tablio");

  // Finanzas registra el pago
  await page.getByTestId("tabla-cobros").getByRole("button", { name: "Registrar pago" }).click();
  await page.getByLabel("Referencia (opcional)").fill("TRF 0001");
  await foto(page, "333-finanzas-registra-pago");
  await page.getByRole("dialog").getByRole("button", { name: "Registrar pago" }).click();
  await expect(page.getByText("Pago registrado").first()).toBeVisible({ timeout: 10_000 });
  await expect(fila).toContainText("Al día");
  await dueno.reload();
  await expect(dueno.getByTestId("mensualidad-local")).toContainText("Pagado", { timeout: 15_000 });
  await ctx.close();
});
