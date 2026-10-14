import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonimo, conSesion, hayCredenciales, invitado, llamarFuncion, qrMesa, DEMO } from "./entorno";

// Fase 2.D — Día de negocio y cierre de caja con conciliación automática.

const LOCAL = !!process.env.DEMO_CREDENCIALES; // base desechable: permite tocar la base directo
const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();

type Canal = { cobrado: number; devuelto: number; esperado: number };
type Resumen = {
  dia: string; hoy: string; cerrado: boolean; pagos: number; total_neto: number; propina_total: number;
  app: Canal; efectivo: Canal; pos: Canal;
  reembolsos: { cantidad: number; monto: number };
  propinas: { nombre: string; propina: number; propina_efectivo: number; pagos: number }[];
  avisos: { por_cobrar: { cantidad: number; monto: number } };
  cierre?: { efectivo_contado: number; diferencia_efectivo: number; pos_contado: number | null; diferencia_pos: number | null; notas: string | null };
};

// Un día del pasado que nadie más usa (cada corrida, uno distinto).
const diaPasado = () =>
  `20${String(10 + Math.floor(Math.random() * 15))}-${String(1 + Math.floor(Math.random() * 12)).padStart(2, "0")}-${String(1 + Math.floor(Math.random() * 28)).padStart(2, "0")}`;

