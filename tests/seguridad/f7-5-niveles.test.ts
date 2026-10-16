import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { conSesion, esBaseLocal, hayCredenciales, DEMO } from "./entorno";

// Fase 7.5 — Niveles y rachas. Los calcula la base al sumar un sello: Plata y Oro se premian una vez, la racha
// cada vez que llega a la meta, solo con visitas que suman sello; si la visita que lo ganó se reembolsa entera,
// el premio se anula. Solo el dueño configura. Arma un cliente de prueba con visitas en fechas conocidas: solo
// en la base desechable.

const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();
const CORREO = "niveles-prueba@demo.tablio.test";

describe.skipIf(!hayCredenciales || !esBaseLocal)("niveles y rachas", () => {
  let cliente = "";
  let programa = "";
  // Una visita (sello) del cliente de prueba en un día dado; devuelve el movimiento
  const visita = (dia: string) => {
    const pago = sql(`SELECT p.id FROM payments p WHERE p.tenant_id = '${DEMO.tenant}' AND p.status = 'approved'
                        AND NOT EXISTS (SELECT 1 FROM movimientos_lealtad m WHERE m.payment_id = p.id AND m.customer_id = '${cliente}')
                      ORDER BY p.created_at DESC LIMIT 1`);
    return sql(`INSERT INTO movimientos_lealtad (tenant_id, branch_id, customer_id, payment_id, dia_negocio, monto, sello)
                VALUES ('${DEMO.tenant}', '${DEMO.sucursal}', '${cliente}', '${pago}', '${dia}', 5000, true) RETURNING id`).split("\n")[0];
  };
  const logros = (mov: string) => Number(sql(`SELECT public._logros_visita('${mov}')`));
  const premios = () => sql(`SELECT coalesce(string_agg(motivo || ':' || coalesce(logro, '') || ':' || status, ',' ORDER BY created_at), '')
                             FROM loyalty_rewards WHERE customer_id = '${cliente}'`);
  const hace = (dias: number) => sql(`SELECT (public.dia_negocio('${DEMO.sucursal}', now()) - ${dias})::text`);

  beforeAll(() => {
    programa = sql(`SELECT id FROM loyalty_programs WHERE tenant_id = '${DEMO.tenant}' AND is_active LIMIT 1`);
    sql(`DELETE FROM loyalty_customers WHERE tenant_id = '${DEMO.tenant}' AND email = '${CORREO}';
         UPDATE loyalty_programs SET niveles_activos = true, nivel_plata = 3, nivel_oro = 5, premio_plata = 'Postre de la casa',
           premio_oro = 'Tabla para compartir', racha_semanas = 2, racha_dia = NULL, racha_premio = 'Papas fritas' WHERE id = '${programa}';`);
    cliente = sql(`INSERT INTO loyalty_customers (tenant_id, email) VALUES ('${DEMO.tenant}', '${CORREO}') RETURNING id`).split("\n")[0];
  });
  afterAll(() => {
    sql(`DELETE FROM loyalty_customers WHERE id = '${cliente}';
         UPDATE loyalty_programs SET niveles_activos = false, nivel_plata = 4, nivel_oro = 8, premio_plata = NULL, premio_oro = NULL, racha_semanas = NULL, racha_dia = NULL, racha_premio = NULL WHERE id = '${programa}';`);
  });

  it("Plata y Oro se premian una sola vez, al llegar; la racha cada vez que llega a la meta", () => {
    // Semanas separadas (sin racha seguida): 1 y 2 visitas no dan nada
    expect(logros(visita(hace(60)))).toBe(0);
    expect(logros(visita(hace(45)))).toBe(0);
    // La tercera visita en 90 días: Plata
    expect(logros(visita(hace(30)))).toBe(1);
    expect(premios()).toBe("nivel:nivel:plata:earned");
    // Dos semanas seguidas (hace 8 días y hoy): racha (y la quinta visita: Oro)
    visita(hace(7));
    const hoy = visita(hace(0));
    const nuevos = logros(hoy);
    expect(premios()).toContain("nivel:nivel:oro:earned");
    expect(premios()).toContain("racha:racha:");
    expect(nuevos).toBe(2);
    // Calcular de nuevo la misma visita no premia dos veces
    expect(logros(hoy)).toBe(0);
    // Los premios tienen código (los entrega el personal como los de la tarjeta)
    expect(sql(`SELECT count(*) FROM loyalty_rewards WHERE customer_id = '${cliente}' AND (codigo IS NULL OR codigo !~ '^[A-Z2-9]{4}$')`)).toBe("0");
  });

  it("si la visita que ganó el premio se reembolsa entera, el premio se anula", () => {
    const pagoHoy = sql(`SELECT payment_id FROM movimientos_lealtad WHERE customer_id = '${cliente}' ORDER BY dia_negocio DESC LIMIT 1`);
    sql(`SELECT public._anular_sellos_pago('${pagoHoy}')`);
    expect(premios()).toContain("racha:racha:");
    expect(premios()).toMatch(/racha:racha:[^,]+:anulado/);
    expect(premios()).toMatch(/nivel:nivel:oro:anulado/);
    // El de Plata lo ganó otra visita: sigue vigente
    expect(premios()).toContain("nivel:nivel:plata:earned");
  });

  it("solo el dueño configura los niveles, con valores sanos; las auditorías siguen vacías", async () => {
    const dueno = (await conSesion("owner")).cliente;
    expect((await dueno.from("loyalty_programs").update({ nivel_plata: 6, nivel_oro: 4 } as never).eq("id", programa)).error).not.toBeNull();
    for (const rol of ["cashier", "waiter", "kitchen"]) {
      const c = (await conSesion(rol)).cliente;
      const r = await c.from("loyalty_programs").update({ premio_oro: "Hackeado" } as never).eq("id", programa).select("id");
      expect(r.data ?? [], rol).toHaveLength(0);
    }
    // El cliente de prueba tiene visitas armadas a mano (sin su contador): se borra antes de auditar
    sql(`DELETE FROM loyalty_customers WHERE id = '${cliente}'`);
    const superadmin = (await conSesion("superadmin")).cliente;
    for (const fn of ["auditoria_plata", "auditoria_operacion"] as const) {
      expect((await superadmin.rpc(fn)).data ?? [], fn).toEqual([]);
    }
  });
});
