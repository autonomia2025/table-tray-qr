import { describe, it, expect, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonimo, conSesion, hayCredenciales, invitado, llamarFuncion, qrMesa, DEMO } from "./entorno";

// Propinas por pagar al equipo (art. 64 del Código del Trabajo): la plata queda en el local y debe
// entregarse íntegra al mozo (con tarjeta, en 7 días hábiles). Tablio lleva la cuenta y registra el pago.

type Pendiente = { staff_id: string; monto: number; pagos: number; desde: string; vence: string; vencida: boolean };
const MESA = 2;

describe.skipIf(!hayCredenciales)("propinas por pagar al equipo", () => {
  let dueno: SupabaseClient;
  let caja: SupabaseClient;
  let mozo: SupabaseClient;
  let miFicha: string;
  let item: string;
  const pendienteDe = async (c: SupabaseClient, ficha: string) => {
    const r = await c.rpc("propinas_por_pagar", { _branch_id: DEMO.sucursal });
    expect(r.error).toBeNull();
    return ((r.data as { pendientes: Pendiente[] }).pendientes.find((p) => p.staff_id === ficha)) ?? null;
  };

  beforeAll(async () => {
    dueno = (await conSesion("owner")).cliente;
    caja = (await conSesion("cashier")).cliente;
    mozo = (await conSesion("waiter")).cliente;
    const yo = (await mozo.auth.getUser()).data.user!.id;
    miFicha = (await dueno.from("staff_users").select("id").eq("tenant_id", DEMO.tenant).eq("auth_user_id", yo).single()).data!.id;
    item = (await anonimo().from("menu_items").select("id").eq("tenant_id", DEMO.tenant).eq("name", "Barros Luco").single()).data!.id;
  });

  it("la propina pagada con la app queda como deuda con la mozo de la mesa; la caja registra el pago una sola vez", async () => {
    const { data: mesa } = await dueno.from("tables").select("id").eq("branch_id", DEMO.sucursal).eq("number", MESA).single();
    await dueno.rpc("cerrar_mesa", { _table_id: mesa!.id, _motivo: "preparar prueba" });
    expect((await mozo.rpc("tomar_mesa", { _table_id: mesa!.id })).error).toBeNull();
    try {
      // Deja en cero lo que se le debía antes (de otras pruebas o de la historia de ejemplo)
      await caja.rpc("pagar_propinas", { _branch_id: DEMO.sucursal, _staff_id: miFicha, _medio: "efectivo" });

      const c = await invitado();
      await c.rpc("unirse_a_mesa", { _qr_token: qrMesa(MESA)! });
      const token = (await c.auth.getSession()).data.session!.access_token;
      const r = await llamarFuncion("process-payment", {
        table_token: qrMesa(MESA), method: "card", tip_amount: 890, cart_items: [{ menu_item_id: item, quantity: 1 }],
        idempotency_key: `propina-${Date.now()}`,
      }, token);
      expect(r.status).toBe(200);

      const pendiente = await pendienteDe(dueno, miFicha);
      expect(pendiente).toMatchObject({ monto: 890, pagos: 1, vencida: false });
      expect(pendiente!.vence > pendiente!.desde).toBe(true);
      // La mozo ve lo que le deben
      const mio = await mozo.rpc("mis_propinas_por_cobrar", { _branch_id: DEMO.sucursal });
      expect(mio.error).toBeNull();
      expect((mio.data as { por_cobrar: number }).por_cobrar).toBe(890);

      // La mozo no se paga sola; dos personas registrando al mismo tiempo pagan una sola vez
      expect((await mozo.rpc("pagar_propinas", { _branch_id: DEMO.sucursal, _staff_id: miFicha, _medio: "efectivo" })).error).not.toBeNull();
      const [a, b] = await Promise.all([
        caja.rpc("pagar_propinas", { _branch_id: DEMO.sucursal, _staff_id: miFicha, _medio: "transferencia", _nota: "Prueba" }),
        dueno.rpc("pagar_propinas", { _branch_id: DEMO.sucursal, _staff_id: miFicha, _medio: "efectivo" }),
      ]);
      const ok = [a, b].filter((x) => x.error === null);
      expect(ok).toHaveLength(1);
      expect((ok[0].data as { monto: number }).monto).toBe(890);
      expect([a, b].find((x) => x.error)!.error!.message).toContain("No hay propinas por pagar");
      expect(await pendienteDe(dueno, miFicha)).toBeNull();

      // La mozo ve el pago; queda en la auditoría
      const despues = (await mozo.rpc("mis_propinas_por_cobrar", { _branch_id: DEMO.sucursal })).data as { por_cobrar: number; pagadas: { monto: number }[] };
      expect(despues.por_cobrar).toBe(0);
      expect(despues.pagadas[0].monto).toBe(890);
      const { data: log } = await dueno.from("audit_logs").select("action").eq("tenant_id", DEMO.tenant).eq("action", "propinas_pagadas").limit(1);
      expect(log).toHaveLength(1);
    } finally {
      await dueno.rpc("cerrar_mesa", { _table_id: mesa!.id, _motivo: "fin de la prueba" });
    }
  });

  it("solo dueño, administrador, encargado y caja ven y registran; la mozo ve solo lo suyo; nadie escribe directo", async () => {
    for (const [quien, c] of [["mozo", mozo], ["cocina", (await conSesion("kitchen")).cliente], ["comensal", await invitado()], ["anónimo", anonimo()]] as const) {
      expect((await c.rpc("propinas_por_pagar", { _branch_id: DEMO.sucursal })).error, quien).not.toBeNull();
    }
    expect((await (await conSesion("admin")).cliente.rpc("propinas_por_pagar", { _branch_id: DEMO.sucursal })).error).toBeNull();
    expect((await (await invitado()).rpc("mis_propinas_por_cobrar", { _branch_id: DEMO.sucursal })).error).not.toBeNull();
    // La mozo no ve los pagos de propinas de otros
    const { data: suyos } = await mozo.from("liquidaciones_propina").select("staff_id");
    expect((suyos ?? []).every((l) => l.staff_id === miFicha)).toBe(true);
    // Nadie inventa un pago de propinas desde el navegador
    expect((await dueno.from("liquidaciones_propina").insert({
      tenant_id: DEMO.tenant, branch_id: DEMO.sucursal, staff_id: miFicha, monto: 1, pagos: ["00000000-0000-0000-0000-000000000000"], medio: "efectivo",
    })).error).not.toBeNull();
    // Un medio inventado o una persona de otro local, no
    expect((await caja.rpc("pagar_propinas", { _branch_id: DEMO.sucursal, _staff_id: miFicha, _medio: "cheque" })).error?.message).toContain("Elige cómo");
    expect((await caja.rpc("pagar_propinas", { _branch_id: DEMO.sucursal, _staff_id: "00000000-0000-0000-0000-000000000000", _medio: "efectivo" })).error).not.toBeNull();
  });

  it.skipIf(!process.env.DEMO_CREDENCIALES)("el dueño de otro local no ve ni registra propinas del demo", async () => {
    const ajeno = (await conSesion("owner_ajeno")).cliente;
    expect((await ajeno.rpc("propinas_por_pagar", { _branch_id: DEMO.sucursal })).error).not.toBeNull();
    expect((await ajeno.rpc("pagar_propinas", { _branch_id: DEMO.sucursal, _staff_id: miFicha, _medio: "efectivo" })).error).not.toBeNull();
    expect((await ajeno.from("liquidaciones_propina").select("id").eq("tenant_id", DEMO.tenant)).data ?? []).toHaveLength(0);
  });

  it("la auditoría de la operación sigue vacía con los pagos de propinas", async () => {
    const { data } = await (await conSesion("superadmin")).cliente.rpc("auditoria_operacion");
    expect(data ?? [], JSON.stringify(data)).toHaveLength(0);
  });
});
