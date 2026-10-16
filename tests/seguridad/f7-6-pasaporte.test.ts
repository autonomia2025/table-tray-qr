import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonimo, conSesion, confirmarPresencia, esBaseLocal, hayCredenciales, invitado, llamarFuncion, qrMesa, DEMO } from "./entorno";

// Fase 7.6 — Pasaporte de la casa. Lo calcula la base desde los pedidos pagados de cada persona: sin sesión no
// se ve, cada uno ve solo lo suyo y solo en ese local, lo sin pagar o anulado no cuenta, y el dueño lo puede
// apagar. No mueve plata ni guarda datos nuevos de la persona.

type Pasaporte = {
  activo: boolean; probados: number; total: number;
  secciones: { nombre: string; total: number; probados: number; completa: boolean; items: { id: string; probado: boolean }[] }[];
  insignias: { tipo: string; nombre: string }[];
  siguiente: { nombre: string; faltan: number } | null;
};
const pasaporte = async (c: SupabaseClient, local = DEMO.tenant) => {
  const r = await c.rpc("mi_pasaporte", { _tenant_id: local });
  return { error: r.error, p: r.data as unknown as Pasaporte };
};

describe.skipIf(!hayCredenciales)("pasaporte de la casa", () => {
  it("sin sesión no se ve; con sesión, los números calzan con sus secciones y sus insignias", async () => {
    expect((await pasaporte(anonimo())).error).not.toBeNull();
    const { p, error } = await pasaporte((await conSesion("cliente")).cliente);
    expect(error).toBeNull();
    expect(p.activo).toBe(true);
    expect(p.secciones.reduce((t, s) => t + s.probados, 0)).toBe(p.probados);
    expect(p.secciones.reduce((t, s) => t + s.total, 0)).toBe(p.total);
    for (const s of p.secciones) {
      expect(s.items.filter((i) => i.probado)).toHaveLength(s.probados);
      expect(s.completa).toBe(s.probados === s.total);
    }
    // Una insignia por cada sección completa, más las de cantidad que alcanzó
    const hitos = [3, 10, 25].filter((n) => p.probados >= n).length;
    expect(p.insignias).toHaveLength(p.secciones.filter((s) => s.completa).length + hitos);
  });

  it("alguien nuevo empieza en cero, y un local donde no tiene programa no le muestra nada", async () => {
    const nuevo = await invitado();
    const { p } = await pasaporte(nuevo);
    expect(p).toMatchObject({ activo: true, probados: 0, insignias: [], siguiente: { nombre: "Curioso", faltan: 3 } });
    expect((await pasaporte(nuevo, "00000000-0000-0000-0000-000000000000")).p).toEqual({ activo: false });
  });
});

// Paga de verdad (simulado) y apaga el pasaporte del demo: solo en la base desechable
const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();
const MESA = 3;

