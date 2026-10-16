import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonimo, conSesion, confirmarPresencia, esBaseLocal, hayCredenciales, invitado, llamarFuncion, qrMesa, DEMO } from "./entorno";

// Fase 7.4b — Dividir un plato. Toca la plata de varias personas a la vez: cada parte se paga por su monto
// (que suman exacto el total), el plato no va a cocina hasta estar todo pagado, nadie paga la parte de otro
// sin que se la pasen, la misma parte no se cobra dos veces, el mozo no la cobra aparte, devolver la parte de
// uno no "reembolsa" la de los demás y lo pagado de un plato anulado aparece en la caja para devolverlo.
// Paga de verdad (simulado): solo en la base desechable.

const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();
const sqlSesion = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1"], { input: q }).toString().trim();
const MESA = 2;

type Persona = { c: SupabaseClient; token: string; comensal: string };
type Mesa = { divididos: { id: string; estado: string; total: number; partes: { id: string; monto: number; estado: string; yo: boolean; quien: string }[] }[] };

describe.skipIf(!hayCredenciales || !esBaseLocal)("dividir un plato", () => {
  let ana: Persona;
  let beto: Persona;
  let caro: Persona;
  let tabla: { id: string; price: number };
  const persona = async (alias: string): Promise<Persona> => {
    const c = await invitado();
    await c.rpc("unirse_a_mesa", { _qr_token: qrMesa(MESA)!, _alias: alias });
    await confirmarPresencia(c, MESA);
    const yo = (await c.auth.getUser()).data.user!.id;
    return { c, token: (await c.auth.getSession()).data.session!.access_token, comensal: sql(`SELECT id FROM comensales_mesa WHERE user_id = '${yo}' ORDER BY created_at DESC LIMIT 1`) };
  };
  const dividir = (quien: Persona, con: Persona[]) =>
    quien.c.rpc("dividir_plato", { _qr_token: qrMesa(MESA)!, _item: { menu_item_id: tabla.id, quantity: 1 }, _comensales: con.map((p) => p.comensal) });
  const enVivo = async (p: Persona) => (await p.c.rpc("mi_mesa_en_vivo", { _qr_token: qrMesa(MESA)! })).data as unknown as Mesa;
  const pagarParte = async (p: Persona, parte: string, clave = `parte-${Date.now()}-${Math.random()}`) => {
    const cot = (await p.c.rpc("cotizar_parte", { _qr_token: qrMesa(MESA)!, _parte_id: parte })).data as { id: string };
    return llamarFuncion("process-payment", { table_token: qrMesa(MESA), method: "card", tip_amount: 0, cotizacion_id: cot.id, idempotency_key: clave }, p.token);
  };
  const miParte = async (p: Persona, plato: string) => (await enVivo(p)).divididos.find((d) => d.id === plato)!.partes.find((x) => x.yo)!.id;
  const auditoria = async () => ((await (await conSesion("superadmin")).cliente.rpc("auditoria_plata")).data ?? []) as unknown[];

  beforeAll(async () => {
    const dueno = (await conSesion("owner")).cliente;
    const id = (await dueno.from("tables").select("id").eq("branch_id", DEMO.sucursal).eq("number", MESA).single()).data!.id;
    await dueno.rpc("cerrar_mesa", { _table_id: id, _motivo: "preparar prueba" });
    tabla = (await anonimo().from("menu_items").select("id, price").eq("tenant_id", DEMO.tenant).eq("name", "Tabla de quesos y carnes").single()).data as { id: string; price: number };
    ana = await persona("Ana");
    beto = await persona("Beto");
    caro = await persona("Caro");
  });

  it("las partes suman exacto el total, el plato no va a cocina hasta estar todo pagado y el mozo no lo cobra aparte", async () => {
    // Validaciones: solo, o con alguien de otra mesa, no
    expect((await dividir(ana, [])).error?.message).toContain("Elige con quién");
    const r = (await dividir(ana, [beto, caro])).data as { plato: string; order_id: string; total: number; mi_monto: number };
    expect(r.total).toBe(tabla.price);
    const partes = (await enVivo(ana)).divididos[0].partes;
    expect(partes.reduce((t, p) => t + p.monto, 0)).toBe(tabla.price);
    expect(partes.find((p) => p.yo)!.monto).toBe(r.mi_monto);
    // Beto no puede pagar la parte de Ana, ni alguien de afuera
    const parteAna = partes.find((p) => p.yo)!.id;
    expect((await beto.c.rpc("cotizar_parte", { _qr_token: qrMesa(MESA)!, _parte_id: parteAna })).error).not.toBeNull();
    // El mozo no lo cobra en efectivo
    expect((await (await conSesion("cashier")).cliente.rpc("registrar_cobro_mozo", { _order_ids: [r.order_id], _metodo: "cash" })).error?.message).toContain("dividido");

    expect((await pagarParte(ana, parteAna)).status).toBe(200);
    expect((await pagarParte(beto, await miParte(beto, r.plato))).status).toBe(200);
    // Faltando una parte: sin pagar y fuera de la cocina
    expect(sql(`SELECT payment_status || '|' || status FROM orders WHERE id = '${r.order_id}'`)).toBe("unpaid|confirmed");

    // Caro paga su parte dos veces al mismo tiempo: una se cobra, la otra se devuelve sola
    const parteCaro = await miParte(caro, r.plato);
    const [a, b] = await Promise.all([pagarParte(caro, parteCaro), pagarParte(caro, parteCaro)]);
    const aprobados = [a, b].filter((x) => JSON.parse(x.cuerpo).payment?.id);
    expect(aprobados).toHaveLength(1);
    expect(sql(`SELECT count(*) FROM payments WHERE parte_id = '${parteCaro}' AND status = 'approved'`)).toBe("1");
    // Con la última parte: pagado y a cocina
    expect(sql(`SELECT payment_status FROM orders WHERE id = '${r.order_id}'`)).toBe("paid");
    expect((await enVivo(beto)).divididos.find((d) => d.id === r.plato)!.estado).toBe("pagado");
    expect(await auditoria()).toEqual([]);

    // Devolver la parte de Beto no deja el plato como "reembolsado": las otras siguen pagadas
    const pagoBeto = sql(`SELECT id FROM payments WHERE parte_id = '${(await enVivo(beto)).divididos.find((d) => d.id === r.plato)!.partes.find((p) => p.yo)!.id}'`);
    const devolucion = await llamarFuncion("refund-payment", { payment_id: pagoBeto, reason: "Beto se tuvo que ir antes" }, (await conSesion("cashier")).token);
    expect(devolucion.status, devolucion.cuerpo).toBe(200);
    expect(sql(`SELECT payment_status FROM orders WHERE id = '${r.order_id}'`)).toBe("paid");
    expect(await auditoria()).toEqual([]);
  });

  it("si alguien no quiere, quien lo pidió paga esa parte", async () => {
    const r = (await dividir(ana, [beto])).data as { plato: string; order_id: string };
    const parteBeto = await miParte(beto, r.plato);
    const parteAna = await miParte(ana, r.plato); // antes de tomar la de Beto (después tiene dos)
    expect((await beto.c.rpc("rechazar_parte", { _qr_token: qrMesa(MESA)!, _parte_id: parteBeto })).error).toBeNull();
    // Caro (no es quien lo pidió) no puede tomar esa parte; Ana sí
    expect((await caro.c.rpc("tomar_parte", { _qr_token: qrMesa(MESA)!, _parte_id: parteBeto })).error).not.toBeNull();
    expect((await ana.c.rpc("tomar_parte", { _qr_token: qrMesa(MESA)!, _parte_id: parteBeto })).error).toBeNull();
    expect((await pagarParte(ana, parteAna)).status).toBe(200);
    expect((await pagarParte(ana, parteBeto)).status).toBe(200);
    expect(sql(`SELECT payment_status FROM orders WHERE id = '${r.order_id}'`)).toBe("paid");
    expect(await auditoria()).toEqual([]);
  });

  it("si se anula, lo ya pagado aparece en la caja para devolverlo, y se devuelve", async () => {
    const r = (await dividir(ana, [beto])).data as { plato: string; order_id: string };
    expect((await pagarParte(ana, await miParte(ana, r.plato))).status).toBe(200);
    const { cliente: caja, token: tokenCaja } = await conSesion("cashier");
    expect((await (await conSesion("owner")).cliente.rpc("cambiar_estado_pedido", { _order_id: r.order_id, _estado: "cancelled", _motivo: "Beto no quiso dividir" })).error).toBeNull();
    expect(sql(`SELECT estado FROM platos_divididos WHERE id = '${r.plato}'`)).toBe("anulado");
    // Pagar la parte de un plato anulado ya no se puede
    expect((await beto.c.rpc("cotizar_parte", { _qr_token: qrMesa(MESA)!, _parte_id: await miParteAnulada(beto, r.plato) })).error).not.toBeNull();
    const pendientes = ((await caja.rpc("excepciones_caja", { _branch_id: DEMO.sucursal })).data as { tipo: string; pago_id: string; monto: number }[])
      .filter((e) => e.tipo === "parte_por_devolver");
    expect(pendientes).toHaveLength(1);
    const d = await llamarFuncion("refund-payment", { payment_id: pendientes[0].pago_id, amount: pendientes[0].monto, reason: "Plato dividido anulado: se devuelve la parte pagada" }, tokenCaja);
    expect(d.status, d.cuerpo).toBe(200);
    expect(((await caja.rpc("excepciones_caja", { _branch_id: DEMO.sucursal })).data as { tipo: string }[]).filter((e) => e.tipo === "parte_por_devolver")).toHaveLength(0);
    expect(await auditoria()).toEqual([]);
  });

  it("la auditoría detecta partes que no suman o que se pagaron por otro monto", async () => {
    const salida = sqlSesion(`
      BEGIN;
      SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT user_id FROM platform_admins LIMIT 1), 'role', 'authenticated')::text, true) IS NULL;
      UPDATE partes_plato SET monto = monto + 100 WHERE id = (SELECT id FROM partes_plato WHERE estado = 'pagada' ORDER BY created_at LIMIT 1);
      SELECT 'hallazgo:' || tipo FROM auditoria_plata();
      ROLLBACK;`);
    expect(salida).toContain("hallazgo:dividido_no_calza");
    expect(salida).toContain("hallazgo:parte_no_calza");
  });

  // La parte de alguien en un plato que ya no aparece en su mesa en vivo (anulado): se busca en la base
  async function miParteAnulada(p: Persona, plato: string) {
    const yo = (await p.c.auth.getUser()).data.user!.id;
    return sql(`SELECT id FROM partes_plato WHERE plato_id = '${plato}' AND user_id = '${yo}'`);
  }
});
