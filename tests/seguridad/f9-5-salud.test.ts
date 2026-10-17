import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonimo, conSesion, esBaseLocal, guardarCuenta, hayCredenciales, invitado, qrMesa, DEMO } from "./entorno";

// Fase 9.5 — "Salud" entre amigos en el mismo bar, con doble permiso: nadie aparece presente si no lo activa,
// y solo lo ven sus amigos que también están en ese local y también lo activaron. El aviso termina al cerrarse
// la mesa. Un "salud" cada 2 minutos por pareja.

const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();
type Aqui = { comunidad: boolean; avisando?: boolean; amigos?: { user_id: string; nombre: string }[]; saludos?: { de: string }[] };

describe.skipIf(!hayCredenciales)("salud entre amigos", () => {
  it("nadie lee presencias ni saludos directo; sin sesión no se usa", async () => {
    expect((await anonimo().rpc("avisar_que_estoy", { _qr_token: qrMesa(1)!, _activar: true })).error).not.toBeNull();
    for (const rol of ["cliente", "owner", "waiter"]) {
      const c = await conSesion(rol).then((s) => s.cliente, () => null);
      if (!c) continue;
      for (const t of ["presencias_comunidad", "saludos_amigos"]) expect((await c.from(t as never).select("*").limit(1)).data ?? [], t).toHaveLength(0);
    }
  });
});

describe.skipIf(!hayCredenciales || !esBaseLocal)("salud entre amigos: doble permiso", () => {
  const MESAS = { ana: 3, beto: 4, caro: 5, dani: 6 };
  const p: Record<string, SupabaseClient> = {};
  const id = async (c: SupabaseClient) => (await c.auth.getUser()).data.user!.id;
  const aqui = async (quien: keyof typeof MESAS) => (await p[quien].rpc("amigos_aqui", { _qr_token: qrMesa(MESAS[quien])! })).data as Aqui;
  const avisar = (quien: keyof typeof MESAS, activar = true) => p[quien].rpc("avisar_que_estoy", { _qr_token: qrMesa(MESAS[quien])!, _activar: activar });
  const salud = (de: keyof typeof MESAS, para: string) => p[de].rpc("mandar_salud", { _qr_token: qrMesa(MESAS[de])!, _amigo_id: para });
  const amigos = async (a: SupabaseClient, b: SupabaseClient) => {
    await a.rpc("pedir_amistad", { _codigo: ((await b.rpc("mi_comunidad")).data as { codigo: string }).codigo });
    await b.rpc("responder_amistad", { _amistad_id: ((await b.rpc("mi_comunidad")).data as { solicitudes: { id: string }[] }).solicitudes[0].id, _aceptar: true });
  };

  beforeAll(async () => {
    const dueno = (await conSesion("owner")).cliente;
    for (const [nombre, mesa] of Object.entries(MESAS)) {
      await dueno.rpc("cerrar_mesa", { _table_id: sql(`SELECT id FROM tables WHERE branch_id = '${DEMO.sucursal}' AND number = ${mesa}`), _motivo: "preparar prueba" });
      const c = await invitado();
      await c.rpc("unirse_a_mesa", { _qr_token: qrMesa(mesa)!, _alias: nombre });
      await guardarCuenta(c, `salud-${nombre}-${Date.now()}@demo.tablio.test`);
      await c.rpc("activar_comunidad", { _nombre: nombre[0].toUpperCase() + nombre.slice(1), _acepto: true });
      p[nombre] = c;
    }
    await amigos(p.ana, p.beto);
    await amigos(p.ana, p.caro);
    // Dani no es amigo de nadie
  });

  it("sin avisar nadie aparece; el que avisa solo ve a amigos que también avisan", async () => {
    expect((await (await invitado()).rpc("avisar_que_estoy", { _qr_token: qrMesa(3)!, _activar: true })).error).not.toBeNull();
    expect(await aqui("ana")).toMatchObject({ comunidad: true, avisando: false });
    expect((await avisar("beto")).error).toBeNull();
    // Ana no avisó: no ve a Beto (ni la lista)
    expect((await aqui("ana")).amigos).toBeUndefined();
    expect((await avisar("ana")).error).toBeNull();
    expect((await aqui("ana")).amigos!.map((a) => a.nombre)).toEqual(["Beto"]);
    expect((await aqui("beto")).amigos!.map((a) => a.nombre)).toEqual(["Ana"]);
    // Caro es amiga pero no avisa: ni aparece ni ve a nadie. Dani avisa pero no es amigo: no aparece
    expect((await aqui("caro")).amigos).toBeUndefined();
    await avisar("dani");
    expect((await aqui("ana")).amigos!.map((a) => a.nombre)).toEqual(["Beto"]);
    expect((await aqui("dani")).amigos).toEqual([]);
  });

  it("el salud llega una vez, con límite, y solo a un amigo que está avisando", async () => {
    expect((await salud("ana", await id(p.beto))).error).toBeNull();
    expect((await salud("ana", await id(p.beto))).error?.message).toContain("Recién");
    expect((await salud("ana", await id(p.caro))).error?.message).toContain("ya no está aquí");
    expect((await salud("ana", await id(p.dani))).error?.message).toContain("ya no está aquí");
    expect((await aqui("beto")).saludos!.map((s) => s.de)).toEqual(["Ana"]);
    expect((await aqui("beto")).saludos).toEqual([]); // ya visto
  });

  it("dejar de avisar o que se cierre la mesa lo apaga; las auditorías siguen vacías y detectan un aviso de otro local", async () => {
    await avisar("beto", false);
    expect((await aqui("ana")).amigos).toEqual([]);
    expect((await salud("ana", await id(p.beto))).error).not.toBeNull();
    await avisar("beto");
    expect((await aqui("ana")).amigos!.map((a) => a.nombre)).toEqual(["Beto"]);
    // Se cierra la mesa de Ana: ya no aparece para Beto
    await (await conSesion("owner")).cliente.rpc("cerrar_mesa", { _table_id: sql(`SELECT id FROM tables WHERE branch_id = '${DEMO.sucursal}' AND number = ${MESAS.ana}`), _motivo: "fin de la prueba" });
    expect((await aqui("beto")).amigos).toEqual([]);

    const sa = (await conSesion("superadmin")).cliente;
    for (const fn of ["auditoria_seguridad", "auditoria_plata", "auditoria_operacion"] as const) {
      expect((await sa.rpc(fn)).data ?? [], fn).toEqual([]);
    }
    const salida = execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1"], { input: `
      BEGIN;
      SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT user_id FROM platform_admins LIMIT 1), 'role', 'authenticated')::text, true) IS NULL;
      UPDATE presencias_comunidad SET tenant_id = (SELECT id FROM tenants WHERE id <> '${DEMO.tenant}' LIMIT 1) WHERE user_id = (SELECT user_id FROM presencias_comunidad LIMIT 1);
      SELECT 'hallazgo:' || tipo FROM auditoria_operacion();
      ROLLBACK;` }).toString();
    expect(salida).toContain("hallazgo:presencia_incoherente");
  });
});
