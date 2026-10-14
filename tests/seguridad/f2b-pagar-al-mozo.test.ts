import { describe, it, expect, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonimo, conSesion, hayCredenciales, invitado, llamarFuncion, qrMesa, DEMO, confirmarPresencia } from "./entorno";

// Fase 2.B — "Pagar al mozo" (efectivo o POS) y "Agregar a mi cuenta" (cuenta abierta).

async function comensalEn(mesa: number) {
  const c = await invitado();
  await c.rpc("unirse_a_mesa", { _qr_token: qrMesa(mesa)! });
  await confirmarPresencia(c, mesa);
  const token = (await c.auth.getSession()).data.session!.access_token;
  return { c, token };
}

describe.skipIf(!hayCredenciales)("pagar al mozo y cuenta abierta", () => {
  let dueno: SupabaseClient;
  let mozo: SupabaseClient;
  let cocina: SupabaseClient;
  let caja: SupabaseClient;
  const ids: Record<string, string> = {};
  const linea = (nombre: string, cantidad = 1) => [{ menu_item_id: ids[nombre], quantity: cantidad }];
  const idMesa = async (n: number) => (await dueno.from("tables").select("id").eq("branch_id", DEMO.sucursal).eq("number", n).single()).data!.id as string;
  const liberar = async (n: number) => dueno.rpc("cerrar_mesa", { _table_id: await idMesa(n), _motivo: "preparar prueba" });

  beforeAll(async () => {
    dueno = (await conSesion("owner")).cliente;
    mozo = (await conSesion("waiter")).cliente;
    cocina = (await conSesion("kitchen")).cliente;
    caja = (await conSesion("cashier")).cliente;
    const { data } = await anonimo().from("menu_items").select("id, name, price").eq("tenant_id", DEMO.tenant);
    for (const p of data ?? []) ids[p.name] = p.id;
  });

  it("pagar al mozo en prepago: no pasa a cocina hasta que el mozo cobra; después sí, con vuelto y registro", async () => {
    await liberar(2);
    const { c } = await comensalEn(2);
    const r = await c.rpc("pedir_sin_pagar", { _qr_token: qrMesa(2)!, _items: linea("Agua mineral", 2), _forma: "mozo" });
    expect(r.error).toBeNull();
    const pedido = r.data as { order_id: string; total: number; a_cocina: boolean };
    expect(pedido.a_cocina).toBe(false);
    expect((await cocina.rpc("cambiar_estado_pedido", { _order_id: pedido.order_id, _estado: "in_kitchen" })).error?.message).toContain("no está pagado");

    const cobro = await mozo.rpc("registrar_cobro_mozo", { _order_ids: [pedido.order_id], _metodo: "cash", _propina: 500, _recibido: pedido.total + 2000 });
    expect(cobro.error).toBeNull();
    expect(cobro.data).toMatchObject({ total: pedido.total, propina: 500, vuelto: 1500 });

    const { data: o } = await dueno.from("orders").select("payment_status, paid_at, forma_pago").eq("id", pedido.order_id).single();
    expect(o).toMatchObject({ payment_status: "paid", forma_pago: "mozo" });
    expect(o!.paid_at).not.toBeNull();
    const { data: pago } = await dueno.from("payments").select("method, provider, amount, tip_amount, staff_id").eq("id", (cobro.data as { payment_id: string }).payment_id).single();
    expect(pago).toMatchObject({ method: "cash", provider: "local", amount: pedido.total, tip_amount: 500 });
    expect(pago!.staff_id).not.toBeNull();
    // Ahora sí va a cocina
    expect((await cocina.rpc("cambiar_estado_pedido", { _order_id: pedido.order_id, _estado: "in_kitchen" })).error).toBeNull();
    // Y no se cobra dos veces
    expect((await caja.rpc("registrar_cobro_mozo", { _order_ids: [pedido.order_id], _metodo: "pos" })).error?.message).toContain("ya está cobrado");
  });

  it("dos personas registrando el mismo cobro al mismo tiempo: queda uno solo", async () => {
    await liberar(3);
    const { c } = await comensalEn(3);
    const p = (await c.rpc("pedir_sin_pagar", { _qr_token: qrMesa(3)!, _items: linea("Agua mineral"), _forma: "mozo" })).data as { order_id: string };
    const [a, b] = await Promise.all([
      mozo.rpc("registrar_cobro_mozo", { _order_ids: [p.order_id], _metodo: "cash" }),
      caja.rpc("registrar_cobro_mozo", { _order_ids: [p.order_id], _metodo: "pos" }),
    ]);
    expect([a.error, b.error].filter((e) => e === null)).toHaveLength(1);
    const { data: pagos } = await dueno.from("payments").select("id").eq("order_id", p.order_id);
    expect(pagos).toHaveLength(1);
  });

  it("solo el personal de sala o caja registra cobros; el mozo, solo en sus mesas; y con montos válidos", async () => {
    await liberar(4);
    const { c } = await comensalEn(4);
    const p = (await c.rpc("pedir_sin_pagar", { _qr_token: qrMesa(4)!, _items: linea("Agua mineral"), _forma: "mozo" })).data as { order_id: string; total: number };
    expect((await cocina.rpc("registrar_cobro_mozo", { _order_ids: [p.order_id], _metodo: "cash" })).error?.message).toContain("permiso");
    expect((await c.rpc("registrar_cobro_mozo", { _order_ids: [p.order_id], _metodo: "cash" })).error).not.toBeNull();
    expect((await anonimo().rpc("registrar_cobro_mozo", { _order_ids: [p.order_id], _metodo: "cash" })).error).not.toBeNull();
    expect((await mozo.rpc("registrar_cobro_mozo", { _order_ids: [p.order_id], _metodo: "cash", _recibido: 1 })).error?.message).toContain("no alcanza");
    expect((await mozo.rpc("registrar_cobro_mozo", { _order_ids: [p.order_id], _metodo: "cash", _propina: p.total * 3 })).error?.message).toContain("propina");
    expect((await mozo.rpc("registrar_cobro_mozo", { _order_ids: [p.order_id], _metodo: "bitcoin" })).error).not.toBeNull();

    // Mesa de otro mozo
    const { data: { user } } = await mozo.auth.getUser();
    const { data: otro } = await dueno.from("staff_users").select("id").eq("tenant_id", DEMO.tenant).eq("role", "waiter").neq("auth_user_id", user!.id).limit(1).single();
    await dueno.rpc("transferir_mesa", { _table_id: await idMesa(4), _staff_id: otro!.id });
    expect((await mozo.rpc("registrar_cobro_mozo", { _order_ids: [p.order_id], _metodo: "cash" })).error?.message).toContain("otro mozo");
    // La caja sí puede
    expect((await caja.rpc("registrar_cobro_mozo", { _order_ids: [p.order_id], _metodo: "pos" })).error).toBeNull();
    await liberar(4);
  });

  it("nadie acumula pedidos sin pagar a nombre de la mesa: máximo 3 esperando al mozo", async () => {
    await liberar(5);
    const { c } = await comensalEn(5);
    for (let i = 0; i < 3; i++) {
      expect((await c.rpc("pedir_sin_pagar", { _qr_token: qrMesa(5)!, _items: linea("Agua mineral"), _forma: "mozo" })).error).toBeNull();
    }
    expect((await c.rpc("pedir_sin_pagar", { _qr_token: qrMesa(5)!, _items: linea("Agua mineral"), _forma: "mozo" })).error?.message).toContain("esperando");
    // Sin estar en la mesa, no se puede pedir
    expect((await (await invitado()).rpc("pedir_sin_pagar", { _qr_token: qrMesa(5)!, _items: linea("Agua mineral"), _forma: "mozo" })).error).not.toBeNull();
    await dueno.rpc("cerrar_mesa", { _table_id: await idMesa(5), _motivo: "fin de prueba" });
  });

  it("agregar a mi cuenta: no en prepago; en cuenta abierta va a cocina y cada uno paga lo suyo al final", async () => {
    await liberar(6);
    const a = await comensalEn(6);
    expect((await a.c.rpc("pedir_sin_pagar", { _qr_token: qrMesa(6)!, _items: linea("Agua mineral"), _forma: "cuenta" })).error?.message).toContain("se paga al pedir");

    expect((await dueno.from("branches").update({ payment_mode: "open_tab" }).eq("id", DEMO.sucursal)).error).toBeNull();
    try {
      const b = await comensalEn(6);
      const pa = (await a.c.rpc("pedir_sin_pagar", { _qr_token: qrMesa(6)!, _items: linea("Agua mineral", 2), _forma: "cuenta" })).data as { order_id: string; total: number; a_cocina: boolean };
      const pb = (await b.c.rpc("pedir_sin_pagar", { _qr_token: qrMesa(6)!, _items: linea("Agua mineral"), _forma: "cuenta" })).data as { order_id: string; total: number };
      expect(pa.a_cocina).toBe(true);
      expect((await cocina.rpc("cambiar_estado_pedido", { _order_id: pa.order_id, _estado: "in_kitchen" })).error).toBeNull();

      // A paga al final desde la app: se le cobra solo lo suyo (regla 8)
      const r = await llamarFuncion("process-payment", { table_token: qrMesa(6), method: "card", idempotency_key: `cuenta-${Date.now()}` }, a.token);
      expect(r.status).toBe(200);
      expect(JSON.parse(r.cuerpo).payment.amount).toBe(pa.total);
      const { data: deB } = await dueno.from("orders").select("payment_status").eq("id", pb.order_id).single();
      expect(deB!.payment_status).toBe("unpaid");
    } finally {
      await dueno.from("branches").update({ payment_mode: "prepaid" }).eq("id", DEMO.sucursal);
      await dueno.rpc("cerrar_mesa", { _table_id: await idMesa(6), _motivo: "fin de prueba" });
    }
  });
});
