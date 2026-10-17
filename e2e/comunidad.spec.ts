import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { guardarCuenta, invitado } from "../tests/seguridad/entorno";
import { entrar, entrarComoCliente, foto, linkMesa } from "./apoyo/recorrido";

// Fase 9.2 — Comunidad y amigos: el cliente activa la comunidad (con permiso explícito), recibe una solicitud
// por su código y la acepta; Tablio modera un reporte. Solo en la base desechable (crea cuentas y perfiles).
test.skip(process.env.E2E_BASE_DATOS !== "local", "Solo en la base desechable (crea cuentas y perfiles)");
test.skip(({ isMobile }) => isMobile, "Dos pantallas a la vez; se prueba una vez");

const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();
const cliente = "(SELECT id FROM auth.users WHERE email = 'cliente@demo.tablio.test')";
const limpiar = () => sql(`DELETE FROM perfiles_comunidad WHERE user_id = ${cliente}; DELETE FROM amistades WHERE de_user_id = ${cliente} OR para_user_id = ${cliente};
  DELETE FROM reportes_comunidad WHERE motivo LIKE 'Prueba:%'`);
test.beforeAll(limpiar);
test.afterAll(limpiar);

test("el cliente activa la comunidad, acepta a un amigo y Tablio modera un reporte", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  const c = await ctx.newPage();
  await entrarComoCliente(c);
  await c.goto(linkMesa(1)!);
  await c.getByRole("button", { name: "Mi cuenta" }).click({ timeout: 20_000 });
  await c.getByTestId("cuenta-comunidad").click();
  const activar = c.getByTestId("activar-comunidad");
  await expect(activar).toBeVisible({ timeout: 15_000 });
  await c.getByLabel("Tu nombre en la comunidad").fill("Cami");
  await c.getByLabel("Acepto usar la comunidad").click();
  await foto(c, "370-cliente-activa-comunidad");
  await c.getByRole("button", { name: "Activar comunidad" }).click();
  const codigo = (await c.getByTestId("mi-codigo").textContent({ timeout: 15_000 }))!.trim();
  expect(codigo).toMatch(/^TAB-/);

  // Un amigo (otra cuenta) le pide amistad con su código
  const amigo = await invitado();
  await guardarCuenta(amigo, `amigo-cami-${Date.now()}@demo.tablio.test`);
  expect((await amigo.rpc("activar_comunidad", { _nombre: "Pablo", _acepto: true })).error).toBeNull();
  expect((await amigo.rpc("pedir_amistad", { _codigo: codigo })).error).toBeNull();
  await c.reload();
  const solicitud = c.getByTestId("solicitud-amistad");
  await expect(solicitud).toContainText("Pablo", { timeout: 15_000 });
  await foto(c, "371-cliente-recibe-solicitud");
  await solicitud.getByRole("button", { name: "Aceptar" }).click();
  await expect(c.getByTestId("amigo")).toContainText("Pablo", { timeout: 10_000 });
  await foto(c, "372-cliente-con-un-amigo");
  await ctx.close();

  // Tablio ve un reporte y lo revisa con una nota
  sql(`INSERT INTO reportes_comunidad (reporta_id, reportado_id, motivo)
       SELECT ${cliente}, user_id, 'Prueba: me escribe cosas que no corresponden' FROM perfiles_comunidad WHERE nombre = 'Pablo' ORDER BY created_at DESC LIMIT 1`);
  await entrar(page, "superadmin");
  await expect(page).toHaveURL(/\/superadmin/, { timeout: 15_000 });
  await page.getByRole("button", { name: "Comunidad" }).first().click();
  const reporte = page.getByTestId("reporte-comunidad").filter({ hasText: "Pablo" }).first();
  await expect(reporte).toBeVisible({ timeout: 15_000 });
  await reporte.getByLabel("Nota de moderación").fill("Revisado: se le advierte");
  await foto(page, "373-superadmin-modera-reporte");
  await reporte.getByRole("button", { name: "Marcar revisado" }).click();
  await expect(page.getByText("Reporte revisado").first()).toBeVisible({ timeout: 10_000 });
});
