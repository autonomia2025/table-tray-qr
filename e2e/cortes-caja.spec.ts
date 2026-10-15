import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { anonimo, conSesion, confirmarPresencia, invitado, qrMesa, DEMO } from "../tests/seguridad/entorno";
import { entrar, foto } from "./apoyo/recorrido";

// Fase 6.2 — Varios cierres de caja al día: al cambio de turno la caja hace un corte (cuenta lo del tramo);
// lo que entra después es del turno siguiente y el cierre del día cuenta solo el último tramo. Solo en la base
// desechable: los cortes de hoy se deshacen al terminar (en la real no se llena el demo de cortes de prueba).
test.skip(process.env.E2E_BASE_DATOS !== "local", "Solo en la base desechable (deshace los cortes directo en la base)");
test.skip(({ isMobile }) => isMobile, "Pantalla de escritorio; se prueba una vez");

const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();
const hoy = `public.dia_abierto('${DEMO.sucursal}', public.dia_negocio('${DEMO.sucursal}', now()))`;
const pesos = (texto: string) => parseInt(texto.replace(/\D/g, ""), 10) || 0;

test.afterAll(() => {
  sql(`DELETE FROM cortes_caja WHERE branch_id = '${DEMO.sucursal}' AND dia = ${hoy};
       UPDATE payments SET corte_numero = 1 WHERE branch_id = '${DEMO.sucursal}' AND dia_negocio = ${hoy};`);
});

test("la caja hace un corte de turno y el cierre cuenta solo desde el último corte", async ({ page }) => {
  test.setTimeout(120_000);
  const agua = (await anonimo().from("menu_items").select("id").eq("tenant_id", DEMO.tenant).eq("name", "Agua mineral").single()).data!.id;
  const caja = (await conSesion("cashier")).cliente;
  const cobrarEfectivo = async () => {
    const c = await invitado();
    await c.rpc("unirse_a_mesa", { _qr_token: qrMesa(7)! });
    await confirmarPresencia(c, 7);
    const p = (await c.rpc("pedir_sin_pagar", { _qr_token: qrMesa(7)!, _items: [{ menu_item_id: agua, quantity: 1 }], _forma: "mozo" })).data as { order_id: string };
    return ((await caja.rpc("registrar_cobro_mozo", { _order_ids: [p.order_id], _metodo: "cash" })).data as { total: number }).total;
  };
  await cobrarEfectivo();

  // Cambio de turno: la cajera cuenta el cajón y hace el corte
  await entrar(page, "cashier");
  await expect(page).toHaveURL(/\/admin\/demo-tablio\/caja/, { timeout: 15_000 });
  await page.getByRole("tab", { name: "Cierre de caja" }).click();
  const cortes = page.getByTestId("cortes-caja");
  await cortes.getByRole("button", { name: "Hacer corte de turno" }).click();
  const esperado = pesos(await cortes.locator("strong").first().innerText());
  expect(esperado).toBeGreaterThan(0);
  await cortes.getByLabel("Nombre del corte").fill("Turno mañana");
  await cortes.getByLabel("Efectivo contado", { exact: true }).fill(String(esperado - 1000));
  await expect(cortes.getByText("Faltan $1.000")).toBeVisible();
  await expect(cortes.getByRole("button", { name: "Guardar corte" })).toBeDisabled();
  await cortes.getByLabel("Efectivo contado", { exact: true }).fill(String(esperado));
  await expect(cortes.getByText("Cuadra")).toBeVisible();
  await foto(page, "230-caja-hacer-corte");
  await cortes.getByRole("button", { name: "Guardar corte" }).click();
  await expect(page.getByText("Corte guardado").first()).toBeVisible({ timeout: 15_000 });
  await expect(cortes.getByRole("cell", { name: /Turno mañana/ })).toBeVisible();

  // Entra un cobro nuevo: es del turno siguiente; el cierre del día cuenta solo eso
  const nuevo = await cobrarEfectivo();
  await page.reload();
  await page.getByRole("tab", { name: "Cierre de caja" }).click();
  const filaEfectivo = page.locator("tr").filter({ has: page.getByRole("cell", { name: "Efectivo", exact: true }) });
  await expect(filaEfectivo.getByText(/desde el último corte/)).toBeVisible({ timeout: 20_000 });
  expect(pesos(await filaEfectivo.getByText(/desde el último corte/).innerText())).toBe(nuevo);
  await page.getByLabel("Efectivo contado desde el último corte").fill(String(nuevo));
  await expect(filaEfectivo.getByText("Cuadra")).toBeVisible();
  await page.getByTestId("cortes-caja").scrollIntoViewIfNeeded();
  await foto(page, "231-caja-cortes-del-dia");
});
