import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonimo, conSesion, confirmarPresencia, esBaseLocal, hayCredenciales, invitado, llamarFuncion, qrMesa, DEMO } from "./entorno";

// Fase 7.2 — Beneficio de la campaña al pagar con el QR. Toca la plata: el descuento lo calcula la base al
// cotizar (nunca el navegador), nunca va sobre productos con alcohol, se usa una vez por persona (dos pagos
// a la vez: el segundo se devuelve solo), vence, respeta la compra mínima y queda cuadrado en la auditoría.
// Todo en la base desechable: manda campañas y paga.

const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();
const sqlSesion = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1"], { input: q }).toString().trim();
const MESA = 5;

type Cot = { id: string; subtotal: number; descuento: number; beneficio: string | null };

describe.skipIf(!hayCredenciales || !esBaseLocal)("beneficio de campaña al pagar con el QR", () => {
  let dueno: SupabaseClient;
  let tokenDueno: string;
  let cliente: SupabaseClient;
  let tokenCliente = "";
  let idCliente = "";
  let agua: { id: string; price: number };
  let schop: { id: string; price: number };
  let campana = "";
  const cotizar = async (c: SupabaseClient, items: { menu_item_id: string; quantity: number }[]) => {
    const r = await c.rpc("cotizar", { _qr_token: qrMesa(MESA)!, _items: items });
    expect(r.error, r.error?.message).toBeNull();
    return r.data as unknown as Cot;
  };
  const pagar = async (token: string, cotizacion: string, clave = `beneficio-${Date.now()}-${Math.random()}`) =>
    llamarFuncion("process-payment", { table_token: qrMesa(MESA), method: "card", tip_amount: 0, cotizacion_id: cotizacion, idempotency_key: clave }, token);
  const mandarCampana = async (beneficio: Record<string, unknown>) => {
    sql(`DELETE FROM campanas WHERE tenant_id = '${DEMO.tenant}'`);
    const id = (await dueno.rpc("guardar_campana", {
      _tenant_id: DEMO.tenant, _titulo: "Vuelve esta semana", _mensaje: "Te tenemos un regalo para tu próxima visita", _publico: "todos", ...beneficio,
    })).data as string;
    const r = await llamarFuncion("enviar-campana", { campana_id: id }, tokenDueno);
    expect(r.status, r.cuerpo).toBe(200);
    expect(JSON.parse(r.cuerpo).destinatarios).toBe(1);
    return id;
  };

  beforeAll(async () => {
    ({ cliente: dueno, token: tokenDueno } = await conSesion("owner"));
    ({ cliente, token: tokenCliente } = await conSesion("cliente"));
    idCliente = (await cliente.auth.getUser()).data.user!.id;
    const items = (await anonimo().from("menu_items").select("id, name, price").eq("tenant_id", DEMO.tenant)).data!;
    agua = items.find((i) => i.name === "Agua mineral")! as { id: string; price: number };
    schop = items.find((i) => i.name === "Schop Torobayo 500cc")! as { id: string; price: number };
    sql(`INSERT INTO configuracion_tablio (clave, valor) VALUES ('campanas', '{"desde_hora": 0, "hasta_hora": 24}')
         ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor;
         INSERT INTO consentimientos_comensal (user_id, promociones, politica_version) VALUES ('${idCliente}', true, 'prueba')
         ON CONFLICT (user_id) DO UPDATE SET promociones = true;
         UPDATE menu_items SET tiene_alcohol = true WHERE id = '${schop.id}';
         DELETE FROM campanas WHERE tenant_id = '${DEMO.tenant}';`);
    await (await conSesion("owner")).cliente.rpc("cerrar_mesa", {
      _table_id: (await dueno.from("tables").select("id").eq("branch_id", DEMO.sucursal).eq("number", MESA).single()).data!.id, _motivo: "preparar prueba",
    });
    await cliente.rpc("unirse_a_mesa", { _qr_token: qrMesa(MESA)! });
    await confirmarPresencia(cliente, MESA);
    campana = await mandarCampana({ _beneficio_tipo: "porcentaje", _beneficio_valor: 20, _beneficio_minimo: 0, _beneficio_dias: 7 });
  });
  afterAll(() => {
    sql(`DELETE FROM campanas WHERE tenant_id = '${DEMO.tenant}'; DELETE FROM configuracion_tablio WHERE clave = 'campanas';
         UPDATE menu_items SET tiene_alcohol = false WHERE id = '${schop.id}';`);
  });

  it("el beneficio se valida: % de 5 a 50, y en pesos con compra mínima de al menos el doble", async () => {
    const base = { _tenant_id: DEMO.tenant, _titulo: "Prueba", _mensaje: "Un mensaje de prueba", _publico: "todos" };
    expect((await dueno.rpc("guardar_campana", { ...base, _beneficio_tipo: "porcentaje", _beneficio_valor: 60 })).error).not.toBeNull();
    expect((await dueno.rpc("guardar_campana", { ...base, _beneficio_tipo: "monto", _beneficio_valor: 2000, _beneficio_minimo: 3000 })).error?.message).toContain("doble");
    expect((await dueno.rpc("guardar_campana", { ...base, _beneficio_tipo: "porcentaje", _beneficio_valor: 20, _beneficio_dias: 90 })).error).not.toBeNull();
  });

  it("la base descuenta al cotizar, solo sobre lo sin alcohol; un invitado o el pago al mozo no tienen beneficio", async () => {
    const cot = await cotizar(cliente, [{ menu_item_id: agua.id, quantity: 2 }, { menu_item_id: schop.id, quantity: 1 }]);
    const descuento = Math.floor((agua.price * 2 * 20) / 100);
    expect(cot.descuento).toBe(descuento);
    expect(cot.subtotal).toBe(agua.price * 2 + schop.price - descuento);
    expect(cot.beneficio).toBe("Vuelve esta semana");
    // Solo alcohol: nada que descontar
    expect((await cotizar(cliente, [{ menu_item_id: schop.id, quantity: 2 }])).descuento).toBe(0);
    // Un invitado en la misma mesa no recibió la campaña
    const inv = await invitado();
    await inv.rpc("unirse_a_mesa", { _qr_token: qrMesa(MESA)! });
    await confirmarPresencia(inv, MESA);
    expect((await cotizar(inv, [{ menu_item_id: agua.id, quantity: 2 }])).descuento).toBe(0);
    // El navegador no puede escribir el descuento de una cotización ni de un pedido
    expect((await cliente.from("cotizaciones" as never).update({ descuento: 9999 } as never).eq("id", cot.id).select("id")).data ?? []).toHaveLength(0);
  });

  it("se paga con el descuento, queda anotado una vez y la plata cuadra", async () => {
    const cot = await cotizar(cliente, [{ menu_item_id: agua.id, quantity: 2 }]);
    const r = await pagar(tokenCliente, cot.id);
    expect(r.status, r.cuerpo).toBe(200);
    const pago = JSON.parse(r.cuerpo).payment as { id: string; amount: number };
    expect(pago.amount).toBe(cot.subtotal);
    expect(sql(`SELECT o.descuento || '|' || o.total_amount FROM orders o JOIN payments p ON p.order_id = o.id WHERE p.id = '${pago.id}'`))
      .toBe(`${cot.descuento}|${cot.subtotal}`);
    expect(sql(`SELECT count(*) || '|' || sum(descuento) FROM beneficios_usados WHERE campana_id = '${campana}'`)).toBe(`1|${cot.descuento}`);
    // Ya lo usó: la siguiente cotización va sin descuento, y el enlace del aviso lo dice
    expect((await cotizar(cliente, [{ menu_item_id: agua.id, quantity: 2 }])).descuento).toBe(0);
    const token = sql(`SELECT token FROM envios_campana WHERE campana_id = '${campana}'`);
    expect(((await anonimo().rpc("ver_promo", { _token: token })).data as { beneficio: { usado: boolean } }).beneficio.usado).toBe(true);
    // Los resultados de la campaña lo cuentan
    const fila = ((await dueno.rpc("resultados_campanas", { _tenant_id: DEMO.tenant })).data as { id: string; canjes: number; descuentos: number; volvieron: number }[]).find((c) => c.id === campana)!;
    expect(fila).toMatchObject({ canjes: 1, descuentos: cot.descuento, volvieron: 1 });
    expect((await (await conSesion("superadmin")).cliente.rpc("auditoria_plata")).data ?? []).toEqual([]);
  });

  it("dos pagos a la vez con el mismo beneficio: uno lo usa y el otro se devuelve solo", async () => {
    campana = await mandarCampanaDeNuevo();
    const [a, b] = [await cotizar(cliente, [{ menu_item_id: agua.id, quantity: 2 }]), await cotizar(cliente, [{ menu_item_id: agua.id, quantity: 3 }])];
    expect(a.descuento).toBeGreaterThan(0);
    expect(b.descuento).toBeGreaterThan(0);
    const [ra, rb] = await Promise.all([pagar(tokenCliente, a.id), pagar(tokenCliente, b.id)]);
    const estados = [ra, rb].map((r) => JSON.parse(r.cuerpo) as { payment?: { id: string }; error?: string; motivo?: string });
    expect(estados.filter((e) => e.payment?.id)).toHaveLength(1);
    expect(sql(`SELECT count(*) FROM beneficios_usados WHERE campana_id = '${campana}'`)).toBe("1");
    expect(sql(`SELECT count(*) FROM intentos_pago WHERE cotizacion_id IN ('${a.id}', '${b.id}') AND estado = 'reembolsado' AND motivo LIKE 'Ese beneficio ya se usó%'`)).toBe("1");
    expect((await (await conSesion("superadmin")).cliente.rpc("auditoria_plata")).data ?? []).toEqual([]);
  });

  it("vence a los días indicados y respeta la compra mínima", async () => {
    campana = await mandarCampana({ _beneficio_tipo: "monto", _beneficio_valor: 1000, _beneficio_minimo: agua.price * 3, _beneficio_dias: 3 });
    expect((await cotizar(cliente, [{ menu_item_id: agua.id, quantity: 2 }])).descuento).toBe(0);
    expect((await cotizar(cliente, [{ menu_item_id: agua.id, quantity: 3 }])).descuento).toBe(1000);
    sql(`UPDATE campanas SET enviada_at = now() - interval '4 days' WHERE id = '${campana}'`);
    expect((await cotizar(cliente, [{ menu_item_id: agua.id, quantity: 3 }])).descuento).toBe(0);
  });

  it("la auditoría detecta un descuento que no calza con su uso anotado", async () => {
    const salida = sqlSesion(`
      BEGIN;
      SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT user_id FROM platform_admins LIMIT 1), 'role', 'authenticated')::text, true) IS NULL;
      UPDATE orders SET descuento = descuento + 100 WHERE id = (SELECT order_id FROM beneficios_usados ORDER BY created_at DESC LIMIT 1);
      SELECT 'hallazgo:' || tipo FROM auditoria_plata();
      ROLLBACK;`);
    expect(salida).toContain("hallazgo:beneficio_incoherente");
  });

  // Una campaña nueva con el mismo beneficio (la anterior ya se usó); el cliente "descansa" 7 días entre
  // campañas, así que se corre su último aviso hacia atrás.
  async function mandarCampanaDeNuevo() {
    sql(`UPDATE envios_campana SET created_at = now() - interval '8 days' WHERE tenant_id = '${DEMO.tenant}'`);
    return mandarCampana({ _beneficio_tipo: "porcentaje", _beneficio_valor: 20, _beneficio_minimo: 0, _beneficio_dias: 7 });
  }
});
