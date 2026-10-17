import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonimo, conSesion, esBaseLocal, guardarCuenta, hayCredenciales, invitado, llamarFuncion, qrMesa, DEMO } from "./entorno";

// Fase 9.3 — Planes con amigos. Solo se arma en un local donde ya pagaste, solo con amigos, y solo ellos lo
// ven; dejar de ser amigos lo saca de su vista. La primera ronda no crea pedidos ni cobra nada antes de llegar.

const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();
type Plan = { id: string; mio: boolean; mi_respuesta: string | null; invitados: { nombre: string; respuesta: string }[]; ronda: unknown[]; cancelado: boolean };

describe.skipIf(!hayCredenciales)("planes con amigos", () => {
  it("nadie lee los planes directo; sin sesión no se arma ninguno", async () => {
    expect((await anonimo().rpc("crear_plan", { _tenant_id: DEMO.tenant, _fecha: new Date().toISOString(), _amigos: [] })).error).not.toBeNull();
    for (const rol of ["cliente", "owner"]) {
      const c = await conSesion(rol).then((s) => s.cliente, () => null);
      if (!c) continue;
      for (const t of ["planes_amigos", "plan_invitados"]) expect((await c.from(t as never).select("*").limit(1)).data ?? [], t).toHaveLength(0);
    }
  });
});

