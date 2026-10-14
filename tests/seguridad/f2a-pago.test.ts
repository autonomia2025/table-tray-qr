import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonimo, conSesion, hayCredenciales, invitado, llamarFuncion, qrMesa, DEMO } from "./entorno";

// Fase 2.A — Núcleo del pago: cotización con precio congelado, intento reservado antes de cobrar y
// confirmación atómica. Los casos difíciles de la plata (CLAUDE.md, regla de calidad 3).

const LOCAL = !!process.env.DEMO_CREDENCIALES; // base desechable: permite mover horas y llamar funciones internas
const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();

async function comensalEn(mesa: number) {
  const c = await invitado();
  await c.rpc("unirse_a_mesa", { _qr_token: qrMesa(mesa)! });
  const token = (await c.auth.getSession()).data.session!.access_token;
  return { c, token };
}

describe.skipIf(!hayCredenciales)("núcleo del pago", () => {
  let dueno: SupabaseClient;
  let cocina: SupabaseClient;
  let mozo: SupabaseClient;
  const ids: Record<string, string> = {};
  const linea = (nombre: string, cantidad = 1) => [{ menu_item_id: ids[nombre], quantity: cantidad }];
  const pagar = (token: string, mesa: number, body: Record<string, unknown>) =>
    llamarFuncion("process-payment", { table_token: qrMesa(mesa), method: "card", ...body }, token);

  beforeAll(async () => {
    dueno = (await conSesion("owner")).cliente;
    cocina = (await conSesion("kitchen")).cliente;
    mozo = (await conSesion("waiter")).cliente;
    const { data } = await anonimo().from("menu_items").select("id, name").eq("tenant_id", DEMO.tenant);
    for (const p of data ?? []) ids[p.name] = p.id;
  });

  it("la cotización congela el precio, es solo del comensal y nadie la escribe directo", async () => {
    const { c } = await comensalEn(2);
    const r = await c.rpc("cotizar", { _qr_token: qrMesa(2)!, _items: linea("Agua mineral", 2) });
    expect(r.error).toBeNull();
    const cot = r.data as { id: string; subtotal: number; expira_at: string };
    const { data: agua } = await anonimo().from("menu_items").select("price").eq("id", ids["Agua mineral"]).single();
    expect(cot.subtotal).toBe(agua!.price * 2);
    expect(new Date(cot.expira_at).getTime() - Date.now()).toBeGreaterThan(9 * 60_000);

    const otro = await invitado();
    expect((await otro.from("cotizaciones").select("id").eq("id", cot.id)).data ?? []).toHaveLength(0);
    expect((await c.from("cotizaciones").update({ subtotal: 1 }).eq("id", cot.id)).error).not.toBeNull();
    expect((await c.from("intentos_pago").insert({ cotizacion_id: cot.id, idempotency_key: "x".repeat(10) })).error).not.toBeNull();
    expect((await anonimo().rpc("cotizar", { _qr_token: qrMesa(2)!, _items: linea("Agua mineral") })).error).not.toBeNull();
  });

  it("si el dueño cambia el precio después de cotizar, se cobra el precio congelado", async () => {
    const { c, token } = await comensalEn(3);
    const { data: antes } = await dueno.from("menu_items").select("price").eq("id", ids["Agua mineral"]).single();
    const cot = (await c.rpc("cotizar", { _qr_token: qrMesa(3)!, _items: linea("Agua mineral") })).data as { id: string; subtotal: number };
    await dueno.from("menu_items").update({ price: antes!.price + 5000 }).eq("id", ids["Agua mineral"]);
    try {
      const r = await pagar(token, 3, { cotizacion_id: cot.id, idempotency_key: `cong-${Date.now()}` });
      expect(r.status).toBe(200);
      expect(JSON.parse(r.cuerpo).payment.amount).toBe(antes!.price);
    } finally {
      await dueno.from("menu_items").update({ price: antes!.price }).eq("id", ids["Agua mineral"]);
    }
  });

  it("el mismo pago repetido 5 veces al mismo tiempo se cobra una sola vez", async () => {
    const { c, token } = await comensalEn(4);
    const cot = (await c.rpc("cotizar", { _qr_token: qrMesa(4)!, _items: linea("Agua mineral") })).data as { id: string };
    const clave = `rep-${Date.now()}`;
    const respuestas = await Promise.all(Array.from({ length: 5 }, () => pagar(token, 4, { cotizacion_id: cot.id, idempotency_key: clave })));
    const aprobadas = respuestas.filter((r) => r.status === 200);
    expect(aprobadas.length).toBeGreaterThanOrEqual(1);
    const { data: pagos } = await dueno.from("payments").select("id, order_id").eq("idempotency_key", clave);
    expect(pagos).toHaveLength(1);
    // Repetir después responde lo mismo, sin cobrar
    const despues = await pagar(token, 4, { cotizacion_id: cot.id, idempotency_key: clave });
    expect(despues.status).toBe(200);
    expect(JSON.parse(despues.cuerpo).duplicate).toBe(true);
    expect(JSON.parse(despues.cuerpo).payment.id).toBe(pagos![0].id);
  });

  it("dos pagos distintos de la misma cotización al mismo tiempo: solo uno se cobra", async () => {
    const { c, token } = await comensalEn(4);
    const cot = (await c.rpc("cotizar", { _qr_token: qrMesa(4)!, _items: linea("Agua mineral") })).data as { id: string };
    const [a, b] = await Promise.all([
      pagar(token, 4, { cotizacion_id: cot.id, idempotency_key: `doble-a-${Date.now()}` }),
      pagar(token, 4, { cotizacion_id: cot.id, idempotency_key: `doble-b-${Date.now()}` }),
    ]);
    expect([a.status, b.status].filter((s) => s === 200)).toHaveLength(1);
    const { data: pagos } = await dueno.from("payments").select("id").like("idempotency_key", "doble-%").eq("table_id", (await dueno.from("tables").select("id").eq("branch_id", DEMO.sucursal).eq("number", 4).single()).data!.id).gte("created_at", new Date(Date.now() - 60_000).toISOString());
    expect(pagos).toHaveLength(1);
  });

  it("dos personas pagando lo mismo de la mesa: a la segunda se le devuelve la plata", async () => {
    const mesa5 = (await dueno.from("tables").select("id").eq("branch_id", DEMO.sucursal).eq("number", 5).single()).data!.id;
    await dueno.rpc("cerrar_mesa", { _table_id: mesa5, _motivo: "preparar prueba" });
    const a = await comensalEn(5);
    const b = await comensalEn(5);
    const pedido = await mozo.rpc("crear_pedido_mozo", { _table_id: mesa5, _items: linea("Agua mineral", 2) });
    const pedidoId = (pedido.data as { order_id: string }).order_id;
    const cotA = (await a.c.rpc("cotizar", { _qr_token: qrMesa(5)!, _order_ids: [pedidoId] })).data as { id: string };
    const cotB = (await b.c.rpc("cotizar", { _qr_token: qrMesa(5)!, _order_ids: [pedidoId] })).data as { id: string };
    const ra = await pagar(a.token, 5, { cotizacion_id: cotA.id, idempotency_key: `ultimo-a-${Date.now()}` });
    expect(ra.status).toBe(200);
    const rb = await pagar(b.token, 5, { cotizacion_id: cotB.id, idempotency_key: `ultimo-b-${Date.now()}` });
    expect(rb.status).toBe(409);
    expect(JSON.parse(rb.cuerpo)).toMatchObject({ refunded: true });
    expect(JSON.parse(rb.cuerpo).error).toContain("ya pagó");
    const { data: pagos } = await dueno.from("payments").select("id").eq("order_id", pedidoId);
    expect(pagos).toHaveLength(1);
    await dueno.rpc("cerrar_mesa", { _table_id: mesa5, _motivo: "fin de prueba" });
  });

  it("si un producto se agota mientras alguien paga, se respeta el pedido y cocina recibe la alerta", async () => {
    const { c, token } = await comensalEn(6);
    const cot = (await c.rpc("cotizar", { _qr_token: qrMesa(6)!, _items: linea("Agua mineral") })).data as { id: string };
    await cocina.rpc("marcar_agotado", { _menu_item_id: ids["Agua mineral"], _agotado: true });
    try {
      const r = await pagar(token, 6, { cotizacion_id: cot.id, idempotency_key: `agot-${Date.now()}` });
      expect(r.status).toBe(200);
      const pedidoId = JSON.parse(r.cuerpo).order.id;
      const { data } = await cocina.from("orders").select("alerta, payment_status, paid_at").eq("id", pedidoId).single();
      expect(data!.alerta).toContain("Agua mineral");
      expect(data!.payment_status).toBe("paid");
      expect(data!.paid_at).not.toBeNull();
    } finally {
      await cocina.rpc("marcar_agotado", { _menu_item_id: ids["Agua mineral"], _agotado: false });
    }
  });

  it("cada pago guarda qué mozo atendía la mesa (propinas por mozo)", async () => {
    const mesa7 = (await dueno.from("tables").select("id").eq("branch_id", DEMO.sucursal).eq("number", 7).single()).data!.id;
    await dueno.rpc("cerrar_mesa", { _table_id: mesa7, _motivo: "preparar prueba" });
    const tomada = await mozo.rpc("tomar_mesa", { _table_id: mesa7 });
    const mozoId = (tomada.data as { assigned_waiter_id: string }).assigned_waiter_id;
    const { token } = await comensalEn(7);
    const r = await pagar(token, 7, { cart_items: linea("Agua mineral"), tip_amount: 500, idempotency_key: `mozo-${Date.now()}` });
    expect(r.status).toBe(200);
    const { data: pago } = await dueno.from("payments").select("staff_id, tip_amount").eq("id", JSON.parse(r.cuerpo).payment.id).single();
    expect(pago).toMatchObject({ staff_id: mozoId, tip_amount: 500 });
    await dueno.rpc("cerrar_mesa", { _table_id: mesa7, _motivo: "fin de prueba" });
  });

  it.skipIf(!LOCAL)("cotización vencida: no se puede empezar a pagar con un precio viejo", async () => {
    const { c, token } = await comensalEn(8);
    const cot = (await c.rpc("cotizar", { _qr_token: qrMesa(8)!, _items: linea("Agua mineral") })).data as { id: string };
    sql(`UPDATE cotizaciones SET expira_at = now() - interval '1 minute' WHERE id = '${cot.id}'`);
    const r = await pagar(token, 8, { cotizacion_id: cot.id, idempotency_key: `venc-${Date.now()}` });
    expect(r.status).toBe(409);
    expect(JSON.parse(r.cuerpo).error).toContain("venció");
  });

  it.skipIf(!LOCAL)("pago tardío: con el monto correcto se respeta; si no calza, se devuelve solo", async () => {
    const { c } = await comensalEn(9);
    const usuario = (await c.auth.getUser()).data.user!.id;
    const cotizar = () => (c.rpc("cotizar", { _qr_token: qrMesa(9)!, _items: linea("Agua mineral") }));
    const preparar = async () => {
      const cot = (await cotizar()).data as { id: string; subtotal: number };
      const intento = JSON.parse(sql(`SELECT reservar_intento_pago('${cot.id}', '${usuario}', 'tarde-${Date.now()}-${Math.random()}', 'card', 0)`));
      // La confirmación llega cuando la cotización ya venció (como un aviso tardío de la pasarela)
      sql(`UPDATE cotizaciones SET expira_at = now() - interval '5 minutes' WHERE id = '${cot.id}'`);
      return { cot, intento };
    };

    const ok = await preparar();
    const r1 = JSON.parse(sql(`SELECT confirmar_pago('${ok.intento.id}', true, ${ok.cot.subtotal}, 'simulated', 'REF-OK', '{}'::jsonb, NULL)`));
    expect(r1.estado).toBe("aprobado");
    // Confirmar otra vez (la pasarela avisa dos veces) no crea otro pago
    const r1b = JSON.parse(sql(`SELECT confirmar_pago('${ok.intento.id}', true, ${ok.cot.subtotal}, 'simulated', 'REF-OK', '{}'::jsonb, NULL)`));
    expect(r1b).toMatchObject({ estado: "aprobado", nuevo: false, payment_id: r1.payment_id });

    const mal = await preparar();
    const r2 = JSON.parse(sql(`SELECT confirmar_pago('${mal.intento.id}', true, ${mal.cot.subtotal - 100}, 'simulated', 'REF-MAL', '{}'::jsonb, NULL)`));
    expect(r2.estado).toBe("reembolsado");
    expect(r2.reembolsar).toBe(mal.cot.subtotal - 100);
    expect(sql(`SELECT count(*) FROM payments WHERE intento_id = '${mal.intento.id}'`)).toBe("0");
  });
});
