import { describe, it, expect, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonimo, conSesion, hayCredenciales, invitado, llamarFuncion, qrMesa, DEMO } from "./entorno";

// Fase 1.5 — Dominio MESAS y SESIONES: abrir, tomar, transferir y cerrar por el servidor,
// lectura de mesas cerrada (los códigos QR ya no se exponen) y registro de cada acción.

async function idMesa(cliente: SupabaseClient, numero: number): Promise<string> {
  const { data } = await cliente.from("tables").select("id").eq("branch_id", DEMO.sucursal).eq("number", numero).single();
  return data!.id;
}

async function pedidoPagado(mesa: number) {
  const comensal = await invitado();
  await comensal.rpc("unirse_a_mesa", { _qr_token: qrMesa(mesa)! });
  const token = (await comensal.auth.getSession()).data.session!.access_token;
  const { data: item } = await anonimo().from("menu_items").select("id").eq("tenant_id", DEMO.tenant).eq("name", "Agua mineral").single();
  const r = await llamarFuncion(
    "process-payment",
    { table_token: qrMesa(mesa), method: "card", cart_items: [{ menu_item_id: item!.id, quantity: 1 }], idempotency_key: `m-${Date.now()}-${Math.random()}` },
    token,
  );
  expect(r.status).toBe(200);
  return { id: JSON.parse(r.cuerpo).order.id as string, comensal };
}

