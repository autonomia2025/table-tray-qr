import { describe, it, expect, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  anonimo, confirmarPresencia, conSesion, esBaseLocal, guardarCuenta, hayCredenciales, invitado, llamarFuncion, qrMesa, DEMO,
} from "./entorno";

// Fase 3.7 — Sellos: los suma la base al guardarse un pago. Uno por persona y día de negocio, desde el
// monto mínimo del programa (el demo: $3.000), solo con cuenta verificada, también al pagarle al mozo,
// retroactivos al guardar la cuenta, anulados con un reembolso total y premios que entrega el personal.

type Tarjeta = {
  programa: { tipo: string; meta: number; premio: string; monto_minimo: number } | null;
  registrado: boolean;
  pendiente?: boolean;
  total?: number;
  sellos?: number;
  puntos?: number;
  hoy_sumado?: boolean;
  ultimo?: { payment_id: string; sello: boolean; retroactivo: boolean; premio: boolean } | null;
  premios?: { id: string; descripcion: string; codigo: string }[];
};

const MESA = 10;
const tarjeta = async (c: SupabaseClient) => {
  const r = await c.rpc("mis_sellos", { _tenant_id: DEMO.tenant, _branch_id: DEMO.sucursal });
  expect(r.error).toBeNull();
  return r.data as unknown as Tarjeta;
};

