import { describe, it, expect, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonimo, conSesion, hayCredenciales, invitado, llamarFuncion, qrMesa, DEMO } from "./entorno";

// Fase 1.9 — Precios por el servidor (comensal y mozo) y pedido del mozo por el servidor.

type Linea = { menu_item_id: string; quantity: number; modifiers?: { groupName: string; modifierName: string }[]; notes?: string };

describe.skipIf(!hayCredenciales)("precios y pedido del mozo", () => {
  let dueno: SupabaseClient;
  let mozo: SupabaseClient;
  let cocina: SupabaseClient;
  let caja: SupabaseClient;
  const ids: Record<string, string> = {};
  const mesa = async (n: number) => (await dueno.from("tables").select("id").eq("branch_id", DEMO.sucursal).eq("number", n).single()).data!.id as string;
  const liberar = async (n: number) => dueno.rpc("cerrar_mesa", { _table_id: await mesa(n), _motivo: "preparar prueba" });

  beforeAll(async () => {
    dueno = (await conSesion("owner")).cliente;
    mozo = (await conSesion("waiter")).cliente;
    cocina = (await conSesion("kitchen")).cliente;
    caja = (await conSesion("cashier")).cliente;
    const { data } = await anonimo().from("menu_items").select("id, name").eq("tenant_id", DEMO.tenant);
    for (const p of data ?? []) ids[p.name] = p.id;
  });

  it("desde el navegador ya nadie crea pedidos directo (ni el mozo ni el dueño)", async () => {
    const pedido = { tenant_id: DEMO.tenant, branch_id: DEMO.sucursal, table_id: await mesa(2), order_number: 99999, total_amount: 1, status: "confirmed" };
    expect((await mozo.from("orders").insert(pedido)).error).not.toBeNull();
    expect((await dueno.from("orders").insert(pedido)).error).not.toBeNull();
    expect((await dueno.from("order_items").insert({ tenant_id: DEMO.tenant, menu_item_name: "x", unit_price: 1, quantity: 1, subtotal: 1 })).error).not.toBeNull();
    // Y la función de precios no la llama nadie desde afuera
    expect((await dueno.rpc("calcular_precios", { _tenant_id: DEMO.tenant, _branch_id: DEMO.sucursal, _items: [] })).error).not.toBeNull();
  });

  it("el mozo toma un pedido con opciones: el precio, el número y el registro los pone el servidor", async () => {
    await liberar(2);
    const lineas: Linea[] = [
      { menu_item_id: ids["Papas fritas"], quantity: 2, modifiers: [{ groupName: "Tamaño", modifierName: "XL" }, { groupName: "Salsas", modifierName: "Cheddar" }] },
      { menu_item_id: ids["Hamburguesa Tablio"], quantity: 1, modifiers: [{ groupName: "Punto de la carne", modifierName: "A punto" }], notes: "sin cebolla" },
    ];
    const r = await mozo.rpc("crear_pedido_mozo", { _table_id: await mesa(2), _items: lineas });
    expect(r.error).toBeNull();
    const { data: precioHamburguesa } = await anonimo().from("menu_items").select("price").eq("id", ids["Hamburguesa Tablio"]).single();
    const esperado = (5900 + 2000 + 1000) * 2 + precioHamburguesa!.price;
    expect(r.data).toMatchObject({ total: esperado, espera_pago: true });

    const pedidoId = (r.data as { order_id: string }).order_id;
    const { data: pedido } = await dueno.from("orders").select("source, payment_status, total_amount, order_items(menu_item_name, subtotal, item_notes, selected_modifiers)").eq("id", pedidoId).single();
    expect(pedido).toMatchObject({ source: "waiter", payment_status: "unpaid", total_amount: esperado });
    expect(pedido!.order_items).toHaveLength(2);
    expect(pedido!.order_items.find((i) => i.menu_item_name === "Hamburguesa Tablio")!.item_notes).toBe("sin cebolla");
    const { data: evento } = await dueno.from("order_events").select("estado_nuevo, actor_rol, productos").eq("order_id", pedidoId).single();
    expect(evento).toMatchObject({ estado_nuevo: "confirmed", actor_rol: "waiter", productos: 2 });

    // En prepago, la cocina no lo prepara hasta que se cobre
    expect((await cocina.rpc("cambiar_estado_pedido", { _order_id: pedidoId, _estado: "in_kitchen" })).error?.message).toContain("no está pagado");
    await dueno.rpc("cambiar_estado_pedido", { _order_id: pedidoId, _estado: "cancelled", _motivo: "fin de prueba" });
  });

  it("el servidor rechaza opciones inventadas, faltantes o repetidas, agotados, cantidades raras y productos ajenos", async () => {
    await liberar(2);
    const intentar = async (lineas: Linea[] | unknown) => (await mozo.rpc("crear_pedido_mozo", { _table_id: await mesa(2), _items: lineas })).error?.message ?? "";
    expect(await intentar([{ menu_item_id: ids["Papas fritas"], quantity: 1 }])).toContain("Elige");
    expect(await intentar([{ menu_item_id: ids["Papas fritas"], quantity: 1, modifiers: [{ groupName: "Tamaño", modifierName: "Gigante gratis" }] }])).toContain("no es válida");
    expect(await intentar([{ menu_item_id: ids["Papas fritas"], quantity: 1, modifiers: [{ groupName: "Tamaño", modifierName: "XL" }, { groupName: "Tamaño", modifierName: "Normal" }] }])).toContain("demasiadas");
    expect(await intentar([{ menu_item_id: ids["Papas fritas"], quantity: 1, modifiers: [{ groupName: "Tamaño", modifierName: "XL" }, { groupName: "Tamaño", modifierName: "XL" }] }])).toContain("repetida");
    expect(await intentar([{ menu_item_id: ids["Agua mineral"], quantity: 50 }])).toContain("cantidad");
    expect(await intentar([{ menu_item_id: "00000000-0000-0000-0000-000000000000", quantity: 1 }])).toContain("ya no está en la carta");
    expect(await intentar([])).toContain("vacío");

    expect((await cocina.rpc("marcar_agotado", { _menu_item_id: ids["Agua mineral"], _agotado: true })).error).toBeNull();
    try {
      expect(await intentar([{ menu_item_id: ids["Agua mineral"], quantity: 1 }])).toContain("ya no está disponible");
    } finally {
      await cocina.rpc("marcar_agotado", { _menu_item_id: ids["Agua mineral"], _agotado: false });
    }
  });

  it("solo el personal de sala toma pedidos, y el mozo solo en sus mesas o en las libres", async () => {
    await liberar(3);
    const linea = [{ menu_item_id: ids["Agua mineral"], quantity: 1 }];
    expect((await cocina.rpc("crear_pedido_mozo", { _table_id: await mesa(3), _items: linea })).error?.message).toContain("permiso");
    expect((await caja.rpc("crear_pedido_mozo", { _table_id: await mesa(3), _items: linea })).error?.message).toContain("permiso");
    expect((await anonimo().rpc("crear_pedido_mozo", { _table_id: await mesa(3), _items: linea })).error).not.toBeNull();
    expect((await (await invitado()).rpc("crear_pedido_mozo", { _table_id: await mesa(3), _items: linea })).error).not.toBeNull();

    const { data: { user } } = await mozo.auth.getUser();
    const { data: otro } = await dueno.from("staff_users").select("id").eq("tenant_id", DEMO.tenant).eq("role", "waiter").neq("auth_user_id", user!.id).limit(1).single();
    await dueno.rpc("transferir_mesa", { _table_id: await mesa(3), _staff_id: otro!.id });
    expect((await mozo.rpc("crear_pedido_mozo", { _table_id: await mesa(3), _items: linea })).error?.message).toContain("otro mozo");
    await liberar(3);
  });

  it("pedidos al mismo tiempo nunca repiten número", async () => {
    await liberar(4);
    const linea = [{ menu_item_id: ids["Agua mineral"], quantity: 1 }];
    const resultados = await Promise.all(Array.from({ length: 6 }, async () => mozo.rpc("crear_pedido_mozo", { _table_id: await mesa(4), _items: linea })));
    const numeros = resultados.map((r) => (r.data as { order_number: number }).order_number);
    expect(resultados.every((r) => r.error === null)).toBe(true);
    expect(new Set(numeros).size).toBe(6);
    await dueno.rpc("cerrar_mesa", { _table_id: await mesa(4), _motivo: "fin de prueba" });
  });

  it("el pago del comensal usa los mismos precios: rechaza opciones inventadas y cobra los extras reales", async () => {
    const comensal = await invitado();
    await comensal.rpc("unirse_a_mesa", { _qr_token: qrMesa(5)! });
    const token = (await comensal.auth.getSession()).data.session!.access_token;
    const pagar = (cart_items: unknown, clave = `p19-${Date.now()}-${Math.random()}`) =>
      llamarFuncion("process-payment", { table_token: qrMesa(5), method: "card", cart_items, idempotency_key: clave }, token);

    const inventada = await pagar([{ menu_item_id: ids["Piscola"], quantity: 1, modifiers: [{ groupName: "Pisco", modifierName: "Pisco gratis" }, { groupName: "Bebida", modifierName: "Coca-Cola" }] }]);
    expect(inventada.status).toBe(409);
    expect(JSON.parse(inventada.cuerpo).error).toContain("no es válida");
    const falta = await pagar([{ menu_item_id: ids["Piscola"], quantity: 1, modifiers: [{ groupName: "Pisco", modifierName: "Pisco 35°" }] }]);
    expect(falta.status).toBe(409);
    expect(JSON.parse(falta.cuerpo).error).toContain("Elige");

    const { data: piscola } = await anonimo().from("menu_items").select("price").eq("id", ids["Piscola"]).single();
    const clave = `p19-ok-${Date.now()}`;
    const linea = [{ menu_item_id: ids["Piscola"], quantity: 2, modifiers: [{ groupName: "Pisco", modifierName: "Pisco 40° premium" }, { groupName: "Bebida", modifierName: "Ginger ale" }] }];
    const ok = await pagar(linea, clave);
    expect(ok.status).toBe(200);
    const cuerpo = JSON.parse(ok.cuerpo);
    expect(cuerpo.payment.amount).toBe((piscola!.price + 1500) * 2);

    // Pago repetido con la misma clave: no se cobra ni se crea otro pedido
    const repetido = await pagar(linea, clave);
    expect(repetido.status).toBe(200);
    expect(JSON.parse(repetido.cuerpo).duplicate).toBe(true);
    const { data: pagos } = await dueno.from("payments").select("id").eq("idempotency_key", clave);
    expect(pagos).toHaveLength(1);
  });

  it("con la sucursal cerrada no se puede pedir ni pagar", async () => {
    expect((await dueno.from("branches").update({ is_open: false }).eq("id", DEMO.sucursal)).error).toBeNull();
    try {
      const comensal = await invitado();
      await comensal.rpc("unirse_a_mesa", { _qr_token: qrMesa(6)! });
      const token = (await comensal.auth.getSession()).data.session!.access_token;
      const r = await llamarFuncion("process-payment", { table_token: qrMesa(6), method: "card", cart_items: [{ menu_item_id: ids["Agua mineral"], quantity: 1 }], idempotency_key: `cerrado-${Date.now()}` }, token);
      expect(r.status).toBe(409);
      expect(JSON.parse(r.cuerpo).error).toContain("cerrado");
      expect((await mozo.rpc("crear_pedido_mozo", { _table_id: await mesa(6), _items: [{ menu_item_id: ids["Agua mineral"], quantity: 1 }] })).error?.message).toContain("cerrado");
    } finally {
      await dueno.from("branches").update({ is_open: true }).eq("id", DEMO.sucursal);
    }
  });

  // Solo en la base desechable, donde existe "Local Ajeno".
  it.skipIf(!process.env.DEMO_CREDENCIALES)("el dueño de otro local no toma pedidos en el demo", async () => {
    const ajeno = (await conSesion("owner_ajeno")).cliente;
    const r = await ajeno.rpc("crear_pedido_mozo", { _table_id: await mesa(7), _items: [{ menu_item_id: ids["Agua mineral"], quantity: 1 }] });
    expect(r.error?.message).toContain("permiso");
  });
});
