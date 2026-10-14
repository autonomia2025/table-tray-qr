import { describe, it, expect, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonimo, conSesion, hayCredenciales, invitado, llamarFuncion, qrMesa, DEMO } from "./entorno";

// Fase 3.2 — Estaciones: cada producto va a la pantalla de su estación (barra o cocina), cada una avanza
// lo suyo, el mozo lleva lo que está listo sin esperar al resto, y la configuración está protegida.

describe.skipIf(!hayCredenciales)("estaciones", () => {
  let dueno: SupabaseClient;
  let cocina: SupabaseClient;
  let mozo: SupabaseClient;
  const ids: Record<string, string> = {};
  let barra: string;
  let principal: string;
  const linea = (nombre: string, cantidad = 1) => ({ menu_item_id: ids[nombre], quantity: cantidad });

  async function pagar(mesa: number, items: { menu_item_id: string; quantity: number }[]) {
    const c = await invitado();
    await c.rpc("unirse_a_mesa", { _qr_token: qrMesa(mesa)! });
    const token = (await c.auth.getSession()).data.session!.access_token;
    const r = await llamarFuncion("process-payment", {
      table_token: qrMesa(mesa), method: "card", cart_items: items, idempotency_key: `est-${Date.now()}-${Math.random()}`,
    }, token);
    expect(r.status).toBe(200);
    return JSON.parse(r.cuerpo).order.id as string;
  }
  const itemsDe = async (pedido: string) =>
    (await dueno.from("order_items").select("menu_item_name, station_id, status").eq("order_id", pedido)).data!;
  const estadoPedido = async (pedido: string) =>
    (await dueno.from("orders").select("status").eq("id", pedido).single()).data!.status;

  beforeAll(async () => {
    dueno = (await conSesion("owner")).cliente;
    cocina = (await conSesion("kitchen")).cliente;
    mozo = (await conSesion("waiter")).cliente;
    const { data } = await anonimo().from("menu_items").select("id, name").eq("tenant_id", DEMO.tenant);
    for (const p of data ?? []) ids[p.name] = p.id;
    const { data: est } = await dueno.from("stations").select("id, name, es_predeterminada").eq("branch_id", DEMO.sucursal);
    barra = est!.find((e) => e.name === "Barra")!.id;
    principal = est!.find((e) => e.es_predeterminada)!.id;
  });

  it("cada producto va a la estación de su categoría: bebidas a la barra, comida a la cocina", async () => {
    const pedido = await pagar(2, [linea("Agua mineral"), linea("Barros Luco")]);
    const items = await itemsDe(pedido);
    expect(items.find((i) => i.menu_item_name === "Agua mineral")!.station_id).toBe(barra);
    expect(items.find((i) => i.menu_item_name === "Barros Luco")!.station_id).toBe(principal);
  });

  it("la barra avanza lo suyo sin tocar la cocina, y el mozo lleva la bebida sin esperar la comida", async () => {
    const pedido = await pagar(3, [linea("Agua mineral"), linea("Barros Luco")]);
    expect((await cocina.rpc("cambiar_estado_pedido", { _order_id: pedido, _estado: "ready", _station_id: barra })).error).toBeNull();
    let items = await itemsDe(pedido);
    expect(items.find((i) => i.menu_item_name === "Agua mineral")!.status).toBe("ready");
    expect(items.find((i) => i.menu_item_name === "Barros Luco")!.status).toBe("confirmed");
    // El pedido sigue "nuevo" para la cocina: su estado es el del producto más atrasado
    expect(await estadoPedido(pedido)).toBe("confirmed");

    // El mozo entrega: solo se va lo listo (la bebida)
    expect((await mozo.rpc("cambiar_estado_pedido", { _order_id: pedido, _estado: "delivered" })).error).toBeNull();
    items = await itemsDe(pedido);
    expect(items.find((i) => i.menu_item_name === "Agua mineral")!.status).toBe("delivered");
    expect(items.find((i) => i.menu_item_name === "Barros Luco")!.status).toBe("confirmed");

    // La cocina termina lo suyo y el mozo lo lleva: el pedido queda entregado
    expect((await cocina.rpc("cambiar_estado_pedido", { _order_id: pedido, _estado: "in_kitchen", _station_id: principal })).error).toBeNull();
    expect(await estadoPedido(pedido)).toBe("in_kitchen");
    expect((await cocina.rpc("cambiar_estado_pedido", { _order_id: pedido, _estado: "ready", _station_id: principal })).error).toBeNull();
    expect(await estadoPedido(pedido)).toBe("ready");
    expect((await mozo.rpc("cambiar_estado_pedido", { _order_id: pedido, _estado: "delivered" })).error).toBeNull();
    expect(await estadoPedido(pedido)).toBe("delivered");
  });

  it("solo el dueño o el encargado configuran estaciones; la principal no se borra ni se desactiva", async () => {
    // Cocina, mozo, comensal y anónimo no crean ni cambian estaciones
    for (const [quien, c] of [["cocina", cocina], ["mozo", mozo], ["comensal", await invitado()]] as const) {
      expect((await c.from("stations").insert({ tenant_id: DEMO.tenant, branch_id: DEMO.sucursal, name: "Pirata" })).error, quien).not.toBeNull();
      await c.from("stations").update({ name: "Pirata" }).eq("id", barra);
    }
    expect((await anonimo().from("stations").select("id")).data ?? []).toHaveLength(0);
    const { data: sigue } = await dueno.from("stations").select("name").eq("id", barra).single();
    expect(sigue!.name).toBe("Barra");

    expect((await dueno.from("stations").update({ is_active: false }).eq("id", principal)).error?.message).toContain("principal");
    expect((await dueno.from("stations").delete().eq("id", principal)).error?.message).toContain("principal");
  });

  it("al desactivar una estación, lo pendiente pasa a la principal y lo nuevo ya no va ahí", async () => {
    const { data: parrilla } = await dueno.from("stations").insert({ tenant_id: DEMO.tenant, branch_id: DEMO.sucursal, name: "Parrilla", sort_order: 5 }).select("id").single();
    const { data: cat } = await dueno.from("categories").select("id").eq("tenant_id", DEMO.tenant).eq("name", "Postres").single();
    try {
      expect((await dueno.from("categories").update({ station_id: parrilla!.id }).eq("id", cat!.id)).error).toBeNull();
      const pedido = await pagar(4, [linea("Mote con huesillo")]);
      expect((await itemsDe(pedido))[0].station_id).toBe(parrilla!.id);

      expect((await dueno.from("stations").update({ is_active: false }).eq("id", parrilla!.id)).error).toBeNull();
      expect((await itemsDe(pedido))[0].station_id).toBe(principal);
      const otro = await pagar(4, [linea("Mote con huesillo")]);
      expect((await itemsDe(otro))[0].station_id).toBe(principal);
    } finally {
      await dueno.from("categories").update({ station_id: null }).eq("id", cat!.id);
      await dueno.from("stations").delete().eq("id", parrilla!.id);
    }
  });

  it.skipIf(!process.env.DEMO_CREDENCIALES)("el dueño de otro local no toca las estaciones del demo ni las usa", async () => {
    const ajeno = (await conSesion("owner_ajeno")).cliente;
    expect((await ajeno.from("stations").select("id").eq("id", barra)).data ?? []).toHaveLength(0);
    await ajeno.from("stations").update({ name: "Hackeada" }).eq("id", barra);
    expect((await dueno.from("stations").select("name").eq("id", barra).single()).data!.name).toBe("Barra");
    // Una categoría del demo no puede apuntar a una estación de otro local
    const { data: suya } = await ajeno.from("stations").select("id").limit(1).single();
    const { data: cat } = await dueno.from("categories").select("id").eq("tenant_id", DEMO.tenant).eq("name", "Postres").single();
    expect((await dueno.from("categories").update({ station_id: suya!.id }).eq("id", cat!.id)).error).not.toBeNull();
  });
});