describe.skipIf(!hayCredenciales)("cierre de caja", () => {
  let dueno: SupabaseClient;
  let caja: SupabaseClient;
  let mozo: SupabaseClient;
  let tokenCaja: string;
  const ids: Record<string, string> = {};
  const linea = (nombre: string, cantidad = 1) => [{ menu_item_id: ids[nombre], quantity: cantidad }];
  const idMesa = async (n: number) => (await dueno.from("tables").select("id").eq("branch_id", DEMO.sucursal).eq("number", n).single()).data!.id as string;
  const liberar = async (n: number) => dueno.rpc("cerrar_mesa", { _table_id: await idMesa(n), _motivo: "preparar prueba" });
  const resumen = async (dia?: string) => {
    const r = await caja.rpc("resumen_caja", { _branch_id: DEMO.sucursal, ...(dia ? { _dia: dia } : {}) });
    expect(r.error).toBeNull();
    return r.data as unknown as Resumen;
  };

  async function pagoApp(mesa: number, cantidad: number, propina: number) {
    const c = await invitado();
    await c.rpc("unirse_a_mesa", { _qr_token: qrMesa(mesa)! });
    const token = (await c.auth.getSession()).data.session!.access_token;
    const r = await llamarFuncion("process-payment", {
      table_token: qrMesa(mesa), method: "card", tip_amount: propina,
      cart_items: linea("Agua mineral", cantidad), idempotency_key: `cierre-${Date.now()}-${Math.random()}`,
    }, token);
    expect(r.status).toBe(200);
    const p = JSON.parse(r.cuerpo).payment;
    return { id: p.id as string, total: (p.amount + p.tip_amount) as number };
  }

  async function cobroMozo(mesa: number, metodo: "cash" | "pos", propina: number) {
    await liberar(mesa);
    const c = await invitado();
    await c.rpc("unirse_a_mesa", { _qr_token: qrMesa(mesa)! });
    const pedido = (await c.rpc("pedir_sin_pagar", { _qr_token: qrMesa(mesa)!, _items: linea("Agua mineral"), _forma: "mozo" })).data as { order_id: string; total: number };
    const cobro = await caja.rpc("registrar_cobro_mozo", { _order_ids: [pedido.order_id], _metodo: metodo, _propina: propina });
    expect(cobro.error).toBeNull();
    return { id: (cobro.data as { payment_id: string }).payment_id, total: pedido.total + propina };
  }

  beforeAll(async () => {
    dueno = (await conSesion("owner")).cliente;
    ({ cliente: caja, token: tokenCaja } = await conSesion("cashier"));
    mozo = (await conSesion("waiter")).cliente;
    const { data } = await anonimo().from("menu_items").select("id, name").eq("tenant_id", DEMO.tenant);
    for (const p of data ?? []) ids[p.name] = p.id;
  });

  it("la conciliación cuadra sola: app, efectivo, POS, reembolsos y propinas del día de negocio", async () => {
    const antes = await resumen();
    expect(antes.cerrado).toBe(false);
    expect(antes.dia).toBe(antes.hoy);

    const app = await pagoApp(2, 2, 300);
    const efectivo = await cobroMozo(3, "cash", 200);
    const pos = await cobroMozo(4, "pos", 100);
    // Un reembolso parcial del pago con app y uno total del efectivo (se devuelve en el local)
    expect((await llamarFuncion("refund-payment", { payment_id: app.id, amount: 500, reason: "Faltó un producto" }, tokenCaja)).status).toBe(200);
    expect((await llamarFuncion("refund-payment", { payment_id: efectivo.id, reason: "Se devolvió en efectivo" }, tokenCaja)).status).toBe(200);

    const despues = await resumen();
    expect(despues.dia).toBe(antes.dia);
    expect(despues.pagos - antes.pagos).toBe(3);
    expect(despues.app.cobrado - antes.app.cobrado).toBe(app.total);
    expect(despues.app.devuelto - antes.app.devuelto).toBe(500);
    expect(despues.efectivo.cobrado - antes.efectivo.cobrado).toBe(efectivo.total);
    expect(despues.efectivo.esperado - antes.efectivo.esperado).toBe(0);
    expect(despues.pos.esperado - antes.pos.esperado).toBe(pos.total);
    expect(despues.reembolsos.monto - antes.reembolsos.monto).toBe(500 + efectivo.total);
    expect(despues.total_neto - antes.total_neto).toBe(app.total - 500 + pos.total);
    // Las propinas: la del efectivo se devolvió completa, así que no cuenta
    const propinas = (r: Resumen) => r.propinas.reduce((s, x) => s + x.propina, 0);
    expect(propinas(despues) - propinas(antes)).toBe(300 + 100);
    await Promise.all([3, 4].map(liberar));
  });

  it("al cerrar, la base cuadra lo contado, exige explicar las diferencias y deja el día bloqueado", async () => {
    const dia = diaPasado();
    const r0 = await resumen(dia);
    expect(r0.cerrado).toBe(false);

    const sinNota = await caja.rpc("cerrar_caja", { _branch_id: DEMO.sucursal, _dia: dia, _efectivo_contado: 1000 });
    expect(sinNota.error?.message).toContain("no cuadra");

    const cierre = await caja.rpc("cerrar_caja", {
      _branch_id: DEMO.sucursal, _dia: dia, _efectivo_contado: 1000, _pos_contado: 0, _notas: "Sobró un billete de mil",
    });
    expect(cierre.error).toBeNull();
    expect((cierre.data as unknown as Resumen).cierre).toMatchObject({ efectivo_contado: 1000, diferencia_efectivo: 1000, diferencia_pos: 0 });

    // Queda bloqueado: no se cierra otra vez ni se edita
    expect((await caja.rpc("cerrar_caja", { _branch_id: DEMO.sucursal, _dia: dia, _efectivo_contado: 0 })).error?.message).toContain("ya está cerrada");
    const { data: guardado } = await dueno.from("payment_settlements").select("id, status, diferencia_efectivo, closed_by_name").eq("branch_id", DEMO.sucursal).eq("settlement_date", dia).single();
    expect(guardado).toMatchObject({ status: "closed", diferencia_efectivo: 1000 });
    expect(guardado!.closed_by_name).toBeTruthy();
    await dueno.from("payment_settlements").update({ diferencia_efectivo: 0 }).eq("id", guardado!.id);
    const { data: igual } = await dueno.from("payment_settlements").select("diferencia_efectivo").eq("id", guardado!.id).single();
    expect(igual!.diferencia_efectivo).toBe(1000);

    // Ver ese día muestra lo que quedó guardado al cerrar
    const r1 = await resumen(dia);
    expect(r1).toMatchObject({ cerrado: true, cierre: { notas: "Sobró un billete de mil" } });

    // Y queda en la auditoría
    const { data: registro } = await dueno.from("audit_logs").select("action").eq("entity_id", guardado!.id).eq("action", "cierre_caja");
    expect(registro).toHaveLength(1);
  });

  it("dos cierres del mismo día al mismo tiempo: queda uno solo", async () => {
    const dia = diaPasado();
    const [a, b] = await Promise.all([
      caja.rpc("cerrar_caja", { _branch_id: DEMO.sucursal, _dia: dia, _efectivo_contado: 0 }),
      dueno.rpc("cerrar_caja", { _branch_id: DEMO.sucursal, _dia: dia, _efectivo_contado: 0 }),
    ]);
    expect([a.error, b.error].filter((e) => e === null)).toHaveLength(1);
    const { data } = await dueno.from("audit_logs").select("id").eq("action", "cierre_caja").contains("metadata", { dia });
    expect(data).toHaveLength(1);
  });

  it("no se cierra un día que no empieza ni con montos inválidos; solo la caja, el encargado o el dueño", async () => {
    const hoy = (await resumen()).hoy;
    const futuro = new Date(new Date(`${hoy}T12:00:00Z`).getTime() + 3 * 86_400_000).toISOString().slice(0, 10);
    expect((await caja.rpc("cerrar_caja", { _branch_id: DEMO.sucursal, _dia: futuro, _efectivo_contado: 0 })).error?.message).toContain("todavía no empieza");
    expect((await caja.rpc("cerrar_caja", { _branch_id: DEMO.sucursal, _dia: diaPasado(), _efectivo_contado: -1 })).error?.message).toContain("efectivo");

    const cocina = (await conSesion("kitchen")).cliente;
    const comensal = await invitado();
    for (const [quien, cliente] of [["mozo", mozo], ["cocina", cocina], ["comensal", comensal], ["anónimo", anonimo()]] as const) {
      expect((await cliente.rpc("resumen_caja", { _branch_id: DEMO.sucursal })).error, quien).not.toBeNull();
      expect((await cliente.rpc("cerrar_caja", { _branch_id: DEMO.sucursal, _dia: diaPasado(), _efectivo_contado: 0 })).error, quien).not.toBeNull();
    }
    // Nadie escribe cierres directo
    expect((await caja.from("payment_settlements").insert({ tenant_id: DEMO.tenant, branch_id: DEMO.sucursal, settlement_date: diaPasado(), status: "closed" })).error).not.toBeNull();
    // Las funciones internas no se llaman desde afuera
    const internas: [string, Record<string, string>][] = [
      ["_conciliar_dia", { _branch_id: DEMO.sucursal, _dia: hoy }],
      ["dia_abierto", { _branch_id: DEMO.sucursal, _dia: hoy }],
      ["dia_negocio", { _branch_id: DEMO.sucursal, _ts: new Date().toISOString() }],
      ["_tenant_caja", { _branch_id: DEMO.sucursal }],
    ];
    for (const [fn, args] of internas) {
      expect((await caja.rpc(fn as never, args as never)).error, fn).not.toBeNull();
    }
  });

  it.skipIf(!process.env.DEMO_CREDENCIALES)("el dueño de otro local no ve ni cierra la caja del demo", async () => {
    const ajeno = (await conSesion("owner_ajeno")).cliente;
    expect((await ajeno.rpc("resumen_caja", { _branch_id: DEMO.sucursal })).error?.message).toContain("Solo la caja");
    expect((await ajeno.rpc("cerrar_caja", { _branch_id: DEMO.sucursal, _dia: diaPasado(), _efectivo_contado: 0 })).error).not.toBeNull();
  });

  it.skipIf(!LOCAL)("lo que llega después de cerrar (un pago, un reembolso) cae en el día siguiente", async () => {
    const hoy = (await resumen()).hoy;
    const pagoAntes = await pagoApp(5, 1, 0);
    // Se cierra el día de hoy (directo en la base desechable, para no esperar al corte de las 06:00)
    sql(`INSERT INTO payment_settlements (tenant_id, branch_id, settlement_date, status) VALUES ('${DEMO.tenant}', '${DEMO.sucursal}', '${hoy}', 'closed')`);
    try {
      const manana = (await resumen()).hoy;
      expect(manana > hoy).toBe(true);
      const pagoDespues = await pagoApp(5, 1, 0);
      expect(sql(`SELECT dia_negocio FROM payments WHERE id = '${pagoDespues.id}'`)).toBe(manana);
      // El reembolso de un pago del día cerrado cuenta en el día en que se devuelve
      expect((await llamarFuncion("refund-payment", { payment_id: pagoAntes.id, reason: "Reclamo tardío" }, tokenCaja)).status).toBe(200);
      expect(sql(`SELECT dia_negocio FROM refunds WHERE payment_id = '${pagoAntes.id}'`)).toBe(manana);
      expect(sql(`SELECT dia_negocio FROM payments WHERE id = '${pagoAntes.id}'`)).toBe(hoy);
      const r = await resumen(manana);
      expect(r.app.devuelto).toBeGreaterThanOrEqual(pagoAntes.total);
    } finally {
      sql(`DELETE FROM payment_settlements WHERE branch_id = '${DEMO.sucursal}' AND settlement_date = '${hoy}'`);
      await liberar(5);
    }
  });

  it.skipIf(!LOCAL)("el día de negocio va de la hora de corte (06:00 de Chile) a la misma hora del día siguiente", async () => {
    expect(sql(`SELECT dia_negocio('${DEMO.sucursal}', '2026-10-15 03:00:00-03')`)).toBe("2026-10-14");
    expect(sql(`SELECT dia_negocio('${DEMO.sucursal}', '2026-10-15 05:59:00-03')`)).toBe("2026-10-14");
    expect(sql(`SELECT dia_negocio('${DEMO.sucursal}', '2026-10-15 06:00:00-03')`)).toBe("2026-10-15");
    // En invierno (Chile en UTC-4) también
    expect(sql(`SELECT dia_negocio('${DEMO.sucursal}', '2026-07-10 10:00:00+00')`)).toBe("2026-07-10");
    expect(sql(`SELECT dia_negocio('${DEMO.sucursal}', '2026-07-10 09:59:00+00')`)).toBe("2026-07-09");
  });
});
