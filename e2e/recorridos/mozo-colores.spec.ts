import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { conSesion, invitado, llamarFuncion, qrMesa, anonimo, DEMO } from "../../tests/seguridad/entorno";
import { entrar, foto } from "../apoyo/recorrido";

// Recorrido con fotos: la pantalla del mozo con mesas en distintos estados y cronómetros.
// Solo en la base desechable: para que los cronómetros muestren minutos reales se adelantan las horas
// de los pedidos de prueba directamente en esa base (nunca en la real).
test.skip(!process.env.RECORRIDO || process.env.E2E_BASE_DATOS !== "local", "Solo para el recorrido, en la base desechable");
test.skip(({ isMobile }) => !isMobile, "Recorrido en celular");

const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-q", "-v", "ON_ERROR_STOP=1", "-c", q]);

async function pagarEnMesa(mesa: number, producto: string) {
  const c = await invitado();
  await c.rpc("unirse_a_mesa", { _qr_token: qrMesa(mesa)! });
  const token = (await c.auth.getSession()).data.session!.access_token;
  const { data: item } = await anonimo().from("menu_items").select("id").eq("tenant_id", DEMO.tenant).eq("name", producto).single();
  const r = await llamarFuncion("process-payment", { table_token: qrMesa(mesa), method: "card", cart_items: [{ menu_item_id: item!.id, quantity: 1 }], idempotency_key: `rc-${mesa}-${Date.now()}` }, token);
  return { comensal: c, pedido: JSON.parse(r.cuerpo).order.id as string };
}

test("recorrido: mesas del mozo en colores, con cronómetros", async ({ page }) => {
  test.setTimeout(120_000);
  const cocina = (await conSesion("kitchen")).cliente;
  const mozo = (await conSesion("waiter")).cliente;

  // Mesa 2: pagada hace 18 min y en cocina (amarillo: se está demorando)
  const m2 = await pagarEnMesa(2, "Agua mineral");
  await cocina.rpc("cambiar_estado_pedido", { _order_id: m2.pedido, _estado: "in_kitchen" });
  // Mesa 3: lista hace 8 min (rojo: se enfría)
  const m3 = await pagarEnMesa(3, "Pisco Sour");
  await cocina.rpc("cambiar_estado_pedido", { _order_id: m3.pedido, _estado: "in_kitchen" });
  await cocina.rpc("cambiar_estado_pedido", { _order_id: m3.pedido, _estado: "ready" });
  // Mesa 4: pagada hace 3 min, recién en cocina
  const m4 = await pagarEnMesa(4, "Limonada menta jengibre");
  await cocina.rpc("cambiar_estado_pedido", { _order_id: m4.pedido, _estado: "in_kitchen" });
  // Mesa 6: llaman al mozo hace 3 min
  const m6 = await pagarEnMesa(6, "Agua mineral");
  await m6.comensal.rpc("llamar_mozo", { _qr_token: qrMesa(6)!, _motivo: "help" });
  // Mesa 7: pedido tomado a mano, por cobrar hace 6 min
  const { data: agua } = await anonimo().from("menu_items").select("id").eq("tenant_id", DEMO.tenant).eq("name", "Agua mineral").single();
  const mesa7 = (await cocina.from("tables").select("id").eq("branch_id", DEMO.sucursal).eq("number", 7).single()).data!.id;
  await mozo.rpc("crear_pedido_mozo", { _table_id: mesa7, _items: [{ menu_item_id: agua!.id, quantity: 2 }] });

  sql(`UPDATE orders SET confirmed_at = now() - interval '18 minutes' WHERE id = '${m2.pedido}';
       UPDATE payments SET created_at = now() - interval '18 minutes' WHERE order_id = '${m2.pedido}';
       UPDATE orders SET confirmed_at = now() - interval '14 minutes', ready_at = now() - interval '8 minutes' WHERE id = '${m3.pedido}';
       UPDATE payments SET created_at = now() - interval '14 minutes' WHERE order_id = '${m3.pedido}';
       UPDATE orders SET confirmed_at = now() - interval '3 minutes' WHERE id = '${m4.pedido}';
       UPDATE payments SET created_at = now() - interval '3 minutes' WHERE order_id = '${m4.pedido}';
       UPDATE waiter_calls SET created_at = now() - interval '3 minutes' WHERE table_id = (SELECT id FROM tables WHERE branch_id = '${DEMO.sucursal}' AND number = 6) AND status = 'pending';
       UPDATE orders SET confirmed_at = now() - interval '6 minutes' WHERE table_id = '${mesa7}' AND source = 'waiter';`);

  await entrar(page, "waiter");
  await expect(page).toHaveURL(/\/mozo\/mesas/, { timeout: 15_000 });
  await expect(page.getByText("✅ Listo para llevar").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/listo hace 8 min/).first()).toBeVisible();
  await foto(page, "20-mozo-mesas-colores");
  await page.evaluate(() => window.scrollBy(0, 700));
  await foto(page, "21-mozo-mesas-colores-abajo");

  // Detalle de una mesa: la acción principal arriba; "tomar pedido a mano" queda como respaldo
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator("div.rounded-xl").filter({ has: page.locator("span.text-4xl", { hasText: /^3$/ }) }).first().click();
  await expect(page.getByRole("button", { name: /Tomar pedido a mano/ })).toBeVisible();
  await foto(page, "22-mozo-detalle-mesa");
});