describe.skipIf(!hayCredenciales)("sellos que se sienten", () => {
  let dueno: SupabaseClient;
  let mozo: SupabaseClient;
  const ids: Record<string, string> = {};

  const sentarse = async (c: SupabaseClient) => {
    await c.rpc("unirse_a_mesa", { _qr_token: qrMesa(MESA)! });
  };
  const pagar = async (c: SupabaseClient, nombre: string, cantidad = 1) => {
    const token = (await c.auth.getSession()).data.session!.access_token;
    const r = await llamarFuncion("process-payment", {
      table_token: qrMesa(MESA), method: "card", cart_items: [{ menu_item_id: ids[nombre], quantity: cantidad }],
      idempotency_key: `sellos-${Date.now()}-${Math.random()}`,
    }, token);
    expect(r.status).toBe(200);
    return JSON.parse(r.cuerpo).payment.id as string;
  };
  const correoNuevo = () => `sellos-${Date.now()}-${Math.floor(Math.random() * 1e6)}@demo.tablio.test`;

  beforeAll(async () => {
    dueno = (await conSesion("owner")).cliente;
    mozo = (await conSesion("waiter")).cliente;
    const { data } = await anonimo().from("menu_items").select("id, name").eq("tenant_id", DEMO.tenant);
    for (const p of data ?? []) ids[p.name] = p.id;
  });

  it.skipIf(!esBaseLocal)("el invitado que paga y después guarda su cuenta recibe el sello de esa visita; un segundo pago el mismo día no suma otro", async () => {
    const c = await invitado();
    await sentarse(c);
    const pago = await pagar(c, "Barros Luco");
    const antes = await tarjeta(c);
    expect(antes.registrado).toBe(false);
    expect(antes.pendiente).toBe(true);

    await guardarCuenta(c, correoNuevo());
    const despues = await tarjeta(c);
    expect(despues).toMatchObject({ registrado: true, total: 1, sellos: 1, hoy_sumado: true });
    expect(despues.ultimo).toMatchObject({ payment_id: pago, sello: true, retroactivo: true });

    // Otra ronda el mismo día: suma al gasto, no otro sello
    await pagar(c, "Barros Luco");
    expect((await tarjeta(c)).total).toBe(1);
    // Ver la tarjeta de nuevo no vuelve a sumar nada
    expect((await tarjeta(c)).total).toBe(1);
  });

  it.skipIf(!esBaseLocal)("una compra bajo el monto mínimo no da sello", async () => {
    const c = await invitado();
    await guardarCuenta(c, correoNuevo());
    await sentarse(c);
    await pagar(c, "Agua mineral"); // $2.000 < $3.000
    const t = await tarjeta(c);
    expect(t.total).toBe(0);
    expect(t.hoy_sumado).toBe(false);
  });

  it.skipIf(!esBaseLocal)("dos pagos al mismo tiempo dan un solo sello", async () => {
    const c = await invitado();
    await guardarCuenta(c, correoNuevo());
    await sentarse(c);
    await Promise.all([pagar(c, "Barros Luco"), pagar(c, "Chacarero")]);
    expect((await tarjeta(c)).total).toBe(1);
    const { data: movs } = await dueno.from("movimientos_lealtad").select("sello").eq("user_id", (await c.auth.getUser()).data.user!.id);
    expect(movs).toHaveLength(2);
    expect(movs!.filter((m) => m.sello)).toHaveLength(1);
  });

  it.skipIf(!esBaseLocal)("pagarle al mozo también suma el sello, a quien pidió", async () => {
    const c = await invitado();
    await guardarCuenta(c, correoNuevo());
    await sentarse(c);
    await confirmarPresencia(c, MESA);
    const r = await c.rpc("pedir_sin_pagar", { _qr_token: qrMesa(MESA)!, _items: [{ menu_item_id: ids["Chacarero"], quantity: 1 }], _forma: "mozo" });
    expect(r.error).toBeNull();
    expect((await tarjeta(c)).total).toBe(0);
    const pedido = r.data as { order_id: string };
    expect((await mozo.rpc("registrar_cobro_mozo", { _order_ids: [pedido.order_id], _metodo: "pos" })).error).toBeNull();
    expect((await tarjeta(c)).total).toBe(1);
  });

  it.skipIf(!esBaseLocal)("un reembolso total quita el sello; si ese día pagó otra cosa, el sello pasa a ese pago", async () => {
    const c = await invitado();
    await guardarCuenta(c, correoNuevo());
    await sentarse(c);
    const primero = await pagar(c, "Barros Luco");
    const segundo = await pagar(c, "Chacarero");
    expect((await tarjeta(c)).total).toBe(1);
    const tokenCaja = (await conSesion("cashier")).token;

    expect((await llamarFuncion("refund-payment", { payment_id: primero, reason: "Prueba de sellos" }, tokenCaja)).status).toBe(200);
    let t = await tarjeta(c);
    expect(t.total).toBe(1);
    expect(t.ultimo?.payment_id).toBe(segundo);

    expect((await llamarFuncion("refund-payment", { payment_id: segundo, reason: "Prueba de sellos" }, tokenCaja)).status).toBe(200);
    t = await tarjeta(c);
    expect(t.total).toBe(0);
    expect(t.hoy_sumado).toBe(false);
  });

  it.skipIf(!esBaseLocal)("al completar la meta gana un premio con código; el mozo lo ve en la mesa y lo entrega con ese código, una sola vez", async () => {
    // Para no esperar 5 días: el programa pasa a puntos por un momento (10 puntos = premio)
    const { data: prog } = await dueno.from("loyalty_programs").select("*").eq("tenant_id", DEMO.tenant).single();
    expect((await dueno.from("loyalty_programs").update({ type: "points", points_goal: 10, points_per_thousand: 1 }).eq("id", prog!.id)).error).toBeNull();
    try {
      const c = await invitado();
      await guardarCuenta(c, correoNuevo());
      await sentarse(c);
      await pagar(c, "Barros Luco", 2); // $17.800 = 17 puntos
      const t = await tarjeta(c);
      expect(t.premios).toHaveLength(1);
      expect(t.puntos).toBe(7);
      const premio = t.premios![0];
      expect(premio.codigo).toMatch(/^[A-Z2-9]{4}$/);

      // El mozo lo ve en el detalle de la mesa
      const { data: mesa } = await dueno.from("tables").select("id").eq("branch_id", DEMO.sucursal).eq("number", MESA).single();
      const enMesa = await mozo.rpc("premios_en_mesa", { _table_id: mesa!.id });
      expect(enMesa.error).toBeNull();
      const visto = (enMesa.data as { id: string; codigo?: string }[]).find((p) => p.id === premio.id);
      expect(visto).toBeDefined();
      expect(visto!.codigo).toBeUndefined(); // el código lo muestra el cliente, no la pantalla del mozo

      // Ni el cliente, ni la cocina, ni alguien sin sesión lo pueden marcar entregado; con otro código, tampoco
      expect((await c.rpc("entregar_premio", { _premio_id: premio.id, _codigo: premio.codigo })).error).not.toBeNull();
      expect((await (await conSesion("kitchen")).cliente.rpc("entregar_premio", { _premio_id: premio.id, _codigo: premio.codigo })).error).not.toBeNull();
      expect((await anonimo().rpc("entregar_premio", { _premio_id: premio.id, _codigo: premio.codigo })).error).not.toBeNull();
      expect((await mozo.rpc("entregar_premio", { _premio_id: premio.id, _codigo: "ZZZZ" })).error?.message).toContain("código");

      expect((await mozo.rpc("entregar_premio", { _premio_id: premio.id, _codigo: premio.codigo.toLowerCase() })).error).toBeNull();
      expect((await mozo.rpc("entregar_premio", { _premio_id: premio.id, _codigo: premio.codigo })).error?.message).toContain("ya se entregó");
      expect((await tarjeta(c)).premios).toHaveLength(0);
      const { data: log } = await dueno.from("audit_logs").select("action").eq("entity_id", premio.id).eq("action", "premio_entregado");
      expect(log).toHaveLength(1);
      // El dueño lo ve en entregados
      const lista = await dueno.rpc("premios_por_entregar", { _tenant_id: DEMO.tenant });
      expect((lista.data as { entregados: { id: string }[] }).entregados.some((p) => p.id === premio.id)).toBe(true);
    } finally {
      await dueno.from("loyalty_programs").update({ type: prog!.type, points_goal: prog!.points_goal, points_per_thousand: prog!.points_per_thousand }).eq("id", prog!.id);
    }
  });

  it("la cuenta de cliente del demo suma como mucho un sello por día, aunque pague dos veces al mismo tiempo", async () => {
    const c = (await conSesion("cliente")).cliente;
    await sentarse(c);
    const antes = await tarjeta(c);
    expect(antes.registrado).toBe(true);
    await Promise.all([pagar(c, "Barros Luco"), pagar(c, "Chacarero")]);
    const despues = await tarjeta(c);
    expect(despues.total).toBe((antes.total ?? 0) + (antes.hoy_sumado ? 0 : 1));
    expect(despues.hoy_sumado).toBe(true);
  });

  it("los movimientos y premios solo los lee el local (dueño, encargado, caja); nadie los escribe desde el navegador", async () => {
    const c = (await conSesion("cliente")).cliente;
    expect((await c.from("movimientos_lealtad").select("id")).data ?? []).toHaveLength(0);
    expect((await c.from("loyalty_rewards").select("id")).data ?? []).toHaveLength(0);
    expect((await mozo.from("movimientos_lealtad").select("id")).data ?? []).toHaveLength(0);
    expect((await (await invitado()).from("loyalty_customers").select("id")).data ?? []).toHaveLength(0);
    expect(((await dueno.from("movimientos_lealtad").select("id").eq("tenant_id", DEMO.tenant)).data ?? []).length).toBeGreaterThan(0);

    // Nadie se regala sellos ni premios
    const yo = (await c.auth.getUser()).data.user!.id;
    const { data: ficha } = await dueno.from("loyalty_customers").select("id, visits").eq("tenant_id", DEMO.tenant).eq("user_id", yo).single();
    await c.from("loyalty_customers").update({ visits: 99 }).eq("id", ficha!.id);
    await dueno.from("loyalty_customers").update({ visits: 99 }).eq("id", ficha!.id);
    const { data: igual } = await dueno.from("loyalty_customers").select("visits").eq("id", ficha!.id).single();
    expect(igual!.visits).toBe(ficha!.visits);
    expect((await c.from("loyalty_rewards").insert({ tenant_id: DEMO.tenant, customer_id: ficha!.id, description: "Gratis" })).error).not.toBeNull();
    expect((await dueno.from("movimientos_lealtad").insert({
      tenant_id: DEMO.tenant, customer_id: ficha!.id, payment_id: "00000000-0000-0000-0000-000000000000", dia_negocio: "2026-10-14", sello: true,
    })).error).not.toBeNull();
    // Las piezas internas no se llaman desde afuera
    expect((await dueno.rpc("_sellos_pago" as never, { _payment_id: "00000000-0000-0000-0000-000000000000" } as never)).error).not.toBeNull();
  });

  it("premios: el mozo solo ve los de una mesa de su local; la lista del local es para dueño, encargado y caja", async () => {
    const { data: mesa } = await dueno.from("tables").select("id").eq("branch_id", DEMO.sucursal).eq("number", MESA).single();
    expect((await (await invitado()).rpc("premios_en_mesa", { _table_id: mesa!.id })).error).not.toBeNull();
    expect((await (await conSesion("kitchen")).cliente.rpc("premios_en_mesa", { _table_id: mesa!.id })).error).not.toBeNull();
    expect((await mozo.rpc("premios_por_entregar", { _tenant_id: DEMO.tenant })).error).not.toBeNull();
    expect((await (await conSesion("cashier")).cliente.rpc("premios_por_entregar", { _tenant_id: DEMO.tenant })).error).toBeNull();
  });

  it.skipIf(!process.env.DEMO_CREDENCIALES)("el dueño de otro local no ve ni entrega premios del demo", async () => {
    const ajeno = (await conSesion("owner_ajeno")).cliente;
    const { data: mesa } = await dueno.from("tables").select("id").eq("branch_id", DEMO.sucursal).eq("number", MESA).single();
    expect((await ajeno.rpc("premios_en_mesa", { _table_id: mesa!.id })).error).not.toBeNull();
    expect((await ajeno.rpc("premios_por_entregar", { _tenant_id: DEMO.tenant })).error).not.toBeNull();
    expect((await ajeno.from("movimientos_lealtad").select("id").eq("tenant_id", DEMO.tenant)).data ?? []).toHaveLength(0);
  });
});
