import { describe, it, expect, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { anonimo, conSesion, esBaseLocal, hayCredenciales, DEMO } from "./entorno";

// Fase 8.2 — Métricas de finanzas desde cobros reales. Solo las ve finanzas (y el superadmin), y calzan con
// los cobros: ingreso mensual de las suscripciones vigentes, facturado y cobrado por mes, nuevos, cancelados,
// abandono y cohortes. Arma cobros conocidos: solo en la base desechable.

const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();
type Metricas = {
  actual: { mrr: number; clientes_activos: number; en_prueba: number; cancelados: number; por_cobrar: number };
  meses: { mes: string; facturado: number; cobrado: number; pagando: number; nuevos: number; perdidos: number; pagando_antes: number }[];
  cohortes: { mes: string; tamano: number; siguen: number[] }[];
};

describe.skipIf(!hayCredenciales)("métricas de finanzas", () => {
  it("solo finanzas y el superadmin las ven", async () => {
    expect((await anonimo().rpc("metricas_finanzas", { _meses: 3 })).error).not.toBeNull();
    for (const rol of ["owner", "admin", "cashier", "cliente", "vendedor", "jefe_ventas"]) {
      const c = await conSesion(rol).then((s) => s.cliente, () => null);
      if (c) expect((await c.rpc("metricas_finanzas", { _meses: 3 })).error, rol).not.toBeNull();
    }
    for (const rol of ["finanzas", "superadmin"]) {
      const c = await conSesion(rol).then((s) => s.cliente, () => null);
      if (c) expect((await c.rpc("metricas_finanzas", { _meses: 3 })).error, rol).toBeNull();
    }
  });
});

describe.skipIf(!hayCredenciales || !esBaseLocal)("métricas de finanzas: calzan con los cobros", () => {
  let otro = "";
  const mes = (k: number) => sql(`SELECT (date_trunc('month', (now() AT TIME ZONE 'America/Santiago'))::date - make_interval(months => ${k}))::date`);
  const limpiar = () => sql(`DELETE FROM cobros_mensualidad; DELETE FROM suscripciones_local;
    UPDATE tenants SET plan_id = NULL WHERE id IN ('${DEMO.tenant}'${otro ? `, '${otro}'` : ""})`);
  afterAll(limpiar);

  it("ingreso mensual, facturado y cobrado, nuevos, cancelados, abandono y cohortes", async () => {
    otro = sql(`SELECT id FROM tenants WHERE id <> '${DEMO.tenant}' ORDER BY created_at LIMIT 1`);
    limpiar();
    // Demo: paga desde hace 2 meses, sigue vigente ($79.000). Otro: pagó hace 2 meses y canceló el mes pasado ($50.000).
    const [m2, m1, m0] = [mes(2), mes(1), mes(0)];
    sql(`INSERT INTO suscripciones_local (tenant_id, precio_mensual, dia_cobro, desde) VALUES ('${DEMO.tenant}', 79000, 1, '${m2}');
         INSERT INTO suscripciones_local (tenant_id, precio_mensual, dia_cobro, desde, cancelada_at) VALUES ('${otro}', 50000, 1, '${m2}', ('${m1}'::date + 10)::timestamp AT TIME ZONE 'America/Santiago');
         INSERT INTO cobros_mensualidad (tenant_id, periodo, monto, vence_el, estado, pagado_at, medio) VALUES
           ('${DEMO.tenant}', '${m2}', 79000, '${m2}'::date + 10, 'pagado', now(), 'transferencia'),
           ('${DEMO.tenant}', '${m1}', 79000, '${m1}'::date + 10, 'pagado', now(), 'transferencia'),
           ('${otro}', '${m2}', 50000, '${m2}'::date + 10, 'pagado', now(), 'transferencia');
         INSERT INTO cobros_mensualidad (tenant_id, periodo, monto, vence_el) VALUES ('${DEMO.tenant}', '${m0}', 79000, '${m0}'::date + 10);`);
    const { data, error } = await (await conSesion("finanzas")).cliente.rpc("metricas_finanzas", { _meses: 3 });
    expect(error).toBeNull();
    const m = data as Metricas;
    expect(m.actual).toMatchObject({ mrr: 79000, clientes_activos: 1, cancelados: 1, por_cobrar: 79000 });
    expect(m.meses.map((x) => x.mes)).toEqual([m2, m1, m0]);
    expect(m.meses.map((x) => [x.facturado, x.cobrado, x.pagando, x.nuevos, x.perdidos])).toEqual([
      [129000, 129000, 2, 2, 0],
      [79000, 79000, 1, 0, 1],
      [79000, 0, 0, 0, 0],
    ]);
    // Abandono del mes pasado: 1 cancelado de 2 que pagaban
    expect(m.meses[1].pagando_antes).toBe(2);
    // Cohorte de hace 2 meses: 2 locales; siguen 2 y 1 (el mes en curso no cuenta: todavía se está cobrando)
    expect(m.cohortes).toEqual([{ mes: m2, tamano: 2, siguen: [2, 1] }]);
  });
});
