import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonimo, conSesion, confirmarPresencia, esBaseLocal, hayCredenciales, invitado, llamarFuncion, qrMesa, DEMO } from "./entorno";

// Fase 4.6 — Excepciones de la caja (brief 5.4): pago sin pedido, monto que no calza, boleta sin marcar y
// reembolso rechazado. Cada devolución automática queda anotada; lo que la app no resuelve sola aparece en
// una bandeja para la caja, que lo resuelve con una explicación que queda en la auditoría.

const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();

type Excepcion = { tipo: string; id: string; monto: number; mesa: number | null; detalle: string; pago_id?: string };

describe.skipIf(!hayCredenciales)("excepciones de la caja", () => {
  let dueno: SupabaseClient;
  let caja: SupabaseClient;
  let mozo: SupabaseClient;
  let cocina: SupabaseClient;
  let agua: string;
  const idMesa = async (n: number) => (await dueno.from("tables").select("id").eq("branch_id", DEMO.sucursal).eq("number", n).single()).data!.id as string;
  const liberar = async (n: number) => dueno.rpc("cerrar_mesa", { _table_id: await idMesa(n), _motivo: "preparar prueba" });
  const excepciones = async () => {
    const r = await caja.rpc("excepciones_caja", { _branch_id: DEMO.sucursal });
    expect(r.error).toBeNull();
    return r.data as unknown as Excepcion[];
  };
  const comensalEn = async (mesa: number) => {
    const c = await invitado();
    await c.rpc("unirse_a_mesa", { _qr_token: qrMesa(mesa)! });
    await confirmarPresencia(c, mesa);
    return { c, token: (await c.auth.getSession()).data.session!.access_token };
  };

  beforeAll(async () => {
    dueno = (await conSesion("owner")).cliente;
    caja = (await conSesion("cashier")).cliente;
    mozo = (await conSesion("waiter")).cliente;
    cocina = (await conSesion("kitchen")).cliente;
    agua = (await anonimo().from("menu_items").select("id").eq("tenant_id", DEMO.tenant).eq("name", "Agua mineral").single()).data!.id;
  });

  it("cuando la app devuelve un cobro sola, queda anotado cuánto y que se devolvió", async () => {
    await liberar(5);
    const a = await comensalEn(5);
    const b = await comensalEn(5);
    const pedido = (await mozo.rpc("crear_pedido_mozo", { _table_id: await idMesa(5), _items: [{ menu_item_id: agua, quantity: 1 }] })).data as { order_id: string; total: number };
    const cotA = (await a.c.rpc("cotizar", { _qr_token: qrMesa(5)!, _order_ids: [pedido.order_id] })).data as { id: string };
    const cotB = (await b.c.rpc("cotizar", { _qr_token: qrMesa(5)!, _order_ids: [pedido.order_id] })).data as { id: string };
    const clave = `exc-${Date.now()}`;
    expect((await llamarFuncion("process-payment", { table_token: qrMesa(5), method: "card", tip_amount: 300, cotizacion_id: cotA.id, idempotency_key: `${clave}-a` }, a.token)).status).toBe(200);
    const rb = await llamarFuncion("process-payment", { table_token: qrMesa(5), method: "card", tip_amount: 300, cotizacion_id: cotB.id, idempotency_key: `${clave}-b` }, b.token);
    expect(rb.status).toBe(409);
    if (esBaseLocal) {
      expect(sql(`SELECT estado || '|' || monto_devolver || '|' || devolucion_estado || '|' || devolucion_intentos FROM intentos_pago WHERE idempotency_key = '${clave}-b'`))
        .toBe(`reembolsado|${pedido.total + 300}|hecha|1`);
    }
    // Una devolución que resultó no es una excepción
    expect((await excepciones()).some((e) => e.tipo === "devolucion_fallida" && e.mesa === 5)).toBe(false);
    await liberar(5);
  });

  it.skipIf(!esBaseLocal)("pago sin pedido: si la pasarela no lo devuelve, aparece en la bandeja y se resuelve a mano con explicación", async () => {
    await liberar(5);
    const { c } = await comensalEn(5);
    const usuario = (await c.auth.getUser()).data.user!.id;
    const cot = (await c.rpc("cotizar", { _qr_token: qrMesa(5)!, _items: [{ menu_item_id: agua, quantity: 1 }] })).data as { id: string; subtotal: number };
    const intento = JSON.parse(sql(`SELECT reservar_intento_pago('${cot.id}', '${usuario}', 'exc-falla-${Date.now()}', 'card', 0)`)) as { id: string };
    // La pasarela cobró otro monto: se debe devolver; y la devolución falla 3 veces
    expect(JSON.parse(sql(`SELECT confirmar_pago('${intento.id}', true, ${cot.subtotal + 500}, 'transbank', 'TBK-X', '{}'::jsonb, NULL)`)).estado).toBe("reembolsado");
    for (let i = 0; i < 3; i++) sql(`SELECT _anotar_devolucion_intento('${intento.id}', false, NULL)`);
    expect(sql(`SELECT monto_devolver || '|' || devolucion_estado || '|' || devolucion_intentos FROM intentos_pago WHERE id = '${intento.id}'`)).toBe(`${cot.subtotal + 500}|fallida|3`);

    const e = (await excepciones()).find((x) => x.tipo === "devolucion_fallida" && x.id === intento.id);
    expect(e).toMatchObject({ monto: cot.subtotal + 500, mesa: 5 });
    // Nadie más lo ve ni lo resuelve
    for (const otro of [mozo, cocina, c]) {
      expect((await otro.rpc("excepciones_caja", { _branch_id: DEMO.sucursal })).error).not.toBeNull();
      expect((await otro.rpc("resolver_excepcion", { _tipo: "devolucion_fallida", _id: intento.id, _accion: "a_mano", _nota: "intento de otro" })).error).not.toBeNull();
    }
    expect((await anonimo().rpc("excepciones_caja", { _branch_id: DEMO.sucursal })).error).not.toBeNull();
    // Sin explicar no se resuelve; con explicación sí, y queda en la auditoría
    expect((await caja.rpc("resolver_excepcion", { _tipo: "devolucion_fallida", _id: intento.id, _accion: "a_mano" })).error?.message).toContain("Explica");
    expect((await caja.rpc("resolver_excepcion", { _tipo: "devolucion_fallida", _id: intento.id, _accion: "revisada", _nota: "acción equivocada" })).error).not.toBeNull();
    expect((await caja.rpc("resolver_excepcion", { _tipo: "devolucion_fallida", _id: intento.id, _accion: "a_mano", _nota: "Se le devolvió en efectivo en la caja" })).data).toMatchObject({ resuelta: true });
    expect((await caja.rpc("resolver_excepcion", { _tipo: "devolucion_fallida", _id: intento.id, _accion: "a_mano", _nota: "otra vez lo mismo" })).data).toMatchObject({ ya_estaba: true });
    expect(sql(`SELECT devolucion_estado FROM intentos_pago WHERE id = '${intento.id}'`)).toBe("a_mano");
    expect((await excepciones()).some((x) => x.id === intento.id)).toBe(false);
    const { data: log } = await dueno.from("audit_logs").select("metadata").eq("entity_id", intento.id).eq("action", "excepcion_resuelta");
    expect(log).toHaveLength(1);
    expect(JSON.stringify(log![0].metadata)).toContain("efectivo");
    await liberar(5);
  });

  it.skipIf(!esBaseLocal)("monto que no calza con la pasarela: queda guardado, se marca revisado con explicación y no se reabre", async () => {
    const pago = sql(`SELECT id FROM payments WHERE branch_id = '${DEMO.sucursal}' AND provider <> 'local' ORDER BY created_at DESC LIMIT 1`);
    const dia = sql(`SELECT dia_negocio FROM payments WHERE id = '${pago}'`);
    const anotar = (calza: boolean, transitorio = false) =>
      sql(`SELECT _anotar_conciliacion('${DEMO.sucursal}', '${dia}', '[{"pago_id":"${pago}","calza":${calza},"monto":5000,"detalle":"Transbank dice AUTHORIZED por 4000 y Tablio cobró 5000","transitorio":${transitorio}}]'::jsonb)`);
    sql(`DELETE FROM diferencias_pasarela WHERE payment_id = '${pago}'`);
    // "Transbank no respondió" no es una diferencia
    anotar(false, true);
    expect((await excepciones()).some((e) => e.tipo === "diferencia_pasarela" && e.pago_id === pago)).toBe(false);
    anotar(false);
    const e = (await excepciones()).find((x) => x.tipo === "diferencia_pasarela" && x.pago_id === pago);
    expect(e).toBeTruthy();
    // La caja la ve; el mozo no (ni la tabla)
    expect(((await caja.from("diferencias_pasarela" as never).select("id").eq("payment_id", pago)).data ?? [])).toHaveLength(1);
    expect(((await mozo.from("diferencias_pasarela" as never).select("id").eq("payment_id", pago)).data ?? [])).toHaveLength(0);
    // Nadie la escribe desde el navegador
    expect((await dueno.from("diferencias_pasarela" as never).update({ estado: "revisada" } as never).eq("id", e!.id)).error).not.toBeNull();
    expect((await caja.rpc("resolver_excepcion", { _tipo: "diferencia_pasarela", _id: e!.id, _accion: "revisada", _nota: "Revisado en el portal: propina cobrada aparte" })).data).toMatchObject({ resuelta: true });
    // Si la próxima conciliación dice lo mismo, sigue revisada (no vuelve a la bandeja)
    anotar(false);
    expect((await excepciones()).some((x) => x.id === e!.id)).toBe(false);
    expect(sql(`SELECT estado FROM diferencias_pasarela WHERE id = '${e!.id}'`)).toBe("revisada");
    // Y si después calza, queda corregida
    sql(`UPDATE diferencias_pasarela SET estado = 'abierta' WHERE id = '${e!.id}'`);
    anotar(true);
    expect(sql(`SELECT estado FROM diferencias_pasarela WHERE id = '${e!.id}'`)).toBe("corregida");
    sql(`DELETE FROM diferencias_pasarela WHERE id = '${e!.id}'`);
  });

  it.skipIf(!esBaseLocal)("boleta de un día anterior sin marcar: aparece y se resuelve (entregada o no entregada con motivo)", async () => {
    await liberar(7);
    const pagos: string[] = [];
    for (let i = 0; i < 2; i++) {
      const { c } = await comensalEn(7);
      const p = (await c.rpc("pedir_sin_pagar", { _qr_token: qrMesa(7)!, _items: [{ menu_item_id: agua, quantity: 1 }], _forma: "mozo" })).data as { order_id: string };
      pagos.push(((await caja.rpc("registrar_cobro_mozo", { _order_ids: [p.order_id], _metodo: "cash" })).data as { payment_id: string }).payment_id);
    }
    // Hoy no son excepción (están en "Boletas por entregar"); de un día anterior, sí
    expect((await excepciones()).some((e) => pagos.includes(e.id))).toBe(false);
    // (el día anterior está cerrado: se devuelven a hoy al terminar, o la compuerta de la plata vería un cierre que cambió)
    sql(`UPDATE payments SET dia_negocio = dia_negocio - 1 WHERE id IN ('${pagos.join("','")}')`);
    try {
      const lista = (await excepciones()).filter((e) => e.tipo === "boleta_atrasada" && pagos.includes(e.id));
      expect(lista).toHaveLength(2);

      expect((await caja.rpc("resolver_excepcion", { _tipo: "boleta_atrasada", _id: pagos[0], _accion: "entregada", _folio: "777" })).data).toMatchObject({ resuelta: true });
      expect((await caja.rpc("resolver_excepcion", { _tipo: "boleta_atrasada", _id: pagos[1], _accion: "no_entregada" })).error?.message).toContain("Explica");
      expect((await caja.rpc("resolver_excepcion", { _tipo: "boleta_atrasada", _id: pagos[1], _accion: "no_entregada", _nota: "El cliente se fue; se emitió en el sistema" })).data).toMatchObject({ resuelta: true });
      expect(sql(`SELECT string_agg(boleta_estado || ':' || coalesce(boleta_folio, '-'), ',' ORDER BY boleta_estado) FROM payments WHERE id IN ('${pagos.join("','")}')`)).toBe("entregada:777,no_entregada:-");
      expect((await excepciones()).some((e) => pagos.includes(e.id))).toBe(false);
    } finally {
      sql(`UPDATE payments SET dia_negocio = dia_negocio + 1 WHERE id IN ('${pagos.join("','")}')`);
    }
    await liberar(7);
  });

  it.skipIf(!esBaseLocal)("reembolso que la pasarela rechazó: aparece hasta que se reintenta o se descarta con motivo", async () => {
    const pago = sql(`SELECT id FROM payments WHERE branch_id = '${DEMO.sucursal}' AND status = 'approved' AND provider <> 'local' ORDER BY created_at DESC LIMIT 1`);
    const reembolso = sql(`INSERT INTO refunds (tenant_id, payment_id, amount, reason, status, authorized_by_name, devolucion)
                             VALUES ('${DEMO.tenant}', '${pago}', 1000, 'Producto agotado', 'failed', 'Caja Demo', 'pasarela') RETURNING id`).split("\n")[0];
    const e = (await excepciones()).find((x) => x.tipo === "reembolso_fallido" && x.id === reembolso);
    expect(e).toMatchObject({ monto: 1000, pago_id: pago, detalle: "Producto agotado" });
    expect((await caja.rpc("resolver_excepcion", { _tipo: "reembolso_fallido", _id: reembolso, _accion: "descartar", _nota: "El cliente aceptó otro plato" })).data).toMatchObject({ resuelta: true });
    expect((await excepciones()).some((x) => x.id === reembolso)).toBe(false);
    sql(`DELETE FROM refunds WHERE id = '${reembolso}'`);
  });

  it("la revisión con la pasarela se puede pedir desde la caja (no desde otro rol) y cuenta las devoluciones", async () => {
    const r = await llamarFuncion("revisar-pagos", { branch_id: DEMO.sucursal }, (await conSesion("cashier")).token);
    expect(r.status, r.cuerpo).toBe(200);
    expect(JSON.parse(r.cuerpo)).toMatchObject({ devueltos: expect.any(Number), sin_devolver: expect.any(Number) });
    expect((await llamarFuncion("revisar-pagos", { branch_id: DEMO.sucursal }, (await conSesion("waiter")).token)).status).toBe(403);
  });

  it.skipIf(!process.env.DEMO_CREDENCIALES)("el dueño de otro local no ve ni resuelve excepciones del demo", async () => {
    const ajeno = (await conSesion("owner_ajeno")).cliente;
    expect((await ajeno.rpc("excepciones_caja", { _branch_id: DEMO.sucursal })).error).not.toBeNull();
    const pago = (await dueno.from("payments").select("id").eq("branch_id", DEMO.sucursal).limit(1).single()).data!.id;
    expect((await ajeno.rpc("resolver_excepcion", { _tipo: "boleta_atrasada", _id: pago, _accion: "entregada" })).error).not.toBeNull();
  });

  it.skipIf(!esBaseLocal)("la auditoría de la plata detecta un cobro sin devolver por más de 7 días", async () => {
    const id = sql(`SELECT id FROM intentos_pago WHERE estado = 'reembolsado' ORDER BY resuelto_at DESC LIMIT 1`);
    const antes = sql(`SELECT coalesce(devolucion_estado, 'null') || '|' || resuelto_at FROM intentos_pago WHERE id = '${id}'`);
    sql(`UPDATE intentos_pago SET devolucion_estado = 'fallida', resuelto_at = now() - interval '8 days' WHERE id = '${id}'`);
    try {
      const { data } = await (await conSesion("superadmin")).cliente.rpc("auditoria_plata");
      expect((data as { tipo: string; objeto: string }[]).some((h) => h.tipo === "devolucion_sin_resolver" && h.objeto === id)).toBe(true);
    } finally {
      const [estado, cuando] = antes.split("|");
      sql(`UPDATE intentos_pago SET devolucion_estado = ${estado === "null" ? "NULL" : `'${estado}'`}, resuelto_at = '${cuando}' WHERE id = '${id}'`);
    }
  });
});