describe.skipIf(!hayCredenciales || !esBaseLocal)("pasaporte: qué cuenta", () => {
  let platos: Record<string, string> = {};
  beforeAll(async () => {
    const { data } = await anonimo().from("menu_items").select("id, name").eq("tenant_id", DEMO.tenant).in("name", ["Agua mineral", "Barros Luco", "Jugo natural"]);
    platos = Object.fromEntries((data ?? []).map((m) => [m.name, m.id]));
    const dueno = (await conSesion("owner")).cliente;
    const id = (await dueno.from("tables").select("id").eq("branch_id", DEMO.sucursal).eq("number", MESA).single()).data!.id;
    await dueno.rpc("cerrar_mesa", { _table_id: id, _motivo: "preparar prueba" });
  });
  afterAll(() => sql(`UPDATE loyalty_programs SET pasaporte_activo = true WHERE tenant_id = '${DEMO.tenant}'`));

  it("solo cuenta lo pagado y no anulado; otra persona de la misma mesa no suma lo mío", async () => {
    const c = await invitado();
    await c.rpc("unirse_a_mesa", { _qr_token: qrMesa(MESA)!, _alias: "Pía" });
    await confirmarPresencia(c, MESA);
    const token = (await c.auth.getSession()).data.session!.access_token;
    const otro = await invitado();
    await otro.rpc("unirse_a_mesa", { _qr_token: qrMesa(MESA)!, _alias: "Tomás" });

    // Pagado: cuenta (dos unidades del mismo plato cuentan una vez)
    const cot = (await c.rpc("cotizar", { _qr_token: qrMesa(MESA)!, _items: [{ menu_item_id: platos["Agua mineral"], quantity: 2 }] })).data as { id: string };
    const r = await llamarFuncion("process-payment", { table_token: qrMesa(MESA), method: "card", tip_amount: 0, cotizacion_id: cot.id, idempotency_key: `pasaporte-${Date.now()}` }, token);
    expect(r.status, r.cuerpo).toBe(200);
    // Sin pagar (esperando al mozo): no cuenta
    expect((await c.rpc("pedir_sin_pagar", { _qr_token: qrMesa(MESA)!, _items: [{ menu_item_id: platos["Barros Luco"], quantity: 1 }], _forma: "mozo" })).error).toBeNull();
    // Pagado y después anulado: no cuenta
    const rc2 = await c.rpc("cotizar", { _qr_token: qrMesa(MESA)!, _items: [{ menu_item_id: platos["Jugo natural"], quantity: 1 }] });
    expect(rc2.error).toBeNull();
    const cot2 = rc2.data as { id: string };
    const r2 = await llamarFuncion("process-payment", { table_token: qrMesa(MESA), method: "card", tip_amount: 0, cotizacion_id: cot2.id, idempotency_key: `pasaporte2-${Date.now()}` }, token);
    expect(r2.status, r2.cuerpo).toBe(200);
    const pedidoJugo = (JSON.parse(r2.cuerpo).order ?? JSON.parse(r2.cuerpo).orders?.[0])?.id
      ?? sql(`SELECT o.id FROM orders o JOIN order_items oi ON oi.order_id = o.id WHERE oi.menu_item_id = '${platos["Jugo natural"]}' ORDER BY o.created_at DESC LIMIT 1`);
    sql(`UPDATE orders SET status = 'cancelled' WHERE id = '${pedidoJugo}'`);

    const { p } = await pasaporte(c);
    expect(p.probados).toBe(1);
    const probados = p.secciones.flatMap((s) => s.items.filter((i) => i.probado).map((i) => i.id));
    expect(probados).toEqual([platos["Agua mineral"]]);
    expect(p.siguiente).toEqual({ nombre: "Curioso", faltan: 2 });
    // Tomás estuvo en la misma mesa pero no pidió nada
    expect((await pasaporte(otro)).p.probados).toBe(0);
    // Lo del jugo se deja como estaba (pagado), para no descuadrar la caja
    sql(`UPDATE orders SET status = 'confirmed' WHERE id = '${pedidoJugo}'`);
    // Y el pedido sin pagar se anula, para no dejar la mesa con algo pendiente
    const yo = (await c.auth.getUser()).data.user!.id;
    const sinPagar = sql(`SELECT id FROM orders WHERE user_id = '${yo}' AND payment_status = 'unpaid' LIMIT 1`);
    expect((await (await conSesion("owner")).cliente.rpc("cambiar_estado_pedido", { _order_id: sinPagar, _estado: "cancelled", _motivo: "fin de la prueba" })).error).toBeNull();
  });

  it("si el dueño lo apaga, nadie lo ve; solo el dueño o el administrador lo cambian", async () => {
    for (const rol of ["cashier", "waiter", "kitchen", "cliente"]) {
      const c = (await conSesion(rol)).cliente;
      const r = await c.from("loyalty_programs").update({ pasaporte_activo: false } as never).eq("tenant_id", DEMO.tenant).select("id");
      expect(r.data ?? [], rol).toHaveLength(0);
    }
    const dueno = (await conSesion("owner")).cliente;
    expect((await dueno.from("loyalty_programs").update({ pasaporte_activo: false } as never).eq("tenant_id", DEMO.tenant).select("id")).data?.length).toBeGreaterThan(0);
    expect((await pasaporte((await conSesion("cliente")).cliente)).p).toEqual({ activo: false });
    await dueno.from("loyalty_programs").update({ pasaporte_activo: true } as never).eq("tenant_id", DEMO.tenant);
    const superadmin = (await conSesion("superadmin")).cliente;
    for (const fn of ["auditoria_seguridad", "auditoria_plata", "auditoria_operacion"] as const) {
      expect((await superadmin.rpc(fn)).data ?? [], fn).toEqual([]);
    }
  });
});
