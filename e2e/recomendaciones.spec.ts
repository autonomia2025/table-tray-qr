import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { conSesion, guardarCuenta, invitado, llamarFuncion, qrMesa, DEMO } from "../tests/seguridad/entorno";
import { entrarComoCliente, foto, linkMesa } from "./apoyo/recorrido";

// Fase 9.4 — Recomendaciones de conocidos: un amigo recomienda algo que pagó; al día siguiente el cliente lo ve
// en la carta; el cliente recomienda desde su pasaporte. Solo en la base desechable (crea cuentas y pagos).
test.skip(process.env.E2E_BASE_DATOS !== "local", "Solo en la base desechable (crea cuentas y pagos)");
test.skip(({ isMobile }) => isMobile, "Se prueba una vez");

const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();
const cliente = "(SELECT id FROM auth.users WHERE email = 'cliente@demo.tablio.test')";
const limpiar = () => sql(`DELETE FROM recomendaciones_amigos WHERE user_id = ${cliente}; DELETE FROM amistades WHERE de_user_id = ${cliente} OR para_user_id = ${cliente};
  DELETE FROM perfiles_comunidad WHERE user_id = ${cliente}`);
test.beforeAll(limpiar);
test.afterAll(limpiar);

test("un amigo recomienda un plato, el cliente lo ve en la carta y recomienda desde su pasaporte", async ({ browser }) => {
  test.setTimeout(120_000);
  const yo = (await conSesion("cliente")).cliente;
  await yo.rpc("activar_comunidad", { _nombre: "Cami", _acepto: true });
  const pablo = await invitado();
  await pablo.rpc("unirse_a_mesa", { _qr_token: qrMesa(7)!, _alias: "Pablo" });
  await guardarCuenta(pablo, `pablo-reco-${Date.now()}@demo.tablio.test`);
  await pablo.rpc("activar_comunidad", { _nombre: "Pablo", _acepto: true });
  await pablo.rpc("pedir_amistad", { _codigo: ((await yo.rpc("mi_comunidad")).data as { codigo: string }).codigo });
  await yo.rpc("responder_amistad", { _amistad_id: ((await yo.rpc("mi_comunidad")).data as { solicitudes: { id: string }[] }).solicitudes[0].id, _aceptar: true });
  // Pablo paga un Barros Luco y lo recomienda; pasan 24 horas
  const barros = sql(`SELECT id FROM menu_items WHERE tenant_id = '${DEMO.tenant}' AND name = 'Barros Luco'`);
  const cot = (await pablo.rpc("cotizar", { _qr_token: qrMesa(7)!, _items: [{ menu_item_id: barros, quantity: 1 }] })).data as { id: string };
  await llamarFuncion("process-payment", { table_token: qrMesa(7), method: "card", tip_amount: 0, cotizacion_id: cot.id, idempotency_key: `reco-e2e-${Date.now()}` },
    (await pablo.auth.getSession()).data.session!.access_token);
  expect((await pablo.rpc("recomendar_plato", { _menu_item_id: barros, _comentario: "El pan amasado es otra cosa" })).error).toBeNull();
  sql(`UPDATE recomendaciones_amigos SET created_at = now() - interval '25 hours', visible_desde = now() - interval '1 hour' WHERE menu_item_id = '${barros}'`);

  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  const c = await ctx.newPage();
  await entrarComoCliente(c);
  await c.goto(linkMesa(1)!);
  const recomiendan = c.getByTestId("recomiendan-amigos");
  await expect(recomiendan).toContainText("Barros Luco", { timeout: 20_000 });
  await expect(recomiendan).toContainText("Pablo");
  await foto(c, "390-cliente-ve-lo-que-recomiendan");

  // El cliente recomienda desde su pasaporte
  await c.goto(`/demo-tablio/pasaporte${new URL(linkMesa(1)!, "http://x").search}`);
  const bloque = c.getByTestId("recomendar-probados");
  await expect(bloque).toBeVisible({ timeout: 15_000 });
  await bloque.getByRole("button", { name: "Recomendar" }).first().click();
  await bloque.getByRole("textbox").first().fill("Imperdible");
  await bloque.scrollIntoViewIfNeeded();
  await foto(c, "391-cliente-recomienda-desde-el-pasaporte");
  await bloque.getByRole("button", { name: "Guardar" }).click();
  await expect(bloque.getByText("Recomendado ✓").first()).toBeVisible({ timeout: 10_000 });
  await foto(c, "392-cliente-recomendado");
  await ctx.close();
});
