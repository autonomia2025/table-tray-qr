import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonimo, conSesion, esBaseLocal, FUNCIONES, hayCredenciales, invitado, llamarFuncion, qrMesa, DEMO, CLAVE_PUBLICA } from "./entorno";

// Fase 4.1 — Pasarelas conectadas por cada local (Transbank primero). Se prueba contra el ambiente de
// pruebas de Transbank (público): conectar con claves que se prueban antes de guardarse y quedan
// cifradas, mandar al cliente a Webpay, la vuelta (anulada o sin pagar) y que solo el demo simula.

const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();
const MESA = 4;
const APP = "http://localhost:8080";

describe.skipIf(!hayCredenciales)("pasarelas de pago por local", () => {
  let dueno: SupabaseClient;
  let tokenDueno: string;
  let item: string;

  const conexionActiva = async () =>
    (await dueno.from("conexiones_pago").select("id, proveedor, ambiente, estado, etiqueta").eq("branch_id", DEMO.sucursal).eq("estado", "activa").maybeSingle()).data;
  const desconectarTodo = async () => {
    const c = await conexionActiva();
    if (c) await dueno.rpc("desconectar_pago", { _conexion_id: c.id });
  };
  const pagar = async (c: SupabaseClient) => {
    const token = (await c.auth.getSession()).data.session!.access_token;
    const r = await fetch(`${FUNCIONES}/process-payment`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: CLAVE_PUBLICA, Authorization: `Bearer ${token}`, Origin: APP },
      body: JSON.stringify({ table_token: qrMesa(MESA), method: "card", tip_amount: 0, cart_items: [{ menu_item_id: item, quantity: 1 }], idempotency_key: `pasarela-${Date.now()}-${Math.random()}` }),
    });
    return { status: r.status, cuerpo: await r.json() };
  };

  beforeAll(async () => {
    const s = await conSesion("owner");
    dueno = s.cliente;
    tokenDueno = s.token;
    item = (await anonimo().from("menu_items").select("id").eq("tenant_id", DEMO.tenant).eq("name", "Barros Luco").single()).data!.id;
    await desconectarTodo();
  });
  afterAll(async () => { await desconectarTodo(); });

  it("solo el dueño o el administrador conectan; claves malas no se guardan", async () => {
    for (const rol of ["waiter", "cashier", "kitchen"]) {
      const r = await llamarFuncion("conectar-pago", { branch_id: DEMO.sucursal, proveedor: "transbank", ambiente: "integracion", usar_claves_de_prueba: true }, (await conSesion(rol)).token);
      expect(r.status, rol).toBe(403);
    }
    const sinSesion = await llamarFuncion("conectar-pago", { branch_id: DEMO.sucursal, proveedor: "transbank", usar_claves_de_prueba: true });
    expect(sinSesion.status).toBe(401);
    const formato = await llamarFuncion("conectar-pago", { branch_id: DEMO.sucursal, proveedor: "transbank", ambiente: "integracion", codigo_comercio: "123", api_key: "x" }, tokenDueno);
    expect(formato.status).toBe(400);
    const mala = await llamarFuncion("conectar-pago", {
      branch_id: DEMO.sucursal, proveedor: "transbank", ambiente: "integracion", codigo_comercio: "597055555532", api_key: "0".repeat(64),
    }, tokenDueno);
    expect(mala.status).toBe(422);
    expect(JSON.parse(mala.cuerpo).error).toContain("no reconoce");
    expect(await conexionActiva()).toBeNull();
  });

  it("el dueño conecta Webpay con las claves de prueba: queda activa, la clave no se puede leer y el cliente va a Webpay", async () => {
    const r = await llamarFuncion("conectar-pago", { branch_id: DEMO.sucursal, proveedor: "transbank", ambiente: "integracion", usar_claves_de_prueba: true }, tokenDueno);
    expect(r.status, r.cuerpo).toBe(200);
    const c = await conexionActiva();
    expect(c).toMatchObject({ proveedor: "transbank", ambiente: "integracion", etiqueta: "Código de comercio 597055555532" });
    // Nadie lee la clave (ni el dueño): la columna no está disponible
    expect((await dueno.from("conexiones_pago").select("secreto_id")).error).not.toBeNull();
    expect((await (await conSesion("waiter")).cliente.from("conexiones_pago").select("id").eq("branch_id", DEMO.sucursal)).data ?? []).toHaveLength(0);

    // El cliente ve que se paga con Webpay (de prueba) y al pagar se le manda a Webpay
    const cliente = await invitado();
    await cliente.rpc("unirse_a_mesa", { _qr_token: qrMesa(MESA)! });
    expect((await cliente.rpc("pasarela_de_mesa", { _qr_token: qrMesa(MESA)! })).data).toMatchObject({ proveedor: "transbank", prueba: true });
    const p = await pagar(cliente);
    expect(p.status).toBe(200);
    expect(p.cuerpo).toMatchObject({ approved: false, pendiente: true });
    expect(p.cuerpo.redirigir.url).toContain("webpay3gint.transbank.cl");
    const tbk = p.cuerpo.redirigir.campos.token_ws as string;
    expect(tbk.length).toBeGreaterThan(20);
    // Otra persona no ve cómo va ese pago
    expect((await (await invitado()).rpc("resultado_intento", { _intento_id: p.cuerpo.intento_id })).error).not.toBeNull();

    // Vuelve de Webpay sin haber pagado (abrió y volvió): Transbank dice que no está pagado → rechazado
    const vuelta = await fetch(`${FUNCIONES}/pago-retorno?app=${encodeURIComponent(APP)}&v=checkout`, {
      method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", apikey: CLAVE_PUBLICA },
      body: new URLSearchParams({ token_ws: tbk }).toString(),
    });
    expect(vuelta.status).toBe(303);
    const destino = vuelta.headers.get("location")!;
    expect(destino.startsWith(`${APP}/demo-tablio/checkout?`)).toBe(true);
    expect(destino).toContain(`intento=${p.cuerpo.intento_id}`);
    const res = (await cliente.rpc("resultado_intento", { _intento_id: p.cuerpo.intento_id })).data as { estado: string };
    expect(res.estado).toBe("rechazado");
    // Volver a entrar a la misma dirección no cambia nada (idempotente)
    const otraVez = await fetch(`${FUNCIONES}/pago-retorno?app=${encodeURIComponent(APP)}`, {
      method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", apikey: CLAVE_PUBLICA },
      body: new URLSearchParams({ token_ws: tbk }).toString(),
    });
    expect(otraVez.status).toBe(303);
    expect(((await cliente.rpc("resultado_intento", { _intento_id: p.cuerpo.intento_id })).data as { estado: string }).estado).toBe("rechazado");
  });

  it("si el cliente anula en Webpay, no se cobra; la vuelta nunca lleva a otra página que no sea la app", async () => {
    const cliente = await invitado();
    await cliente.rpc("unirse_a_mesa", { _qr_token: qrMesa(MESA)! });
    const p = await pagar(cliente);
    expect(p.cuerpo.pendiente).toBe(true);
    const vuelta = await fetch(`${FUNCIONES}/pago-retorno?app=${encodeURIComponent("https://sitio-malicioso.com")}`, {
      method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", apikey: CLAVE_PUBLICA },
      body: new URLSearchParams({ TBK_TOKEN: p.cuerpo.redirigir.campos.token_ws, TBK_ORDEN_COMPRA: "x" }).toString(),
    });
    expect(vuelta.status).toBe(303);
    expect(vuelta.headers.get("location")).not.toContain("sitio-malicioso");
    expect(((await cliente.rpc("resultado_intento", { _intento_id: p.cuerpo.intento_id })).data as { estado: string }).estado).toBe("rechazado");
    const { data: pagos } = await dueno.from("payments").select("id").eq("tenant_id", DEMO.tenant).contains("provider_payload", { token: p.cuerpo.redirigir.campos.token_ws });
    expect(pagos ?? []).toHaveLength(0);
  });

  it("al desconectar, el demo vuelve a simular; un local que no es demo y no tiene pasarela no cobra con la app", async () => {
    await desconectarTodo();
    expect(await conexionActiva()).toBeNull();
    const cliente = await invitado();
    await cliente.rpc("unirse_a_mesa", { _qr_token: qrMesa(MESA)! });
    expect((await cliente.rpc("pasarela_de_mesa", { _qr_token: qrMesa(MESA)! })).data).toMatchObject({ proveedor: "simulado" });
    expect((await pagar(cliente)).cuerpo.approved).toBe(true);

    if (esBaseLocal) {
      // Sin pasarela y sin ser demo: no se cobra (nunca un cobro simulado para un local real)
      sql(`UPDATE branches SET pagos_simulados = false WHERE id = '${DEMO.sucursal}'`);
      try {
        expect((await cliente.rpc("pasarela_de_mesa", { _qr_token: qrMesa(MESA)! })).data).toMatchObject({ proveedor: null });
        const r = await pagar(cliente);
        expect(r.status).toBe(409);
        expect(r.cuerpo.error).toContain("todavía no recibe pagos con la app");
      } finally {
        sql(`UPDATE branches SET pagos_simulados = true WHERE id = '${DEMO.sucursal}'`);
      }
    }
    // Ni el dueño cambia el modo simulado desde el navegador
    await dueno.from("branches").update({ pagos_simulados: false } as never).eq("id", DEMO.sucursal);
    expect((await dueno.from("branches").select("pagos_simulados").eq("id", DEMO.sucursal).single()).data!.pagos_simulados).toBe(true);
    // Las piezas internas no se llaman desde afuera
    expect((await dueno.rpc("_pasarela_sucursal" as never, { _branch_id: DEMO.sucursal } as never)).error).not.toBeNull();
    expect((await dueno.rpc("_credenciales_conexion" as never, { _conexion_id: DEMO.sucursal } as never)).error).not.toBeNull();
  });

  it.skipIf(!process.env.DEMO_CREDENCIALES)("el dueño de otro local no conecta ni ve pasarelas del demo", async () => {
    const ajeno = await conSesion("owner_ajeno");
    const r = await llamarFuncion("conectar-pago", { branch_id: DEMO.sucursal, proveedor: "transbank", ambiente: "integracion", usar_claves_de_prueba: true }, ajeno.token);
    expect(r.status).toBe(403);
    expect((await ajeno.cliente.from("conexiones_pago").select("id").eq("branch_id", DEMO.sucursal)).data ?? []).toHaveLength(0);
  });
});
