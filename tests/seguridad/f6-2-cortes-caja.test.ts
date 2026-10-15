import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonimo, conSesion, confirmarPresencia, esBaseLocal, hayCredenciales, invitado, qrMesa, DEMO } from "./entorno";

// Fase 6.2 — Varios cierres de caja al día: cada corte cuenta su tramo; lo que llega después cae en el tramo
// siguiente; el cierre del día hace el último corte y suma todos; los cortes no se cambian. Lo que hace cortes
// corre en la base desechable (en la real no se llena el demo de cortes de prueba).

const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();
// Años 2001-2009: el historial de la caja muestra los 30 cierres más nuevos y la prueba de la caja (2010-2024) busca el suyo
const diaPasado = () => `200${String(1 + Math.floor(Math.random() * 9))}-${String(1 + Math.floor(Math.random() * 12)).padStart(2, "0")}-${String(1 + Math.floor(Math.random() * 28)).padStart(2, "0")}`;

type Tramo = { numero: number; efectivo: number; pos: number; pagos: number };
type Resumen = { dia: string; cerrado: boolean; cortes: { numero: number; efectivo_esperado: number; efectivo_contado: number; final: boolean }[]; tramo_abierto: Tramo; efectivo: { esperado: number } };

describe.skipIf(!hayCredenciales)("varios cierres de caja al día", () => {
  let caja: SupabaseClient;
  let mozo: SupabaseClient;
  let agua: string;
  const resumen = async (dia?: string) => (await caja.rpc("resumen_caja", { _branch_id: DEMO.sucursal, ...(dia ? { _dia: dia } : {}) })).data as unknown as Resumen;
  const cobrarEfectivo = async (mesa: number) => {
    const c = await invitado();
    await c.rpc("unirse_a_mesa", { _qr_token: qrMesa(mesa)! });
    await confirmarPresencia(c, mesa);
    const p = (await c.rpc("pedir_sin_pagar", { _qr_token: qrMesa(mesa)!, _items: [{ menu_item_id: agua, quantity: 1 }], _forma: "mozo" })).data as { order_id: string };
    return (await caja.rpc("registrar_cobro_mozo", { _order_ids: [p.order_id], _metodo: "cash" })).data as { payment_id: string; total: number };
  };

  // Los cortes de HOY se deshacen al terminar (solo en la base desechable): las demás pruebas de la caja
  // esperan un día sin cortes. Los del día pasado de la última prueba quedan (ese día está cerrado y cuadra).
  afterAll(() => {
    if (!esBaseLocal) return;
    sql(`WITH hoy AS (SELECT public.dia_abierto('${DEMO.sucursal}', public.dia_negocio('${DEMO.sucursal}', now())) AS d)
         DELETE FROM cortes_caja WHERE branch_id = '${DEMO.sucursal}' AND dia = (SELECT d FROM hoy);
         UPDATE payments SET corte_numero = 1 WHERE branch_id = '${DEMO.sucursal}' AND dia_negocio = public.dia_abierto('${DEMO.sucursal}', public.dia_negocio('${DEMO.sucursal}', now()));
         UPDATE refunds SET corte_numero = 1 WHERE dia_negocio = public.dia_abierto('${DEMO.sucursal}', public.dia_negocio('${DEMO.sucursal}', now()))
           AND payment_id IN (SELECT id FROM payments WHERE branch_id = '${DEMO.sucursal}');`);
  });

  beforeAll(async () => {
    caja = (await conSesion("cashier")).cliente;
    mozo = (await conSesion("waiter")).cliente;
    agua = (await anonimo().from("menu_items").select("id").eq("tenant_id", DEMO.tenant).eq("name", "Agua mineral").single()).data!.id;
  });

  it("solo la caja, el encargado o el dueño hacen cortes; nadie los cambia ni los lee sin permiso", async () => {
    for (const c of [mozo, (await conSesion("kitchen")).cliente, await invitado(), anonimo()]) {
      expect((await c.rpc("hacer_corte_caja", { _branch_id: DEMO.sucursal, _efectivo_contado: 0 })).error).not.toBeNull();
      expect((await c.from("cortes_caja" as never).select("id").eq("tenant_id", DEMO.tenant).limit(1)).data ?? []).toHaveLength(0);
    }
    if (process.env.DEMO_CREDENCIALES) {
      const ajeno = (await conSesion("owner_ajeno")).cliente;
      expect((await ajeno.rpc("hacer_corte_caja", { _branch_id: DEMO.sucursal, _efectivo_contado: 0 })).error).not.toBeNull();
    }
    expect((await caja.rpc("hacer_corte_caja", { _branch_id: DEMO.sucursal, _efectivo_contado: -5 })).error).not.toBeNull();
  });

  it.skipIf(!esBaseLocal)("cada corte cuenta su tramo; lo que llega después es del tramo siguiente; un corte no se cambia", async () => {
    // Se cuadra lo pendiente de hoy con un primer corte (lo que haya contado otra prueba no importa)
    const antes = await resumen();
    const primero = await caja.rpc("hacer_corte_caja", { _branch_id: DEMO.sucursal, _efectivo_contado: antes.tramo_abierto.efectivo, _nombre: "Turno mañana" });
    expect(primero.error).toBeNull();
    const despues = await resumen();
    expect(despues.tramo_abierto).toMatchObject({ efectivo: 0, pagos: 0 });
    expect(despues.cortes.at(-1)).toMatchObject({ efectivo_esperado: antes.tramo_abierto.efectivo, efectivo_contado: antes.tramo_abierto.efectivo, final: false });

    // Un cobro nuevo cae en el tramo siguiente, no en el ya contado
    const cobro = await cobrarEfectivo(7);
    expect(sql(`SELECT corte_numero FROM payments WHERE id = '${cobro.payment_id}'`)).toBe(String(despues.cortes.at(-1)!.numero + 1));
    const ahora = await resumen();
    expect(ahora.tramo_abierto.efectivo).toBe(cobro.total);
    expect(ahora.cortes.at(-1)!.efectivo_esperado).toBe(antes.tramo_abierto.efectivo);

    // Faltan $500 en el segundo corte: sin explicar no se puede; con nota sí
    expect((await caja.rpc("hacer_corte_caja", { _branch_id: DEMO.sucursal, _efectivo_contado: cobro.total - 500 })).error?.message).toContain("explica");
    expect((await caja.rpc("hacer_corte_caja", { _branch_id: DEMO.sucursal, _efectivo_contado: cobro.total - 500, _notas: "Faltan 500 de vuelto mal dado" })).data).toMatchObject({ diferencia_efectivo: -500 });
    // Nadie lo cambia, ni desde la base
    const id = sql(`SELECT id FROM cortes_caja WHERE branch_id = '${DEMO.sucursal}' ORDER BY created_at DESC LIMIT 1`);
    expect(() => sql(`UPDATE cortes_caja SET efectivo_contado = 0 WHERE id = '${id}'`)).toThrow();
    expect((await caja.from("cortes_caja" as never).update({ efectivo_contado: 0 } as never).eq("id", id)).error).not.toBeNull();
    expect((await (await conSesion("superadmin")).cliente.rpc("auditoria_plata")).data ?? []).toHaveLength(0);
  });

  it.skipIf(!esBaseLocal)("el cierre del día con cortes cuenta solo el último tramo y suma todos los cortes", async () => {
    const dia = diaPasado();
    // Un día pasado con dos tramos de un cobro en efectivo cada uno (el primero ya cortado)
    const c1 = await cobrarEfectivo(8);
    const c2 = await cobrarEfectivo(8);
    const precio = c2.total;
    sql(`UPDATE payments SET dia_negocio = '${dia}', corte_numero = 1 WHERE id = '${c1.payment_id}';
         UPDATE payments SET dia_negocio = '${dia}', corte_numero = 2 WHERE id = '${c2.payment_id}';`);
    sql(`INSERT INTO cortes_caja (tenant_id, branch_id, dia, numero, nombre, efectivo_esperado, efectivo_contado, diferencia_efectivo, pos_esperado)
         VALUES ('${DEMO.tenant}', '${DEMO.sucursal}', '${dia}', 1, 'Turno mañana', ${c1.total}, ${c1.total}, 0, 0)`);
    const r = await resumen(dia);
    expect(r.tramo_abierto).toMatchObject({ numero: 2, efectivo: precio });

    // Se cierra contando solo el último tramo, con 100 menos (y nota)
    expect((await caja.rpc("cerrar_caja", { _branch_id: DEMO.sucursal, _dia: dia, _efectivo_contado: precio - 100 })).error?.message).toContain("explica");
    const cierre = await caja.rpc("cerrar_caja", { _branch_id: DEMO.sucursal, _dia: dia, _efectivo_contado: precio - 100, _notas: "Faltan 100 en el turno noche" });
    expect(cierre.error).toBeNull();
    const total = c1.total + c2.total;
    expect(sql(`SELECT efectivo_esperado || '|' || efectivo_contado || '|' || diferencia_efectivo FROM payment_settlements WHERE branch_id = '${DEMO.sucursal}' AND settlement_date = '${dia}'`)).toBe(`${total}|${total - 100}|-100`);
    expect(sql(`SELECT string_agg(numero || ':' || efectivo_contado || ':' || final, ',' ORDER BY numero) FROM cortes_caja WHERE branch_id = '${DEMO.sucursal}' AND dia = '${dia}'`)).toBe(`1:${c1.total}:false,2:${precio - 100}:true`);
    const cerrado = await resumen(dia);
    expect(cerrado.cerrado).toBe(true);
    expect(cerrado.cortes).toHaveLength(2);
    expect((await (await conSesion("superadmin")).cliente.rpc("auditoria_plata")).data ?? []).toHaveLength(0);
    // Si alguien tocara un corte (saltándose la protección), la auditoría lo detecta
    const salida = execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1"], { input: `
      BEGIN;
      SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT user_id FROM platform_admins LIMIT 1), 'role', 'authenticated')::text, true) IS NULL;
      SET LOCAL session_replication_role = replica;
      UPDATE cortes_caja SET efectivo_contado = 1000 WHERE branch_id = '${DEMO.sucursal}' AND dia = '${dia}' AND numero = 1;
      UPDATE payments SET tip_amount = 777 WHERE id = '${c2.payment_id}';
      SELECT 'hallazgo:' || tipo FROM auditoria_plata();
      ROLLBACK;` }).toString();
    expect(salida).toContain("hallazgo:cortes_no_suman");
    expect(salida).toContain("hallazgo:corte_cambio");
  });
});
