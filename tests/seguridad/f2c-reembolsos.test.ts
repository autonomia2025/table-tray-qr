import { describe, it, expect, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonimo, conSesion, hayCredenciales, invitado, llamarFuncion, qrMesa, DEMO, confirmarPresencia } from "./entorno";

// Fase 2.C — Reembolsos atómicos: nunca más de lo cobrado, siempre con motivo, por rol.

async function pagoConApp(mesa: number, cantidad = 2) {
  const c = await invitado();
  await c.rpc("unirse_a_mesa", { _qr_token: qrMesa(mesa)! });
  const token = (await c.auth.getSession()).data.session!.access_token;
  const { data: item } = await anonimo().from("menu_items").select("id").eq("tenant_id", DEMO.tenant).eq("name", "Agua mineral").single();
  const r = await llamarFuncion("process-payment", {
    table_token: qrMesa(mesa), method: "card", tip_amount: 300,
    cart_items: [{ menu_item_id: item!.id, quantity: cantidad }], idempotency_key: `reemb-${Date.now()}-${Math.random()}`,
  }, token);
  expect(r.status).toBe(200);
  const cuerpo = JSON.parse(r.cuerpo);
  return { pagoId: cuerpo.payment.id as string, pedidoId: cuerpo.order.id as string, total: cuerpo.payment.amount + cuerpo.payment.tip_amount, token };
}

