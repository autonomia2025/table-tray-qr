import { describe, it, expect, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { anonimo, conSesion, esBaseLocal, hayCredenciales, invitado, qrMesa, DEMO } from "./entorno";

// Fase 7.9 — Módulos por plan. Lo cumple la base: sin el módulo, sus funciones no corren aunque alguien llame
// directo, y las pantallas lo esconden. Solo el superadmin cambia planes y ajustes, con motivo y auditoría.

const MODULOS = ["campanas", "niveles", "pasaporte", "raspe", "juegos", "ronda", "dividir", "tablets", "invitar"];

describe.skipIf(!hayCredenciales)("módulos por plan", () => {
  it("cualquiera con sesión ve qué módulos tiene el local; sin sesión no", async () => {
    expect((await anonimo().rpc("modulos_del_local", { _tenant_id: DEMO.tenant })).error).not.toBeNull();
    const { data } = await (await invitado()).rpc("modulos_del_local", { _tenant_id: DEMO.tenant });
    expect(Object.keys(data as object).sort()).toEqual([...MODULOS].sort());
  });

  it("solo el superadmin cambia planes, el plan de un local y sus ajustes; nadie escribe directo", async () => {
    const plan = (await anonimo().from("plans").select("id").limit(1)).data?.[0]?.id as string | undefined;
    for (const rol of ["owner", "admin", "cashier", "waiter", "cliente", "owner_ajeno", "vendedor"]) {
      const c = await conSesion(rol).then((s) => s.cliente, () => null);
      if (!c) continue; // esa cuenta no existe en esta base
      expect((await c.rpc("ajustar_modulo_local", { _tenant_id: DEMO.tenant, _modulo: "juegos", _estado: false, _motivo: "intento" })).error, rol).not.toBeNull();
      expect((await c.rpc("asignar_plan", { _tenant_id: DEMO.tenant, _plan_id: null })).error, rol).not.toBeNull();
      if (plan) expect((await c.rpc("guardar_modulos_plan", { _plan_id: plan, _modulos: { juegos: false } })).error, rol).not.toBeNull();
      expect((await c.from("tenant_feature_flags").insert({ tenant_id: DEMO.tenant, flag_key: "juegos", is_enabled: false } as never)).error, rol).not.toBeNull();
      const r = await c.from("plans").update({ features: {} } as never).neq("id", "00000000-0000-0000-0000-000000000000").select("id");
      expect(r.data ?? [], rol).toHaveLength(0);
    }
  });
});

// Apaga módulos del demo y lo deja como estaba: solo en la base desechable
const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();
const MESA = 3;

describe.skipIf(!hayCredenciales || !esBaseLocal)("módulos por plan: se cumplen en la base", () => {
  afterAll(() => sql(`DELETE FROM tenant_feature_flags WHERE tenant_id = '${DEMO.tenant}';
    UPDATE tenants SET plan_id = NULL WHERE id = '${DEMO.tenant}';
    UPDATE plans SET features = features || (SELECT jsonb_object_agg(modulo, true) FROM _catalogo_modulos())`));

  it("un módulo apagado para el local no corre, aunque se llame directo", async () => {
    const sa = (await conSesion("superadmin")).cliente;
    const desde = sql("SELECT now()");
    // El motivo es obligatorio
    expect((await sa.rpc("ajustar_modulo_local", { _tenant_id: DEMO.tenant, _modulo: "juegos", _estado: false, _motivo: "" })).error?.message).toContain("motivo");
    expect((await sa.rpc("ajustar_modulo_local", { _tenant_id: DEMO.tenant, _modulo: "inventado", _estado: false, _motivo: "prueba de módulos" })).error).not.toBeNull();
    for (const m of ["juegos", "pasaporte", "dividir", "ronda", "tablets", "raspe", "niveles"]) {
      expect((await sa.rpc("ajustar_modulo_local", { _tenant_id: DEMO.tenant, _modulo: m, _estado: false, _motivo: "prueba de módulos" })).error, m).toBeNull();
    }
    expect(sql(`SELECT count(*) FROM audit_logs WHERE tenant_id = '${DEMO.tenant}' AND action = 'modulo_ajustado' AND created_at >= '${desde}'`)).toBe("7");
    const mods = (await (await invitado()).rpc("modulos_del_local", { _tenant_id: DEMO.tenant })).data as Record<string, boolean>;
    expect(mods).toMatchObject({ juegos: false, pasaporte: false, campanas: true });

    // El comensal en la mesa
    const c = await invitado();
    await c.rpc("unirse_a_mesa", { _qr_token: qrMesa(MESA)!, _alias: "Módulos" });
    expect((await c.rpc("empezar_trivia", { _qr_token: qrMesa(MESA)! })).error?.message).toContain("no está incluida en el plan");
    expect((await c.rpc("girar_ruleta", { _qr_token: qrMesa(MESA)! })).error?.message).toContain("no está incluida en el plan");
    expect((await c.rpc("dividir_plato", { _qr_token: qrMesa(MESA)!, _item: {}, _comensales: [] })).error?.message).toContain("no está incluida en el plan");
    expect((await c.rpc("mi_pasaporte", { _tenant_id: DEMO.tenant })).data).toEqual({ activo: false });
    expect(((await c.rpc("mi_mesa_en_vivo", { _qr_token: qrMesa(MESA)! })).data as { modulos: Record<string, boolean> }).modulos.juegos).toBe(false);
    // La ronda: el pedido no queda marcado (la plata no cambia)
    const agua = (await anonimo().from("menu_items").select("id").eq("tenant_id", DEMO.tenant).eq("name", "Agua mineral").single()).data!.id;
    const cot = (await c.rpc("cotizar", { _qr_token: qrMesa(MESA)!, _items: [{ menu_item_id: agua, quantity: 1 }], _ronda: true })).data as { id: string };
    expect(sql(`SELECT ronda FROM cotizaciones WHERE id = '${cot.id}'`)).toBe("f");
    // Las tablets
    expect((await (await conSesion("owner")).cliente.rpc("crear_equipo_compartido", { _branch_id: DEMO.sucursal, _nombre: "Tablet de prueba" })).error?.message).toContain("no está incluida en el plan");

    // Volver a "según su plan" (sin plan: tiene todo)
    for (const m of ["juegos", "pasaporte", "dividir", "ronda", "tablets", "raspe", "niveles"]) {
      await sa.rpc("ajustar_modulo_local", { _tenant_id: DEMO.tenant, _modulo: m, _estado: null, _motivo: "fin de la prueba" });
    }
    expect((await c.rpc("mi_pasaporte", { _tenant_id: DEMO.tenant })).data).toMatchObject({ activo: true });
  });

  it("el plan del local decide, y un ajuste del local va por encima del plan", async () => {
    const sa = (await conSesion("superadmin")).cliente;
    const desde = sql("SELECT now()");
    const chico = sql(`SELECT id FROM plans WHERE name = 'chico'`);
    expect((await sa.rpc("guardar_modulos_plan", { _plan_id: chico, _modulos: { campanas: false, inventado: true } })).error).not.toBeNull();
    expect((await sa.rpc("guardar_modulos_plan", { _plan_id: chico, _modulos: { campanas: false } })).error).toBeNull();
    expect((await sa.rpc("asignar_plan", { _tenant_id: DEMO.tenant, _plan_id: chico })).error).toBeNull();
    const dueno = (await conSesion("owner")).cliente;
    const guardar = () => dueno.rpc("guardar_campana", { _tenant_id: DEMO.tenant, _titulo: "Prueba de plan", _mensaje: "Un mensaje de prueba para el plan", _publico: "todos" });
    expect((await guardar()).error?.message).toContain("no está incluida en el plan");
    // El superadmin se la presta a este local
    await sa.rpc("ajustar_modulo_local", { _tenant_id: DEMO.tenant, _modulo: "campanas", _estado: true, _motivo: "prueba de campañas" });
    const ok = await guardar();
    expect(ok.error).toBeNull();
    sql(`DELETE FROM campanas WHERE id = '${ok.data}'`);
    expect(sql(`SELECT count(*) FROM audit_logs WHERE action IN ('plan_asignado', 'modulos_plan_cambiados') AND created_at >= '${desde}'`)).toBe("2");
  });

  it("las auditorías siguen vacías y detectan un plan con un módulo que no existe", async () => {
    sql(`DELETE FROM tenant_feature_flags WHERE tenant_id = '${DEMO.tenant}'; UPDATE tenants SET plan_id = NULL WHERE id = '${DEMO.tenant}';
         UPDATE plans SET features = features || (SELECT jsonb_object_agg(modulo, true) FROM _catalogo_modulos())`);
    const sa = (await conSesion("superadmin")).cliente;
    for (const fn of ["auditoria_seguridad", "auditoria_plata", "auditoria_operacion"] as const) {
      expect((await sa.rpc(fn)).data ?? [], fn).toEqual([]);
    }
    const salida = execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1"], { input: `
      BEGIN;
      SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT user_id FROM platform_admins LIMIT 1), 'role', 'authenticated')::text, true) IS NULL;
      UPDATE plans SET features = features || '{"cripto": true}' WHERE name = 'chico';
      SELECT 'hallazgo:' || tipo FROM auditoria_seguridad();
      ROLLBACK;` }).toString();
    expect(salida).toContain("hallazgo:modulo_desconocido");
  });
});
