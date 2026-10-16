import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonimo, conSesion, confirmarPresencia, esBaseLocal, hayCredenciales, invitado, qrMesa } from "./entorno";

// Fase 7.8 — Juegos en la mesa. La trivia la corrige el servidor: las respuestas correctas no llegan antes
// de responder, no se responde dos veces ni se juega sin límite. La ruleta la sortea el servidor, solo con 2
// o más en la mesa y sin girar a cada rato. Solo los de esa mesa juegan y ven los resultados. Crea partidas:
// solo en la base desechable.

const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();
const MESA = 9;

type Partida = { partida: string; preguntas: { id: string; pregunta: string; opciones: string[] }[] };
type Mesa = { trivia: { quien: string; puntaje: number; yo: boolean }[]; ruleta: { elegido: string } | null };

describe.skipIf(!hayCredenciales || !esBaseLocal)("juegos en la mesa", () => {
  const comensal = async (mesa: number, alias: string) => {
    const c = await invitado();
    await c.rpc("unirse_a_mesa", { _qr_token: qrMesa(mesa)!, _alias: alias });
    await confirmarPresencia(c, mesa);
    return c;
  };
  const enVivo = async (c: SupabaseClient, mesa = MESA) => (await c.rpc("mi_mesa_en_vivo", { _qr_token: qrMesa(mesa)! })).data as unknown as Mesa;
  let ana: SupabaseClient;
  let beto: SupabaseClient;

  beforeAll(async () => {
    const dueno = (await conSesion("owner")).cliente;
    for (const n of [MESA, MESA + 1]) {
      const id = (await dueno.from("tables").select("id").eq("branch_id", "aebe7faa-0e29-5aa9-83c2-1e1b336f1554").eq("number", n).single()).data!.id;
      await dueno.rpc("cerrar_mesa", { _table_id: id, _motivo: "preparar prueba" });
    }
    ana = await comensal(MESA, "Ana");
  });

  it("solo quien está en la mesa juega; nadie lee las respuestas ni las tablas directo", async () => {
    const afuera = await invitado(); // tiene sesión pero no está en la mesa
    for (const c of [anonimo(), afuera]) {
      expect((await c.rpc("empezar_trivia", { _qr_token: qrMesa(MESA)! })).error).not.toBeNull();
      expect((await c.rpc("girar_ruleta", { _qr_token: qrMesa(MESA)! })).error).not.toBeNull();
    }
    for (const t of ["preguntas_trivia", "partidas_trivia", "ruletas_mesa"]) {
      expect((await ana.from(t as never).select("*").limit(1)).data ?? [], t).toHaveLength(0);
    }
    // La partida trae las preguntas sin la correcta
    const p = (await ana.rpc("empezar_trivia", { _qr_token: qrMesa(MESA)! })).data as unknown as Partida;
    expect(p.preguntas).toHaveLength(5);
    expect(JSON.stringify(p)).not.toContain("correcta");
    // Responder la partida de otra persona, no
    const ajena = await comensal(MESA, "Intrusa");
    expect((await ajena.rpc("responder_trivia", { _qr_token: qrMesa(MESA)!, _partida: p.partida, _respuestas: [0, 0, 0, 0, 0] })).error).not.toBeNull();
  });

  it("el servidor corrige una sola vez, hay máximo 3 partidas por visita y la mesa ve el ranking", async () => {
    const p = (await ana.rpc("empezar_trivia", { _qr_token: qrMesa(MESA)! })).data as unknown as Partida;
    // Se responde todo bien usando la base (solo la prueba conoce las correctas)
    const correctas = p.preguntas.map((q) => Number(sql(`SELECT correcta FROM preguntas_trivia WHERE id = '${q.id}'`)));
    const r = (await ana.rpc("responder_trivia", { _qr_token: qrMesa(MESA)!, _partida: p.partida, _respuestas: correctas })).data as { puntaje: number };
    expect(r.puntaje).toBe(5);
    expect((await ana.rpc("responder_trivia", { _qr_token: qrMesa(MESA)!, _partida: p.partida, _respuestas: correctas })).error?.message).toContain("terminó");
    // Tercera partida sí; cuarta no (la primera de la prueba anterior cuenta)
    expect((await ana.rpc("empezar_trivia", { _qr_token: qrMesa(MESA)! })).error).toBeNull();
    expect((await ana.rpc("empezar_trivia", { _qr_token: qrMesa(MESA)! })).error?.message).toContain("3 trivias");

    beto = await comensal(MESA, "Beto");
    const ranking = (await enVivo(beto)).trivia;
    expect(ranking[0]).toMatchObject({ quien: "Ana", puntaje: 5, yo: false });
    // Alguien de otra mesa no lo ve
    const otra = await comensal(MESA + 1, "Otra");
    expect((await enVivo(otra, MESA + 1)).trivia).toHaveLength(0);
  });

  it("la ruleta la sortea el servidor entre los de la mesa, y no gira a cada rato", async () => {
    const solo = await comensal(MESA + 1, "Sola");
    // En la otra mesa ya hay 2 ("Otra" y "Sola"): gira; aquí se prueba el mínimo con una mesa nueva
    const vacia = await (async () => {
      const dueno = (await conSesion("owner")).cliente;
      const id = (await dueno.from("tables").select("id").eq("branch_id", "aebe7faa-0e29-5aa9-83c2-1e1b336f1554").eq("number", 8).single()).data!.id;
      await dueno.rpc("cerrar_mesa", { _table_id: id, _motivo: "preparar prueba" });
      return comensal(8, "Solita");
    })();
    expect((await vacia.rpc("girar_ruleta", { _qr_token: qrMesa(8)! })).error?.message).toContain("dos personas");
    expect(solo).toBeTruthy();

    const r = (await beto.rpc("girar_ruleta", { _qr_token: qrMesa(MESA)! })).data as { elegido: string };
    expect(["Ana", "Beto", "Intrusa"]).toContain(r.elegido);
    expect((await beto.rpc("girar_ruleta", { _qr_token: qrMesa(MESA)! })).error?.message).toContain("recién giró");
    expect((await enVivo(ana)).ruleta?.elegido).toBe(r.elegido);
    // El comensal ve sus partidas en sus datos
    const datos = (await ana.rpc("mis_datos")).data as { trivias: unknown[] };
    expect(datos.trivias.length).toBeGreaterThanOrEqual(2);
  });
});
