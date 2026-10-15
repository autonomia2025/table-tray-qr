import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonimo, conSesion, esBaseLocal, hayCredenciales, invitado, qrMesa, DEMO, confirmarPresencia } from "./entorno";

// Fase 4.3 (etapa 1) — La boleta del local en efectivo y transferencia, y la transferencia como medio de
// cobro. La boleta es del local: Tablio solo recuerda entregarla y deja marcarla. La app y el POS no la
// necesitan (el comprobante de la pasarela vale como boleta).

const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();

type Canal = { cobrado: number; devuelto: number; esperado: number };
type Pendiente = { id: string; mesa: number | null; monto: number; metodo: string; cobrado_por?: string };

describe.skipIf(!hayCredenciales)("boleta del local y transferencia", () => {
  let dueno: SupabaseClient;
  let mozo: SupabaseClient;
  let caja: SupabaseClient;
  let cocina: SupabaseClient;
  let agua: string;
  const idMesa = async (n: number) => (await dueno.from("tables").select("id").eq("branch_id", DEMO.sucursal).eq("number", n).single()).data!.id as string;
  const liberar = async (n: number) => dueno.rpc("cerrar_mesa", { _table_id: await idMesa(n), _motivo: "preparar prueba" });
  const pedidoAlMozo = async (mesa: number) => {
    const c = await invitado();
    await c.rpc("unirse_a_mesa", { _qr_token: qrMesa(mesa)! });
    await confirmarPresencia(c, mesa);
    const r = await c.rpc("pedir_sin_pagar", { _qr_token: qrMesa(mesa)!, _items: [{ menu_item_id: agua, quantity: 1 }], _forma: "mozo" });
    expect(r.error).toBeNull();
    return r.data as { order_id: string; total: number };
  };
  const pago = async (id: string) =>
    (await dueno.from("payments").select("method, provider, amount, boleta_estado, boleta_folio, boleta_marcada_at, boleta_marcada_por").eq("id", id).single()).data!;
  const resumen = async () => (await caja.rpc("resumen_caja", { _branch_id: DEMO.sucursal })).data as unknown as {
    total_neto: number; app: Canal; efectivo: Canal; pos: Canal; transferencia: Canal; avisos: { sin_boleta: { cantidad: number; monto: number } };
  };

  beforeAll(async () => {
    dueno = (await conSesion("owner")).cliente;
    mozo = (await conSesion("waiter")).cliente;
    caja = (await conSesion("cashier")).cliente;
    cocina = (await conSesion("kitchen")).cliente;
    agua = (await anonimo().from("menu_items").select("id").eq("tenant_id", DEMO.tenant).eq("name", "Agua mineral").single()).data!.id;
  });

  it("cobro por transferencia: queda como canal propio en la caja, con la boleta pendiente hasta que el mozo la marca", async () => {
    await liberar(7);
    const antes = await resumen();
    const p = await pedidoAlMozo(7);
    const cobro = await mozo.rpc("registrar_cobro_mozo", { _order_ids: [p.order_id], _metodo: "transfer", _propina: 300, _recibido: 999999 });
    expect(cobro.error).toBeNull();
    const r = cobro.data as { payment_id: string; total: number; boleta: string; vuelto: number | null };
    expect(r).toMatchObject({ total: p.total, boleta: "pendiente", vuelto: null });
    expect(await pago(r.payment_id)).toMatchObject({ method: "transfer", provider: "local", boleta_estado: "pendiente", boleta_folio: null });

    // La caja ve la transferencia aparte, y suma al total del día; el efectivo no cambia
    const despues = await resumen();
    expect(despues.transferencia.cobrado - (antes.transferencia?.cobrado ?? 0)).toBe(p.total + 300);
    expect(despues.efectivo.cobrado).toBe(antes.efectivo.cobrado);
    expect(despues.total_neto - antes.total_neto).toBe(p.total + 300);
    expect(despues.avisos.sin_boleta.cantidad - (antes.avisos.sin_boleta?.cantidad ?? 0)).toBe(1);

    // El mozo la ve en sus boletas por entregar; la caja, en las de la sucursal (con quién cobró)
    const mias = (await mozo.rpc("mis_boletas_pendientes")).data as unknown as Pendiente[];
    expect(mias.find((b) => b.id === r.payment_id)).toMatchObject({ mesa: 7, monto: p.total, metodo: "transfer" });
    const deLaSucursal = (await caja.rpc("boletas_pendientes", { _branch_id: DEMO.sucursal })).data as unknown as Pendiente[];
    expect(deLaSucursal.find((b) => b.id === r.payment_id)?.cobrado_por).toBeTruthy();

    // El mozo la marca con su número; marcarla de nuevo no cambia nada
    expect((await mozo.rpc("marcar_boleta", { _pago_id: r.payment_id, _folio: "  10234 " })).error).toBeNull();
    const marcado = await pago(r.payment_id);
    expect(marcado).toMatchObject({ boleta_estado: "entregada", boleta_folio: "10234" });
    expect(marcado.boleta_marcada_at).not.toBeNull();
    expect((await mozo.rpc("marcar_boleta", { _pago_id: r.payment_id, _folio: "otro" })).data).toMatchObject({ ya_estaba: true });
    expect((await pago(r.payment_id)).boleta_folio).toBe("10234");
    expect(((await mozo.rpc("mis_boletas_pendientes")).data as unknown as Pendiente[]).some((b) => b.id === r.payment_id)).toBe(false);
    // Queda registrado quién la marcó
    const { data: log } = await dueno.from("audit_logs").select("action, metadata").eq("entity_id", r.payment_id).eq("action", "boleta_entregada");
    expect(log).toHaveLength(1);
    await liberar(7);
  });

  it("en efectivo se marca al cobrar; con POS no hace falta boleta del local", async () => {
    await liberar(8);
    const a = await pedidoAlMozo(8);
    const ef = (await mozo.rpc("registrar_cobro_mozo", { _order_ids: [a.order_id], _metodo: "cash", _boleta_entregada: true, _boleta_folio: "555" })).data as { payment_id: string; boleta: string };
    expect(ef.boleta).toBe("entregada");
    expect(await pago(ef.payment_id)).toMatchObject({ boleta_estado: "entregada", boleta_folio: "555" });
    expect((await pago(ef.payment_id)).boleta_marcada_por).not.toBeNull();

    const b = await pedidoAlMozo(8);
    const pos = (await mozo.rpc("registrar_cobro_mozo", { _order_ids: [b.order_id], _metodo: "pos", _boleta_entregada: true, _boleta_folio: "999" })).data as { payment_id: string; boleta: string | null };
    expect(pos.boleta).toBeNull();
    expect(await pago(pos.payment_id)).toMatchObject({ boleta_estado: null, boleta_folio: null });
    expect((await caja.rpc("marcar_boleta", { _pago_id: pos.payment_id })).error?.message).toContain("no necesita boleta");
    await liberar(8);
  });

  it("solo quien cobró o la caja marcan la boleta; nadie la cambia directo; cocina, clientes y otros locales no la ven", async () => {
    await liberar(7);
    const p = await pedidoAlMozo(7);
    const id = ((await caja.rpc("registrar_cobro_mozo", { _order_ids: [p.order_id], _metodo: "cash" })).data as { payment_id: string }).payment_id;

    // El mozo no cobró este: no lo marca ni lo ve en sus pendientes (mismo mensaje que si no existiera)
    expect((await mozo.rpc("marcar_boleta", { _pago_id: id })).error?.message).toContain("no encontrado");
    expect(((await mozo.rpc("mis_boletas_pendientes")).data as unknown as Pendiente[]).some((b) => b.id === id)).toBe(false);
    expect((await cocina.rpc("marcar_boleta", { _pago_id: id })).error).not.toBeNull();
    expect((await cocina.rpc("boletas_pendientes", { _branch_id: DEMO.sucursal })).error).not.toBeNull();
    expect((await mozo.rpc("boletas_pendientes", { _branch_id: DEMO.sucursal })).error).not.toBeNull();
    const cliente = await invitado();
    expect((await cliente.rpc("marcar_boleta", { _pago_id: id })).error).not.toBeNull();
    expect((await cliente.rpc("boletas_pendientes", { _branch_id: DEMO.sucursal })).error).not.toBeNull();
    expect(((await cliente.rpc("mis_boletas_pendientes")).data as unknown as Pendiente[]) ?? []).toHaveLength(0);
    expect((await anonimo().rpc("marcar_boleta", { _pago_id: id })).error).not.toBeNull();
    expect((await anonimo().rpc("mis_boletas_pendientes")).error).not.toBeNull();

    // Nadie escribe la boleta directo en el pago (ni el dueño)
    await dueno.from("payments").update({ boleta_estado: "entregada" } as never).eq("id", id);
    expect((await pago(id)).boleta_estado).toBe("pendiente");
    // Folio absurdo
    expect((await caja.rpc("marcar_boleta", { _pago_id: id, _folio: "x".repeat(41) })).error).not.toBeNull();
    // La caja sí la marca
    expect((await caja.rpc("marcar_boleta", { _pago_id: id })).error).toBeNull();
    expect((await pago(id)).boleta_estado).toBe("entregada");
    await liberar(7);
  });

  it("el dueño anota los datos para transferir y apaga el recordatorio; el mozo no cambia la sucursal", async () => {
    await mozo.from("branches").update({ recordar_boleta: false, datos_transferencia: "cuenta del mozo" } as never).eq("id", DEMO.sucursal);
    const { data: b } = await dueno.from("branches").select("recordar_boleta, datos_transferencia").eq("id", DEMO.sucursal).single();
    expect(b!.recordar_boleta).toBe(true);
    expect(b!.datos_transferencia ?? "").not.toBe("cuenta del mozo");
    expect((await dueno.from("branches").update({ datos_transferencia: "x".repeat(301) }).eq("id", DEMO.sucursal)).error).not.toBeNull();

    expect((await dueno.from("branches").update({ recordar_boleta: false, datos_transferencia: "Banco Demo · Cuenta 123" }).eq("id", DEMO.sucursal)).error).toBeNull();
    try {
      // El mozo lee los datos para mostrárselos al cliente
      expect((await mozo.from("branches").select("datos_transferencia").eq("id", DEMO.sucursal).single()).data!.datos_transferencia).toBe("Banco Demo · Cuenta 123");
      await liberar(8);
      const p = await pedidoAlMozo(8);
      const r = (await mozo.rpc("registrar_cobro_mozo", { _order_ids: [p.order_id], _metodo: "cash" })).data as { payment_id: string; boleta: string | null };
      expect(r.boleta).toBeNull();
      expect((await pago(r.payment_id)).boleta_estado).toBeNull();
    } finally {
      await dueno.from("branches").update({ recordar_boleta: true, datos_transferencia: null }).eq("id", DEMO.sucursal);
      await liberar(8);
    }
  });

  it.skipIf(!process.env.DEMO_CREDENCIALES)("el dueño de otro local no ve ni marca boletas del demo", async () => {
    const ajeno = (await conSesion("owner_ajeno")).cliente;
    expect((await ajeno.rpc("boletas_pendientes", { _branch_id: DEMO.sucursal })).error).not.toBeNull();
    const { data } = await caja.rpc("boletas_pendientes", { _branch_id: DEMO.sucursal });
    const alguna = (data as unknown as Pendiente[])[0];
    if (alguna) expect((await ajeno.rpc("marcar_boleta", { _pago_id: alguna.id })).error?.message).toContain("no encontrado");
  });

  it.skipIf(!esBaseLocal)("la auditoría detecta una boleta incoherente", async () => {
    const id = sql(`SELECT id FROM payments WHERE tenant_id = '${DEMO.tenant}' AND method = 'pos' AND provider = 'local' ORDER BY created_at DESC LIMIT 1`);
    expect(id).not.toBe("");
    sql(`UPDATE payments SET boleta_estado = 'pendiente' WHERE id = '${id}'`);
    try {
      const sa = (await conSesion("superadmin")).cliente;
      const { data } = await sa.rpc("auditoria_operacion");
      expect((data as { tipo: string; objeto: string }[]).some((h) => h.tipo === "boleta_sin_motivo" && h.objeto === id)).toBe(true);
    } finally {
      sql(`UPDATE payments SET boleta_estado = NULL WHERE id = '${id}'`);
    }
  });
});
