import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonimo, conSesion, esBaseLocal, hayCredenciales, invitado, llamarFuncion, DEMO } from "./entorno";

// Fase 5.2 — Primeros pasos del dueño: la base calcula qué le falta al local para abrir y la carta se importa
// de una vez (todo o nada). Lo que necesita un local nuevo corre solo en la base desechable.

const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();

type Pasos = { pasos: { clave: string; hecho: boolean }[]; hechos: number; total: number; ocultos: boolean };
const hecho = (p: Pasos, clave: string) => p.pasos.find((x) => x.clave === clave)?.hecho;

describe.skipIf(!hayCredenciales)("primeros pasos del dueño", () => {
  let dueno: SupabaseClient;

  beforeAll(async () => {
    dueno = (await conSesion("owner")).cliente;
  });

  it("solo el dueño, administrador o encargado ven y usan los primeros pasos de su local", async () => {
    const r = await dueno.rpc("primeros_pasos", { _branch_id: DEMO.sucursal });
    expect(r.error).toBeNull();
    const p = r.data as unknown as Pasos;
    expect(p.total).toBe(7);
    // El demo ya vende: su carta, equipo, cobro, QR y pedido de prueba están hechos
    for (const clave of ["carta", "equipo", "cobro", "qr", "prueba"]) expect(hecho(p, clave), clave).toBe(true);

    const mirones: [string, SupabaseClient][] = [["mozo", (await conSesion("waiter")).cliente], ["cocina", (await conSesion("kitchen")).cliente],
      ["caja", (await conSesion("cashier")).cliente], ["comensal", await invitado()], ["anónimo", anonimo()]];
    if (process.env.DEMO_CREDENCIALES) mirones.push(["dueño de otro local", (await conSesion("owner_ajeno")).cliente]);
    for (const [quien, c] of mirones) {
      expect((await c.rpc("primeros_pasos", { _branch_id: DEMO.sucursal })).error, quien).not.toBeNull();
      expect((await c.rpc("marcar_paso", { _branch_id: DEMO.sucursal, _paso: "ocultar" })).error, quien).not.toBeNull();
      expect((await c.rpc("importar_carta", { _branch_id: DEMO.sucursal, _lineas: [{ categoria: "X", nombre: "Intruso", precio: 1 }] })).error, quien).not.toBeNull();
    }
    expect((await anonimo().from("menu_items").select("id").eq("tenant_id", DEMO.tenant).eq("name", "Intruso")).data ?? []).toHaveLength(0);
  });

  it.skipIf(!esBaseLocal)("un local nuevo parte en cero y se va marcando solo: carta pegada, QR, ocultar", async () => {
    // Un local recién creado y activado por su dueña
    const sa = (await conSesion("superadmin")).cliente;
    const id = Date.now().toString(36);
    const c = (await sa.rpc("crear_local", { _nombre: `Bar Pasos ${id}`, _slug: `bar-pasos-${id}`, _correo_dueno: `pasos-${id}@demo.tablio.test`, _mesas: 4 })).data as { branch_id: string; token: string };
    expect((await llamarFuncion("activar-local", { token: c.token, nombre: "Paula", password: "clave-segura-123" })).status).toBe(200);
    const nueva = anonimo();
    await nueva.auth.signInWithPassword({ email: `pasos-${id}@demo.tablio.test`, password: "clave-segura-123" });
    const pasos = async () => (await nueva.rpc("primeros_pasos", { _branch_id: c.branch_id })).data as unknown as Pasos;

    expect((await pasos()).hechos).toBe(0);
    // Pega su carta: 2 categorías, 4 platos (uno repetido con otra mayúscula no se duplica)
    const r = await nueva.rpc("importar_carta", { _branch_id: c.branch_id, _lineas: [
      { categoria: "Cervezas", nombre: "Torobayo", precio: 4500 },
      { categoria: "cervezas", nombre: "Calafate", precio: 4900, descripcion: "Rubia del sur" },
      { categoria: "Para picar", nombre: "Papas fritas", precio: 3500 },
      { categoria: "Para picar", nombre: "Empanaditas", precio: 5900 },
      { categoria: "Cervezas", nombre: "TOROBAYO", precio: 4500 },
    ] });
    expect(r.error).toBeNull();
    expect(r.data).toMatchObject({ categorias_nuevas: 2, platos_nuevos: 4, repetidos: 1 });
    expect(sql(`SELECT count(*) FROM categories c JOIN menus m ON m.id = c.menu_id WHERE m.branch_id = '${c.branch_id}'`)).toBe("2");
    expect(hecho(await pasos(), "carta")).toBe(true);
    // Imprime los QR y abre: se marcan
    expect((await nueva.rpc("marcar_paso", { _branch_id: c.branch_id, _paso: "qr" })).error).toBeNull();
    await nueva.from("branches").update({ is_open: true }).eq("id", c.branch_id);
    const despues = await pasos();
    expect(hecho(despues, "qr")).toBe(true);
    expect(hecho(despues, "abrir")).toBe(true);
    expect(despues.hechos).toBe(3);
    // Ocultar y volver a mostrar
    await nueva.rpc("marcar_paso", { _branch_id: c.branch_id, _paso: "ocultar" });
    expect((await pasos()).ocultos).toBe(true);
    await nueva.rpc("marcar_paso", { _branch_id: c.branch_id, _paso: "mostrar" });
    expect((await pasos()).ocultos).toBe(false);
    expect((await nueva.rpc("marcar_paso", { _branch_id: c.branch_id, _paso: "inventado" })).error).not.toBeNull();
    // La dueña nueva no ve ni importa en el demo
    expect((await nueva.rpc("primeros_pasos", { _branch_id: DEMO.sucursal })).error).not.toBeNull();
    expect((await nueva.rpc("importar_carta", { _branch_id: DEMO.sucursal, _lineas: [{ categoria: "X", nombre: "Intrusa", precio: 1 }] })).error).not.toBeNull();
  });

  it.skipIf(!esBaseLocal)("la carta se importa entera o no se importa: una línea mala no deja nada a medias", async () => {
    const antes = sql(`SELECT count(*) FROM menu_items WHERE tenant_id = '${DEMO.tenant}'`);
    const mala = await dueno.rpc("importar_carta", { _branch_id: DEMO.sucursal, _lineas: [
      { categoria: "Nueva prueba", nombre: "Buena", precio: 1000 },
      { categoria: "Nueva prueba", nombre: "Mala", precio: "mil" },
    ] });
    expect(mala.error?.message).toContain("Línea 2");
    expect(sql(`SELECT count(*) FROM menu_items WHERE tenant_id = '${DEMO.tenant}'`)).toBe(antes);
    expect(sql(`SELECT count(*) FROM categories WHERE tenant_id = '${DEMO.tenant}' AND name = 'Nueva prueba'`)).toBe("0");
    expect((await dueno.rpc("importar_carta", { _branch_id: DEMO.sucursal, _lineas: [] })).error?.message).toContain("No hay platos");
    expect((await dueno.rpc("importar_carta", { _branch_id: DEMO.sucursal, _lineas: [{ nombre: "Caro", precio: 99999999 }] })).error?.message).toContain("precio");
    expect((await dueno.rpc("importar_carta", { _branch_id: DEMO.sucursal, _lineas: [{ nombre: "x".repeat(81), precio: 1000 }] })).error?.message).toContain("nombre");
    const muchas = Array.from({ length: 301 }, (_, i) => ({ nombre: `Plato ${i}`, precio: 1000 }));
    expect((await dueno.rpc("importar_carta", { _branch_id: DEMO.sucursal, _lineas: muchas })).error?.message).toContain("300");
  });
});
