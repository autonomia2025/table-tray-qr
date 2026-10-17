import { describe, it, expect, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonimo, conSesion, esBaseLocal, hayCredenciales, invitado, qrMesa, DEMO } from "./entorno";

// Fase 8.4 — Noche de trivia en vivo. Solo el dueño, el administrador o el encargado la manejan; solo juega
// quien está en una mesa del local; la correcta nunca llega al celular antes del resultado (ni se deduce del
// ranking); cada uno responde una vez, a tiempo, y el puntaje lo calcula la base. No mueve plata.

const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();
const sesion = (rol: string) => conSesion(rol).then((s) => s.cliente, () => null);
type Estado = { id: string; estado: string; actual: number; pregunta: { opciones: string[]; correcta: number | null } | null;
  ranking: { alias: string; puntos: number; yo: boolean }[]; mi_respuesta: { opcion: number; correcta: boolean | null; puntos: number | null } | null };

describe.skipIf(!hayCredenciales)("trivia en vivo", () => {
  it("solo el encargado la maneja; nadie lee las tablas directo; sin sesión no se juega", async () => {
    expect((await anonimo().rpc("trivia_vivo_mesa", { _qr_token: qrMesa(5)! })).error).not.toBeNull();
    expect((await anonimo().rpc("pantalla_trivia_vivo", { _branch_id: DEMO.sucursal })).error).not.toBeNull();
    for (const rol of ["cashier", "waiter", "kitchen", "cliente", "owner_ajeno"]) {
      const c = await sesion(rol);
      if (!c) continue;
      expect((await c.rpc("crear_trivia_vivo", { _branch_id: DEMO.sucursal })).error, rol).not.toBeNull();
      expect((await c.rpc("pantalla_trivia_vivo", { _branch_id: DEMO.sucursal })).error, rol).not.toBeNull();
      for (const t of ["trivias_vivo", "respuestas_trivia_vivo"]) {
        expect((await c.from(t as never).select("*").eq("tenant_id", DEMO.tenant).limit(1)).data ?? [], `${rol}: ${t}`).toHaveLength(0);
      }
    }
  });
});

