import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonimo, conSesion, esBaseLocal, FUNCIONES, hayCredenciales, invitado, llamarFuncion, qrMesa, DEMO, CLAVE_PUBLICA } from "./entorno";

// Fase 4.4 — Pagos que salieron a Webpay y no volvieron (el cliente cerró el celular): la revisión los
// cierra (Transbank los anula si nadie los confirma, así que no hay cobro). Y la conciliación con la
// pasarela al cerrar la caja. Contra el ambiente de pruebas de Transbank.

const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();
const hoy = () => new Date(Date.now() - 6 * 3_600_000).toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
const MESA = 5;

describe.skipIf(!hayCredenciales)("revisión de pagos y conciliación con la pasarela", () => {
  let dueno: SupabaseClient;
  let tokenDueno: string;
  const desconectar = async () => {
    const { data: c } = await dueno.from("conexiones_pago").select("id").eq("branch_id", DEMO.sucursal).eq("estado", "activa").maybeSingle();
    if (c) await dueno.rpc("desconectar_pago", { _conexion_id: c.id });
  };

  beforeAll(async () => {
    const s = await conSesion("owner");
    dueno = s.cliente;
    tokenDueno = s.token;
  });
  afterAll(async () => { await desconectar(); });

  it("la revisión la pide el reloj (con su clave) o alguien del local con acceso a la plata", async () => {
    expect((await llamarFuncion("revisar-pagos", { branch_id: DEMO.sucursal })).status).toBe(401);
    const claveFalsa = await fetch(`${FUNCIONES}/revisar-pagos`, {
      method: "POST", headers: { "Content-Type": "application/json", apikey: CLAVE_PUBLICA, "x-tablio-cron": "inventada" }, body: "{}",
    });
    expect(claveFalsa.status).toBe(401);
    for (const rol of ["waiter", "kitchen"]) {
      expect((await llamarFuncion("revisar-pagos", { branch_id: DEMO.sucursal }, (await conSesion(rol)).token)).status, rol).toBe(403);
    }
    const caja = await llamarFuncion("revisar-pagos", { branch_id: DEMO.sucursal }, (await conSesion("cashier")).token);
    expect(caja.status).toBe(200);
    expect(JSON.parse(caja.cuerpo)).toHaveProperty("revisados");
  });

  it.skipIf(!esBaseLocal)("un pago que salió a Webpay y no volvió se cierra solo al revisar: no hay cobro", async () => {
    expect((await llamarFuncion("conectar-pago", { branch_id: DEMO.sucursal, proveedor: "transbank", ambiente: "integracion", usar_claves_de_prueba: true }, tokenDueno)).status).toBe(200);
    const cliente = await invitado();
    await cliente.rpc("unirse_a_mesa", { _qr_token: qrMesa(MESA)! });
    const token = (await cliente.auth.getSession()).data.session!.access_token;
    const item = (await anonimo().from("menu_items").select("id").eq("tenant_id", DEMO.tenant).eq("name", "Chacarero").single()).data!.id;
    const r = await fetch(`${FUNCIONES}/process-payment`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: CLAVE_PUBLICA, Authorization: `Bearer ${token}`, Origin: "http://localhost:8080" },
      body: JSON.stringify({ table_token: qrMesa(MESA), method: "card", cart_items: [{ menu_item_id: item, quantity: 1 }], idempotency_key: `abandono-${Date.now()}` }),
    });
    const pago = await r.json();
    expect(pago.pendiente).toBe(true);
    // El cliente cerró el celular en Webpay. Pasan 10 minutos…
    sql(`UPDATE intentos_pago SET created_at = now() - interval '10 minutes' WHERE id = '${pago.intento_id}'`);
    // El dueño desconecta Webpay justo ahora: el pago en curso igual se revisa con la conexión con que
    // salió (su clave se guarda 120 días para esto y para devoluciones), y se cierra sin cobro
    await desconectar();
    let rev = JSON.parse((await llamarFuncion("revisar-pagos", { branch_id: DEMO.sucursal }, tokenDueno)).cuerpo);
    expect(rev.cerrados).toBeGreaterThanOrEqual(1);
    expect(((await cliente.rpc("resultado_intento", { _intento_id: pago.intento_id })).data as { estado: string }).estado).toBe("rechazado");

    // Caso principal: la pasarela sigue conectada y el cliente no volvió
    expect((await llamarFuncion("conectar-pago", { branch_id: DEMO.sucursal, proveedor: "transbank", ambiente: "integracion", usar_claves_de_prueba: true }, tokenDueno)).status).toBe(200);
    const r2 = await fetch(`${FUNCIONES}/process-payment`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: CLAVE_PUBLICA, Authorization: `Bearer ${token}`, Origin: "http://localhost:8080" },
      body: JSON.stringify({ table_token: qrMesa(MESA), method: "card", cart_items: [{ menu_item_id: item, quantity: 1 }], idempotency_key: `abandono2-${Date.now()}` }),
    });
    const pago2 = await r2.json();
    sql(`UPDATE intentos_pago SET created_at = now() - interval '10 minutes' WHERE id = '${pago2.intento_id}'`);
    rev = JSON.parse((await llamarFuncion("revisar-pagos", { branch_id: DEMO.sucursal }, tokenDueno)).cuerpo);
    expect(rev.cerrados).toBeGreaterThanOrEqual(1);
    const res = (await cliente.rpc("resultado_intento", { _intento_id: pago2.intento_id })).data as { estado: string };
    expect(res.estado).toBe("rechazado");
    // El reloj de la base está programado cada 5 minutos
    expect(sql("SELECT schedule FROM cron.job WHERE jobname = 'revisar-pagos'")).toBe("*/5 * * * *");
    expect(() => sql("SELECT public._llamar_revisar_pagos()")).not.toThrow();
  });

  it("la conciliación con la pasarela es para quien ve la plata, y un día sin pagos con Webpay sale vacío", async () => {
    for (const rol of ["waiter", "kitchen"]) {
      expect((await llamarFuncion("conciliar-pasarela", { branch_id: DEMO.sucursal, dia: hoy() }, (await conSesion(rol)).token)).status, rol).toBe(403);
    }
    expect((await llamarFuncion("conciliar-pasarela", { branch_id: DEMO.sucursal, dia: hoy() })).status).toBe(401);
    const r = await llamarFuncion("conciliar-pasarela", { branch_id: DEMO.sucursal, dia: "2026-01-01" }, (await conSesion("cashier")).token);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.cuerpo)).toMatchObject({ pagos: 0, diferencias: 0 });
    if (process.env.DEMO_CREDENCIALES) {
      expect((await llamarFuncion("conciliar-pasarela", { branch_id: DEMO.sucursal, dia: hoy() }, (await conSesion("owner_ajeno")).token)).status).toBe(403);
    }
  });
});