describe.skipIf(!hayCredenciales)("mesas y sesiones", () => {
  let dueno: SupabaseClient;
  let mozo: SupabaseClient;
  let cocina: SupabaseClient;
  let caja: SupabaseClient;

  beforeAll(async () => {
    dueno = (await conSesion("owner")).cliente;
    mozo = (await conSesion("waiter")).cliente;
    cocina = (await conSesion("kitchen")).cliente;
    caja = (await conSesion("cashier")).cliente;
  });

  it("sin sesión no se leen mesas ni sus códigos QR, y no se escriben mesas ni sesiones", async () => {
    const anon = anonimo();
    const { data: mesas } = await anon.from("tables").select("id, qr_token").limit(5);
    expect(mesas ?? []).toHaveLength(0);
    const { data: sesiones } = await anon.from("table_sessions").select("id").limit(5);
    expect(sesiones ?? []).toHaveLength(0);
    const cambio = await anon.from("tables").update({ status: "free" }).eq("branch_id", DEMO.sucursal).select("id");
    expect(cambio.data ?? []).toHaveLength(0);
    const nueva = await anon.from("table_sessions").insert({ tenant_id: DEMO.tenant, branch_id: DEMO.sucursal, table_id: await idMesa(dueno, 9) });
    expect(nueva.error).not.toBeNull();
  });

  it("con el código del QR se ve solo esa mesa (sin su código); un código falso no muestra nada", async () => {
    const mesa = await anonimo().rpc("ver_mesa", { _qr_token: qrMesa(8)! });
    expect(mesa.error).toBeNull();
    const datos = mesa.data as Record<string, unknown>;
    expect(datos.number).toBe(8);
    expect(datos.tenant_id).toBe(DEMO.tenant);
    expect(datos).not.toHaveProperty("qr_token");
    const falso = await anonimo().rpc("ver_mesa", { _qr_token: "no-existe-este-codigo" });
    expect(falso.data).toBeNull();
  });

  it("el comensal no lista las mesas del local ni escribe su sesión directo", async () => {
    const comensal = await invitado();
    await comensal.rpc("unirse_a_mesa", { _qr_token: qrMesa(8)! });
    const { data: mesas } = await comensal.from("tables").select("id, number, qr_token").eq("branch_id", DEMO.sucursal);
    // Solo ve la mesa donde está sentado
    expect((mesas ?? []).map((m) => m.number)).toEqual([8]);
    const { data: sesion } = await comensal.from("table_sessions").select("id").eq("is_active", true);
    expect(sesion).toHaveLength(1);
    const cambio = await comensal.from("table_sessions").update({ total_amount: 1, paid_amount: 999999 }).eq("id", sesion![0].id).select("id");
    expect(cambio.error ?? cambio.data?.length === 0).toBeTruthy();
    const estado = await comensal.from("tables").update({ status: "free" }).eq("number", 8).select("id");
    expect(estado.error ?? estado.data?.length === 0).toBeTruthy();
  });

  it("el personal no escribe el estado ni el mozo de una mesa directo; el dueño sí edita su configuración", async () => {
    const id = await idMesa(dueno, 9);
    const mozoDirecto = await mozo.from("tables").update({ status: "free" }).eq("id", id).select("id");
    expect(mozoDirecto.error).not.toBeNull();
    const duenoDirecto = await dueno.from("tables").update({ assigned_waiter_id: null }).eq("id", id).select("id");
    expect(duenoDirecto.error).not.toBeNull();
    const sesionDirecta = await dueno.from("table_sessions").update({ is_active: false }).eq("table_id", id).select("id");
    expect(sesionDirecta.error).not.toBeNull();

    const config = await dueno.from("tables").update({ capacity: 6 }).eq("id", id).select("capacity");
    expect(config.data?.[0]?.capacity).toBe(6);
    await dueno.from("tables").update({ capacity: 4 }).eq("id", id);
    const ajenaMozo = await mozo.from("tables").update({ capacity: 2 }).eq("id", id).select("id");
    expect(ajenaMozo.data ?? []).toHaveLength(0);
  });

  it("el mozo toma una mesa libre; la de otro mozo solo cambia transfiriéndola, y todo queda registrado", async () => {
    const id = await idMesa(dueno, 10);
    expect((await dueno.rpc("cerrar_mesa", { _table_id: id, _motivo: "preparar prueba" })).error).toBeNull();
    const tomada = await mozo.rpc("tomar_mesa", { _table_id: id });
    expect(tomada.error).toBeNull();
    const yo = (tomada.data as { assigned_waiter_id: string }).assigned_waiter_id;
    // El otro mozo del demo
    const { data: otro } = await dueno.from("staff_users").select("id, name").eq("tenant_id", DEMO.tenant).eq("role", "waiter").neq("id", yo).limit(1).single();

    // La cocina no atiende mesas
    expect((await cocina.rpc("tomar_mesa", { _table_id: id })).error?.message).toContain("permiso");

    // El dueño se la pasa a otro mozo; el primero ya no puede tomarla ni transferirla
    expect((await dueno.rpc("transferir_mesa", { _table_id: id, _staff_id: otro!.id })).error).toBeNull();
    expect((await mozo.rpc("tomar_mesa", { _table_id: id })).error?.message).toContain(otro!.name);
    expect((await mozo.rpc("transferir_mesa", { _table_id: id, _staff_id: yo })).error?.message).toContain("mozo a cargo");

    // No se puede transferir a la cocina
    const { data: cocinero } = await dueno.from("staff_users").select("id").eq("tenant_id", DEMO.tenant).eq("role", "kitchen").limit(1).single();
    expect((await dueno.rpc("transferir_mesa", { _table_id: id, _staff_id: cocinero!.id })).error).not.toBeNull();

    const { data: eventos } = await dueno.from("table_events").select("accion, detalle").eq("table_id", id).order("id", { ascending: false }).limit(2);
    expect(eventos!.map((e) => e.accion)).toEqual(["transferir", "tomar"]);
    expect((eventos![0].detalle as { hacia: string }).hacia).toBe(otro!.id);
    await dueno.rpc("cerrar_mesa", { _table_id: id, _motivo: "fin de prueba" });
  });

  it("con pedidos sin pagar el mozo no cierra la mesa; el encargado sí, con motivo, y queda lo que se perdió", async () => {
    const id = await idMesa(dueno, 9);
    await dueno.rpc("cerrar_mesa", { _table_id: id, _motivo: "preparar prueba" });
    const apertura = await mozo.rpc("abrir_mesa", { _table_id: id });
    expect(apertura.error).toBeNull();
    const sesion = (apertura.data as { session_id: string }).session_id;
    const { error: e } = await mozo.from("orders").insert({
      tenant_id: DEMO.tenant, branch_id: DEMO.sucursal, table_id: id, session_id: sesion,
      order_number: 9000 + Math.floor(Math.random() * 900), total_amount: 4500, status: "confirmed", source: "waiter",
    });
    expect(e).toBeNull();

    // El total de la sesión lo calcula la base
    const { data: s } = await dueno.from("table_sessions").select("total_amount").eq("id", sesion).single();
    expect(s!.total_amount).toBe(4500);

    expect((await mozo.rpc("cerrar_mesa", { _table_id: id })).error?.message).toContain("sin pagar");
    expect((await dueno.rpc("cerrar_mesa", { _table_id: id })).error?.message).toContain("motivo");
    const cierre = await dueno.rpc("cerrar_mesa", { _table_id: id, _motivo: "se fueron sin pagar" });
    expect(cierre.error).toBeNull();
    expect(cierre.data).toMatchObject({ pedidos_sin_pagar: 1, monto_sin_pagar: 4500 });

    const { data: mesa } = await dueno.from("tables").select("status, assigned_waiter_id").eq("id", id).single();
    expect(mesa).toEqual({ status: "free", assigned_waiter_id: null });
    const { data: cerrada } = await dueno.from("table_sessions").select("is_active, closed_at").eq("id", sesion).single();
    expect(cerrada!.is_active).toBe(false);
    expect(cerrada!.closed_at).not.toBeNull();
    const { data: evento } = await dueno.from("table_events").select("accion, motivo, detalle").eq("session_id", sesion).eq("accion", "cerrar").single();
    expect(evento!.motivo).toBe("se fueron sin pagar");
  });

  it("al cerrar una mesa pagada se entrega lo listo; el comensal califica su visita y un extraño no", async () => {
    const id = await idMesa(dueno, 7);
    await dueno.rpc("cerrar_mesa", { _table_id: id, _motivo: "preparar prueba" });
    const p = await pedidoPagado(7);
    expect((await cocina.rpc("cambiar_estado_pedido", { _order_id: p.id, _estado: "in_kitchen" })).error).toBeNull();
    expect((await cocina.rpc("cambiar_estado_pedido", { _order_id: p.id, _estado: "ready" })).error).toBeNull();

    // La cocina no cierra mesas; el mozo sí (la mesa está pagada)
    expect((await cocina.rpc("cerrar_mesa", { _table_id: id })).error?.message).toContain("permiso");
    const cierre = await mozo.rpc("cerrar_mesa", { _table_id: id });
    expect(cierre.error).toBeNull();
    expect(cierre.data).toMatchObject({ pedidos_sin_pagar: 0, pedidos_entregados: 1 });
    const { data: pedido } = await dueno.from("orders").select("status").eq("id", p.id).single();
    expect(pedido!.status).toBe("delivered");

    // El comensal todavía ve su sesión (cerrada) y la califica
    expect((await p.comensal.rpc("calificar_mesa", { _qr_token: qrMesa(7)!, _estrellas: 5 })).error).toBeNull();
    const extrano = await invitado();
    expect((await extrano.rpc("calificar_mesa", { _qr_token: qrMesa(7)!, _estrellas: 1 })).error).not.toBeNull();
    expect((await p.comensal.rpc("calificar_mesa", { _qr_token: qrMesa(7)!, _estrellas: 9 })).error).not.toBeNull();
    const { data: ses } = await dueno.from("table_sessions").select("rating").eq("table_id", id).order("opened_at", { ascending: false }).limit(1).single();
    expect(ses!.rating).toBe(5);
  });

  it("la caja puede cerrar mesas; el registro de mesas no lo escribe ni borra nadie", async () => {
    const id = await idMesa(dueno, 9);
    await dueno.rpc("abrir_mesa", { _table_id: id });
    expect((await caja.rpc("cerrar_mesa", { _table_id: id })).error).toBeNull();

    const escribir = await dueno.from("table_events").insert({ tenant_id: DEMO.tenant, branch_id: DEMO.sucursal, table_id: id, accion: "cerrar" });
    expect(escribir.error).not.toBeNull();
    const borrar = await dueno.from("table_events").delete().eq("table_id", id).select("id");
    expect(borrar.error ?? borrar.data?.length === 0).toBeTruthy();
    const { data: anon } = await anonimo().from("table_events").select("id").limit(1);
    expect(anon ?? []).toHaveLength(0);
  });

  it("una mesa nueva recibe un código QR largo generado por la base; la caja no crea mesas", async () => {
    const nueva = await dueno.from("tables").insert({ tenant_id: DEMO.tenant, branch_id: DEMO.sucursal, number: 900 + Math.floor(Math.random() * 99), name: "Prueba" }).select("id, qr_token, status").single();
    expect(nueva.error).toBeNull();
    expect(nueva.data!.qr_token.length).toBeGreaterThanOrEqual(32);
    expect(nueva.data!.status).toBe("free");
    expect((await dueno.from("tables").delete().eq("id", nueva.data!.id)).error).toBeNull();

    const caja1 = await caja.from("tables").insert({ tenant_id: DEMO.tenant, branch_id: DEMO.sucursal, number: 999 });
    expect(caja1.error).not.toBeNull();
    // Ni con un código corto inventado
    const corto = await dueno.from("tables").insert({ tenant_id: DEMO.tenant, branch_id: DEMO.sucursal, number: 998, qr_token: "123" });
    expect(corto.error).not.toBeNull();
  });

  // Solo en la base desechable, donde existe "Local Ajeno".
  it.skipIf(!process.env.DEMO_CREDENCIALES)("el dueño de otro local no ve ni toca las mesas del demo", async () => {
    const ajeno = (await conSesion("owner_ajeno")).cliente;
    const id = await idMesa(dueno, 9);
    const { data } = await ajeno.from("tables").select("id").eq("id", id);
    expect(data ?? []).toHaveLength(0);
    expect((await ajeno.rpc("abrir_mesa", { _table_id: id })).error?.message).toContain("permiso");
    expect((await ajeno.rpc("cerrar_mesa", { _table_id: id, _motivo: "intento ajeno" })).error?.message).toContain("permiso");
    const otraSucursal = await ajeno.from("tables").insert({ tenant_id: DEMO.tenant, branch_id: DEMO.sucursal, number: 997 });
    expect(otraSucursal.error).not.toBeNull();
  });
});
