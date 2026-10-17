import { describe, it, expect, afterAll } from "vitest";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonimo, conSesion, esBaseLocal, guardarCuenta, hayCredenciales, invitado, llamarFuncion, qrMesa, DEMO } from "./entorno";

// Fase 8.5 — Compuerta de la fase 8 (mensualidad, métricas y trivia en vivo). No depende del orden de los
// archivos: arma lo que necesita. Revisa el aislamiento de lo nuevo, los casos difíciles que cruzan etapas
// (cobros generados a la vez, cambiar de plan cambia los módulos, cancelar con un cobro pendiente, muchas
// respuestas a la vez, borrar una cuenta que jugó) y las tres auditorías: vacías, y atentas a un descuadre.

const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();
const sqlAsync = promisify(execFile);
const sesion = (rol: string) => conSesion(rol).then((s) => s.cliente, () => null);

describe.skipIf(!hayCredenciales)("compuerta de la fase 8", () => {
  const auditorias = async () => {
    const superadmin = (await conSesion("superadmin")).cliente;
    const salida: string[] = [];
    for (const fn of ["auditoria_seguridad", "auditoria_plata", "auditoria_operacion"] as const) {
      const { data, error } = await superadmin.rpc(fn);
      expect(error, fn).toBeNull();
      for (const h of (data ?? []) as Record<string, string>[]) salida.push(`${fn}: ${Object.values(h).join(" · ")}`);
    }
    return salida;
  };

  it("todo lo nuevo está aislado: otro local, un invitado, un anónimo y el personal no ven ni tocan nada", async () => {
    const ajenos: [string, SupabaseClient][] = [["invitado", await invitado()], ["anónimo", anonimo()]];
    for (const rol of ["owner_ajeno", "waiter", "kitchen", "cashier", "vendedor"]) {
      const c = await sesion(rol);
      if (c) ajenos.push([rol, c]);
    }
    for (const [quien, c] of ajenos) {
      for (const t of ["suscripciones_local", "cobros_mensualidad"]) {
        expect((await c.from(t as never).select("*").limit(1)).data ?? [], `${quien}: ${t}`).toHaveLength(0);
      }
      for (const t of ["trivias_vivo", "respuestas_trivia_vivo"]) {
        expect((await c.from(t as never).select("*").eq("tenant_id", DEMO.tenant).limit(1)).data ?? [], `${quien}: ${t}`).toHaveLength(0);
      }
      expect((await c.rpc("metricas_finanzas", { _meses: 3 })).error, quien).not.toBeNull();
      expect((await c.rpc("mensualidades_locales")).error, quien).not.toBeNull();
      expect((await c.rpc("crear_trivia_vivo", { _branch_id: DEMO.sucursal })).error, quien).not.toBeNull();
    }
  });

  describe.skipIf(!esBaseLocal)("casos difíciles", () => {
    const limpiar = () => sql(`DELETE FROM cobros_mensualidad WHERE tenant_id = '${DEMO.tenant}'; DELETE FROM suscripciones_local WHERE tenant_id = '${DEMO.tenant}';
      UPDATE tenants SET plan_id = NULL, plan_status = 'active' WHERE id = '${DEMO.tenant}';
      UPDATE plans SET features = features || (SELECT jsonb_object_agg(modulo, true) FROM _catalogo_modulos());
      DELETE FROM trivias_vivo WHERE tenant_id = '${DEMO.tenant}'`);
    afterAll(limpiar);

    it("los cobros generados a la vez salen una sola vez; cancelar deja lo pendiente como deuda", async () => {
      limpiar();
      const fin = (await conSesion("finanzas")).cliente;
      expect((await fin.rpc("guardar_suscripcion", { _tenant_id: DEMO.tenant, _plan_id: null, _precio_mensual: 79000, _dia_cobro: 1 })).error).toBeNull();
      sql(`UPDATE suscripciones_local SET desde = '2026-01-01' WHERE tenant_id = '${DEMO.tenant}'`);
      await Promise.all(Array.from({ length: 8 }, () => sqlAsync("psql", [DB, "-At", "-c", "SELECT public._generar_cobros('2027-05-03')"])));
      expect(sql(`SELECT count(*) FROM cobros_mensualidad WHERE tenant_id = '${DEMO.tenant}' AND periodo = '2027-05-01'`)).toBe("1");
      // Cancelar no borra lo que debe
      expect((await fin.rpc("cancelar_suscripcion", { _tenant_id: DEMO.tenant, _motivo: "Cierra el local" })).error).toBeNull();
      expect(sql(`SELECT estado FROM cobros_mensualidad WHERE tenant_id = '${DEMO.tenant}' AND periodo = '2027-05-01'`)).toBe("pendiente");
      expect(sql(`SELECT public._estado_mensualidad('${DEMO.tenant}') ->> 'estado'`)).toBe("cancelada");
      // Si vuelve, la suscripción se reactiva y la deuda sigue ahí
      expect((await fin.rpc("guardar_suscripcion", { _tenant_id: DEMO.tenant, _plan_id: null, _precio_mensual: 79000, _dia_cobro: 1 })).error).toBeNull();
      expect(Number(sql(`SELECT public._estado_mensualidad('${DEMO.tenant}') ->> 'pendiente'`))).toBe(79000);
      expect(await auditorias()).toEqual([]);
    });

    it("cambiar de plan en la mensualidad cambia los módulos del local al instante", async () => {
      const fin = (await conSesion("finanzas")).cliente;
      const chico = sql(`SELECT id FROM plans WHERE name = 'chico'`);
      sql(`UPDATE plans SET features = features || '{"juegos": false}' WHERE id = '${chico}'`);
      expect((await fin.rpc("guardar_suscripcion", { _tenant_id: DEMO.tenant, _plan_id: chico, _precio_mensual: 59000, _dia_cobro: 1 })).error).toBeNull();
      const dueno = (await conSesion("owner")).cliente;
      expect((await dueno.rpc("crear_trivia_vivo", { _branch_id: DEMO.sucursal })).error?.message).toContain("no está incluida en el plan");
      expect(((await (await invitado()).rpc("modulos_del_local", { _tenant_id: DEMO.tenant })).data as Record<string, boolean>).juegos).toBe(false);
      sql(`UPDATE plans SET features = features || '{"juegos": true}' WHERE id = '${chico}'`);
      expect((await dueno.rpc("crear_trivia_vivo", { _branch_id: DEMO.sucursal, _preguntas: 3 })).error).toBeNull();
    });

    it("muchas respuestas a la vez cuentan una; una cuenta que jugó se borra entera y el ranking sigue calzando", async () => {
      const MESA = 9;
      const dueno = (await conSesion("owner")).cliente;
      await dueno.rpc("cerrar_mesa", { _table_id: sql(`SELECT id FROM tables WHERE branch_id = '${DEMO.sucursal}' AND number = ${MESA}`), _motivo: "preparar prueba" });
      const trivia = sql(`SELECT id FROM trivias_vivo WHERE tenant_id = '${DEMO.tenant}' AND estado <> 'terminada'`);
      await dueno.rpc("avanzar_trivia_vivo", { _trivia_id: trivia });
      const c = await invitado();
      await c.rpc("unirse_a_mesa", { _qr_token: qrMesa(MESA)!, _alias: "Dani" });
      await guardarCuenta(c, `f8-compuerta-${Date.now()}@demo.tablio.test`);
      const yo = (await c.auth.getUser()).data.user!.id;
      const correcta = Number(sql(`SELECT q.correcta FROM trivias_vivo t JOIN preguntas_trivia q ON q.id = t.preguntas[1] WHERE t.id = '${trivia}'`));
      const intentos = await Promise.all(Array.from({ length: 10 }, () =>
        c.rpc("responder_trivia_vivo", { _qr_token: qrMesa(MESA)!, _trivia_id: trivia, _numero: 1, _opcion: correcta })));
      expect(intentos.filter((r) => !r.error)).toHaveLength(1);
      expect(sql(`SELECT count(*) FROM respuestas_trivia_vivo WHERE trivia_id = '${trivia}' AND user_id = '${yo}'`)).toBe("1");
      await dueno.rpc("avanzar_trivia_vivo", { _trivia_id: trivia });
      expect(((await dueno.rpc("pantalla_trivia_vivo", { _branch_id: DEMO.sucursal })).data as { ranking: { alias: string }[] }).ranking.map((r) => r.alias)).toContain("Dani");

      const r = await llamarFuncion("borrar-mi-cuenta", { confirmar: true }, (await c.auth.getSession()).data.session!.access_token);
      expect(r.status, r.cuerpo).toBe(200);
      expect(sql(`SELECT count(*) FROM respuestas_trivia_vivo WHERE user_id = '${yo}'`)).toBe("0");
      expect(((await dueno.rpc("pantalla_trivia_vivo", { _branch_id: DEMO.sucursal })).data as { ranking: { alias: string }[] }).ranking.map((x) => x.alias)).not.toContain("Dani");
      await dueno.rpc("terminar_trivia_vivo", { _trivia_id: trivia });
      expect(await auditorias()).toEqual([]);
    });
  });

  it("las tres auditorías salen vacías", async () => {
    expect(await auditorias()).toEqual([]);
  });

  it.skipIf(!esBaseLocal)("y detectan lo de la fase 8 cuando algo no calza (se descuadra a propósito y se deshace)", async () => {
    const salida = execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1"], { input: `
      BEGIN;
      SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT user_id FROM platform_admins LIMIT 1), 'role', 'authenticated')::text, true) IS NULL;
      -- Un cobro de un local sin suscripción y una respuesta de trivia con puntos sin acertar
      INSERT INTO cobros_mensualidad (tenant_id, periodo, monto, vence_el)
        SELECT id, '2030-01-01', 1000, '2030-01-10' FROM tenants WHERE id NOT IN (SELECT tenant_id FROM suscripciones_local) LIMIT 1;
      INSERT INTO trivias_vivo (tenant_id, branch_id, preguntas, estado, actual)
        SELECT '${DEMO.tenant}', '${DEMO.sucursal}', (SELECT array_agg(id) FROM (SELECT id FROM preguntas_trivia LIMIT 3) x), 'terminada', 1;
      INSERT INTO respuestas_trivia_vivo (trivia_id, tenant_id, user_id, alias, numero, opcion, correcta, puntos)
        SELECT t.id, t.tenant_id, (SELECT id FROM auth.users LIMIT 1), 'Sabotaje', 1, (q.correcta + 1) % cardinality(q.opciones), true, 150
          FROM trivias_vivo t JOIN preguntas_trivia q ON q.id = t.preguntas[1]
         WHERE t.tenant_id = '${DEMO.tenant}' ORDER BY t.created_at DESC LIMIT 1;
      SELECT 'hallazgo:' || tipo FROM auditoria_plata();
      SELECT 'hallazgo:' || tipo FROM auditoria_operacion();
      ROLLBACK;` }).toString();
    for (const t of ["cobro_sin_suscripcion", "trivia_vivo_incoherente"]) expect(salida, t).toContain(`hallazgo:${t}`);
  });
});
