import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonimo, conSesion, confirmarPresencia, esBaseLocal, hayCredenciales, invitado, llamarFuncion, qrMesa, DEMO } from "./entorno";

// Fase 6.4 — Compuerta de la fase 6 (tablets, cortes de caja y permisos). Los casos difíciles que faltaban
// (los demás están en f6-1 a f6-3), el aislamiento de todo lo nuevo y las tres auditorías: después de todo,
// tienen que salir vacías, y tienen que detectar un descuadre hecho a propósito. Lo que crea cortes,
// tablets o permisos corre en la base desechable.

const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();
const sqlSesion = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1"], { input: q }).toString().trim();
const hoy = `public.dia_abierto('${DEMO.sucursal}', public.dia_negocio('${DEMO.sucursal}', now()))`;

describe.skipIf(!hayCredenciales)("compuerta de la fase 6", () => {
  let superadmin: SupabaseClient;
  let dueno: SupabaseClient;
  let caja: SupabaseClient;
  let mozo: SupabaseClient;
  let agua: string;
  const cobroEnEfectivo = async (mesa: number) => {
    const c = await invitado();
    await c.rpc("unirse_a_mesa", { _qr_token: qrMesa(mesa)! });
    await confirmarPresencia(c, mesa);
    const p = (await c.rpc("pedir_sin_pagar", { _qr_token: qrMesa(mesa)!, _items: [{ menu_item_id: agua, quantity: 1 }], _forma: "mozo" })).data as { order_id: string };
    return caja.rpc("registrar_cobro_mozo", { _order_ids: [p.order_id], _metodo: "cash" });
  };
  const auditorias = async () => {
    const salida: string[] = [];
    for (const fn of ["auditoria_seguridad", "auditoria_plata", "auditoria_operacion"] as const) {
      const { data, error } = await superadmin.rpc(fn);
      expect(error, fn).toBeNull();
      for (const h of (data ?? []) as Record<string, string>[]) salida.push(`${fn}: ${Object.values(h).join(" · ")}`);
    }
    return salida;
  };

  beforeAll(async () => {
    superadmin = (await conSesion("superadmin")).cliente;
    dueno = (await conSesion("owner")).cliente;
    caja = (await conSesion("cashier")).cliente;
    mozo = (await conSesion("waiter")).cliente;
    agua = (await anonimo().from("menu_items").select("id").eq("tenant_id", DEMO.tenant).eq("name", "Agua mineral").single()).data!.id;
  });
  afterAll(() => {
    if (!esBaseLocal) return;
    sql(`DELETE FROM cortes_caja WHERE branch_id = '${DEMO.sucursal}' AND dia = ${hoy};
         UPDATE payments SET corte_numero = 1 WHERE branch_id = '${DEMO.sucursal}' AND dia_negocio = ${hoy};
         DELETE FROM permisos_rol WHERE tenant_id = '${DEMO.tenant}';`);
  });

  it.skipIf(!esBaseLocal)("cobros entrando justo durante un corte: cada uno queda en un solo tramo y los cortes cuadran", async () => {
    const pendiente = ((await caja.rpc("resumen_caja", { _branch_id: DEMO.sucursal })).data as { tramo_abierto: { efectivo: number } }).tramo_abierto.efectivo;
    const [corte, ...cobros] = await Promise.all([
      caja.rpc("hacer_corte_caja", { _branch_id: DEMO.sucursal, _efectivo_contado: pendiente, _notas: "Corte con cobros entrando al mismo tiempo" }),
      cobroEnEfectivo(9), cobroEnEfectivo(9), cobroEnEfectivo(10), cobroEnEfectivo(10),
    ]);
    expect(corte.error).toBeNull();
    for (const c of cobros) expect(c.error).toBeNull();
    const numero = (corte.data as { numero: number }).numero;
    // Cada cobro quedó o dentro del corte o en el tramo siguiente; el corte guardó exactamente lo suyo
    const ids = cobros.map((c) => `'${(c.data as { payment_id: string }).payment_id}'`).join(",");
    for (const n of sql(`SELECT corte_numero FROM payments WHERE id IN (${ids})`).split("\n")) expect([numero, numero + 1]).toContain(Number(n));
    expect(await auditorias()).toEqual([]);
  });

  it.skipIf(!esBaseLocal)("dos cortes al mismo tiempo: nunca dos con el mismo número", async () => {
    const pares = await Promise.all([0, 1].map(() =>
      caja.rpc("hacer_corte_caja", { _branch_id: DEMO.sucursal, _efectivo_contado: 0, _notas: "Dos cortes a la vez (prueba)" })));
    const buenos = pares.filter((p) => !p.error);
    expect(buenos.length).toBeGreaterThanOrEqual(1);
    expect(sql(`SELECT count(*) - count(DISTINCT numero) FROM cortes_caja WHERE branch_id = '${DEMO.sucursal}' AND dia = ${hoy}`)).toBe("0");
    expect(await auditorias()).toEqual([]);
  });

  it.skipIf(!esBaseLocal)("ocho intentos de PIN al mismo tiempo: se bloquea a los cinco y después ni el PIN correcto entra", async () => {
    const PIN = "3917";
    const yo = (await mozo.auth.getUser()).data.user!.id;
    const staff = (await dueno.from("staff_users").select("id").eq("auth_user_id", yo).single()).data!.id;
    expect((await mozo.rpc("definir_mi_pin", { _pin: PIN })).error).toBeNull();
    const token = ((await dueno.rpc("crear_equipo_compartido", { _branch_id: DEMO.sucursal, _nombre: "Tablet compuerta" })).data as { token: string }).token;
    try {
      await Promise.all(Array.from({ length: 8 }, (_, i) => llamarFuncion("entrar-con-pin", { equipo: token, persona: staff, pin: `0${String(100 + i).slice(1)}5` })));
      expect(sql(`SELECT bloqueado_hasta > now() FROM pines_personal WHERE staff_id = '${staff}'`)).toBe("t");
      const correcto = await llamarFuncion("entrar-con-pin", { equipo: token, persona: staff, pin: PIN });
      expect(correcto.status).not.toBe(200);
      expect(correcto.cuerpo).toContain("Demasiados intentos");
    } finally {
      sql(`UPDATE pines_personal SET intentos = 0, bloqueado_hasta = NULL WHERE staff_id = '${staff}';
           UPDATE equipos_compartidos SET revocado_at = now() WHERE nombre = 'Tablet compuerta' AND revocado_at IS NULL;`);
    }
  });

  it.skipIf(!esBaseLocal)("quitar un permiso justo mientras la persona lo usa: o pasa antes o queda bloqueado, nunca a medias", async () => {
    const pagos = await Promise.all([
      cobroEnEfectivo(9),
      dueno.rpc("guardar_permiso_rol", { _tenant_id: DEMO.tenant, _rol: "cashier", _permiso: "cobrar", _permitido: false }),
    ]);
    const cobro = pagos[0];
    if (cobro.error) expect(cobro.error.message).toContain("no tiene permiso");
    // Ya quitado, ningún cobro más pasa
    expect((await cobroEnEfectivo(9)).error?.message).toContain("no tiene permiso");
    sql(`DELETE FROM permisos_rol WHERE tenant_id = '${DEMO.tenant}'`);
    expect(await auditorias()).toEqual([]);
  });

  it("todo lo nuevo está aislado: el dueño de otro local, un invitado y un anónimo no ven ni tocan nada", async () => {
    const ajenos: SupabaseClient[] = [await invitado(), anonimo()];
    if (process.env.DEMO_CREDENCIALES) ajenos.push((await conSesion("owner_ajeno")).cliente);
    for (const c of ajenos) {
      for (const t of ["cortes_caja", "permisos_rol", "pines_personal", "equipos_compartidos"]) {
        expect((await c.from(t as never).select("*").eq("tenant_id", DEMO.tenant).limit(1)).data ?? [], t).toHaveLength(0);
      }
      expect((await c.rpc("hacer_corte_caja", { _branch_id: DEMO.sucursal, _efectivo_contado: 0 })).error).not.toBeNull();
      expect((await c.rpc("guardar_permiso_rol", { _tenant_id: DEMO.tenant, _rol: "cashier", _permiso: "ver_reportes", _permitido: true })).error).not.toBeNull();
      expect((await c.rpc("permisos_del_local", { _tenant_id: DEMO.tenant })).error).not.toBeNull();
      expect((await c.rpc("crear_equipo_compartido", { _branch_id: DEMO.sucursal, _nombre: "Ajena" })).error).not.toBeNull();
      expect((await c.rpc("estado_pines", { _branch_id: DEMO.sucursal })).data ?? []).toHaveLength(0);
    }
  });

  it("las tres auditorías salen vacías", async () => {
    expect(await auditorias()).toEqual([]);
  });

  it.skipIf(!esBaseLocal)("y detectan lo nuevo cuando algo no calza (se descuadra a propósito y se deshace)", async () => {
    const salida = sqlSesion(`
      BEGIN;
      SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT user_id FROM platform_admins LIMIT 1), 'role', 'authenticated')::text, true) IS NULL;
      -- Un PIN y una tablet que apuntan a otro local; un permiso de plata para el mozo
      UPDATE pines_personal SET tenant_id = (SELECT id FROM tenants WHERE id <> '${DEMO.tenant}' LIMIT 1)
       WHERE staff_id = (SELECT staff_id FROM pines_personal WHERE tenant_id = '${DEMO.tenant}' LIMIT 1);
      INSERT INTO equipos_compartidos (tenant_id, branch_id, nombre, token_hash)
        SELECT id, '${DEMO.sucursal}', 'Sabotaje', md5(random()::text) FROM tenants WHERE id <> '${DEMO.tenant}' LIMIT 1;
      ALTER TABLE permisos_rol DROP CONSTRAINT permisos_rol_posible;
      INSERT INTO permisos_rol (tenant_id, rol, permiso, permitido) VALUES ('${DEMO.tenant}', 'waiter', 'reembolsar', true);
      SELECT 'hallazgo:' || tipo FROM auditoria_operacion();
      SELECT 'hallazgo:' || tipo FROM auditoria_seguridad();
      ROLLBACK;`);
    for (const t of ["pin_incoherente", "tablet_incoherente", "permiso_imposible"]) expect(salida, t).toContain(`hallazgo:${t}`);
    // Y la plata sigue protegida aunque la fila exista: el permiso imposible no le da nada al mozo
    expect(sqlSesion(`
      BEGIN;
      ALTER TABLE permisos_rol DROP CONSTRAINT permisos_rol_posible;
      INSERT INTO permisos_rol (tenant_id, rol, permiso, permitido) VALUES ('${DEMO.tenant}', 'waiter', 'reembolsar', true);
      SELECT 'puede:' || public._rol_puede('${DEMO.tenant}', 'waiter', 'reembolsar');
      ROLLBACK;`)).toContain("puede:false");
  });
});
