import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  anonimo, conSesion, confirmarPresencia, esBaseLocal, FUNCIONES, guardarCuenta, hayCredenciales, invitado, llamarFuncion, qrMesa,
  CLAVE_PUBLICA, DEMO,
} from "./entorno";

// Fase 4.7 — Compuerta del dinero real. Los casos difíciles de la fase 4 que faltaban (los demás están en
// f4-1 a f4-6), el aislamiento de todo lo nuevo y las tres auditorías: después de todo, tienen que salir
// vacías, y tienen que detectar un descuadre hecho a propósito.

const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();
const sqlSesion = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1"], { input: q }).toString().trim();
const APP = "http://localhost:8080";

describe.skipIf(!hayCredenciales)("compuerta del dinero real", () => {
  let superadmin: SupabaseClient;
  let dueno: SupabaseClient;
  let tokenDueno: string;
  let caja: SupabaseClient;
  let tokenCaja: string;
  let mozo: SupabaseClient;
  let agua: string;
  const idMesa = async (n: number) => (await dueno.from("tables").select("id").eq("branch_id", DEMO.sucursal).eq("number", n).single()).data!.id as string;
  const liberar = async (n: number) => dueno.rpc("cerrar_mesa", { _table_id: await idMesa(n), _motivo: "preparar prueba" });
  const comensalEn = async (mesa: number) => {
    const c = await invitado();
    await c.rpc("unirse_a_mesa", { _qr_token: qrMesa(mesa)! });
    await confirmarPresencia(c, mesa);
    return { c, token: (await c.auth.getSession()).data.session!.access_token };
  };
  const cobroEnEfectivo = async (mesa: number, metodo: "cash" | "transfer" = "cash") => {
    const { c } = await comensalEn(mesa);
    const p = (await c.rpc("pedir_sin_pagar", { _qr_token: qrMesa(mesa)!, _items: [{ menu_item_id: agua, quantity: 1 }], _forma: "mozo" })).data as { order_id: string; total: number };
    const r = (await mozo.rpc("registrar_cobro_mozo", { _order_ids: [p.order_id], _metodo: metodo })).data as { payment_id: string; total: number };
    return r;
  };
  const conexionActiva = async () =>
    (await dueno.from("conexiones_pago").select("id").eq("branch_id", DEMO.sucursal).eq("estado", "activa")).data ?? [];
  const desconectarTodo = async () => {
    for (const c of await conexionActiva()) await dueno.rpc("desconectar_pago", { _conexion_id: c.id });
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
    ({ cliente: dueno, token: tokenDueno } = await conSesion("owner"));
    ({ cliente: caja, token: tokenCaja } = await conSesion("cashier"));
    mozo = (await conSesion("waiter")).cliente;
    agua = (await anonimo().from("menu_items").select("id").eq("tenant_id", DEMO.tenant).eq("name", "Agua mineral").single()).data!.id;
  });

  it("dos veces 'conectar Webpay' al mismo tiempo: queda una sola pasarela activa; y la vuelta repetida de Webpay no cobra dos veces", async () => {
    await desconectarTodo();
    try {
      const cuerpo = { branch_id: DEMO.sucursal, proveedor: "transbank", ambiente: "integracion", usar_claves_de_prueba: true };
      const [a, b] = await Promise.all([llamarFuncion("conectar-pago", cuerpo, tokenDueno), llamarFuncion("conectar-pago", cuerpo, tokenDueno)]);
      expect([a.status, b.status]).toContain(200);
      expect(await conexionActiva()).toHaveLength(1);

      // El cliente sale a Webpay; la vuelta llega dos veces al mismo tiempo (doble clic, recarga)
      await liberar(4);
      const { c, token } = await comensalEn(4);
      const r = await fetch(`${FUNCIONES}/process-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: CLAVE_PUBLICA, Authorization: `Bearer ${token}`, Origin: APP },
        body: JSON.stringify({ table_token: qrMesa(4), method: "card", tip_amount: 0, cart_items: [{ menu_item_id: agua, quantity: 1 }], idempotency_key: `compuerta4-${Date.now()}` }),
      });
      const p = await r.json() as { intento_id: string; redirigir: { campos: { token_ws: string } } };
      const tbk = p.redirigir.campos.token_ws;
      const volver = () => fetch(`${FUNCIONES}/pago-retorno?v=checkout`, {
        method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", apikey: CLAVE_PUBLICA },
        body: new URLSearchParams({ token_ws: tbk }).toString(),
      });
      const [v1, v2] = await Promise.all([volver(), volver()]);
      expect([v1.status, v2.status]).toEqual([303, 303]);
      // Sin pagar en Webpay: queda rechazado una sola vez y no hay pago
      expect(((await c.rpc("resultado_intento", { _intento_id: p.intento_id })).data as { estado: string }).estado).toBe("rechazado");
      expect((await dueno.from("payments").select("id").contains("provider_payload", { token: tbk })).data ?? []).toHaveLength(0);
    } finally {
      await desconectarTodo();
      await liberar(4);
    }
  });

  it("la boleta marcada por dos personas al mismo tiempo, y la misma excepción resuelta dos veces a la vez: una sola constancia", async () => {
    await liberar(8);
    const a = await cobroEnEfectivo(8);
    const [m1, m2] = await Promise.all([
      mozo.rpc("marcar_boleta", { _pago_id: a.payment_id, _folio: "1" }),
      caja.rpc("marcar_boleta", { _pago_id: a.payment_id, _folio: "2" }),
    ]);
    expect([m1.error, m2.error]).toEqual([null, null]);
    expect([m1.data, m2.data].filter((d) => (d as { ya_estaba: boolean }).ya_estaba)).toHaveLength(1);
    expect((await dueno.from("audit_logs").select("id").eq("entity_id", a.payment_id).eq("action", "boleta_entregada")).data).toHaveLength(1);

    if (esBaseLocal) {
      const b = await cobroEnEfectivo(8);
      sql(`UPDATE payments SET dia_negocio = dia_negocio - 1 WHERE id = '${b.payment_id}'`);
      try {
        const resolver = () => caja.rpc("resolver_excepcion", { _tipo: "boleta_atrasada", _id: b.payment_id, _accion: "no_entregada", _nota: "El cliente se fue antes" });
        const [r1, r2] = await Promise.all([resolver(), resolver()]);
        expect([r1.data, r2.data].filter((d) => (d as { resuelta: boolean })?.resuelta)).toHaveLength(1);
        expect((await dueno.from("audit_logs").select("id").eq("entity_id", b.payment_id).eq("action", "excepcion_resuelta")).data).toHaveLength(1);
      } finally {
        sql(`UPDATE payments SET dia_negocio = dia_negocio + 1 WHERE id = '${b.payment_id}'`);
      }
    }
    await liberar(8);
  });

  it("una transferencia devuelta en el local: la caja la resta de la transferencia, no del efectivo", async () => {
    await liberar(8);
    const antes = (await caja.rpc("resumen_caja", { _branch_id: DEMO.sucursal })).data as { efectivo: { esperado: number }; transferencia: { devuelto: number; esperado: number }; total_neto: number };
    const t = await cobroEnEfectivo(8, "transfer");
    const r = await llamarFuncion("refund-payment", { payment_id: t.payment_id, reason: "Se equivocó de mesa al transferir" }, tokenCaja);
    expect(r.status, r.cuerpo).toBe(200);
    expect(JSON.parse(r.cuerpo)).toMatchObject({ devolucion: "local", fully_refunded: true });
    const despues = (await caja.rpc("resumen_caja", { _branch_id: DEMO.sucursal })).data as typeof antes;
    expect(despues.transferencia.devuelto - antes.transferencia.devuelto).toBe(t.total);
    expect(despues.transferencia.esperado).toBe(antes.transferencia.esperado);
    expect(despues.efectivo.esperado).toBe(antes.efectivo.esperado);
    expect(despues.total_neto).toBe(antes.total_neto);
    await liberar(8);
  });

  it.skipIf(!esBaseLocal)("un cliente que pagó con la app y borró su cuenta: la plata del local queda intacta y cuadrada", async () => {
    await liberar(9);
    const c = await invitado();
    await guardarCuenta(c, `compuerta-${Date.now()}@demo.tablio.test`);
    await c.rpc("unirse_a_mesa", { _qr_token: qrMesa(9)! });
    await confirmarPresencia(c, 9);
    const token = (await c.auth.getSession()).data.session!.access_token;
    const pago = await llamarFuncion("process-payment", { table_token: qrMesa(9), method: "card", tip_amount: 500, cart_items: [{ menu_item_id: agua, quantity: 1 }], idempotency_key: `compuerta-borrar-${Date.now()}` }, token);
    const { payment } = JSON.parse(pago.cuerpo) as { payment: { id: string; amount: number } };
    await c.rpc("guardar_consentimiento", { _promociones: true });
    expect((await llamarFuncion("borrar-mi-cuenta", { confirmar: true }, token)).status).toBe(200);
    // El pago sigue ahí, sin la persona, y se puede reembolsar
    expect(sql(`SELECT amount || '|' || coalesce(user_id::text, 'sin-persona') FROM payments WHERE id = '${payment.id}'`)).toBe(`${payment.amount}|sin-persona`);
    const r = await llamarFuncion("refund-payment", { payment_id: payment.id, reason: "Prueba de compuerta tras borrar la cuenta" }, tokenCaja);
    expect(r.status, r.cuerpo).toBe(200);
    expect(await auditorias()).toEqual([]);
    await liberar(9);
  });

  it("todo lo nuevo de la fase 4 está aislado: el dueño de otro local, un comensal y alguien sin sesión no ven datos del demo", async () => {
    const tablas = ["conexiones_pago", "diferencias_pasarela", "liquidaciones_propina", "payments", "refunds"] as const;
    const mirones: [string, SupabaseClient][] = [["comensal", await invitado()], ["anónimo", anonimo()], ["mozo", mozo]];
    if (process.env.DEMO_CREDENCIALES) mirones.push(["dueño de otro local", (await conSesion("owner_ajeno")).cliente]);
    for (const [quien, c] of mirones) {
      for (const t of tablas) {
        // La mozo ve sus propios pagos de propina ("Mis propinas"); eso se revisa aparte
        if (quien === "mozo" && t === "liquidaciones_propina") continue;
        const { data } = await c.from(t as never).select("tenant_id").eq("tenant_id", DEMO.tenant).limit(1);
        expect(data ?? [], `${quien} lee ${t}`).toHaveLength(0);
      }
      for (const [fn, args] of [
        ["excepciones_caja", { _branch_id: DEMO.sucursal }],
        ["boletas_pendientes", { _branch_id: DEMO.sucursal }],
        ["propinas_por_pagar", { _branch_id: DEMO.sucursal }],
        ["resumen_caja", { _branch_id: DEMO.sucursal }],
        ["desconectar_pago", { _conexion_id: DEMO.sucursal }],
      ] as const) {
        expect((await c.rpc(fn as never, args as never)).error, `${quien} → ${fn}`).not.toBeNull();
      }
      // La función que conecta una pasarela tampoco le responde
      const s = (await c.auth.getSession()).data.session;
      const r = await llamarFuncion("conectar-pago", { branch_id: DEMO.sucursal, proveedor: "transbank", usar_claves_de_prueba: true }, s?.access_token);
      expect([401, 403], `${quien} → conectar-pago`).toContain(r.status);
    }
    // La mozo solo ve los pagos de propina que son suyos
    const yo = (await mozo.auth.getUser()).data.user!.id;
    const miFicha = (await dueno.from("staff_users").select("id").eq("auth_user_id", yo).single()).data!.id;
    const deLaMozo = (await mozo.from("liquidaciones_propina").select("staff_id")).data ?? [];
    expect(deLaMozo.every((l) => l.staff_id === miFicha)).toBe(true);
    // Nadie lee el consentimiento de otra persona (ni el dueño)
    expect((await dueno.from("consentimientos_comensal").select("user_id").limit(1)).data ?? []).toHaveLength(0);
  });

  it("después de todos los casos difíciles, las tres auditorías salen vacías y solo las corre el superadmin", async () => {
    expect(await auditorias()).toEqual([]);
    for (const c of [dueno, caja, mozo, anonimo()]) {
      for (const fn of ["auditoria_seguridad", "auditoria_plata", "auditoria_operacion"] as const) {
        expect((await c.rpc(fn)).error, fn).not.toBeNull();
      }
    }
  });

  it.skipIf(!esBaseLocal)("las auditorías sí detectan cuando algo de la fase 4 no calza (se descuadra a propósito y se deshace)", async () => {
    const pagoApp = sql(`SELECT id FROM payments WHERE branch_id = '${DEMO.sucursal}' AND provider = 'simulated' ORDER BY created_at DESC LIMIT 1`);
    const intento = sql(`SELECT id FROM intentos_pago ORDER BY created_at DESC LIMIT 1`);
    const ajena = sql(`SELECT id FROM branches WHERE tenant_id <> '${DEMO.tenant}' LIMIT 1`);
    const invitadoId = (await (await invitado()).auth.getUser()).data.user!.id;
    const salida = sqlSesion(`
      BEGIN;
      SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT user_id FROM platform_admins LIMIT 1), 'role', 'authenticated')::text, true) IS NULL;
      -- Un pago con Transbank sin su número de Webpay, y un intento que salió a la pasarela sin conexión
      UPDATE payments SET provider = 'transbank', provider_payload = '{}'::jsonb WHERE id = '${pagoApp}';
      UPDATE intentos_pago SET token_externo = 'tbk-sabotaje-${Date.now()}', conexion_id = NULL WHERE id = '${intento}';
      -- Una pasarela activa sin clave, y otra desconectada hace 200 días que conserva la suya
      INSERT INTO conexiones_pago (tenant_id, branch_id, proveedor, ambiente, estado, etiqueta, secreto_id)
        VALUES ('${DEMO.tenant}', '${DEMO.sucursal}', 'transbank', 'integracion', 'activa', 'sabotaje', NULL);
      INSERT INTO conexiones_pago (tenant_id, branch_id, proveedor, ambiente, estado, etiqueta, secreto_id, desconectado_at)
        VALUES ('${DEMO.tenant}', '${DEMO.sucursal}', 'transbank', 'integracion', 'desconectada', 'sabotaje vieja',
                (SELECT id FROM vault.secrets LIMIT 1), now() - interval '200 days');
      -- Un cobro simulado en un local que no lo permite
      UPDATE branches SET pagos_simulados = false WHERE id = '${ajena}';
      UPDATE payments SET provider = 'simulated' WHERE id = (SELECT id FROM payments WHERE branch_id = '${ajena}' LIMIT 1);
      INSERT INTO payments (tenant_id, branch_id, amount, tip_amount, method, status, provider)
        SELECT tenant_id, id, 1000, 0, 'card', 'approved', 'simulated' FROM branches WHERE id = '${ajena}'
         AND NOT EXISTS (SELECT 1 FROM payments WHERE branch_id = '${ajena}');
      -- Una diferencia con la pasarela anotada en otro local
      INSERT INTO diferencias_pasarela (tenant_id, branch_id, payment_id, dia, monto, detalle)
        SELECT b.tenant_id, b.id, '${pagoApp}', current_date, 1, 'sabotaje' FROM branches b WHERE b.id = '${ajena}';
      -- Un invitado con consentimiento para promociones
      INSERT INTO consentimientos_comensal (user_id, promociones, politica_version) VALUES ('${invitadoId}', true, '2026-10-15');
      SELECT 'hallazgo:' || tipo FROM auditoria_plata();
      SELECT 'hallazgo:' || tipo FROM auditoria_operacion();
      ROLLBACK;`);
    const tipos = new Set(salida.split("\n").filter((l) => l.startsWith("hallazgo:")).map((l) => l.slice(9)));
    for (const t of ["pago_pasarela_sin_rastro", "intento_sin_conexion", "conexion_sin_clave", "clave_vencida",
      "pago_simulado_en_local_real", "diferencia_de_otro_local", "consentimiento_sin_cuenta"]) {
      expect(tipos.has(t), t).toBe(true);
    }
    expect(await auditorias()).toEqual([]);
  });
});