describe.skipIf(!hayCredenciales || !esBaseLocal)("planes con amigos: armar, responder y dejar de verlo", () => {
  let ana: SupabaseClient, beto: SupabaseClient, caro: SupabaseClient;
  let agua = "";
  const id = async (c: SupabaseClient) => (await c.auth.getUser()).data.user!.id;
  const planes = async (c: SupabaseClient) => (await c.rpc("mis_planes")).data as Plan[];
  const manana = () => new Date(Date.now() + 26 * 3_600_000).toISOString();
  const persona = async (nombre: string) => {
    const c = await invitado();
    await guardarCuenta(c, `plan-${nombre.toLowerCase()}-${Date.now()}@demo.tablio.test`);
    await c.rpc("activar_comunidad", { _nombre: nombre, _acepto: true });
    return c;
  };

  beforeAll(async () => {
    agua = (await anonimo().from("menu_items").select("id").eq("tenant_id", DEMO.tenant).eq("name", "Agua mineral").single()).data!.id;
    ana = await persona("Ana"); beto = await persona("Beto"); caro = await persona("Caro");
    // Ana y Beto son amigos; Caro no
    const codigoBeto = ((await beto.rpc("mi_comunidad")).data as { codigo: string }).codigo;
    await ana.rpc("pedir_amistad", { _codigo: codigoBeto });
    const sol = ((await beto.rpc("mi_comunidad")).data as { solicitudes: { id: string }[] }).solicitudes[0];
    await beto.rpc("responder_amistad", { _amistad_id: sol.id, _aceptar: true });
  });

  it("solo en un local donde ya pagaste, con amigos, fecha sana y la ronda de esa carta", async () => {
    const amigos = [await id(beto)];
    expect((await ana.rpc("crear_plan", { _tenant_id: DEMO.tenant, _fecha: manana(), _amigos: amigos })).error?.message).toContain("donde ya hayas estado");
    // Ana paga algo en el demo
    await ana.rpc("unirse_a_mesa", { _qr_token: qrMesa(10)!, _alias: "Ana" });
    const cot = (await ana.rpc("cotizar", { _qr_token: qrMesa(10)!, _items: [{ menu_item_id: agua, quantity: 1 }] })).data as { id: string };
    const p = await llamarFuncion("process-payment", { table_token: qrMesa(10), method: "card", tip_amount: 0, cotizacion_id: cot.id, idempotency_key: `plan-${Date.now()}` },
      (await ana.auth.getSession()).data.session!.access_token);
    expect(p.status, p.cuerpo).toBe(200);
    expect(((await ana.rpc("locales_para_plan")).data as { tenant_id: string }[]).map((l) => l.tenant_id)).toContain(DEMO.tenant);

    expect((await ana.rpc("crear_plan", { _tenant_id: DEMO.tenant, _fecha: new Date(Date.now() - 60_000).toISOString(), _amigos: amigos })).error?.message).toContain("fecha");
    expect((await ana.rpc("crear_plan", { _tenant_id: DEMO.tenant, _fecha: manana(), _amigos: [await id(caro)] })).error?.message).toContain("tus amigos");
    expect((await ana.rpc("crear_plan", { _tenant_id: DEMO.tenant, _fecha: manana(), _amigos: amigos, _mensaje: "info en www.bar.cl" })).error).not.toBeNull();
    const ajeno = sql(`SELECT id FROM menu_items WHERE tenant_id <> '${DEMO.tenant}' LIMIT 1`);
    if (ajeno) expect((await ana.rpc("crear_plan", { _tenant_id: DEMO.tenant, _fecha: manana(), _amigos: amigos, _ronda: [{ menu_item_id: ajeno, quantity: 1 }] })).error?.message).toContain("carta de ese local");

    const pedidosAntes = sql(`SELECT count(*) FROM orders WHERE user_id = '${await id(ana)}'`);
    const r = await ana.rpc("crear_plan", { _tenant_id: DEMO.tenant, _fecha: manana(), _amigos: amigos, _mensaje: "¡Viernes de schop!", _ronda: [{ menu_item_id: agua, quantity: 2 }] });
    expect(r.error).toBeNull();
    // La primera ronda no crea pedidos ni cobra nada
    expect(sql(`SELECT count(*) FROM orders WHERE user_id = '${await id(ana)}'`)).toBe(pedidosAntes);
  });

  it("el amigo lo ve y responde; alguien no invitado no; quien lo arma cancela", async () => {
    const delBeto = (await planes(beto))[0];
    expect(delBeto).toMatchObject({ mio: false, mi_respuesta: "pendiente", ronda: ["Agua mineral"] });
    expect((await beto.rpc("responder_plan", { _plan_id: delBeto.id, _voy: true })).error).toBeNull();
    expect((await planes(ana))[0].invitados).toEqual([{ nombre: "Beto", respuesta: "voy" }]);
    expect(await planes(caro)).toEqual([]);
    expect((await caro.rpc("responder_plan", { _plan_id: delBeto.id, _voy: true })).error).not.toBeNull();
    expect((await beto.rpc("cancelar_plan", { _plan_id: delBeto.id })).error).not.toBeNull();
    // Si dejan de ser amigos, Beto deja de verlo y no puede responder
    const amistad = ((await beto.rpc("mi_comunidad")).data as { amigos: { id: string }[] }).amigos[0];
    await beto.rpc("quitar_amistad", { _amistad_id: amistad.id });
    expect(await planes(beto)).toEqual([]);
    expect((await beto.rpc("responder_plan", { _plan_id: delBeto.id, _voy: false })).error).not.toBeNull();
    expect((await ana.rpc("cancelar_plan", { _plan_id: delBeto.id })).error).toBeNull();
    expect((await planes(ana))[0].cancelado).toBe(true);
  });

  it("las auditorías siguen vacías y detectan un plan que se invita a sí mismo", async () => {
    const sa = (await conSesion("superadmin")).cliente;
    for (const fn of ["auditoria_seguridad", "auditoria_plata", "auditoria_operacion"] as const) {
      expect((await sa.rpc(fn)).data ?? [], fn).toEqual([]);
    }
    const salida = execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1"], { input: `
      BEGIN;
      SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT user_id FROM platform_admins LIMIT 1), 'role', 'authenticated')::text, true) IS NULL;
      INSERT INTO plan_invitados (plan_id, user_id) SELECT id, creador_id FROM planes_amigos ORDER BY created_at DESC LIMIT 1;
      SELECT 'hallazgo:' || tipo FROM auditoria_operacion();
      ROLLBACK;` }).toString();
    expect(salida).toContain("hallazgo:plan_incoherente");
  });
});
