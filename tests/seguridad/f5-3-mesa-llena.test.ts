import { describe, it, expect, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonimo, conSesion, confirmarPresencia, hayCredenciales, invitado, llamarFuncion, qrMesa, DEMO } from "./entorno";

// Fase 5.3 — Mesa llena: la prueba de carga encontró bloqueos mutuos (deadlocks) cuando, en la misma mesa,
// alguien llamaba al mozo o pedía sin pagar mientras otra persona pagaba. Todas las funciones toman ahora
// primero la mesa, después su visita y después los pedidos. Esto lo provoca a propósito, varias veces.

describe.skipIf(!hayCredenciales)("mesa llena: todo a la vez en la misma mesa", () => {
  let dueno: SupabaseClient;
  let mozo: SupabaseClient;
  let agua: string;
  const MESA = 9;

  beforeAll(async () => {
    dueno = (await conSesion("owner")).cliente;
    mozo = (await conSesion("waiter")).cliente;
    agua = (await anonimo().from("menu_items").select("id").eq("tenant_id", DEMO.tenant).eq("name", "Agua mineral").single()).data!.id;
  });

  it("pagos, llamados al mozo, pedidos sin pagar y cobros del mozo al mismo tiempo: ninguno se bloquea", async () => {
    const mesa = (await dueno.from("tables").select("id").eq("branch_id", DEMO.sucursal).eq("number", MESA).single()).data!.id;
    await dueno.rpc("cerrar_mesa", { _table_id: mesa, _motivo: "preparar prueba" });
    const comensales = await Promise.all(Array.from({ length: 6 }, async () => {
      const c = await invitado();
      await c.rpc("unirse_a_mesa", { _qr_token: qrMesa(MESA)! });
      await confirmarPresencia(c, MESA);
      return { c, token: (await c.auth.getSession()).data.session!.access_token };
    }));
    const fallas: string[] = [];
    for (let ronda = 0; ronda < 4; ronda++) {
      // Un pedido para que el mozo lo cobre en la misma ronda
      const porCobrar = (await comensales[5].c.rpc("pedir_sin_pagar", { _qr_token: qrMesa(MESA)!, _items: [{ menu_item_id: agua, quantity: 1 }], _forma: "mozo" })).data as { order_id: string } | null;
      const tareas: Promise<void>[] = [
        ...comensales.slice(0, 3).map(async ({ token }, i) => {
          const r = await llamarFuncion("process-payment", { table_token: qrMesa(MESA), method: "card", tip_amount: 0, cart_items: [{ menu_item_id: agua, quantity: 1 }], idempotency_key: `llena-${ronda}-${i}-${Date.now()}` }, token);
          if (r.status !== 200) fallas.push(`pago ${r.status} ${r.cuerpo.slice(0, 80)}`);
        }),
        (async () => { const r = await comensales[3].c.rpc("llamar_mozo", { _qr_token: qrMesa(MESA)!, _motivo: "Necesito ayuda" }); if (r.error) fallas.push(`llamar ${r.error.code} ${r.error.message}`); })(),
        (async () => {
          // Alguien que recién llega a la mesa pide sin pagar (máximo 3 esperando por persona: cada ronda es otra)
          const nuevo = await invitado();
          await nuevo.rpc("unirse_a_mesa", { _qr_token: qrMesa(MESA)! });
          await confirmarPresencia(nuevo, MESA);
          const r = await nuevo.rpc("pedir_sin_pagar", { _qr_token: qrMesa(MESA)!, _items: [{ menu_item_id: agua, quantity: 1 }], _forma: "mozo" });
          if (r.error) fallas.push(`pedir ${r.error.code} ${r.error.message}`);
        })(),
        (async () => {
          if (!porCobrar) return;
          const r = await mozo.rpc("registrar_cobro_mozo", { _order_ids: [porCobrar.order_id], _metodo: "cash" });
          if (r.error) fallas.push(`cobro ${r.error.code} ${r.error.message}`);
        })(),
      ];
      await Promise.all(tareas);
    }
    expect(fallas, fallas.join("\n")).toEqual([]);
    expect((await (await conSesion("superadmin")).cliente.rpc("auditoria_plata")).data ?? []).toHaveLength(0);
    await dueno.rpc("cerrar_mesa", { _table_id: mesa, _motivo: "fin de prueba" });
  });
});
