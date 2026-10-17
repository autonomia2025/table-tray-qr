import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { conSesion, guardarCuenta, invitado } from "../tests/seguridad/entorno";
import { entrarComoCliente, foto, liberarMesa, linkMesa } from "./apoyo/recorrido";

// Fase 9.3 — Planes con amigos: el cliente arma un plan con un amigo en el demo, con la primera ronda elegida;
// el día del plan, la carta le ofrece cargar esa ronda al carrito (se paga como siempre). Solo en la base
// desechable (crea cuentas, amistades y planes).
test.skip(process.env.E2E_BASE_DATOS !== "local", "Solo en la base desechable (crea cuentas y planes)");
test.skip(({ isMobile }) => isMobile, "Se prueba una vez");

const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();
const cliente = "(SELECT id FROM auth.users WHERE email = 'cliente@demo.tablio.test')";
const limpiar = () => sql(`DELETE FROM planes_amigos WHERE creador_id = ${cliente}; DELETE FROM amistades WHERE de_user_id = ${cliente} OR para_user_id = ${cliente};
  DELETE FROM perfiles_comunidad WHERE user_id = ${cliente}`);
test.beforeAll(limpiar);
test.afterAll(async () => { limpiar(); await liberarMesa(10); });

test("el cliente arma un plan con un amigo y el día del plan pide la primera ronda con un toque", async ({ browser }) => {
  test.setTimeout(120_000);
  // El cliente y Pablo son amigos en la comunidad
  const yo = (await conSesion("cliente")).cliente;
  await yo.rpc("activar_comunidad", { _nombre: "Cami", _acepto: true });
  const pablo = await invitado();
  await guardarCuenta(pablo, `pablo-plan-${Date.now()}@demo.tablio.test`);
  await pablo.rpc("activar_comunidad", { _nombre: "Pablo", _acepto: true });
  await pablo.rpc("pedir_amistad", { _codigo: ((await yo.rpc("mi_comunidad")).data as { codigo: string }).codigo });
  await yo.rpc("responder_amistad", { _amistad_id: ((await yo.rpc("mi_comunidad")).data as { solicitudes: { id: string }[] }).solicitudes[0].id, _aceptar: true });

  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  const c = await ctx.newPage();
  await entrarComoCliente(c);
  const t = new URL(linkMesa(10)!, "http://x").searchParams.get("t");
  await c.goto(`/demo-tablio/comunidad?t=${t}`);
  await c.getByRole("button", { name: "Armar un plan" }).click({ timeout: 20_000 });
  const nuevo = c.getByTestId("nuevo-plan");
  await nuevo.getByLabel("Local del plan").selectOption({ label: "Demo Tablio" });
  const viernes = new Date();
  viernes.setDate(viernes.getDate() + (((5 - viernes.getDay()) + 7) % 7 || 7)); // el próximo viernes
  viernes.setHours(20, 30, 0, 0);
  const local = new Date(viernes.getTime() - viernes.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  await nuevo.getByLabel("Fecha y hora del plan").fill(local);
  await nuevo.getByLabel("Invitar a Pablo").click();
  await nuevo.getByLabel("Mensaje del plan").fill("¡Viernes de schop con los de la U!");
  await nuevo.getByLabel("Buscar en la carta del plan").fill("Schop");
  await nuevo.getByRole("button", { name: "Más Schop Torobayo 500cc" }).click();
  await nuevo.getByRole("button", { name: "Más Schop Torobayo 500cc" }).click();
  await foto(c, "380-cliente-arma-un-plan");
  await nuevo.getByRole("button", { name: "Invitar al plan" }).click();
  await expect(c.getByTestId("plan").first()).toContainText("Demo Tablio", { timeout: 15_000 });
  // Pablo dice que va
  const delPablo = ((await pablo.rpc("mis_planes")).data as { id: string }[])[0];
  await pablo.rpc("responder_plan", { _plan_id: delPablo.id, _voy: true });
  await c.reload();
  await expect(c.getByTestId("plan").first()).toContainText("Pablo ✓", { timeout: 15_000 });
  await foto(c, "381-cliente-ve-quien-va");

  // El día del plan: se adelanta la fecha y la carta ofrece la primera ronda
  sql(`UPDATE planes_amigos SET fecha = now() + interval '20 minutes' WHERE creador_id = ${cliente}`);
  await c.goto(linkMesa(10)!);
  const hoy = c.getByTestId("plan-de-hoy");
  await expect(hoy).toBeVisible({ timeout: 20_000 });
  await foto(c, "382-cliente-plan-de-hoy-en-la-carta");
  await hoy.getByRole("button", { name: "Pedir la primera ronda" }).click();
  await expect(c).toHaveURL(/\/cart/, { timeout: 10_000 });
  await expect(c.getByText("Schop Torobayo 500cc").first()).toBeVisible();
  await foto(c, "383-primera-ronda-en-el-carrito");
  await ctx.close();
});
