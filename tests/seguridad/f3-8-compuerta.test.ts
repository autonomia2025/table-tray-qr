import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  anonimo, confirmarPresencia, conSesion, esBaseLocal, guardarCuenta, hayCredenciales, invitado, llamarFuncion, qrMesa, DEMO,
} from "./entorno";

// Fase 3.8 — Compuerta de la fase 3. Casos que cruzan varias partes (mesas unidas, turnos, propinas,
// estaciones, sellos, código de presencia), aislamiento por local de todo lo nuevo y la auditoría
// automática de la operación: después de todo, tiene que salir vacía.

const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sqlSesion = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1"], { input: q }).toString().trim();
const hoy = () => new Date(Date.now() - 6 * 3_600_000).toLocaleDateString("en-CA", { timeZone: "America/Santiago" });

describe.skipIf(!hayCredenciales)("compuerta de la fase 3", () => {
  let superadmin: SupabaseClient;
  let dueno: SupabaseClient;
  let mozo: SupabaseClient;
  let cocina: SupabaseClient;
  let miFicha: string;
  const ids: Record<string, string> = {};
  const idMesa = async (n: number) => (await dueno.from("tables").select("id").eq("branch_id", DEMO.sucursal).eq("number", n).single()).data!.id as string;

  beforeAll(async () => {
    superadmin = (await conSesion("superadmin")).cliente;
    dueno = (await conSesion("owner")).cliente;
    mozo = (await conSesion("waiter")).cliente;
    cocina = (await conSesion("kitchen")).cliente;
    const yo = (await mozo.auth.getUser()).data.user!.id;
    miFicha = (await dueno.from("staff_users").select("id").eq("tenant_id", DEMO.tenant).eq("auth_user_id", yo).single()).data!.id;
    const { data } = await anonimo().from("menu_items").select("id, name").eq("tenant_id", DEMO.tenant);
    for (const p of data ?? []) ids[p.name] = p.id;
  });

  it("mesas unidas de punta a punta: quien paga desde la secundaria cae en la principal, con propina para la mozo, su turno, cada estación a su ritmo y su sello", async () => {
    const [seis, siete] = [await idMesa(6), await idMesa(7)];
    // Parte sin mesas a cargo de la mozo (para poder terminar su turno al final)
    const { data: suyas } = await dueno.from("tables").select("id").eq("assigned_waiter_id", miFicha);
    for (const m of [seis, siete, ...(suyas ?? []).map((x) => x.id)]) await dueno.rpc("cerrar_mesa", { _table_id: m, _motivo: "preparar prueba" });
    try {
      // La mozo toma la 6 (sin turno: se abre solo) y le une la 7
      expect((await mozo.rpc("tomar_mesa", { _table_id: seis })).error).toBeNull();
      const turno = (await mozo.rpc("mi_turno", { _branch_id: DEMO.sucursal })).data as { turno_id: string } | null;
      expect(turno?.turno_id).toBeTruthy();
      expect((await mozo.rpc("unir_mesas", { _principal: seis, _secundaria: siete })).error).toBeNull();

      // Un cliente escanea el QR de la 7 y paga un Barros Luco (cocina) y un agua (barra) con propina
      const c = await invitado();
      if (esBaseLocal) await guardarCuenta(c, `compuerta-${Date.now()}@demo.tablio.test`);
      await c.rpc("unirse_a_mesa", { _qr_token: qrMesa(7)! });
      const token = (await c.auth.getSession()).data.session!.access_token;
      const r = await llamarFuncion("process-payment", {
        table_token: qrMesa(7), method: "card", tip_amount: 1000,
        cart_items: [{ menu_item_id: ids["Barros Luco"], quantity: 1 }, { menu_item_id: ids["Agua mineral"], quantity: 1 }],
        idempotency_key: `compuerta-${Date.now()}`,
      }, token);
      expect(r.status).toBe(200);
      const { payment, order } = JSON.parse(r.cuerpo) as { payment: { id: string }; order: { id: string } };
      const { data: pago } = await dueno.from("payments").select("table_id, staff_id, turno_id").eq("id", payment.id).single();
      expect(pago).toMatchObject({ table_id: seis, staff_id: miFicha, turno_id: turno!.turno_id });

      // La barra deja lista el agua: el pedido sigue "en cocina" hasta que el Barros Luco esté listo
      const { data: items } = await dueno.from("order_items").select("id, menu_item_name, station_id").eq("order_id", order.id);
      const barra = items!.find((i) => i.menu_item_name === "Agua mineral")!.station_id;
      const cocinaEst = items!.find((i) => i.menu_item_name === "Barros Luco")!.station_id;
      expect(barra).not.toBe(cocinaEst);
      expect((await cocina.rpc("cambiar_estado_pedido", { _order_id: order.id, _estado: "ready", _station_id: barra })).error).toBeNull();
      expect((await dueno.from("orders").select("status").eq("id", order.id).single()).data!.status).toBe("confirmed");
      expect((await mozo.rpc("cambiar_estado_pedido", { _order_id: order.id, _estado: "delivered" })).error).toBeNull();
      expect((await cocina.rpc("cambiar_estado_pedido", { _order_id: order.id, _estado: "ready", _station_id: cocinaEst })).error).toBeNull();
      expect((await mozo.rpc("cambiar_estado_pedido", { _order_id: order.id, _estado: "delivered" })).error).toBeNull();
      expect((await dueno.from("orders").select("status").eq("id", order.id).single()).data!.status).toBe("delivered");

      // El sello quedó a su nombre (solo con cuenta verificada: en la base desechable)
      if (esBaseLocal) {
        const t = (await c.rpc("mis_sellos", { _tenant_id: DEMO.tenant, _branch_id: DEMO.sucursal })).data as { total: number };
        expect(t.total).toBe(1);
      }

      // Con mesas a cargo no termina el turno; al cerrar la principal, la 7 queda libre y separada
      expect((await mozo.rpc("cerrar_turno", {})).error).not.toBeNull();
      expect((await mozo.rpc("cerrar_mesa", { _table_id: seis })).error).toBeNull();
      const { data: mesas } = await dueno.from("tables").select("id, status, unida_a").in("id", [seis, siete]);
      expect(mesas!.every((m) => m.status === "free" && m.unida_a === null)).toBe(true);
      expect((await mozo.rpc("cerrar_turno", {})).error).toBeNull();
    } finally {
      await dueno.rpc("cerrar_mesa", { _table_id: seis, _motivo: "fin de la prueba" });
      await dueno.rpc("cerrar_mesa", { _table_id: siete, _motivo: "fin de la prueba" });
    }
  });

  it("al mismo tiempo: dos mozos toman la misma mesa (gana uno) y la cocina marca listo mientras se cancela (queda coherente)", async () => {
    const tres = await idMesa(3);
    await dueno.rpc("cerrar_mesa", { _table_id: tres, _motivo: "preparar prueba" });
    const otro = (await conSesion("owner")).cliente; // el dueño también puede tomar mesas
    const [a, b] = await Promise.all([mozo.rpc("tomar_mesa", { _table_id: tres }), otro.rpc("tomar_mesa", { _table_id: tres })]);
    const { data: mesa } = await dueno.from("tables").select("assigned_waiter_id").eq("id", tres).single();
    expect(mesa!.assigned_waiter_id).toBeTruthy();
    expect([a.error, b.error].filter((e) => e === null).length).toBeGreaterThanOrEqual(1);

    const c = await invitado();
    await c.rpc("unirse_a_mesa", { _qr_token: qrMesa(3)! });
    const token = (await c.auth.getSession()).data.session!.access_token;
    const r = await llamarFuncion("process-payment", {
      table_token: qrMesa(3), method: "card", cart_items: [{ menu_item_id: ids["Chacarero"], quantity: 1 }], idempotency_key: `carrera-${Date.now()}`,
    }, token);
    const pedido = JSON.parse(r.cuerpo).order.id as string;
    await Promise.all([
      cocina.rpc("cambiar_estado_pedido", { _order_id: pedido, _estado: "ready" }),
      dueno.rpc("cambiar_estado_pedido", { _order_id: pedido, _estado: "cancelled", _motivo: "Prueba de carrera" }),
    ]);
    const { data: o } = await dueno.from("orders").select("status").eq("id", pedido).single();
    const { data: its } = await dueno.from("order_items").select("status").eq("order_id", pedido);
    // Termine como termine, el pedido dice lo mismo que sus productos
    const vivos = its!.filter((i) => i.status !== "cancelled");
    expect(o!.status).toBe(vivos.length === 0 ? "cancelled" : vivos[0].status);
    await dueno.rpc("cerrar_mesa", { _table_id: tres, _motivo: "fin de la prueba" });
  });

  it("todo lo nuevo de la fase 3 está aislado: el dueño de otro local, un comensal y alguien sin sesión no ven datos del demo", async () => {
    const tablas = ["turnos", "stations", "metas_mozo", "suscripciones_push", "codigos_mesa", "movimientos_lealtad",
      "comensales_mesa", "loyalty_rewards", "loyalty_customers", "table_events"] as const;
    const mirones: [string, SupabaseClient][] = [["comensal", await invitado()], ["anónimo", anonimo()]];
    if (process.env.DEMO_CREDENCIALES) mirones.push(["dueño de otro local", (await conSesion("owner_ajeno")).cliente]);
    for (const [quien, c] of mirones) {
      for (const t of tablas) {
        const { data } = await c.from(t).select("tenant_id").eq("tenant_id", DEMO.tenant).limit(1);
        expect(data ?? [], `${quien} lee ${t}`).toHaveLength(0);
      }
      // Y las funciones de la fase 3 no le responden con datos del demo
      for (const [fn, args] of [
        ["ranking_equipo", { _branch_id: DEMO.sucursal, _desde: hoy(), _hasta: hoy() }],
        ["turnos_sucursal", { _branch_id: DEMO.sucursal, _desde: hoy(), _hasta: hoy() }],
        ["riesgo_cuenta_abierta", { _branch_id: DEMO.sucursal }],
        ["reporte_local", { _branch_id: DEMO.sucursal, _desde: hoy(), _hasta: hoy() }],
        ["historia_del_local", { _branch_id: DEMO.sucursal }],
        ["premios_por_entregar", { _tenant_id: DEMO.tenant }],
        ["cambiar_codigos_mesa", { _branch_id: DEMO.sucursal }],
        ["premios_en_mesa", { _table_id: await idMesa(1) }],
      ] as const) {
        expect((await c.rpc(fn as never, args as never)).error, `${quien} → ${fn}`).not.toBeNull();
      }
    }
  });

  it("la auditoría de la operación sale vacía y solo la ve el superadmin", async () => {
    const { data, error } = await superadmin.rpc("auditoria_operacion");
    expect(error).toBeNull();
    expect(data ?? [], JSON.stringify(data)).toHaveLength(0);
    expect((await dueno.rpc("auditoria_operacion")).error).not.toBeNull();
    expect((await mozo.rpc("auditoria_operacion")).error).not.toBeNull();
    expect((await anonimo().rpc("auditoria_operacion")).error).not.toBeNull();
    // Las otras dos auditorías también siguen vacías después de toda la fase 3
    expect((await superadmin.rpc("auditoria_plata")).data ?? []).toHaveLength(0);
    expect((await superadmin.rpc("auditoria_seguridad")).data ?? []).toHaveLength(0);
  });

  it.skipIf(!esBaseLocal)("la auditoría sí detecta cuando algo no calza (se descuadra a propósito y se deshace)", async () => {
    // Datos para descuadrar: un pago con propina (la mozo tomó la mesa), un pedido, una ficha con sello
    const nueve = await idMesa(9);
    await dueno.rpc("cerrar_mesa", { _table_id: nueve, _motivo: "preparar prueba" });
    expect((await mozo.rpc("tomar_mesa", { _table_id: nueve })).error).toBeNull();
    const c = await invitado();
    await guardarCuenta(c, `sabotaje-${Date.now()}@demo.tablio.test`);
    await c.rpc("unirse_a_mesa", { _qr_token: qrMesa(9)! });
    await confirmarPresencia(c, 9);
    const token = (await c.auth.getSession()).data.session!.access_token;
    const r = await llamarFuncion("process-payment", {
      table_token: qrMesa(9), method: "card", tip_amount: 500, cart_items: [{ menu_item_id: ids["Barros Luco"], quantity: 1 }],
      idempotency_key: `sabotaje-op-${Date.now()}`,
    }, token);
    const { payment, order } = JSON.parse(r.cuerpo) as { payment: { id: string }; order: { id: string } };
    const salida = sqlSesion(`
      BEGIN;
      SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT user_id FROM platform_admins LIMIT 1), 'role', 'authenticated')::text, true) IS NULL;
      UPDATE payments SET staff_id = (SELECT id FROM staff_users WHERE tenant_id = '${DEMO.tenant}' AND role = 'kitchen' LIMIT 1) WHERE id = '${payment.id}';
      UPDATE orders SET status = 'delivered' WHERE id = '${order.id}';
      UPDATE order_items SET status = 'delivered', ready_at = NULL WHERE order_id = '${order.id}';
      UPDATE orders SET status = 'ready' WHERE id = '${order.id}';
      UPDATE table_sessions SET closed_at = now() WHERE id = (SELECT session_id FROM orders WHERE id = '${order.id}');
      UPDATE tables SET status = 'free' WHERE id = (SELECT table_id FROM orders WHERE id = '${order.id}');
      DELETE FROM codigos_mesa WHERE table_id = (SELECT id FROM tables WHERE branch_id = '${DEMO.sucursal}' AND number = 2);
      -- Una cadena (la 5 unida a la 4, que a su vez está unida a la 3): incoherente esté como esté cada mesa
      UPDATE tables SET unida_a = (SELECT id FROM tables WHERE branch_id = '${DEMO.sucursal}' AND number = 3)
       WHERE branch_id = '${DEMO.sucursal}' AND number = 4;
      UPDATE tables SET unida_a = (SELECT id FROM tables WHERE branch_id = '${DEMO.sucursal}' AND number = 4), status = 'occupied'
       WHERE branch_id = '${DEMO.sucursal}' AND number = 5;
      UPDATE loyalty_customers SET visits = visits + 3 WHERE user_id = (SELECT user_id FROM payments WHERE id = '${payment.id}');
      -- Lo que sigue lo impiden disparadores (anular el sello, proteger la estación principal): se apagan
      -- solo en esta sesión para comprobar que la auditoría lo detectaría igual
      SET LOCAL session_replication_role = replica;
      UPDATE payments SET status = 'refunded' WHERE id = '${payment.id}';
      UPDATE stations SET es_predeterminada = false WHERE branch_id = '${DEMO.sucursal}';
      SELECT 'hallazgo:' || tipo FROM auditoria_operacion();
      ROLLBACK;`);
    const tipos = new Set(salida.split("\n").filter((l) => l.startsWith("hallazgo:")).map((l) => l.slice(9)));
    for (const t of ["propina_sin_mozo_del_local", "turno_de_otro_mozo", "estado_pedido_no_calza", "producto_sin_tiempos",
      "sesion_incoherente", "mesa_libre_con_sesion", "mesa_sin_codigo", "mesa_unida_incoherente", "visitas_no_calzan",
      "sello_incoherente", "estacion_principal"]) {
      expect(tipos.has(t), t).toBe(true);
    }
    // Y todo volvió a como estaba
    await dueno.rpc("cerrar_mesa", { _table_id: nueve, _motivo: "fin de la prueba" });
    await mozo.rpc("cerrar_turno", {});
    expect((await superadmin.rpc("auditoria_operacion")).data ?? []).toHaveLength(0);
  });
});
