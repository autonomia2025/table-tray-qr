import { describe, it, expect, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonimo, conSesion, hayCredenciales, invitado, llamarFuncion, qrMesa, DEMO } from "./entorno";

// Fase 1.4 — Dominio PEDIDOS: estados por el servidor, lectura cerrada y registro de eventos.

async function pedidoPagado(mesa: number): Promise<{ id: string; numero: number; comensal: SupabaseClient }> {
  const comensal = await invitado();
  await comensal.rpc("unirse_a_mesa", { _qr_token: qrMesa(mesa)! });
  const token = (await comensal.auth.getSession()).data.session!.access_token;
  const { data: item } = await anonimo().from("menu_items").select("id").eq("tenant_id", DEMO.tenant).eq("name", "Agua mineral").single();
  const r = await llamarFuncion(
    "process-payment",
    { table_token: qrMesa(mesa), method: "card", cart_items: [{ menu_item_id: item!.id, quantity: 1 }], idempotency_key: `p-${Date.now()}-${Math.random()}` },
    token,
  );
  expect(r.status).toBe(200);
  const cuerpo = JSON.parse(r.cuerpo);
  return { id: cuerpo.order.id, numero: cuerpo.order.order_number, comensal };
}

describe.skipIf(!hayCredenciales)("pedidos", () => {
  let cocina: SupabaseClient;
  let mozo: SupabaseClient;
  let dueno: SupabaseClient;

  beforeAll(async () => {
    cocina = (await conSesion("kitchen")).cliente;
    mozo = (await conSesion("waiter")).cliente;
    dueno = (await conSesion("owner")).cliente;
  });

  it("un anónimo no puede marcar un pedido como pagado ni cambiar su estado (problema 2)", async () => {
    const p = await pedidoPagado(1);
    const { data } = await anonimo().from("orders").update({ payment_status: "unpaid", status: "delivered" }).eq("id", p.id).select("id");
    expect(data ?? []).toHaveLength(0);
    const { data: real } = await dueno.from("orders").select("status, payment_status").eq("id", p.id).single();
    expect(real).toEqual({ status: "confirmed", payment_status: "paid" });
  });

  it("ni siquiera el dueño puede escribir directo en un pedido: todo va por el servidor", async () => {
    const p = await pedidoPagado(1);
    const { data } = await dueno.from("orders").update({ status: "delivered" }).eq("id", p.id).select("id");
    expect(data ?? []).toHaveLength(0);
  });

  it("sin sesión no se leen pedidos; el comensal ve los de su mesa y no los de otra", async () => {
    const p = await pedidoPagado(2);
    const { data: anon } = await anonimo().from("orders").select("id").eq("id", p.id);
    expect(anon ?? []).toHaveLength(0);
    const { data: propio } = await p.comensal.from("orders").select("id, order_items(menu_item_name)").eq("id", p.id);
    expect(propio).toHaveLength(1);
    expect(propio![0].order_items).toHaveLength(1);
    const otro = await invitado();
    await otro.rpc("unirse_a_mesa", { _qr_token: qrMesa(3)! });
    const { data: ajeno } = await otro.from("orders").select("id").eq("id", p.id);
    expect(ajeno ?? []).toHaveLength(0);
  });

  it("el mozo no maneja estados de cocina; la cocina sí; el mozo entrega lo listo", async () => {
    const p = await pedidoPagado(4);
    const intento = await mozo.rpc("cambiar_estado_pedido", { _order_id: p.id, _estado: "in_kitchen" });
    expect(intento.error?.message).toContain("permiso");

    // El mozo no puede entregar algo que no está listo: no cambia nada
    const antes = await mozo.rpc("cambiar_estado_pedido", { _order_id: p.id, _estado: "delivered" });
    expect((antes.data as { productos_cambiados: number }).productos_cambiados).toBe(0);
    expect((antes.data as { estado: string }).estado).toBe("confirmed");

    expect((await cocina.rpc("cambiar_estado_pedido", { _order_id: p.id, _estado: "in_kitchen" })).error).toBeNull();
    expect((await cocina.rpc("cambiar_estado_pedido", { _order_id: p.id, _estado: "ready" })).error).toBeNull();
    const entrega = await mozo.rpc("cambiar_estado_pedido", { _order_id: p.id, _estado: "delivered" });
    expect((entrega.data as { estado: string }).estado).toBe("delivered");

    // Hacia atrás no se vuelve
    const atras = await cocina.rpc("cambiar_estado_pedido", { _order_id: p.id, _estado: "in_kitchen" });
    expect((atras.data as { estado: string }).estado).toBe("delivered");

    // Cada producto y el pedido quedaron con la hora del servidor
    const { data } = await dueno.from("orders").select("status, kitchen_accepted_at, ready_at, delivered_at, order_items(status, delivered_at)").eq("id", p.id).single();
    expect(data!.status).toBe("delivered");
    expect(data!.kitchen_accepted_at && data!.ready_at && data!.delivered_at).toBeTruthy();
    expect(data!.order_items.every((i: { status: string; delivered_at: string }) => i.status === "delivered" && i.delivered_at)).toBe(true);
  });

  it("en prepago, la cocina no puede preparar un pedido sin pagar (regla 1)", async () => {
    const c = await invitado();
    const mesa = (await c.rpc("unirse_a_mesa", { _qr_token: qrMesa(5)! })).data as { session_id: string; table_id: string };
    const { data: sinPagar, error } = await mozo
      .from("orders")
      .insert({ tenant_id: DEMO.tenant, branch_id: DEMO.sucursal, session_id: mesa.session_id, table_id: mesa.table_id, order_number: 90000 + Math.floor(Math.random() * 9999), total_amount: 1000, source: "waiter" })
      .select("id")
      .single();
    expect(error).toBeNull();
    const r = await cocina.rpc("cambiar_estado_pedido", { _order_id: sinPagar!.id, _estado: "in_kitchen" });
    expect(r.error?.message).toContain("no está pagado");
  });

  it("cancelar: solo encargados o más, siempre con motivo; queda registrado", async () => {
    const p = await pedidoPagado(6);
    expect((await mozo.rpc("cambiar_estado_pedido", { _order_id: p.id, _estado: "cancelled", _motivo: "error" })).error?.message).toContain("permiso");
    expect((await dueno.rpc("cambiar_estado_pedido", { _order_id: p.id, _estado: "cancelled" })).error?.message).toContain("motivo");
    const ok = await dueno.rpc("cambiar_estado_pedido", { _order_id: p.id, _estado: "cancelled", _motivo: "El cliente se arrepintió" });
    expect((ok.data as { estado: string }).estado).toBe("cancelled");

    const { data: eventos } = await dueno.from("order_events").select("estado_anterior, estado_nuevo, actor_rol, motivo").eq("order_id", p.id);
    expect(eventos).toContainEqual({ estado_anterior: "confirmed", estado_nuevo: "cancelled", actor_rol: "owner", motivo: "El cliente se arrepintió" });
  });

  it("el registro de eventos no se puede escribir, editar ni borrar", async () => {
    const p = await pedidoPagado(7);
    await cocina.rpc("cambiar_estado_pedido", { _order_id: p.id, _estado: "in_kitchen" });
    const ins = await dueno.from("order_events").insert({ tenant_id: DEMO.tenant, order_id: p.id, estado_nuevo: "delivered" });
    expect(ins.error).not.toBeNull();
    const upd = await dueno.from("order_events").update({ motivo: "x" }).eq("order_id", p.id).select("id");
    expect(upd.data ?? []).toHaveLength(0);
    const del = await dueno.from("order_events").delete().eq("order_id", p.id).select("id");
    expect(del.data ?? []).toHaveLength(0);
    const { count } = await dueno.from("order_events").select("id", { count: "exact", head: true }).eq("order_id", p.id);
    expect(count).toBe(1);
  });

  it("un comensal no puede cambiar estados", async () => {
    const p = await pedidoPagado(8);
    const r = await p.comensal.rpc("cambiar_estado_pedido", { _order_id: p.id, _estado: "delivered" });
    expect(r.error).not.toBeNull();
  });

  it("agotado: cocina sí, mozo no, anónimo no", async () => {
    const { data: item } = await anonimo().from("menu_items").select("id").eq("tenant_id", DEMO.tenant).eq("name", "Mojito").single();
    expect((await anonimo().rpc("marcar_agotado", { _menu_item_id: item!.id, _agotado: true })).error).not.toBeNull();
    expect((await mozo.rpc("marcar_agotado", { _menu_item_id: item!.id, _agotado: true })).error?.message).toContain("permiso");
    expect((await cocina.rpc("marcar_agotado", { _menu_item_id: item!.id, _agotado: true })).error).toBeNull();
    const { data: agotado } = await anonimo().from("menu_items").select("status").eq("id", item!.id).single();
    expect(agotado!.status).toBe("out_of_stock");
    expect((await cocina.rpc("marcar_agotado", { _menu_item_id: item!.id, _agotado: false })).error).toBeNull();
  });

  it.skipIf(!process.env.DEMO_CREDENCIALES)("el dueño de otro local no ve ni toca pedidos del demo", async () => {
    const p = await pedidoPagado(9);
    const ajeno = (await conSesion("owner_ajeno")).cliente;
    const { data } = await ajeno.from("orders").select("id").eq("id", p.id);
    expect(data ?? []).toHaveLength(0);
    const r = await ajeno.rpc("cambiar_estado_pedido", { _order_id: p.id, _estado: "cancelled", _motivo: "ataque" });
    expect(r.error?.message).toContain("permiso");
  });
});
