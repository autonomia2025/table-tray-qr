import { describe, it, expect, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonimo, conSesion, hayCredenciales, invitado, llamarFuncion, qrMesa, DEMO } from "./entorno";

// Fase 3.4b — Avisos al celular aunque esté bloqueado: cada comensal guarda y ve solo su dirección de
// aviso; solo la cocina (o el encargado) dispara el aviso, y lo listo se avisa una sola vez.

// Dirección de aviso de mentira (dominio que no existe): el envío falla sin molestar a nadie
const direccion = () => `https://push.ejemplo.invalid/tablio/${Date.now()}-${Math.random().toString(36).slice(2)}`;
const claves = { _p256dh: "B" + "x".repeat(86), _auth: "a".repeat(22) };

describe.skipIf(!hayCredenciales)("avisos al celular", () => {
  let dueno: SupabaseClient;
  let cocina: SupabaseClient;
  let tokenCocina: string;
  let item: string;
  const idMesa = async (n: number) => (await dueno.from("tables").select("id").eq("branch_id", DEMO.sucursal).eq("number", n).single()).data!.id as string;

  beforeAll(async () => {
    dueno = (await conSesion("owner")).cliente;
    ({ cliente: cocina, token: tokenCocina } = await conSesion("kitchen"));
    item = (await anonimo().from("menu_items").select("id").eq("tenant_id", DEMO.tenant).eq("name", "Agua mineral").single()).data!.id;
  });

  it("cada comensal guarda y ve solo su dirección de aviso; el personal no las ve", async () => {
    const yo = await invitado();
    await yo.rpc("unirse_a_mesa", { _qr_token: qrMesa(5)! });
    const mia = direccion();
    expect((await yo.rpc("guardar_suscripcion_push", { _qr_token: qrMesa(5)!, _endpoint: mia, ...claves })).error).toBeNull();
    expect((await yo.from("suscripciones_push").select("endpoint")).data!.map((s) => s.endpoint)).toContain(mia);

    // Otro comensal, el dueño o la cocina no la ven; nadie la escribe directo
    expect((await (await invitado()).from("suscripciones_push").select("id")).data ?? []).toHaveLength(0);
    expect((await dueno.from("suscripciones_push").select("id").eq("endpoint", mia)).data ?? []).toHaveLength(0);
    expect((await cocina.from("suscripciones_push").select("id")).data ?? []).toHaveLength(0);
    expect((await yo.from("suscripciones_push").insert({ tenant_id: DEMO.tenant, user_id: (await yo.auth.getUser()).data.user!.id, endpoint: direccion(), ...{ p256dh: claves._p256dh, auth: claves._auth } })).error).not.toBeNull();

    // Direcciones raras, quien no está en la mesa o sin sesión: no
    expect((await yo.rpc("guardar_suscripcion_push", { _qr_token: qrMesa(5)!, _endpoint: "http://inseguro.cl/x", ...claves })).error).not.toBeNull();
    expect((await (await invitado()).rpc("guardar_suscripcion_push", { _qr_token: qrMesa(5)!, _endpoint: direccion(), ...claves })).error).not.toBeNull();
    expect((await anonimo().rpc("guardar_suscripcion_push", { _qr_token: qrMesa(5)!, _endpoint: direccion(), ...claves })).error).not.toBeNull();

    // Puede borrar la suya
    expect((await yo.from("suscripciones_push").delete().eq("endpoint", mia)).error).toBeNull();
    expect((await yo.from("suscripciones_push").select("id")).data ?? []).toHaveLength(0);
  });

  it("solo la cocina (o el encargado) dispara el aviso, y lo listo se avisa una sola vez", async () => {
    await dueno.rpc("cerrar_mesa", { _table_id: await idMesa(6), _motivo: "preparar prueba" });
    const comensal = await invitado();
    await comensal.rpc("unirse_a_mesa", { _qr_token: qrMesa(6)! });
    await comensal.rpc("guardar_suscripcion_push", { _qr_token: qrMesa(6)!, _endpoint: direccion(), ...claves });
    const token = (await comensal.auth.getSession()).data.session!.access_token;
    const r = await llamarFuncion("process-payment", {
      table_token: qrMesa(6), method: "card", cart_items: [{ menu_item_id: item, quantity: 1 }], idempotency_key: `aviso-${Date.now()}`,
    }, token);
    const pedido = JSON.parse(r.cuerpo).order.id as string;

    // Nada listo todavía: no hay qué avisar
    expect(JSON.parse((await llamarFuncion("avisar-listo", { order_id: pedido }, tokenCocina)).cuerpo)).toMatchObject({ enviados: 0, productos: 0 });

    expect((await cocina.rpc("cambiar_estado_pedido", { _order_id: pedido, _estado: "ready" })).error).toBeNull();
    // El comensal, el mozo, sin sesión o con un pedido inválido: no
    expect((await llamarFuncion("avisar-listo", { order_id: pedido }, token)).status).toBe(403);
    expect((await llamarFuncion("avisar-listo", { order_id: pedido }, (await conSesion("waiter")).token)).status).toBe(403);
    expect((await llamarFuncion("avisar-listo", { order_id: pedido })).status).toBe(401);
    expect((await llamarFuncion("avisar-listo", { order_id: "x" }, tokenCocina)).status).toBe(400);

    // La cocina avisa: se intenta enviar a su celular (la dirección es de mentira, así que falla sin romper nada)
    const primero = JSON.parse((await llamarFuncion("avisar-listo", { order_id: pedido }, tokenCocina)).cuerpo);
    expect(primero.productos).toBe(1);
    if (primero.configurado !== false) expect(primero.enviados + primero.fallidos).toBe(1);
    // Una segunda llamada no vuelve a avisar lo mismo
    expect(JSON.parse((await llamarFuncion("avisar-listo", { order_id: pedido }, tokenCocina)).cuerpo).productos).toBe(0);
    const { data: items } = await dueno.from("order_items").select("avisado_at").eq("order_id", pedido);
    expect(items!.every((i) => i.avisado_at !== null)).toBe(true);
  });
});
