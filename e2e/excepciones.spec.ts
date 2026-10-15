import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { conSesion, confirmarPresencia, invitado, qrMesa, anonimo, DEMO } from "../tests/seguridad/entorno";
import { entrar, foto } from "./apoyo/recorrido";

// Fase 4.6 — Excepciones de la caja: un cobro sin pedido que la pasarela no devolvió, un monto que no calza
// con Transbank y una boleta de ayer sin marcar. La caja las ve en una sola bandeja y las resuelve con una
// explicación. Solo en la base desechable: los casos se preparan directo en esa base (nunca en la real).
test.skip(process.env.E2E_BASE_DATOS !== "local", "Solo en la base desechable (prepara casos directo en la base)");
test.skip(({ isMobile }) => isMobile, "Pantalla de escritorio; se prueba una vez");

const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();

test("la caja ve las excepciones en una bandeja y las resuelve con una explicación", async ({ page }) => {
  test.setTimeout(150_000);
  const agua = (await anonimo().from("menu_items").select("id").eq("tenant_id", DEMO.tenant).eq("name", "Agua mineral").single()).data!.id;
  const caja = (await conSesion("cashier")).cliente;
  const mesa = async (n: number) => (await caja.from("tables").select("id").eq("branch_id", DEMO.sucursal).eq("number", n).single()).data!.id as string;
  await (await conSesion("owner")).cliente.rpc("cerrar_mesa", { _table_id: await mesa(3), _motivo: "preparar prueba" });

  // 1. Pago sin pedido: la pasarela cobró de más, había que devolverlo y la devolución falló 3 veces
  const c = await invitado();
  await c.rpc("unirse_a_mesa", { _qr_token: qrMesa(3)! });
  await confirmarPresencia(c, 3);
  const usuario = (await c.auth.getUser()).data.user!.id;
  const cot = (await c.rpc("cotizar", { _qr_token: qrMesa(3)!, _items: [{ menu_item_id: agua, quantity: 1 }] })).data as { id: string; subtotal: number };
  const intento = JSON.parse(sql(`SELECT reservar_intento_pago('${cot.id}', '${usuario}', 'e2e-exc-${Date.now()}', 'card', 0)`)) as { id: string };
  sql(`SELECT confirmar_pago('${intento.id}', true, ${cot.subtotal + 1500}, 'transbank', 'TBK-E2E', '{}'::jsonb, NULL)`);
  for (let i = 0; i < 3; i++) sql(`SELECT _anotar_devolucion_intento('${intento.id}', false, NULL)`);

  // 2. Monto que no calza: la conciliación con Transbank encontró una diferencia en un pago con la app
  const pagoApp = sql(`SELECT id FROM payments WHERE branch_id = '${DEMO.sucursal}' AND provider <> 'local' ORDER BY created_at DESC LIMIT 1`);
  const dia = sql(`SELECT dia_negocio FROM payments WHERE id = '${pagoApp}'`);
  sql(`DELETE FROM diferencias_pasarela WHERE payment_id = '${pagoApp}'`);
  sql(`SELECT _anotar_conciliacion('${DEMO.sucursal}', '${dia}', '[{"pago_id":"${pagoApp}","calza":false,"monto":8400,"detalle":"Transbank dice AUTHORIZED por 7400 y Tablio cobró 8400"}]'::jsonb)`);

  // 3. Boleta de ayer sin marcar (un cobro en efectivo; ayer está cerrado: al final vuelve a hoy)
  const p = (await c.rpc("pedir_sin_pagar", { _qr_token: qrMesa(3)!, _items: [{ menu_item_id: agua, quantity: 1 }], _forma: "mozo" })).data as { order_id: string };
  const pagoEfectivo = ((await caja.rpc("registrar_cobro_mozo", { _order_ids: [p.order_id], _metodo: "cash" })).data as { payment_id: string }).payment_id;
  sql(`UPDATE payments SET dia_negocio = dia_negocio - 1 WHERE id = '${pagoEfectivo}'`);

  try {
    // El dueño lo ve en su inicio
    await entrar(page, "owner");
    await expect(page).toHaveURL(/\/admin\/demo-tablio\//, { timeout: 15_000 });
    await expect(page.getByText(/excepciones? de caja/).first()).toBeVisible({ timeout: 20_000 });
    await foto(page, "170-inicio-aviso-excepciones");

    // Caja → Excepciones
    await page.goto("/admin/demo-tablio/caja");
    await page.getByRole("tab", { name: /Excepciones/ }).click();
    const bandeja = page.getByTestId("excepciones-caja");
    const devolucion = bandeja.getByTestId("excepcion-devolucion_fallida").filter({ hasText: "Mesa 3" }).first();
    const diferencia = bandeja.getByTestId("excepcion-diferencia_pasarela").filter({ hasText: "7400" }).first();
    const boleta = bandeja.getByTestId("excepcion-boleta_atrasada").filter({ hasText: "Mesa 3" }).first();
    await expect(devolucion).toBeVisible({ timeout: 20_000 });
    await expect(diferencia).toBeVisible();
    await expect(boleta).toBeVisible();
    await foto(page, "171-caja-bandeja-excepciones");

    // El cobro sin pedido se devolvió en efectivo: se explica y sale de la bandeja
    await devolucion.getByRole("button", { name: "Lo devolví de otra forma" }).click();
    const guardar = page.getByRole("dialog").getByRole("button", { name: "Guardar" });
    await expect(guardar).toBeDisabled();
    await page.getByLabel("Qué pasó").fill("Se le devolvió en efectivo; lo entregó Camila");
    await foto(page, "172-caja-explicar-devolucion");
    await guardar.click();
    await expect(page.getByText("Listo, quedó anotado").first()).toBeVisible({ timeout: 10_000 });
    await expect(devolucion).toHaveCount(0, { timeout: 10_000 });

    // La diferencia con Transbank queda revisada
    await diferencia.getByRole("button", { name: "Marcar revisada" }).click();
    await page.getByLabel("Qué pasó").fill("En el portal de Transbank la propina se cobró aparte");
    await page.getByRole("dialog").getByRole("button", { name: "Marcar revisada" }).click();
    await expect(diferencia).toHaveCount(0, { timeout: 10_000 });

    // La boleta se entregó: se anota con su número
    await boleta.getByLabel(/Número de boleta/).fill("10455");
    await boleta.getByRole("button", { name: "Entregada" }).click();
    await expect(boleta).toHaveCount(0, { timeout: 10_000 });
    await foto(page, "173-caja-excepciones-resueltas");

    expect(sql(`SELECT devolucion_estado FROM intentos_pago WHERE id = '${intento.id}'`)).toBe("a_mano");
    expect(sql(`SELECT boleta_estado || ':' || boleta_folio FROM payments WHERE id = '${pagoEfectivo}'`)).toBe("entregada:10455");
  } finally {
    sql(`UPDATE payments SET dia_negocio = dia_negocio + 1 WHERE id = '${pagoEfectivo}'`);
    sql(`DELETE FROM diferencias_pasarela WHERE payment_id = '${pagoApp}'`);
  }
});
