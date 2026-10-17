import { describe, it, expect, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { anonimo, conSesion, esBaseLocal, hayCredenciales, invitado, DEMO } from "./entorno";

// Fase 8.1 — La mensualidad de Tablio. Solo finanzas y el superadmin ven y cambian suscripciones y cobros; el
// dueño (y el administrador) ve solo lo de su local. Los cobros los genera la base, uno por local y mes, en su
// día de cobro y nunca durante la prueba; un pago se registra una vez; anular exige motivo; todo queda en la
// auditoría. Lo que crea suscripciones corre en la base desechable.

const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();
const sesion = (rol: string) => conSesion(rol).then((s) => s.cliente, () => null);

describe.skipIf(!hayCredenciales)("mensualidad de Tablio", () => {
  it("nadie fuera de finanzas ve ni toca suscripciones o cobros", async () => {
    for (const rol of ["owner", "admin", "cashier", "waiter", "cliente", "vendedor", "jefe_ventas", "owner_ajeno"]) {
      const c = await sesion(rol);
      if (!c) continue;
      for (const t of ["suscripciones_local", "cobros_mensualidad"]) {
        expect((await c.from(t as never).select("*").limit(1)).data ?? [], `${rol}: ${t}`).toHaveLength(0);
      }
      expect((await c.rpc("guardar_suscripcion", { _tenant_id: DEMO.tenant, _plan_id: null, _precio_mensual: 0 })).error, rol).not.toBeNull();
      expect((await c.rpc("generar_cobros_mes")).error, rol).not.toBeNull();
      expect((await c.rpc("mensualidades_locales")).error, rol).not.toBeNull();
      expect((await c.rpc("registrar_pago_mensualidad", { _cobro_id: "00000000-0000-0000-0000-000000000000", _medio: "transferencia" })).error, rol).not.toBeNull();
      expect((await c.from("cobros_mensualidad").insert({ tenant_id: DEMO.tenant, periodo: "2026-01-01", monto: 1, vence_el: "2026-01-10" } as never)).error, rol).not.toBeNull();
    }
    expect((await anonimo().rpc("mi_mensualidad", { _tenant_id: DEMO.tenant })).error).not.toBeNull();
  });

  it("el dueño y el administrador ven la mensualidad de su local; la caja, un invitado y otro local no", async () => {
    for (const rol of ["owner", "admin"]) {
      const { data, error } = await (await conSesion(rol)).cliente.rpc("mi_mensualidad", { _tenant_id: DEMO.tenant });
      expect(error, rol).toBeNull();
      expect((data as { estado: string }).estado, rol).toBeTruthy();
    }
    const ajenos = [await sesion("cashier"), await sesion("waiter"), await invitado(), await sesion("owner_ajeno")].filter(Boolean);
    for (const c of ajenos) expect((await c!.rpc("mi_mensualidad", { _tenant_id: DEMO.tenant })).error).not.toBeNull();
  });
});

describe.skipIf(!hayCredenciales || !esBaseLocal)("mensualidad: cobros, pagos y estados", () => {
  const limpiar = () => sql(`DELETE FROM cobros_mensualidad WHERE tenant_id = '${DEMO.tenant}';
    DELETE FROM suscripciones_local WHERE tenant_id = '${DEMO.tenant}';
    UPDATE tenants SET plan_id = NULL, plan_status = 'active' WHERE id = '${DEMO.tenant}'`);
  afterAll(limpiar);
  const estado = () => JSON.parse(sql(`SELECT public._estado_mensualidad('${DEMO.tenant}')`)) as { estado: string; pendiente: number; dias_atraso: number };
  const cobros = () => sql(`SELECT coalesce(string_agg(periodo || ':' || estado || ':' || monto, ',' ORDER BY periodo), '') FROM cobros_mensualidad WHERE tenant_id = '${DEMO.tenant}'`);

  it("finanzas crea la suscripción; los cobros salen en su día, uno por mes, y nunca en prueba", async () => {
    limpiar();
    const fin = (await conSesion("finanzas")).cliente;
    const chico = sql(`SELECT id FROM plans WHERE name = 'chico'`);
    expect((await fin.rpc("guardar_suscripcion", { _tenant_id: DEMO.tenant, _plan_id: chico, _precio_mensual: 79000, _dia_cobro: 29 })).error?.message).toContain("día de cobro");
    expect((await fin.rpc("guardar_suscripcion", { _tenant_id: DEMO.tenant, _plan_id: chico, _precio_mensual: 79000, _dia_cobro: 5, _prueba_hasta: "2027-01-31" })).error).toBeNull();
    // El plan de la suscripción pasa a ser el plan del local (módulos)
    expect(sql(`SELECT plan_id || '|' || plan_status FROM tenants WHERE id = '${DEMO.tenant}'`)).toBe(`${chico}|trial`);
    expect(estado().estado).toBe("prueba");
    sql(`UPDATE suscripciones_local SET desde = '2026-01-01' WHERE tenant_id = '${DEMO.tenant}'`);
    // En prueba (hasta el 31 de enero): diciembre y enero no se cobran; febrero sí, desde el día 5
    expect(sql(`SELECT public._generar_cobros('2026-12-20')`)).toBe("0");
    expect(sql(`SELECT public._generar_cobros('2027-01-20')`)).toBe("0");
    expect(sql(`SELECT public._generar_cobros('2027-02-04')`)).toBe("0");
    expect(sql(`SELECT public._generar_cobros('2027-02-05')`)).toBe("1");
    expect(sql(`SELECT public._generar_cobros('2027-02-25')`)).toBe("0"); // una vez por mes
    expect(cobros()).toBe("2027-02-01:pendiente:79000");
    expect(sql(`SELECT vence_el FROM cobros_mensualidad WHERE tenant_id = '${DEMO.tenant}'`)).toBe("2027-02-15");
    expect(sql(`SELECT count(*) FROM audit_logs WHERE tenant_id = '${DEMO.tenant}' AND action = 'suscripcion_guardada' AND created_at > now() - interval '1 minute'`)).not.toBe("0");
  });

  it("vencido pasa a gracia y después a atrasado; pagar lo deja al día (una sola vez, con registro)", async () => {
    const fin = (await conSesion("finanzas")).cliente;
    const cobro = sql(`SELECT id FROM cobros_mensualidad WHERE tenant_id = '${DEMO.tenant}'`);
    sql(`UPDATE suscripciones_local SET prueba_hasta = NULL WHERE tenant_id = '${DEMO.tenant}'`);
    sql(`UPDATE cobros_mensualidad SET vence_el = (now() AT TIME ZONE 'America/Santiago')::date + 3 WHERE id = '${cobro}'`);
    expect(estado().estado).toBe("por_vencer");
    sql(`UPDATE cobros_mensualidad SET vence_el = (now() AT TIME ZONE 'America/Santiago')::date - 4 WHERE id = '${cobro}'`);
    expect(estado().estado).toBe("en_gracia");
    sql(`UPDATE cobros_mensualidad SET vence_el = (now() AT TIME ZONE 'America/Santiago')::date - 25 WHERE id = '${cobro}'`);
    expect(estado()).toMatchObject({ estado: "atrasado", pendiente: 79000, dias_atraso: 25 });
    // El dueño lo ve en su pantalla
    const m = (await (await conSesion("owner")).cliente.rpc("mi_mensualidad", { _tenant_id: DEMO.tenant })).data as { estado: string; cobros: unknown[] };
    expect(m.estado).toBe("atrasado");
    expect(m.cobros).toHaveLength(1);

    expect((await fin.rpc("registrar_pago_mensualidad", { _cobro_id: cobro, _medio: "cheque" })).error).not.toBeNull();
    const [a, b] = await Promise.all([
      fin.rpc("registrar_pago_mensualidad", { _cobro_id: cobro, _medio: "transferencia", _referencia: "TRF-123", _folio: "F-1" }),
      fin.rpc("registrar_pago_mensualidad", { _cobro_id: cobro, _medio: "transferencia", _referencia: "TRF-123", _folio: "F-1" }),
    ]);
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    expect(sql(`SELECT count(*) FROM audit_logs WHERE entity_id = '${cobro}' AND action = 'mensualidad_pagada'`)).toBe("1");
    expect(estado().estado).toBe("al_dia");
    // Un cobro pagado no se anula
    expect((await fin.rpc("anular_cobro_mensualidad", { _cobro_id: cobro, _motivo: "error de prueba" })).error).not.toBeNull();
  });

  it("anular exige motivo; cancelar la suscripción detiene los cobros; las auditorías siguen vacías y detectan un cobro huérfano", async () => {
    const fin = (await conSesion("finanzas")).cliente;
    expect(sql(`SELECT public._generar_cobros('2027-03-06')`)).toBe("1");
    const marzo = sql(`SELECT id FROM cobros_mensualidad WHERE tenant_id = '${DEMO.tenant}' AND periodo = '2027-03-01'`);
    expect((await fin.rpc("anular_cobro_mensualidad", { _cobro_id: marzo, _motivo: "" })).error?.message).toContain("motivo");
    expect((await fin.rpc("anular_cobro_mensualidad", { _cobro_id: marzo, _motivo: "Mes de cortesía por el piloto" })).error).toBeNull();
    expect(estado().estado).toBe("al_dia");
    expect((await fin.rpc("cancelar_suscripcion", { _tenant_id: DEMO.tenant, _motivo: "Fin de la prueba" })).error).toBeNull();
    expect(sql(`SELECT public._generar_cobros('2027-04-06')`)).toBe("0");
    expect(estado().estado).toBe("cancelada");

    const superadmin = (await conSesion("superadmin")).cliente;
    for (const fn of ["auditoria_seguridad", "auditoria_plata", "auditoria_operacion"] as const) {
      expect((await superadmin.rpc(fn)).data ?? [], fn).toEqual([]);
    }
    const salida = execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1"], { input: `
      BEGIN;
      SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT user_id FROM platform_admins LIMIT 1), 'role', 'authenticated')::text, true) IS NULL;
      DELETE FROM suscripciones_local WHERE tenant_id = '${DEMO.tenant}';
      SELECT 'hallazgo:' || tipo FROM auditoria_plata();
      ROLLBACK;` }).toString();
    expect(salida).toContain("hallazgo:cobro_sin_suscripcion");
  });
});
