import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonimo, conSesion, confirmarPresencia, esBaseLocal, guardarCuenta, hayCredenciales, invitado, llamarFuncion, qrMesa, DEMO } from "./entorno";

// Fase 7.10 — Compuerta de la fase 7 (campañas, beneficio, ronda, dividir, niveles, pasaporte, raspe, juegos y
// módulos). No depende del orden de los archivos: arma lo que necesita. Revisa lo que cruza entre etapas: todo lo
// nuevo aislado, los casos difíciles que faltaban (apagar un módulo a medio pagar, devolver un pago con un
// raspe sin raspar, borrar una cuenta con datos de la fase 7) y las tres auditorías: vacías después de todo, y
// atentas a un descuadre hecho a propósito. Lo que paga o cambia datos corre en la base desechable.

const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();
const sqlSesion = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1"], { input: q }).toString().trim();
const TABLAS_F7 = ["campanas", "envios_campana", "bajas_campanas", "beneficios_usados", "platos_divididos", "partes_plato",
  "partidas_trivia", "ruletas_mesa", "raspes"];

describe.skipIf(!hayCredenciales)("compuerta de la fase 7", () => {
  let superadmin: SupabaseClient;
  const auditorias = async () => {
    const salida: string[] = [];
    for (const fn of ["auditoria_seguridad", "auditoria_plata", "auditoria_operacion"] as const) {
      const { data, error } = await superadmin.rpc(fn);
      expect(error, fn).toBeNull();
      for (const h of (data ?? []) as Record<string, string>[]) salida.push(`${fn}: ${Object.values(h).join(" · ")}`);
    }
    return salida;
  };
  beforeAll(async () => { superadmin = (await conSesion("superadmin")).cliente; });

  it("todo lo nuevo está aislado: otro local, un invitado, un anónimo y el personal sin rol no ven ni tocan nada", async () => {
    const ajenos: [string, SupabaseClient][] = [["invitado", await invitado()], ["anónimo", anonimo()]];
    const otroLocal = await conSesion("owner_ajeno").then((s) => s.cliente, () => null); // no existe en todas las bases
    if (otroLocal) ajenos.push(["otro local", otroLocal]);
    for (const [quien, c] of ajenos) {
      for (const t of TABLAS_F7) {
        expect((await c.from(t as never).select("*").eq("tenant_id", DEMO.tenant).limit(1)).data ?? [], `${quien}: ${t}`).toHaveLength(0);
      }
      expect((await c.rpc("guardar_campana", { _tenant_id: DEMO.tenant, _titulo: "Ajena", _mensaje: "Una campaña que no es mía", _publico: "todos" })).error, quien).not.toBeNull();
      expect((await c.rpc("resultados_campanas", { _tenant_id: DEMO.tenant })).data ?? [], quien).toHaveLength(0);
      expect((await c.rpc("raspar", { _raspe_id: "00000000-0000-0000-0000-000000000000" })).error, quien).not.toBeNull();
      expect((await c.rpc("ajustar_modulo_local", { _tenant_id: DEMO.tenant, _modulo: "juegos", _estado: false, _motivo: "intento ajeno" })).error, quien).not.toBeNull();
    }
    // El mozo y la cocina del mismo local tampoco ven campañas, avisos ni raspes
    for (const rol of ["waiter", "kitchen"]) {
      const c = (await conSesion(rol)).cliente;
      for (const t of ["campanas", "envios_campana", "raspes", "beneficios_usados"]) {
        expect((await c.from(t as never).select("*").eq("tenant_id", DEMO.tenant).limit(1)).data ?? [], `${rol}: ${t}`).toHaveLength(0);
      }
    }
  });

  describe.skipIf(!esBaseLocal)("casos difíciles", () => {
    let agua = "";
    let tabla = { id: "", price: 0 };
    const MESA = 4;
    const persona = async (alias: string) => {
      const c = await invitado();
      await c.rpc("unirse_a_mesa", { _qr_token: qrMesa(MESA)!, _alias: alias });
      await confirmarPresencia(c, MESA);
      const yo = (await c.auth.getUser()).data.user!.id;
      return { c, token: (await c.auth.getSession()).data.session!.access_token, yo,
        comensal: sql(`SELECT id FROM comensales_mesa WHERE user_id = '${yo}' ORDER BY created_at DESC LIMIT 1`) };
    };
    const pagarCotizacion = (token: string, cot: string) => llamarFuncion("process-payment",
      { table_token: qrMesa(MESA), method: "card", tip_amount: 0, cotizacion_id: cot, idempotency_key: `f7c-${Date.now()}-${Math.random()}` }, token);

    beforeAll(async () => {
      agua = (await anonimo().from("menu_items").select("id").eq("tenant_id", DEMO.tenant).eq("name", "Agua mineral").single()).data!.id;
      tabla = (await anonimo().from("menu_items").select("id, price").eq("tenant_id", DEMO.tenant).eq("name", "Tabla de quesos y carnes").single()).data as typeof tabla;
      const dueno = (await conSesion("owner")).cliente;
      const id = (await dueno.from("tables").select("id").eq("branch_id", DEMO.sucursal).eq("number", MESA).single()).data!.id;
      await dueno.rpc("cerrar_mesa", { _table_id: id, _motivo: "preparar prueba" });
    });
    afterAll(() => sql(`DELETE FROM tenant_feature_flags WHERE tenant_id = '${DEMO.tenant}';
      UPDATE loyalty_programs SET sorpresa_activa = false, sorpresa_premio = NULL, sorpresa_uno_de = 10, sorpresa_tope_mes = 20 WHERE tenant_id = '${DEMO.tenant}'`));

    it("si se apaga Dividir con un plato a medio pagar, lo que falta se puede pagar igual (nadie queda con plata trabada)", async () => {
      const ana = await persona("Ana");
      const beto = await persona("Beto");
      const r = (await ana.c.rpc("dividir_plato", { _qr_token: qrMesa(MESA)!, _item: { menu_item_id: tabla.id, quantity: 1 }, _comensales: [beto.comensal] })).data as { plato: string; order_id: string };
      const parte = (p: typeof ana) => sql(`SELECT id FROM partes_plato WHERE plato_id = '${r.plato}' AND user_id = '${p.yo}'`);
      const cotAna = (await ana.c.rpc("cotizar_parte", { _qr_token: qrMesa(MESA)!, _parte_id: parte(ana) })).data as { id: string };
      expect((await pagarCotizacion(ana.token, cotAna.id)).status).toBe(200);
      // El superadmin apaga el módulo justo ahora
      await superadmin.rpc("ajustar_modulo_local", { _tenant_id: DEMO.tenant, _modulo: "dividir", _estado: false, _motivo: "compuerta de la fase 7" });
      // No se puede dividir otro plato…
      expect((await ana.c.rpc("dividir_plato", { _qr_token: qrMesa(MESA)!, _item: { menu_item_id: tabla.id, quantity: 1 }, _comensales: [beto.comensal] })).error?.message).toContain("no está incluida en el plan");
      // …pero Beto termina de pagar su parte, y el plato pasa a cocina
      const cotBeto = await beto.c.rpc("cotizar_parte", { _qr_token: qrMesa(MESA)!, _parte_id: parte(beto) });
      expect(cotBeto.error).toBeNull();
      expect((await pagarCotizacion(beto.token, (cotBeto.data as { id: string }).id)).status).toBe(200);
      expect(sql(`SELECT payment_status FROM orders WHERE id = '${r.order_id}'`)).toBe("paid");
      await superadmin.rpc("ajustar_modulo_local", { _tenant_id: DEMO.tenant, _modulo: "dividir", _estado: null, _motivo: "fin de la compuerta" });
      expect(await auditorias()).toEqual([]);
    });

    it("una cuenta con datos de la fase 7 (raspe, trivia, ronda) se borra entera; la plata del local queda sin su nombre", async () => {
      sql(`UPDATE loyalty_programs SET sorpresa_activa = true, sorpresa_premio = 'Postre de la casa', sorpresa_uno_de = 2, sorpresa_tope_mes = 1000 WHERE tenant_id = '${DEMO.tenant}'`);
      const p = await persona("Carla");
      await guardarCuenta(p.c, `f7-compuerta-${Date.now()}@demo.tablio.test`);
      const token = (await p.c.auth.getSession()).data.session!.access_token;
      const cot = (await p.c.rpc("cotizar", { _qr_token: qrMesa(MESA)!, _items: [{ menu_item_id: agua, quantity: 1 }], _ronda: true })).data as { id: string };
      const pago = await pagarCotizacion(token, cot.id);
      expect(pago.status, pago.cuerpo).toBe(200);
      const pagoId = (JSON.parse(pago.cuerpo).payment as { id: string }).id;
      expect((await p.c.rpc("empezar_trivia", { _qr_token: qrMesa(MESA)! })).error).toBeNull();
      expect(sql(`SELECT count(*) FROM raspes WHERE user_id = '${p.yo}'`)).toBe("1");
      // Sus datos los muestran (y cuentan el raspe)
      const datos = (await p.c.rpc("mis_datos")).data as { sellos: { raspes: number }[] };
      expect(datos.sellos[0].raspes).toBe(1);

      const r = await llamarFuncion("borrar-mi-cuenta", { confirmar: true }, (await p.c.auth.getSession()).data.session!.access_token);
      expect(r.status, r.cuerpo).toBe(200);
      for (const [t, col] of [["raspes", "user_id"], ["partidas_trivia", "user_id"], ["comensales_mesa", "user_id"], ["envios_campana", "user_id"],
                              ["beneficios_usados", "user_id"], ["partes_plato", "user_id"]]) {
        expect(sql(`SELECT count(*) FROM ${t} WHERE ${col} = '${p.yo}'`), t).toBe("0");
      }
      // El pago (y su ronda) quedan en el local, sin su nombre
      expect(sql(`SELECT coalesce(user_id::text, 'sin nombre') || '|' || status FROM payments WHERE id = '${pagoId}'`)).toBe("sin nombre|approved");
      expect(await auditorias()).toEqual([]);
    });

    it("si se devuelve un pago con un raspe sin raspar, el raspe se anula y ya no se puede raspar", async () => {
      const { cliente: c, token } = await conSesion("cliente");
      const yo = (await c.auth.getUser()).data.user!.id;
      sql(`UPDATE loyalty_rewards SET status = 'anulado', anulado_at = now() WHERE status = 'earned' AND id IN (SELECT premio_id FROM raspes WHERE anulado_at IS NULL AND user_id = '${yo}');
           UPDATE raspes SET anulado_at = now() WHERE user_id = '${yo}' AND anulado_at IS NULL`);
      await c.rpc("unirse_a_mesa", { _qr_token: qrMesa(MESA)!, _alias: "Clienta" });
      const cot = (await c.rpc("cotizar", { _qr_token: qrMesa(MESA)!, _items: [{ menu_item_id: agua, quantity: 1 }] })).data as { id: string };
      const pago = await pagarCotizacion(token, cot.id);
      expect(pago.status, pago.cuerpo).toBe(200);
      const raspe = sql(`SELECT id FROM raspes WHERE user_id = '${yo}' AND anulado_at IS NULL`);
      expect(raspe).not.toBe("");
      const dev = await llamarFuncion("refund-payment", { payment_id: (JSON.parse(pago.cuerpo).payment as { id: string }).id, reason: "Compuerta: devolver con raspe pendiente" }, (await conSesion("cashier")).token);
      expect(dev.status, dev.cuerpo).toBe(200);
      expect((await c.rpc("raspar", { _raspe_id: raspe })).error?.message).toContain("ya no está disponible");
      expect(((await c.rpc("mis_raspes", { _tenant_id: DEMO.tenant })).data as { pendientes: unknown[] }).pendientes).toHaveLength(0);
      expect(await auditorias()).toEqual([]);
    });
  });

  it("las tres auditorías salen vacías", async () => {
    expect(await auditorias()).toEqual([]);
  });

  it.skipIf(!esBaseLocal)("y detectan lo de la fase 7 cuando algo no calza (se descuadra a propósito y se deshace)", async () => {
    const salida = sqlSesion(`
      BEGIN;
      SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT user_id FROM platform_admins LIMIT 1), 'role', 'authenticated')::text, true) IS NULL;
      -- Más campañas que el límite, una parte que no suma (el descuento sin su uso lo revisa f7-2),
      -- un raspe ganador sin premio sobre el tope y un plan con un módulo que no existe
      INSERT INTO campanas (tenant_id, titulo, mensaje, publico, estado, enviada_at)
        SELECT '${DEMO.tenant}', 'Sabotaje ' || n, 'Más campañas que el límite', 'todos', 'enviada', now() FROM generate_series(1, 9) n;
      UPDATE partes_plato SET monto = monto + 100 WHERE id = (SELECT id FROM partes_plato WHERE estado = 'pagada' LIMIT 1);
      UPDATE raspes SET gano = true, premio_id = NULL, anulado_at = NULL, tope = 0 WHERE id = (SELECT id FROM raspes ORDER BY created_at DESC LIMIT 1);
      UPDATE plans SET features = features || '{"cripto": true}' WHERE name = 'chico';
      SELECT 'hallazgo:' || tipo FROM auditoria_operacion();
      SELECT 'hallazgo:' || tipo FROM auditoria_plata();
      SELECT 'hallazgo:' || tipo FROM auditoria_seguridad();
      ROLLBACK;`);
    for (const t of ["campanas_sobre_limite", "parte_no_calza", "raspe_incoherente", "raspe_sobre_tope", "modulo_desconocido"]) {
      expect(salida, t).toContain(`hallazgo:${t}`);
    }
  });
});
