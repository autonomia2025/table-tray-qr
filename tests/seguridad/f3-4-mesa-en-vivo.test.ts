import { describe, it, expect, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonimo, conSesion, hayCredenciales, invitado, llamarFuncion, qrMesa, DEMO } from "./entorno";

// Fase 3.4 — La mesa en vivo: el comensal ve SUS productos por estación con un tiempo estimado, quién
// está en su mesa, y "lo de siempre". Nada de pedidos ajenos ni de estaciones fuera de estas funciones.

type EnVivo = {
  mesa: number;
  personas: { alias: string | null; yo: boolean }[];
  pedidos: { id: string; items: { nombre: string; estado: string; estacion: string | null }[]; faltan_min: number | null }[];
};

describe.skipIf(!hayCredenciales)("la mesa en vivo", () => {
  let dueno: SupabaseClient;
  let cocina: SupabaseClient;
  const ids: Record<string, string> = {};
  let barra: string;
  const idMesa = async (n: number) => (await dueno.from("tables").select("id").eq("branch_id", DEMO.sucursal).eq("number", n).single()).data!.id as string;
  const liberar = async (n: number) => dueno.rpc("cerrar_mesa", { _table_id: await idMesa(n), _motivo: "preparar prueba" });

  async function pagar(c: SupabaseClient, mesa: number, nombres: string[]) {
    await c.rpc("unirse_a_mesa", { _qr_token: qrMesa(mesa)! });
    const token = (await c.auth.getSession()).data.session!.access_token;
    const r = await llamarFuncion("process-payment", {
      table_token: qrMesa(mesa), method: "card", idempotency_key: `vivo-${Date.now()}-${Math.random()}`,
      cart_items: nombres.map((n) => ({ menu_item_id: ids[n], quantity: 1 })),
    }, token);
    expect(r.status).toBe(200);
    return JSON.parse(r.cuerpo).order.id as string;
  }
  const enVivo = async (c: SupabaseClient, mesa: number) =>
    (await c.rpc("mi_mesa_en_vivo", { _qr_token: qrMesa(mesa)! })).data as unknown as EnVivo;

  beforeAll(async () => {
    dueno = (await conSesion("owner")).cliente;
    cocina = (await conSesion("kitchen")).cliente;
    const { data } = await anonimo().from("menu_items").select("id, name").eq("tenant_id", DEMO.tenant);
    for (const p of data ?? []) ids[p.name] = p.id;
    barra = (await dueno.from("stations").select("id").eq("branch_id", DEMO.sucursal).eq("name", "Barra").single()).data!.id;
  });

  it("el comensal ve sus productos por estación y cuánto falta; lo listo no espera lo demás", async () => {
    await liberar(2);
    const yo = await invitado();
    const pedido = await pagar(yo, 2, ["Agua mineral", "Barros Luco"]);
    let v = await enVivo(yo, 2);
    let mio = v.pedidos.find((p) => p.id === pedido)!;
    expect(mio.items.map((i) => [i.nombre, i.estacion]).sort()).toEqual([["Agua mineral", "Barra"], ["Barros Luco", "Cocina"]]);
    expect(mio.faltan_min).toBeGreaterThan(0);

    // La barra deja lista el agua: el comensal lo ve, y todavía falta la comida
    expect((await cocina.rpc("cambiar_estado_pedido", { _order_id: pedido, _estado: "ready", _station_id: barra })).error).toBeNull();
    v = await enVivo(yo, 2);
    mio = v.pedidos.find((p) => p.id === pedido)!;
    expect(mio.items.find((i) => i.nombre === "Agua mineral")!.estado).toBe("ready");
    expect(mio.items.find((i) => i.nombre === "Barros Luco")!.estado).toBe("confirmed");
    expect(mio.faltan_min).toBeGreaterThan(0);

    // Todo listo: ya no hay tiempo estimado
    expect((await cocina.rpc("cambiar_estado_pedido", { _order_id: pedido, _estado: "ready" })).error).toBeNull();
    expect((await enVivo(yo, 2)).pedidos.find((p) => p.id === pedido)!.faltan_min).toBeNull();
  });

  it("en la mesa se ve quién está (alias o invitado), pero cada uno ve solo sus pedidos", async () => {
    await liberar(3);
    const ana = await invitado();
    const pedidoAna = await pagar(ana, 3, ["Agua mineral"]);
    expect((await ana.rpc("unirse_a_mesa", { _qr_token: qrMesa(3)!, _alias: "Ana" })).error).toBeNull();
    const otro = await invitado();
    await otro.rpc("unirse_a_mesa", { _qr_token: qrMesa(3)! });

    const v = await enVivo(otro, 3);
    expect(v.personas).toHaveLength(2);
    expect(v.personas.find((p) => p.yo)!.alias).toBeNull();
    expect(v.personas.find((p) => !p.yo)!.alias).toBe("Ana");
    expect(v.pedidos.some((p) => p.id === pedidoAna)).toBe(false);

    // Quien no está en la mesa, o sin sesión, no ve nada
    expect((await (await invitado()).rpc("mi_mesa_en_vivo", { _qr_token: qrMesa(3)! })).error).not.toBeNull();
    expect((await anonimo().rpc("mi_mesa_en_vivo", { _qr_token: qrMesa(3)! })).error).not.toBeNull();
    // Y el comensal sigue sin poder leer las estaciones directo
    expect((await otro.from("stations").select("id")).data ?? []).toHaveLength(0);
  });

  it("lo de siempre: lo que la persona pidió en dos visitas distintas, y nada para quien es nuevo", async () => {
    await liberar(4);
    const cliente = await invitado();
    await pagar(cliente, 4, ["Mote con huesillo"]);
    expect((await cliente.rpc("lo_de_siempre", { _qr_token: qrMesa(4)! })).data).toEqual([]);

    // Vuelve otro día (otra visita) y lo pide de nuevo
    await liberar(4);
    await pagar(cliente, 4, ["Mote con huesillo"]);
    const siempre = (await cliente.rpc("lo_de_siempre", { _qr_token: qrMesa(4)! })).data as { nombre: string; visitas: number }[];
    expect(siempre[0]).toMatchObject({ nombre: "Mote con huesillo", visitas: 2 });

    // Alguien nuevo no tiene "lo de siempre", y sin sesión tampoco
    expect((await (await invitado()).rpc("lo_de_siempre", { _qr_token: qrMesa(4)! })).data).toEqual([]);
    expect((await anonimo().rpc("lo_de_siempre", { _qr_token: qrMesa(4)! })).error).not.toBeNull();
    await liberar(4);
  });
});
