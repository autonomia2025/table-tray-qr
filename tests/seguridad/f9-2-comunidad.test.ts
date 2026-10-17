import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonimo, conSesion, esBaseLocal, guardarCuenta, hayCredenciales, invitado, llamarFuncion, qrMesa } from "./entorno";

// Fase 9.2 — Comunidad: perfil y amigos. Solo con cuenta verificada y con permiso explícito; amigos por código
// o con quien está en tu misma mesa; nadie busca a nadie; bloquear corta la amistad sin revelarlo; reportar
// llega a Tablio, que puede suspender; apagar o borrar la cuenta borra las amistades.

const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();
type Com = { activo: boolean; suspendido: boolean; codigo?: string; amigos?: { id: string; user_id: string; nombre: string }[];
  solicitudes?: { id: string; nombre: string }[]; en_mi_mesa?: { user_id: string; nombre: string }[] };

describe.skipIf(!hayCredenciales)("comunidad", () => {
  it("sin cuenta verificada no se activa; nadie lee las tablas directo", async () => {
    expect((await anonimo().rpc("activar_comunidad", { _nombre: "Ana", _acepto: true })).error).not.toBeNull();
    expect((await (await invitado()).rpc("activar_comunidad", { _nombre: "Ana", _acepto: true })).error?.message).toContain("Guarda tu cuenta");
    for (const rol of ["cliente", "owner", "waiter"]) {
      const c = await conSesion(rol).then((s) => s.cliente, () => null);
      if (!c) continue;
      for (const t of ["perfiles_comunidad", "amistades", "bloqueos_usuario", "reportes_comunidad"]) {
        expect((await c.from(t as never).select("*").limit(1)).data ?? [], `${rol}: ${t}`).toHaveLength(0);
      }
      expect((await c.rpc("reportes_comunidad_abiertos")).error, rol).not.toBeNull();
    }
  });
});