describe.skipIf(!hayCredenciales)("reembolsos", () => {
  let dueno: SupabaseClient;
  let tokenCaja: string;
  let tokenMozo: string;
  let tokenCocina: string;
  const reembolsar = (token: string, cuerpo: Record<string, unknown>) => llamarFuncion("refund-payment", cuerpo, token);

  beforeAll(async () => {
    dueno = (await conSesion("owner")).cliente;
    tokenCaja = (await conSesion("cashier")).token;
    tokenMozo = (await conSesion("waiter")).token;
    tokenCocina = (await conSesion("kitchen")).token;
  });

  it("la caja reembolsa en partes con motivo; al completar, el pedido queda reembolsado y todo queda registrado", async () => {
    const p = await pagoConApp(2);
    const parcial = await reembolsar(tokenCaja, { payment_id: p.pagoId, amount: 1000, reason: "Faltó un producto" });
    expect(parcial.status).toBe(200);
    let { data: pago } = await dueno.from("payments").select("status, refunded_amount").eq("id", p.pagoId).single();
    expect(pago).toMatchObject({ status: "partially_refunded", refunded_amount: 1000 });

    const resto = await reembolsar(tokenCaja, { payment_id: p.pagoId, reason: "El cliente se fue sin consumir" });
    expect(resto.status).toBe(200);
    expect(JSON.parse(resto.cuerpo).fully_refunded).toBe(true);
    ({ data: pago } = await dueno.from("payments").select("status, refunded_amount").eq("id", p.pagoId).single());
    expect(pago).toMatchObject({ status: "refunded", refunded_amount: p.total });
    const { data: pedido } = await dueno.from("orders").select("payment_status").eq("id", p.pedidoId).single();
    expect(pedido!.payment_status).toBe("refunded");

    const { data: registro } = await dueno.from("audit_logs").select("action, metadata").eq("entity_id", p.pagoId).eq("action", "reembolso");
    expect(registro).toHaveLength(2);
    // Ya no queda nada por devolver
    const otra = await reembolsar(tokenCaja, { payment_id: p.pagoId, reason: "Intento de más" });
    expect(otra.status).toBe(409);
  });

  it("dos reembolsos totales al mismo tiempo: solo uno se hace; nunca se devuelve más de lo cobrado", async () => {
    const p = await pagoConApp(3);
    const [a, b] = await Promise.all([
      reembolsar(tokenCaja, { payment_id: p.pagoId, reason: "Reembolso desde la caja" }),
      reembolsar((await conSesion("owner")).token, { payment_id: p.pagoId, reason: "Reembolso desde el dueño" }),
    ]);
    expect([a.status, b.status].filter((s) => s === 200)).toHaveLength(1);
    const { data: pago } = await dueno.from("payments").select("refunded_amount").eq("id", p.pagoId).single();
    expect(pago!.refunded_amount).toBe(p.total);
    const { data: hechos } = await dueno.from("refunds").select("id").eq("payment_id", p.pagoId).eq("status", "completed");
    expect(hechos).toHaveLength(1);
  });

  it("sin motivo, con un monto mayor al cobrado o sin el rol correcto, no se reembolsa", async () => {
    const p = await pagoConApp(4);
    const sinMotivo = await reembolsar(tokenCaja, { payment_id: p.pagoId, reason: "x" });
    expect(sinMotivo.status).toBe(409);
    expect(JSON.parse(sinMotivo.cuerpo).error).toContain("motivo");
    const deMas = await reembolsar(tokenCaja, { payment_id: p.pagoId, amount: p.total + 1, reason: "Monto de más" });
    expect(JSON.parse(deMas.cuerpo).error).toContain("como máximo");
    expect((await reembolsar(tokenMozo, { payment_id: p.pagoId, reason: "Intento del mozo" })).status).toBe(403);
    expect((await reembolsar(tokenCocina, { payment_id: p.pagoId, reason: "Intento de cocina" })).status).toBe(403);
    expect((await reembolsar(p.token, { payment_id: p.pagoId, reason: "Intento del comensal" })).status).toBe(403);
    expect((await llamarFuncion("refund-payment", { payment_id: p.pagoId, reason: "Sin sesión" })).status).toBe(401);
    const { data: pago } = await dueno.from("payments").select("refunded_amount").eq("id", p.pagoId).single();
    expect(pago!.refunded_amount).toBe(0);
  });

  it("un cobro en efectivo se devuelve en el local (no pasa por la pasarela)", async () => {
    const mesa = (await dueno.from("tables").select("id").eq("branch_id", DEMO.sucursal).eq("number", 5).single()).data!.id;
    await dueno.rpc("cerrar_mesa", { _table_id: mesa, _motivo: "preparar prueba" });
    const c = await invitado();
    await c.rpc("unirse_a_mesa", { _qr_token: qrMesa(5)! });
    await confirmarPresencia(c, 5);
    const { data: item } = await anonimo().from("menu_items").select("id").eq("tenant_id", DEMO.tenant).eq("name", "Agua mineral").single();
    const pedido = (await c.rpc("pedir_sin_pagar", { _qr_token: qrMesa(5)!, _items: [{ menu_item_id: item!.id, quantity: 1 }], _forma: "mozo" })).data as { order_id: string };
    const caja = (await conSesion("cashier")).cliente;
    const cobro = (await caja.rpc("registrar_cobro_mozo", { _order_ids: [pedido.order_id], _metodo: "cash" })).data as { payment_id: string };

    const r = await reembolsar(tokenCaja, { payment_id: cobro.payment_id, reason: "Se devolvió en efectivo" });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.cuerpo)).toMatchObject({ devolucion: "local", fully_refunded: true });
    const { data: ped } = await dueno.from("orders").select("payment_status").eq("id", pedido.order_id).single();
    expect(ped!.payment_status).toBe("refunded");
    await dueno.rpc("cerrar_mesa", { _table_id: mesa, _motivo: "fin de prueba" });
  });

  it("nadie escribe reembolsos ni la plata desde el navegador", async () => {
    const p = await pagoConApp(6, 1);
    const caja = (await conSesion("cashier")).cliente;
    expect((await caja.from("refunds").insert({ tenant_id: DEMO.tenant, payment_id: p.pagoId, amount: 1, reason: "directo" })).error).not.toBeNull();
    expect((await caja.from("payments").update({ refunded_amount: 0 }).eq("id", p.pagoId)).error).not.toBeNull();
    expect((await caja.rpc("reservar_reembolso" as never, { _user_id: "x", _payment_id: p.pagoId, _monto: 1, _motivo: "directo" } as never)).error).not.toBeNull();
  });
});
