import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { conSesion, guardarCuenta, invitado, qrMesa } from "../tests/seguridad/entorno";
import { entrarComoCliente, foto, liberarMesa, linkMesa } from "./apoyo/recorrido";

// Fase 9.5 — "Salud" entre amigos en el mismo bar: el cliente avisa que está, ve a su amigo (que también avisó)
// y recibe un "¡Salud!". Solo en la base desechable (crea cuentas y amistades).
test.skip(process.env.E2E_BASE_DATOS !== "local", "Solo en la base desechable (crea cuentas y amistades)");
test.skip(({ isMobile }) => isMobile, "Se prueba una vez");

const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();
const cliente = "(SELECT id FROM auth.users WHERE email = 'cliente@demo.tablio.test')";
const limpiar = () => sql(`DELETE FROM presencias_comunidad WHERE user_id = ${cliente}; DELETE FROM amistades WHERE de_user_id = ${cliente} OR para_user_id = ${cliente};
  DELETE FROM perfiles_comunidad WHERE user_id = ${cliente}`);
test.beforeAll(limpiar);
test.afterAll(async () => { limpiar(); await liberarMesa(8); await liberarMesa(1); });

test("el cliente avisa que está, ve a su amigo y recibe un salud", async ({ browser }) => {
  test.setTimeout(120_000);
  await liberarMesa(8);
  const yo = (await conSesion("cliente")).cliente;
  await yo.rpc("activar_comunidad", { _nombre: "Cami", _acepto: true });
  const pablo = await invitado();
  await pablo.rpc("unirse_a_mesa", { _qr_token: qrMesa(8)!, _alias: "Pablo" });
  await guardarCuenta(pablo, `pablo-salud-${Date.now()}@demo.tablio.test`);
  await pablo.rpc("activar_comunidad", { _nombre: "Pablo", _acepto: true });
  await pablo.rpc("pedir_amistad", { _codigo: ((await yo.rpc("mi_comunidad")).data as { codigo: string }).codigo });
  await yo.rpc("responder_amistad", { _amistad_id: ((await yo.rpc("mi_comunidad")).data as { solicitudes: { id: string }[] }).solicitudes[0].id, _aceptar: true });
  expect((await pablo.rpc("avisar_que_estoy", { _qr_token: qrMesa(8)!, _activar: true })).error).toBeNull();

  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  const c = await ctx.newPage();
  await entrarComoCliente(c);
  await c.goto(linkMesa(1)!);
  const bloque = c.getByTestId("amigos-aqui");
  await expect(bloque).toContainText("¿Hay amigos tuyos aquí?", { timeout: 20_000 });
  await foto(c, "400-cliente-puede-avisar");
  await bloque.getByRole("button", { name: "Avisar a mis amigos que estoy aquí" }).click();
  await expect(bloque).toContainText("Pablo", { timeout: 10_000 });
  await foto(c, "401-cliente-ve-a-su-amigo");

  // Pablo le manda un salud
  const yoId = sql(`SELECT id FROM auth.users WHERE email = 'cliente@demo.tablio.test'`);
  expect((await pablo.rpc("mandar_salud", { _qr_token: qrMesa(8)!, _amigo_id: yoId })).error).toBeNull();
  await c.reload();
  await expect(c.getByTestId("salud-recibido")).toContainText("Pablo te mandó un salud", { timeout: 20_000 });
  await foto(c, "402-cliente-recibe-un-salud");
  await ctx.close();
});