describe.skipIf(!hayCredenciales || !esBaseLocal)("trivia en vivo: una noche completa", () => {
  const MESA = 5;
  let dueno: SupabaseClient;
  let trivia = "";
  afterAll(() => sql(`DELETE FROM trivias_vivo WHERE tenant_id = '${DEMO.tenant}'; DELETE FROM tenant_feature_flags WHERE tenant_id = '${DEMO.tenant}'`));
  const jugador = async (alias: string, mesa = MESA) => {
    const c = await invitado();
    await c.rpc("unirse_a_mesa", { _qr_token: qrMesa(mesa)!, _alias: alias });
    return c;
  };
  const ver = async (c: SupabaseClient, mesa = MESA) => (await c.rpc("trivia_vivo_mesa", { _qr_token: qrMesa(mesa)! })).data as Estado;
  const responder = (c: SupabaseClient, numero: number, opcion: number, mesa = MESA) =>
    c.rpc("responder_trivia_vivo", { _qr_token: qrMesa(mesa)!, _trivia_id: trivia, _numero: numero, _opcion: opcion });

  it("preguntas, respuestas a tiempo y una sola vez, la correcta escondida hasta el resultado, y el ranking", async () => {
    sql(`DELETE FROM trivias_vivo WHERE tenant_id = '${DEMO.tenant}'`);
    dueno = (await conSesion("owner")).cliente;
    const dueño = await dueno.rpc("cerrar_mesa", { _table_id: sql(`SELECT id FROM tables WHERE branch_id = '${DEMO.sucursal}' AND number = ${MESA}`), _motivo: "preparar prueba" });
    expect(dueño.error).toBeNull();
    expect((await dueno.rpc("crear_trivia_vivo", { _branch_id: DEMO.sucursal, _preguntas: 2 })).error?.message).toContain("entre 3 y 20");
    const r = await dueno.rpc("crear_trivia_vivo", { _branch_id: DEMO.sucursal, _preguntas: 3, _segundos: 20 });
    expect(r.error).toBeNull();
    trivia = r.data as string;
    // Una a la vez por sucursal
    expect((await dueno.rpc("crear_trivia_vivo", { _branch_id: DEMO.sucursal })).error?.message).toContain("Ya hay una trivia");

    const ana = await jugador("Ana");
    const beto = await jugador("Beto");
    expect((await ver(ana)).estado).toBe("esperando");
    expect((await responder(ana, 1, 0)).error).not.toBeNull(); // todavía no empieza

    await dueno.rpc("avanzar_trivia_vivo", { _trivia_id: trivia });
    const e1 = await ver(ana);
    expect(e1).toMatchObject({ estado: "pregunta", actual: 1 });
    expect(e1.pregunta!.correcta).toBeNull(); // la correcta no llega al celular
    const correcta = Number(sql(`SELECT q.correcta FROM trivias_vivo t JOIN preguntas_trivia q ON q.id = t.preguntas[1] WHERE t.id = '${trivia}'`));
    const mala = (correcta + 1) % e1.pregunta!.opciones.length;

    expect((await responder(ana, 1, correcta)).error).toBeNull();
    expect((await responder(ana, 1, mala)).error?.message).toContain("Ya respondiste");
    expect((await responder(beto, 1, mala)).error).toBeNull();
    expect((await responder(beto, 2, correcta)).error?.message).toContain("ya cerró");
    expect((await responder(beto, 1, 9)).error).not.toBeNull();
    // Mientras dura la pregunta, el ranking no la cuenta (no se deduce quién acertó) y no se dice si acertó
    const durante = await ver(beto);
    expect(durante.ranking).toEqual([]);
    expect(durante.mi_respuesta).toMatchObject({ opcion: mala, correcta: null, puntos: null });
    // Alguien de otra mesa del local juega igual; alguien que no está en ninguna mesa, no
    const caro = await jugador("Caro", 6);
    expect((await responder(caro, 1, correcta, 6)).error).toBeNull();
    expect((await (await invitado()).rpc("responder_trivia_vivo", { _qr_token: qrMesa(MESA)!, _trivia_id: trivia, _numero: 1, _opcion: 0 })).error).not.toBeNull();

    await dueno.rpc("avanzar_trivia_vivo", { _trivia_id: trivia });
    const res = await ver(ana);
    expect(res.estado).toBe("resultado");
    expect(res.pregunta!.correcta).toBe(correcta);
    expect(res.mi_respuesta!.correcta).toBe(true);
    expect(res.mi_respuesta!.puntos).toBeGreaterThanOrEqual(100);
    expect(res.mi_respuesta!.puntos).toBeLessThanOrEqual(150);
    expect(res.ranking.map((x) => x.alias)).toEqual(expect.arrayContaining(["Ana", "Caro", "Beto"]));
    expect(res.ranking.find((x) => x.alias === "Beto")!.puntos).toBe(0);
    expect(res.ranking.find((x) => x.yo)!.alias).toBe("Ana");

    // Fuera de tiempo, no
    await dueno.rpc("avanzar_trivia_vivo", { _trivia_id: trivia });
    sql(`UPDATE trivias_vivo SET pregunta_desde = now() - interval '25 seconds' WHERE id = '${trivia}'`);
    expect((await responder(beto, 2, 0)).error?.message).toContain("Se acabó el tiempo");

    // Terminar; el personal sin rol no avanza
    expect((await (await conSesion("waiter")).cliente.rpc("avanzar_trivia_vivo", { _trivia_id: trivia })).error).not.toBeNull();
    await dueno.rpc("terminar_trivia_vivo", { _trivia_id: trivia });
    expect((await ver(ana)).estado).toBe("terminada");
    expect((await dueno.rpc("avanzar_trivia_vivo", { _trivia_id: trivia })).error?.message).toContain("ya terminó");
  });

  it("sin el módulo de juegos no se crea; las auditorías siguen vacías y detectan puntos mal dados", async () => {
    await (await conSesion("superadmin")).cliente.rpc("ajustar_modulo_local", { _tenant_id: DEMO.tenant, _modulo: "juegos", _estado: false, _motivo: "prueba de trivia" });
    expect((await dueno.rpc("crear_trivia_vivo", { _branch_id: DEMO.sucursal })).error?.message).toContain("no está incluida en el plan");
    sql(`DELETE FROM tenant_feature_flags WHERE tenant_id = '${DEMO.tenant}'`);
    const superadmin = (await conSesion("superadmin")).cliente;
    for (const fn of ["auditoria_seguridad", "auditoria_plata", "auditoria_operacion"] as const) {
      expect((await superadmin.rpc(fn)).data ?? [], fn).toEqual([]);
    }
    const salida = execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1"], { input: `
      BEGIN;
      SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT user_id FROM platform_admins LIMIT 1), 'role', 'authenticated')::text, true) IS NULL;
      UPDATE respuestas_trivia_vivo SET correcta = NOT correcta WHERE trivia_id = '${trivia}' AND alias = 'Beto';
      SELECT 'hallazgo:' || tipo FROM auditoria_operacion();
      ROLLBACK;` }).toString();
    expect(salida).toContain("hallazgo:trivia_vivo_incoherente");
  });
});