describe.skipIf(!hayCredenciales || !esBaseLocal)("comunidad: amigos, mesa, bloquear, reportar y apagar", () => {
  let ana: SupabaseClient, beto: SupabaseClient, caro: SupabaseClient;
  const yo = async (c: SupabaseClient) => (await c.auth.getUser()).data.user!.id;
  const mia = async (c: SupabaseClient, qr?: string) => (await c.rpc("mi_comunidad", { _qr_token: qr ?? null })).data as Com;
  const persona = async (nombre: string, mesa?: number) => {
    const c = await invitado();
    if (mesa) await c.rpc("unirse_a_mesa", { _qr_token: qrMesa(mesa)!, _alias: nombre });
    await guardarCuenta(c, `comunidad-${nombre.toLowerCase()}-${Date.now()}@demo.tablio.test`);
    return c;
  };

  beforeAll(async () => {
    const dueno = (await conSesion("owner")).cliente;
    await dueno.rpc("cerrar_mesa", { _table_id: sql(`SELECT t.id FROM tables t JOIN branches b ON b.id = t.branch_id WHERE b.tenant_id = '651c363f-0084-50af-9873-be98cfeaaf47' AND t.number = 8 LIMIT 1`), _motivo: "preparar prueba" });
    ana = await persona("Ana", 8);
    beto = await persona("Beto");
    caro = await persona("Caro", 8);
  });

  it("se activa con permiso explícito y un nombre sano; apagada por defecto", async () => {
    expect((await mia(ana)).activo).toBe(false);
    expect((await ana.rpc("activar_comunidad", { _nombre: "Ana", _acepto: false })).error?.message).toContain("aceptar");
    expect((await ana.rpc("activar_comunidad", { _nombre: "ana@mail.cl", _acepto: true })).error).not.toBeNull();
    for (const [c, n] of [[ana, "Ana"], [beto, "Beto"]] as const) {
      expect((await c.rpc("activar_comunidad", { _nombre: n, _acepto: true })).error).toBeNull();
    }
    expect((await mia(ana)).codigo).toMatch(/^TAB-[A-Z2-9]{5}$/);
  });

  it("amigos por código, con aceptar; si los dos se lo piden, queda aceptada", async () => {
    const codigoBeto = (await mia(beto)).codigo!;
    expect((await ana.rpc("pedir_amistad", { _codigo: "TAB-NOEXI" })).error?.message).toContain("No encontramos");
    expect((await ana.rpc("pedir_amistad", { _codigo: codigoBeto.toLowerCase() })).error).toBeNull();
    const sol = (await mia(beto)).solicitudes!;
    expect(sol.map((s) => s.nombre)).toEqual(["Ana"]);
    // Ana no puede aceptar su propia solicitud
    expect((await ana.rpc("responder_amistad", { _amistad_id: sol[0].id, _aceptar: true })).error).not.toBeNull();
    expect((await beto.rpc("responder_amistad", { _amistad_id: sol[0].id, _aceptar: true })).error).toBeNull();
    expect((await mia(ana)).amigos!.map((a) => a.nombre)).toEqual(["Beto"]);
    expect((await mia(beto)).amigos!.map((a) => a.nombre)).toEqual(["Ana"]);
  });

  it("en la misma mesa se ven quienes también activaron la comunidad, y solo ellos", async () => {
    // Caro está en la mesa 8 pero sin comunidad: no aparece
    expect((await mia(ana, qrMesa(8)!)).en_mi_mesa).toEqual([]);
    await caro.rpc("activar_comunidad", { _nombre: "Caro", _acepto: true });
    const enMesa = (await mia(ana, qrMesa(8)!)).en_mi_mesa!;
    expect(enMesa.map((p) => p.nombre)).toEqual(["Caro"]);
    // Beto no está en la mesa: no puede pedírsela por mesa
    expect((await beto.rpc("pedir_amistad", { _qr_token: qrMesa(8)!, _user_id: enMesa[0].user_id })).error).not.toBeNull();
    expect((await ana.rpc("pedir_amistad", { _qr_token: qrMesa(8)!, _user_id: enMesa[0].user_id })).error).toBeNull();
    // Si Caro también se la pide, queda aceptada sola
    expect((await caro.rpc("pedir_amistad", { _qr_token: qrMesa(8)!, _user_id: await yo(ana) })).error).toBeNull();
    expect((await mia(caro)).amigos!.map((a) => a.nombre)).toEqual(["Ana"]);
  });

  it("bloquear corta la amistad y no deja volver a pedirla (sin revelar el bloqueo)", async () => {
    expect((await beto.rpc("bloquear_usuario", { _user_id: await yo(ana) })).error).toBeNull();
    expect((await mia(ana)).amigos!.map((a) => a.nombre)).not.toContain("Beto");
    const r = await ana.rpc("pedir_amistad", { _codigo: (await mia(beto)).codigo! });
    expect(r.error?.message).toContain("No encontramos a esa persona");
  });

  it("reportar llega a Tablio; suspender corta todas sus amistades y no puede reactivarse", async () => {
    expect((await ana.rpc("reportar_usuario", { _user_id: await yo(caro), _motivo: "no" })).error).not.toBeNull();
    expect((await ana.rpc("reportar_usuario", { _user_id: await yo(caro), _motivo: "Me escribe cosas ofensivas" })).error).toBeNull();
    const sa = (await conSesion("superadmin")).cliente;
    const lista = (await sa.rpc("reportes_comunidad_abiertos")).data as { id: string; reportado: string; estado: string }[];
    const rep = lista.find((x) => x.reportado === "Caro" && x.estado === "abierto")!;
    expect(rep).toBeTruthy();
    expect((await sa.rpc("moderar_reporte", { _reporte_id: rep.id, _suspender: true, _nota: "" })).error?.message).toContain("nota");
    expect((await sa.rpc("moderar_reporte", { _reporte_id: rep.id, _suspender: true, _nota: "Lenguaje ofensivo reiterado" })).error).toBeNull();
    expect(await mia(caro)).toMatchObject({ activo: false, suspendido: true });
    expect((await caro.rpc("activar_comunidad", { _nombre: "Caro", _acepto: true })).error?.message).toContain("suspendido");
    expect((await mia(ana)).amigos!.map((a) => a.nombre)).not.toContain("Caro");
    expect(sql(`SELECT count(*) FROM audit_logs WHERE entity_id = '${rep.id}' AND action = 'comunidad_perfil_suspendido'`)).toBe("1");
  });

  it("apagar borra las amistades; borrar la cuenta borra el perfil; las auditorías siguen vacías y detectan un amigo bloqueado", async () => {
    const codigoAna = (await mia(ana)).codigo!;
    await beto.rpc("activar_comunidad", { _nombre: "Beto", _acepto: true });
    expect((await ana.rpc("apagar_comunidad")).error).toBeNull();
    expect(sql(`SELECT count(*) FROM amistades WHERE de_user_id = '${await yo(ana)}' OR para_user_id = '${await yo(ana)}'`)).toBe("0");
    expect((await beto.rpc("pedir_amistad", { _codigo: codigoAna })).error).not.toBeNull();
    const idBeto = await yo(beto);
    const r = await llamarFuncion("borrar-mi-cuenta", { confirmar: true }, (await beto.auth.getSession()).data.session!.access_token);
    expect(r.status, r.cuerpo).toBe(200);
    expect(sql(`SELECT count(*) FROM perfiles_comunidad WHERE user_id = '${idBeto}'`)).toBe("0");

    const sa = (await conSesion("superadmin")).cliente;
    for (const fn of ["auditoria_seguridad", "auditoria_plata", "auditoria_operacion"] as const) {
      expect((await sa.rpc(fn)).data ?? [], fn).toEqual([]);
    }
    const salida = execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1"], { input: `
      BEGIN;
      SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT user_id FROM platform_admins LIMIT 1), 'role', 'authenticated')::text, true) IS NULL;
      INSERT INTO perfiles_comunidad (user_id, nombre, codigo, consentimiento_at) SELECT id, 'X' || left(id::text, 4), 'TAB-' || left(md5(id::text), 5), now()
        FROM auth.users WHERE id NOT IN (SELECT user_id FROM perfiles_comunidad) LIMIT 2;
      INSERT INTO amistades (de_user_id, para_user_id, estado)
        SELECT (array_agg(user_id))[1], (array_agg(user_id))[2], 'aceptada' FROM (SELECT user_id FROM perfiles_comunidad WHERE nombre LIKE 'X%' LIMIT 2) x;
      INSERT INTO bloqueos_usuario (user_id, bloqueado_id) SELECT de_user_id, para_user_id FROM amistades ORDER BY created_at DESC LIMIT 1;
      SELECT 'hallazgo:' || tipo FROM auditoria_operacion();
      ROLLBACK;` }).toString();
    expect(salida).toContain("hallazgo:amistad_incoherente");
  });
});
