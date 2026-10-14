import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonimo, conSesion, hayCredenciales, invitado, llamarFuncion, qrMesa, DEMO, confirmarPresencia } from "./entorno";

// Fase 2.E — Compuerta de la plata. Los casos difíciles que faltaban (los demás están en f2a a f2d) y la
// auditoría automática: después de todo, la plata tiene que calzar en toda la base.

const LOCAL = !!process.env.DEMO_CREDENCIALES; // base desechable: permite tocar la base directo
const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();
// Varias instrucciones en una sola sesión (por la entrada estándar: muestra el resultado de cada una)
const sqlSesion = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1"], { input: q }).toString().trim();

describe.skipIf(!hayCredenciales)("compuerta de la plata", () => {
  let superadmin: SupabaseClient;
  let dueno: SupabaseClient;
  let caja: SupabaseClient;
  let tokenCaja: string;
  const ids: Record<string, string> = {};
  const linea = (nombre: string, cantidad = 1) => [{ menu_item_id: ids[nombre], quantity: cantidad }];
  const idMesa = async (n: number) => (await dueno.from("tables").select("id").eq("branch_id", DEMO.sucursal).eq("number", n).single()).data!.id as string;
  const liberar = async (n: number) => dueno.rpc("cerrar_mesa", { _table_id: await idMesa(n), _motivo: "preparar prueba" });
  const reembolsar = (cuerpo: Record<string, unknown>, token = tokenCaja) => llamarFuncion("refund-payment", cuerpo, token);

  async function comensalEn(mesa: number) {
    const c = await invitado();
    await c.rpc("unirse_a_mesa", { _qr_token: qrMesa(mesa)! });
    await confirmarPresencia(c, mesa);
    const token = (await c.auth.getSession()).data.session!.access_token;
    return { c, token };
  }
  const pagar = (token: string, mesa: number, body: Record<string, unknown>) =>
    llamarFuncion("process-payment", { table_token: qrMesa(mesa), method: "card", ...body }, token);

  async function auditoria() {
    const { data, error } = await superadmin.rpc("auditoria_plata");
    expect(error).toBeNull();
    // Si esto falla, el mensaje dice exactamente qué pago, pedido o cierre no calza y por qué.
    return (data as { tipo: string; objeto: string; detalle: string }[]).map((h) => `${h.tipo}: ${h.objeto} (${h.detalle})`);
  }

  beforeAll(async () => {
    superadmin = (await conSesion("superadmin")).cliente;
    dueno = (await conSesion("owner")).cliente;
    ({ cliente: caja, token: tokenCaja } = await conSesion("cashier"));
    const { data } = await anonimo().from("menu_items").select("id, name").eq("tenant_id", DEMO.tenant);
    for (const p of data ?? []) ids[p.name] = p.id;
  });

  it("la auditoría de la plata solo la corre el superadmin", async () => {
    expect((await dueno.rpc("auditoria_plata")).error).not.toBeNull();
    expect((await caja.rpc("auditoria_plata")).error).not.toBeNull();
    expect((await anonimo().rpc("auditoria_plata")).error).not.toBeNull();
  });

  it("el mozo cobra en efectivo mientras el comensal paga lo mismo con la app: se cobra una sola vez", async () => {
    await liberar(2);
    const { c, token } = await comensalEn(2);
    const pedido = (await c.rpc("pedir_sin_pagar", { _qr_token: qrMesa(2)!, _items: linea("Agua mineral"), _forma: "mozo" })).data as { order_id: string };
    const [efectivo, app] = await Promise.all([
      caja.rpc("registrar_cobro_mozo", { _order_ids: [pedido.order_id], _metodo: "cash" }),
      pagar(token, 2, { order_ids: [pedido.order_id], idempotency_key: `doble-canal-${Date.now()}` }),
    ]);
    const exitos = (efectivo.error ? 0 : 1) + (app.status === 200 ? 1 : 0);
    expect(exitos).toBe(1);
    const { data: vigentes } = await dueno.from("payments").select("id").contains("pedidos", [pedido.order_id]).in("status", ["approved", "partially_refunded"]);
    expect(vigentes).toHaveLength(1);
  });

  it("la misma clave de pago con otro carrito no cobra lo nuevo; y otra persona no puede usar esa clave", async () => {
    const { token } = await comensalEn(3);
    const clave = `clave-${Date.now()}-${Math.random()}`;
    const r1 = await pagar(token, 3, { cart_items: linea("Agua mineral"), idempotency_key: clave });
    expect(r1.status).toBe(200);
    const p1 = JSON.parse(r1.cuerpo).payment;
    // Mismo comensal, misma clave, carrito más caro: devuelve el pago original, no cobra de nuevo
    const r2 = await pagar(token, 3, { cart_items: linea("Agua mineral", 5), idempotency_key: clave });
    if (r2.status === 200) {
      expect(JSON.parse(r2.cuerpo).payment).toMatchObject({ id: p1.id, amount: p1.amount });
    } else {
      expect(r2.status).toBe(409);
    }
    // Otra persona con la misma clave: rechazado y sin ver el pago ajeno
    const otro = await comensalEn(3);
    const r3 = await pagar(otro.token, 3, { cart_items: linea("Agua mineral"), idempotency_key: clave });
    expect(r3.status).not.toBe(200);
    expect(r3.cuerpo).not.toContain(p1.id);
    const { data: pagos } = await dueno.from("payments").select("id").eq("idempotency_key", clave);
    expect(pagos).toHaveLength(1);
  });

  it("varios reembolsos parciales al mismo tiempo nunca suman más de lo cobrado", async () => {
    const { token } = await comensalEn(4);
    const r = await pagar(token, 4, { cart_items: linea("Agua mineral", 3), idempotency_key: `parciales-${Date.now()}` });
    const p = JSON.parse(r.cuerpo).payment;
    const total = p.amount + p.tip_amount;
    const parte = Math.ceil(total * 0.6);
    const respuestas = await Promise.all([1, 2, 3].map((i) => reembolsar({ payment_id: p.id, amount: parte, reason: `Parcial número ${i}` })));
    expect(respuestas.filter((x) => x.status === 200)).toHaveLength(1);
    const { data: pago } = await dueno.from("payments").select("refunded_amount, status").eq("id", p.id).single();
    expect(pago).toMatchObject({ refunded_amount: parte, status: "partially_refunded" });
    // El resto exacto sí se puede devolver; un peso más, no
    expect((await reembolsar({ payment_id: p.id, amount: total - parte + 1, reason: "Un peso de más" })).status).toBe(409);
    expect((await reembolsar({ payment_id: p.id, amount: total - parte, reason: "El resto exacto" })).status).toBe(200);
  });

  it("pagar varios pedidos juntos con la app y reembolsar todo: todos los pedidos quedan reembolsados", async () => {
    await liberar(5);
    expect((await dueno.from("branches").update({ payment_mode: "open_tab" }).eq("id", DEMO.sucursal)).error).toBeNull();
    try {
      const { c, token } = await comensalEn(5);
      const a = (await c.rpc("pedir_sin_pagar", { _qr_token: qrMesa(5)!, _items: linea("Agua mineral"), _forma: "cuenta" })).data as { order_id: string };
      const b = (await c.rpc("pedir_sin_pagar", { _qr_token: qrMesa(5)!, _items: linea("Agua mineral", 2), _forma: "cuenta" })).data as { order_id: string };
      const r = await pagar(token, 5, { idempotency_key: `cuenta-junta-${Date.now()}` });
      expect(r.status).toBe(200);
      const pagoId = JSON.parse(r.cuerpo).payment.id;
      const { data: pago } = await dueno.from("payments").select("pedidos").eq("id", pagoId).single();
      expect([...(pago!.pedidos ?? [])].sort()).toEqual([a.order_id, b.order_id].sort());

      expect((await reembolsar({ payment_id: pagoId, reason: "Se fueron sin consumir" })).status).toBe(200);
      const { data: pedidos } = await dueno.from("orders").select("payment_status").in("id", [a.order_id, b.order_id]);
      expect(pedidos!.map((o) => o.payment_status)).toEqual(["refunded", "refunded"]);
    } finally {
      await dueno.from("branches").update({ payment_mode: "prepaid" }).eq("id", DEMO.sucursal);
      await liberar(5);
    }
  });

  it.skipIf(!LOCAL)("un reembolso que la pasarela rechaza libera la reserva y se puede volver a intentar", async () => {
    const { token } = await comensalEn(6);
    const p = JSON.parse((await pagar(token, 6, { cart_items: linea("Agua mineral"), idempotency_key: `falla-${Date.now()}` })).cuerpo).payment;
    const cajera = sql(`SELECT user_id FROM tenant_members WHERE tenant_id = '${DEMO.tenant}' AND role = 'cashier' LIMIT 1`);
    const reserva = JSON.parse(sql(`SELECT reservar_reembolso('${cajera}', '${p.id}', 0, 'La pasarela falla')`));
    // Mientras está reservado, no se puede devolver otra vez
    expect((await reembolsar({ payment_id: p.id, reason: "Mientras tanto" })).status).toBe(409);
    expect(JSON.parse(sql(`SELECT confirmar_reembolso('${reserva.refund_id}', false, NULL)`))).toMatchObject({ estado: "failed" });
    // Confirmar el rechazo dos veces no cambia nada
    expect(JSON.parse(sql(`SELECT confirmar_reembolso('${reserva.refund_id}', true, 'tarde')`))).toMatchObject({ estado: "failed", nuevo: false });
    expect(sql(`SELECT refunded_amount FROM payments WHERE id = '${p.id}'`)).toBe("0");
    expect((await reembolsar({ payment_id: p.id, reason: "Segundo intento" })).status).toBe(200);
  });

  it.skipIf(!LOCAL)("un reembolso al mismo tiempo que el cierre de caja: el cierre no cambia después", async () => {
    const { token } = await comensalEn(7);
    const p = JSON.parse((await pagar(token, 7, { cart_items: linea("Agua mineral"), idempotency_key: `cierre-${Date.now()}` })).cuerpo).payment;
    const hoy = ((await caja.rpc("resumen_caja", { _branch_id: DEMO.sucursal })).data as { hoy: string }).hoy;
    const esperado = ((await caja.rpc("resumen_caja", { _branch_id: DEMO.sucursal })).data as { efectivo: { esperado: number } }).efectivo.esperado;
    try {
      const [r, cierre] = await Promise.all([
        reembolsar({ payment_id: p.id, reason: "Justo al cerrar" }),
        caja.rpc("cerrar_caja", { _branch_id: DEMO.sucursal, _dia: hoy, _efectivo_contado: esperado }),
      ]);
      expect(r.status).toBe(200);
      expect(cierre.error).toBeNull();
      // El reembolso quedó dentro del cierre o en el día siguiente, nunca a medias
      expect((await auditoria()).filter((h) => h.startsWith("cierre_cambio"))).toEqual([]);
    } finally {
      sql(`DELETE FROM payment_settlements WHERE branch_id = '${DEMO.sucursal}' AND settlement_date = '${hoy}'`);
      // Lo que cayó en el día siguiente vuelve a hoy (la base desechable no puede quedar con días corridos)
      sql(`UPDATE refunds SET dia_negocio = '${hoy}' WHERE payment_id = '${p.id}'`);
    }
  });

  it.skipIf(!LOCAL)("la auditoría sí detecta cuando algo no calza (se descuadra a propósito y se deshace)", async () => {
    // Datos para descuadrar: un pago con la app y un pedido esperando al mozo
    const { c, token } = await comensalEn(8);
    await pagar(token, 8, { cart_items: linea("Agua mineral"), idempotency_key: `sabotaje-${Date.now()}` });
    await c.rpc("pedir_sin_pagar", { _qr_token: qrMesa(8)!, _items: linea("Agua mineral"), _forma: "mozo" });
    await c.rpc("pedir_sin_pagar", { _qr_token: qrMesa(8)!, _items: linea("Agua mineral"), _forma: "mozo" });
    const pago = `(SELECT id FROM payments WHERE status = 'approved' AND method = 'card' ORDER BY created_at DESC LIMIT 1)`;
    const esperando = `(SELECT id FROM orders WHERE payment_status = 'unpaid' AND forma_pago = 'mozo' AND status = 'confirmed' ORDER BY created_at DESC LIMIT 1)`;
    const salida = sqlSesion(`
      BEGIN;
      SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT user_id FROM platform_admins LIMIT 1), 'role', 'authenticated')::text, true) IS NULL;
      UPDATE payments SET refunded_amount = 1 WHERE id = ${pago};
      INSERT INTO payments (tenant_id, branch_id, order_id, amount, tip_amount, method, status, provider)
        SELECT tenant_id, branch_id, order_id, amount + 500, 0, 'card', 'approved', 'simulated' FROM payments WHERE id = ${pago};
      UPDATE orders SET status = 'in_kitchen' WHERE id = ${esperando};
      -- (el siguiente toma el otro pedido: el primero ya no está "confirmed")
      UPDATE orders SET payment_status = 'paid' WHERE id = ${esperando};
      INSERT INTO payment_settlements (tenant_id, branch_id, settlement_date, status, total_neto, detalle)
        SELECT tenant_id, branch_id, dia_negocio, 'closed', 1, '{"x": 1}' FROM payments WHERE id = ${pago}
        ON CONFLICT DO NOTHING;
      SELECT 'hallazgo:' || tipo FROM auditoria_plata();
      ROLLBACK;`);
    const tipos = new Set(salida.split("\n").filter((l) => l.startsWith("hallazgo:")).map((l) => l.slice(9)));
    for (const t of ["reembolsado_no_calza", "estado_pago_incoherente", "pedido_cobrado_dos_veces", "monto_no_calza",
      "cocina_sin_pago", "pedido_pagado_sin_pago", "cierre_cambio"]) {
      expect(tipos.has(t), t).toBe(true);
    }
    // Y después de deshacer, todo vuelve a calzar
    expect(await auditoria()).toEqual([]);
  });

  it("después de todos los casos difíciles, la plata calza en toda la base", async () => {
    expect(await auditoria()).toEqual([]);
  });
});
