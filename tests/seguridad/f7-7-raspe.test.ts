import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { anonimo, conSesion, confirmarPresencia, esBaseLocal, hayCredenciales, invitado, llamarFuncion, qrMesa, DEMO } from "./entorno";

// Fase 7.7 — Premio sorpresa al pagar (raspe y gana). El resultado lo decide la base al pagar; el navegador
// solo raspa. Un raspe por cliente con cuenta y día; el tope de premios del mes nunca se pasa, ni con muchos
// pagos a la vez; el premio no puede ser alcohol; nadie raspa el de otro; el premio se ve recién al raspar; y
// si el pago se reembolsa entero, el raspe y su premio se anulan. Paga de verdad: solo en la base desechable.

const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();
const sqlAsync = promisify(execFile);
const MESA = 3;
const CORREO = (n: number) => `raspe-prueba-${n}@demo.tablio.test`;
type Raspes = { activo: boolean; premio: string | null; pendientes: { id: string }[] };

describe.skipIf(!hayCredenciales || !esBaseLocal)("premio sorpresa (raspe y gana)", () => {
  let programa = "";
  const configurar = (uno: number, tope: number, minimo = 0) =>
    sql(`UPDATE loyalty_programs SET sorpresa_activa = true, sorpresa_premio = 'Postre de la casa', sorpresa_uno_de = ${uno},
           sorpresa_tope_mes = ${tope}, sorpresa_monto_minimo = ${minimo} WHERE id = '${programa}'`);
  // Clientes de prueba con una visita armada a mano en un mes lejano (para no tocar el tope de este mes)
  const clientes: string[] = [];
  const visita = (n: number, dia: string) => {
    const cliente = sql(`INSERT INTO loyalty_customers (tenant_id, email) VALUES ('${DEMO.tenant}', '${CORREO(n)}') RETURNING id`).split("\n")[0];
    clientes.push(cliente);
    const pago = sql(`SELECT id FROM payments WHERE tenant_id = '${DEMO.tenant}' AND status = 'approved' ORDER BY created_at DESC LIMIT 1`);
    return sql(`INSERT INTO movimientos_lealtad (tenant_id, branch_id, customer_id, payment_id, dia_negocio, monto, sello)
                VALUES ('${DEMO.tenant}', '${DEMO.sucursal}', '${cliente}', '${pago}', '${dia}', 5000, false) RETURNING id`).split("\n")[0];
  };
  const limpiar = () => sql(`DELETE FROM loyalty_customers WHERE tenant_id = '${DEMO.tenant}' AND email LIKE 'raspe-prueba-%'`);

  beforeAll(async () => {
    programa = sql(`SELECT id FROM loyalty_programs WHERE tenant_id = '${DEMO.tenant}' AND is_active LIMIT 1`);
    limpiar();
    const dueno = (await conSesion("owner")).cliente;
    const id = (await dueno.from("tables").select("id").eq("branch_id", DEMO.sucursal).eq("number", MESA).single()).data!.id;
    await dueno.rpc("cerrar_mesa", { _table_id: id, _motivo: "preparar prueba" });
  });
  afterAll(() => {
    limpiar();
    sql(`UPDATE loyalty_programs SET sorpresa_activa = false, sorpresa_premio = NULL, sorpresa_uno_de = 10, sorpresa_tope_mes = 20,
           sorpresa_monto_minimo = 0 WHERE id = '${programa}'`);
  });

  it("solo el dueño lo configura y el premio no puede ser alcohol", async () => {
    const dueno = (await conSesion("owner")).cliente;
    const r = await dueno.from("loyalty_programs").update({ sorpresa_activa: true, sorpresa_premio: "Pisco sour gratis" } as never).eq("id", programa);
    expect(r.error?.message).toContain("no puede ser alcohol");
    for (const rol of ["cashier", "waiter", "kitchen", "cliente"]) {
      const c = (await conSesion(rol)).cliente;
      const x = await c.from("loyalty_programs").update({ sorpresa_activa: true, sorpresa_premio: "Postre" } as never).eq("id", programa).select("id");
      expect(x.data ?? [], rol).toHaveLength(0);
    }
    // Nadie de afuera ve los raspes ni crea uno
    expect((await (await conSesion("waiter")).cliente.from("raspes").select("id").limit(1)).data ?? []).toHaveLength(0);
    expect((await anonimo().rpc("mis_raspes", { _tenant_id: DEMO.tenant })).error).not.toBeNull();
    expect((await (await conSesion("cliente")).cliente.from("raspes").insert({ tenant_id: DEMO.tenant } as never)).error).not.toBeNull();
  });

  it("el tope de premios del mes nunca se pasa, ni con muchos pagos a la vez", async () => {
    // 1 de cada 2, tope 3: con 30 visitas en el mes ganan exactamente 3
    configurar(2, 3);
    const movs = Array.from({ length: 30 }, (_, i) => visita(i, `2002-03-${String(1 + (i % 28)).padStart(2, "0")}`));
    for (const m of movs) sql(`SELECT public._raspe_visita('${m}')`);
    expect(sql(`SELECT count(*) FILTER (WHERE gano) || '|' || count(*) FROM raspes WHERE mes = '2002-03-01' AND tenant_id = '${DEMO.tenant}'`)).toBe("3|30");
    // Cada ganador tiene su premio sorpresa con código; los perdedores, nada
    expect(sql(`SELECT count(*) FROM raspes x JOIN loyalty_rewards r ON r.id = x.premio_id
                WHERE x.mes = '2002-03-01' AND r.motivo = 'sorpresa' AND r.codigo ~ '^[A-Z2-9]{4}$' AND r.description = 'Postre de la casa'`)).toBe("3");
    // Un segundo pago del mismo cliente el mismo día no da otro raspe
    const pago2 = sql(`SELECT id FROM payments WHERE tenant_id = '${DEMO.tenant}' AND status = 'approved' ORDER BY created_at DESC OFFSET 1 LIMIT 1`);
    const otro = sql(`INSERT INTO movimientos_lealtad (tenant_id, branch_id, customer_id, payment_id, dia_negocio, monto)
                      VALUES ('${DEMO.tenant}', '${DEMO.sucursal}', '${clientes[0]}', '${pago2}', '2002-03-01', 5000) RETURNING id`).split("\n")[0];
    expect(sql(`SELECT public._raspe_visita('${otro}')`)).toBe("f");
    expect(sql(`SELECT count(*) FROM raspes WHERE customer_id = '${clientes[0]}'`)).toBe("1");

    // 12 pagos a la vez, con tope 2 en otro mes: nunca más de 2 ganadores
    configurar(2, 2);
    const juntos = Array.from({ length: 12 }, (_, i) => visita(100 + i, "2002-05-10"));
    await Promise.all(juntos.map((m) => sqlAsync("psql", [DB, "-At", "-c", `SELECT public._raspe_visita('${m}')`])));
    expect(Number(sql(`SELECT count(*) FROM raspes WHERE mes = '2002-05-01' AND gano AND tenant_id = '${DEMO.tenant}'`))).toBeLessThanOrEqual(2);
    expect(sql(`SELECT count(*) FROM raspes WHERE mes = '2002-05-01' AND tenant_id = '${DEMO.tenant}'`)).toBe("12");
    // La compra mínima: bajo ella no hay raspe
    configurar(2, 2, 10000);
    expect(sql(`SELECT public._raspe_visita('${visita(200, "2002-06-01")}')`)).toBe("f");
    expect(sql(`SELECT count(*) FROM raspes WHERE mes = '2002-06-01'`)).toBe("0");
  });

  it("al pagar con la app: el cliente raspa el suyo (nadie más), el premio se ve recién al raspar y el reembolso lo anula", async () => {
    // 1 de cada 2 y tope alto: puede ganar o no; se revisa cada caso con lo que diga la base
    configurar(2, 1000);
    const { cliente: c, token } = await conSesion("cliente");
    const yo = (await c.auth.getUser()).data.user!.id;
    // De corridas anteriores: se anulan (con su premio)
    sql(`UPDATE loyalty_rewards SET status = 'anulado', anulado_at = now() WHERE status = 'earned' AND id IN (SELECT premio_id FROM raspes WHERE anulado_at IS NULL AND user_id = '${yo}');
         UPDATE raspes SET anulado_at = now() WHERE user_id = '${yo}' AND anulado_at IS NULL`);
    await c.rpc("unirse_a_mesa", { _qr_token: qrMesa(MESA)!, _alias: "Clienta" });
    await confirmarPresencia(c, MESA);
    const agua = (await anonimo().from("menu_items").select("id").eq("tenant_id", DEMO.tenant).eq("name", "Agua mineral").single()).data!.id;
    const pagar = async () => {
      const cot = (await c.rpc("cotizar", { _qr_token: qrMesa(MESA)!, _items: [{ menu_item_id: agua, quantity: 1 }] })).data as { id: string };
      const r = await llamarFuncion("process-payment", { table_token: qrMesa(MESA), method: "card", tip_amount: 0, cotizacion_id: cot.id,
        idempotency_key: `raspe-${Date.now()}-${Math.random()}` }, token);
      expect(r.status, r.cuerpo).toBe(200);
      return (JSON.parse(r.cuerpo).payment as { id: string }).id;
    };
    const pago = await pagar();
    const mios = (await c.rpc("mis_raspes", { _tenant_id: DEMO.tenant })).data as unknown as Raspes;
    expect(mios.activo).toBe(true);
    expect(mios.pendientes).toHaveLength(1);
    expect(Object.keys(mios.pendientes[0])).not.toContain("gano"); // sin el resultado
    const raspe = mios.pendientes[0].id;
    const gano = sql(`SELECT gano FROM raspes WHERE id = '${raspe}'`) === "t";
    const codigos = async () => ((await c.rpc("mis_sellos", { _tenant_id: DEMO.tenant, _branch_id: DEMO.sucursal })).data as { premios?: { codigo: string }[] }).premios?.map((p) => p.codigo) ?? [];
    const codigo = sql(`SELECT coalesce(r.codigo, '') FROM raspes x LEFT JOIN loyalty_rewards r ON r.id = x.premio_id WHERE x.id = '${raspe}'`);
    if (gano) expect(await codigos()).not.toContain(codigo); // todavía no raspó

    // Un segundo pago el mismo día no da otro raspe
    await pagar();
    expect(((await c.rpc("mis_raspes", { _tenant_id: DEMO.tenant })).data as unknown as Raspes).pendientes).toHaveLength(1);

    // Otra persona no puede rasparlo
    expect((await (await invitado()).rpc("raspar", { _raspe_id: raspe })).error).not.toBeNull();
    // Raspar: dice lo que decidió la base, y raspar de nuevo dice lo mismo
    const r1 = (await c.rpc("raspar", { _raspe_id: raspe })).data as { gano: boolean; codigo: string | null };
    expect(r1.gano).toBe(gano);
    expect(((await c.rpc("raspar", { _raspe_id: raspe })).data as { gano: boolean }).gano).toBe(gano);
    if (gano) {
      expect(r1.codigo).toBe(codigo);
      expect(await codigos()).toContain(codigo);
    }
    expect(((await c.rpc("mis_raspes", { _tenant_id: DEMO.tenant })).data as unknown as Raspes).pendientes).toHaveLength(0);

    // Reembolso total del pago: el raspe se anula, y su premio también
    const dev = await llamarFuncion("refund-payment", { payment_id: pago, reason: "Prueba del premio sorpresa" }, (await conSesion("cashier")).token);
    expect(dev.status, dev.cuerpo).toBe(200);
    expect(sql(`SELECT anulado_at IS NOT NULL FROM raspes WHERE id = '${raspe}'`)).toBe("t");
    if (gano) expect(sql(`SELECT status FROM loyalty_rewards WHERE codigo = '${codigo}' AND motivo = 'sorpresa' ORDER BY created_at DESC LIMIT 1`)).toBe("anulado");

    // Un invitado (sin cuenta) que paga no recibe raspe
    const inv = await invitado();
    await inv.rpc("unirse_a_mesa", { _qr_token: qrMesa(MESA)!, _alias: "Invitado" });
    const cot = (await inv.rpc("cotizar", { _qr_token: qrMesa(MESA)!, _items: [{ menu_item_id: agua, quantity: 1 }] })).data as { id: string };
    await llamarFuncion("process-payment", { table_token: qrMesa(MESA), method: "card", tip_amount: 0, cotizacion_id: cot.id, idempotency_key: `raspe-inv-${Date.now()}` },
      (await inv.auth.getSession()).data.session!.access_token);
    expect(((await inv.rpc("mis_raspes", { _tenant_id: DEMO.tenant })).data as unknown as Raspes).pendientes).toHaveLength(0);
  });

  it("las auditorías siguen vacías y detectan un raspe que no calza o un tope pasado", async () => {
    limpiar(); // los clientes de prueba tienen visitas armadas a mano
    const superadmin = (await conSesion("superadmin")).cliente;
    for (const fn of ["auditoria_seguridad", "auditoria_plata", "auditoria_operacion"] as const) {
      expect((await superadmin.rpc(fn)).data ?? [], fn).toEqual([]);
    }
    const salida = execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1"], { input: `
      BEGIN;
      SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT user_id FROM platform_admins LIMIT 1), 'role', 'authenticated')::text, true) IS NULL;
      UPDATE raspes SET gano = true, premio_id = NULL, anulado_at = NULL, tope = 0 WHERE id = (SELECT id FROM raspes ORDER BY created_at DESC LIMIT 1);
      SELECT 'hallazgo:' || tipo FROM auditoria_operacion();
      ROLLBACK;` }).toString();
    expect(salida).toContain("hallazgo:raspe_incoherente");
    expect(salida).toContain("hallazgo:raspe_sobre_tope");
  });
});
