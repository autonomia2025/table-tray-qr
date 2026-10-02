import { describe, it, expect, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonimo, conSesion, hayCredenciales, invitado, qrMesa, DEMO } from "./entorno";

// Fase 1.6 — Acciones del comensal sin cámara: llamar al mozo y pedir la cuenta por el servidor.
// Valida que el comensal esté en la mesa, sin duplicados, con límite, y el total lo calcula la base.

async function idMesa(cliente: SupabaseClient, numero: number): Promise<string> {
  const { data } = await cliente.from("tables").select("id").eq("branch_id", DEMO.sucursal).eq("number", numero).single();
  return data!.id;
}

describe.skipIf(!hayCredenciales)("acciones del comensal", () => {
  let dueno: SupabaseClient;
  let mozo: SupabaseClient;
  let cocina: SupabaseClient;

  beforeAll(async () => {
    dueno = (await conSesion("owner")).cliente;
    mozo = (await conSesion("waiter")).cliente;
    cocina = (await conSesion("kitchen")).cliente;
  });

  it("nadie escribe llamadas ni cuentas directo, y sin sesión no se leen", async () => {
    const anon = anonimo();
    const id = await idMesa(dueno, 5);
    const llamada = await anon.from("waiter_calls").insert({ tenant_id: DEMO.tenant, branch_id: DEMO.sucursal, table_id: id, status: "pending" });
    expect(llamada.error).not.toBeNull();
    const cuenta = await anon.from("bill_requests").insert({ tenant_id: DEMO.tenant, branch_id: DEMO.sucursal, table_id: id, total_amount: 1, status: "pending" });
    expect(cuenta.error).not.toBeNull();
    expect((await anon.from("waiter_calls").select("id").limit(1)).data ?? []).toHaveLength(0);
    expect((await anon.from("bill_requests").select("id").limit(1)).data ?? []).toHaveLength(0);

    const comensal = await invitado();
    await comensal.rpc("unirse_a_mesa", { _qr_token: qrMesa(5)! });
    const directa = await comensal.from("waiter_calls").insert({ tenant_id: DEMO.tenant, branch_id: DEMO.sucursal, table_id: id, status: "pending" });
    expect(directa.error).not.toBeNull();
    const mozoDirecto = await mozo.from("waiter_calls").update({ status: "attended" }).eq("table_id", id).select("id");
    expect(mozoDirecto.error).not.toBeNull();
  });

  it("solo quien está en la mesa llama al mozo; una segunda llamada no se duplica; el mozo la atiende", async () => {
    const id = await idMesa(dueno, 5);
    await dueno.rpc("cerrar_mesa", { _table_id: id, _motivo: "preparar prueba" });

    // Alguien con el link pero sin estar en la mesa (sin sesión) no puede
    expect((await anonimo().rpc("llamar_mozo", { _qr_token: qrMesa(5)!, _motivo: "help" })).error).not.toBeNull();
    // Un invitado que no se registró en esta mesa tampoco
    const extrano = await invitado();
    expect((await extrano.rpc("llamar_mozo", { _qr_token: qrMesa(5)!, _motivo: "help" })).error?.message).toContain("estar en la mesa");

    const comensal = await invitado();
    await comensal.rpc("unirse_a_mesa", { _qr_token: qrMesa(5)! });
    const primera = await comensal.rpc("llamar_mozo", { _qr_token: qrMesa(5)!, _motivo: "help" });
    expect(primera.error).toBeNull();
    const segunda = await comensal.rpc("llamar_mozo", { _qr_token: qrMesa(5)!, _motivo: "problem" });
    expect((segunda.data as { id: string }).id).toBe((primera.data as { id: string }).id);
    expect((segunda.data as { nueva: boolean }).nueva).toBe(false);

    // El comensal ve su llamada; otro comensal de otra mesa no
    const llamadaId = (primera.data as { id: string }).id;
    expect((await comensal.from("waiter_calls").select("id").eq("id", llamadaId)).data).toHaveLength(1);
    expect((await extrano.from("waiter_calls").select("id").eq("id", llamadaId)).data ?? []).toHaveLength(0);

    // La cocina no atiende llamadas; el mozo sí, y queda quién y cuándo
    expect((await cocina.rpc("atender_llamado", { _id: llamadaId })).error?.message).toContain("permiso");
    expect((await mozo.rpc("atender_llamado", { _id: llamadaId })).error).toBeNull();
    const { data } = await dueno.from("waiter_calls").select("status, attended_at, attended_by, user_id").eq("id", llamadaId).single();
    expect(data!.status).toBe("attended");
    expect(data!.attended_at).not.toBeNull();
    expect(data!.attended_by).not.toBeNull();
    expect(data!.user_id).not.toBeNull();
  });

  it("el comensal cancela su llamada; un extraño no puede cancelarla", async () => {
    const comensal = await invitado();
    await comensal.rpc("unirse_a_mesa", { _qr_token: qrMesa(5)! });
    const r = await comensal.rpc("llamar_mozo", { _qr_token: qrMesa(5)!, _motivo: "change" });
    const llamadaId = (r.data as { id: string }).id;
    const extrano = await invitado();
    expect((await extrano.rpc("cancelar_llamado", { _id: llamadaId })).error).not.toBeNull();
    expect((await comensal.rpc("cancelar_llamado", { _id: llamadaId })).error).toBeNull();
    const { data } = await dueno.from("waiter_calls").select("status").eq("id", llamadaId).single();
    expect(data!.status).toBe("cancelled");
  });

  it("hay un límite de llamadas por persona para evitar abusos", async () => {
    const comensal = await invitado();
    await comensal.rpc("unirse_a_mesa", { _qr_token: qrMesa(5)! });
    let bloqueada = false;
    for (let i = 0; i < 8; i++) {
      const r = await comensal.rpc("llamar_mozo", { _qr_token: qrMesa(5)!, _motivo: "help" });
      if (r.error) {
        expect(r.error.message).toContain("varias veces");
        bloqueada = true;
        break;
      }
      await comensal.rpc("cancelar_llamado", { _id: (r.data as { id: string }).id });
    }
    expect(bloqueada).toBe(true);
  });

  it("pedir la cuenta: el total lo calcula la base con lo que falta pagar, sin duplicar, y la mesa queda esperando", async () => {
    const id = await idMesa(dueno, 5);
    await dueno.rpc("cerrar_mesa", { _table_id: id, _motivo: "preparar prueba" });
    const comensal = await invitado();
    await comensal.rpc("unirse_a_mesa", { _qr_token: qrMesa(5)! });

    // Sin nada pendiente no hay cuenta que pedir
    expect((await comensal.rpc("pedir_cuenta", { _qr_token: qrMesa(5)!, _propina: 0, _porcentaje: 0 })).error?.message).toContain("nada pendiente");

    // Un pedido sin pagar tomado por el mozo (cuenta abierta)
    const { data: sesion } = await dueno.from("table_sessions").select("id").eq("table_id", id).eq("is_active", true).single();
    await mozo.from("orders").insert({
      tenant_id: DEMO.tenant, branch_id: DEMO.sucursal, table_id: id, session_id: sesion!.id,
      order_number: 8000 + Math.floor(Math.random() * 900), total_amount: 10000, status: "confirmed", source: "waiter",
    });

    // La propina no puede ser mayor que la cuenta
    expect((await comensal.rpc("pedir_cuenta", { _qr_token: qrMesa(5)!, _propina: 50000, _porcentaje: 0 })).error).not.toBeNull();

    const r = await comensal.rpc("pedir_cuenta", { _qr_token: qrMesa(5)!, _propina: 1000, _porcentaje: 10 });
    expect(r.error).toBeNull();
    expect(r.data).toMatchObject({ total: 10000, propina: 1000, a_pagar: 11000 });
    const otra = await comensal.rpc("pedir_cuenta", { _qr_token: qrMesa(5)!, _propina: 1500, _porcentaje: 15 });
    expect((otra.data as { id: string }).id).toBe((r.data as { id: string }).id);

    const { data: cuentas } = await dueno.from("bill_requests").select("total_amount, tip_amount, status").eq("session_id", sesion!.id);
    expect(cuentas).toEqual([{ total_amount: 10000, tip_amount: 1500, status: "pending" }]);
    const { data: mesa } = await dueno.from("tables").select("status").eq("id", id).single();
    expect(mesa!.status).toBe("waiting_bill");

    // El mozo la atiende; la cocina no
    const cuentaId = (r.data as { id: string }).id;
    expect((await cocina.rpc("atender_cuenta", { _id: cuentaId })).error?.message).toContain("permiso");
    expect((await mozo.rpc("atender_cuenta", { _id: cuentaId })).error).toBeNull();
    const { data: atendida } = await dueno.from("bill_requests").select("status, attended_by").eq("id", cuentaId).single();
    expect(atendida!.status).toBe("attending");
    expect(atendida!.attended_by).not.toBeNull();

    // Un extraño no pide la cuenta de esta mesa
    const extrano = await invitado();
    expect((await extrano.rpc("pedir_cuenta", { _qr_token: qrMesa(5)!, _propina: 0, _porcentaje: 0 })).error).not.toBeNull();
    await dueno.rpc("cerrar_mesa", { _table_id: id, _motivo: "fin de prueba" });
  });
});
