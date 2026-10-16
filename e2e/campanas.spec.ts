import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { DEMO } from "../tests/seguridad/entorno";
import { entrar, foto } from "./apoyo/recorrido";

// Fase 7.1 — Campañas: el dueño escribe una promoción, ve a cuántos les llega y la manda; el cliente abre el
// aviso, ve la promoción con el color del local y puede darse de baja. Solo en la base desechable (allí el
// horario se abre para poder probar a cualquier hora y las campañas se borran al terminar).
test.skip(process.env.E2E_BASE_DATOS !== "local", "Solo en la base desechable (envía de verdad y abre el horario)");
test.skip(({ isMobile }) => isMobile, "Varias pantallas a la vez; se prueba una vez");

const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();
const limpiar = () => sql(`DELETE FROM campanas WHERE tenant_id = '${DEMO.tenant}'; DELETE FROM bajas_campanas WHERE tenant_id = '${DEMO.tenant}';
                           DELETE FROM configuracion_tablio WHERE clave = 'campanas';`);

test.afterAll(limpiar);

test("el dueño manda una campaña y el cliente la abre desde el aviso", async ({ page, browser }) => {
  test.setTimeout(120_000);
  limpiar();
  sql(`INSERT INTO configuracion_tablio (clave, valor) VALUES ('campanas', '{"desde_hora": 0, "hasta_hora": 24}');
       INSERT INTO consentimientos_comensal (user_id, promociones, politica_version)
         SELECT id, true, 'prueba' FROM auth.users WHERE email = 'cliente@demo.tablio.test'
       ON CONFLICT (user_id) DO UPDATE SET promociones = true;`);

  await entrar(page, "owner");
  await expect(page).toHaveURL(/\/admin\/demo-tablio\//, { timeout: 15_000 });
  await page.getByRole("button", { name: "Campañas" }).first().click();
  await expect(page.getByRole("heading", { name: "Campañas", exact: true })).toBeVisible({ timeout: 15_000 });

  // Una promoción con 2x1 en tragos no se puede guardar
  await page.getByLabel("Título").fill("Jueves de schop");
  await page.getByLabel("Mensaje").fill("2x1 en schops toda la noche del jueves");
  await page.getByRole("button", { name: "Guardar borrador" }).click();
  await expect(page.getByText(/no pueden premiar tomar más alcohol/).first()).toBeVisible({ timeout: 10_000 });
  await foto(page, "249-dueno-campana-sin-alcohol");
  await page.reload();

  // La de verdad: a los frecuentes
  await page.getByLabel("Título").fill("Volvió el pastel de choclo");
  await page.getByLabel("Mensaje").fill("Este viernes y sábado, con la receta de la casa. ¡Te esperamos!");
  await page.getByRole("radio", { name: /Frecuentes/ }).click();
  await expect(page.getByTestId("alcance-campana")).toContainText("1 cliente en este público", { timeout: 10_000 });
  await foto(page, "250-dueno-nueva-campana");
  await page.getByRole("button", { name: "Enviar campaña" }).click();
  await expect(page.getByText("¿Enviar la campaña?")).toBeVisible();
  await page.getByRole("button", { name: "Enviar ahora" }).click();
  await expect(page.getByText("Campaña enviada").first()).toBeVisible({ timeout: 15_000 });
  const tarjeta = page.getByTestId("campana").filter({ hasText: "Volvió el pastel de choclo" });
  await expect(tarjeta.getByText("Enviada", { exact: true })).toBeVisible();
  await expect(tarjeta.getByText("Le llegó a")).toBeVisible();

  // En la base de prueba el cliente no tiene la app instalada: se simula que el aviso le llegó, como a un
  // cliente real con la app (el envío de verdad lo prueba f7-1-campanas)
  sql(`SELECT public._anotar_aviso_campana(e.id, true) FROM envios_campana e JOIN campanas c ON c.id = e.campana_id
        WHERE c.tenant_id = '${DEMO.tenant}' AND c.titulo = 'Volvió el pastel de choclo'`);

  // El cliente abre el aviso en su celular
  const token = sql(`SELECT e.token FROM envios_campana e JOIN campanas c ON c.id = e.campana_id
                      WHERE c.tenant_id = '${DEMO.tenant}' AND c.titulo = 'Volvió el pastel de choclo'`);
  const cel = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  const cliente = await cel.newPage();
  await cliente.goto(`/demo-tablio/promo/${token}`);
  await expect(cliente.getByRole("heading", { name: "Volvió el pastel de choclo" })).toBeVisible({ timeout: 15_000 });
  await foto(cliente, "252-cliente-abre-la-promocion");
  await cliente.getByRole("button", { name: /No quiero más promociones/ }).click();
  await expect(cliente.getByText(/no te llegarán más promociones/)).toBeVisible({ timeout: 10_000 });
  await foto(cliente, "253-cliente-se-da-de-baja");
  await cel.close();

  // El dueño ve que la abrieron
  await page.reload();
  await expect(tarjeta.getByText("La abrieron")).toBeVisible({ timeout: 15_000 });
  await expect(tarjeta.locator("p", { hasText: /^1$/ }).first()).toBeVisible();
  await tarjeta.scrollIntoViewIfNeeded();
  await foto(page, "251-dueno-resultados-campana");
});
