import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonimo, conSesion, esBaseLocal, guardarCuenta, hayCredenciales, invitado, llamarFuncion, qrMesa, DEMO } from "./entorno";

// Fase 9.4 — Recomendaciones de conocidos. Solo se recomienda lo que se pagó; solo los amigos lo ven, recién
// 24 horas después (desfase); bloquear lo esconde; Tablio puede ocultar una recomendación con nota.

const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();
type Reco = { menu_item_id: string; plato: string; amigos: { nombre: string; comentario: string | null }[] };

describe.skipIf(!hayCredenciales)("recomendaciones de conocidos", () => {
  it("nadie lee las recomendaciones directo; sin sesión no se recomienda", async () => {
    expect((await anonimo().rpc("recomendar_plato", { _menu_item_id: "00000000-0000-0000-0000-000000000000" })).error).not.toBeNull();
    for (const rol of ["cliente", "owner"]) {
      const c = await conSesion(rol).then((s) => s.cliente, () => null);
      if (c) expect((await c.from("recomendaciones_amigos" as never).select("*").limit(1)).data ?? []).toHaveLength(0);
    }
  });
});

describe.skipIf(!hayCredenciales || !esBaseLocal)("recomendaciones: lo pagado, a los amigos, con desfase", () => {
  let ana: SupabaseClient, beto: SupabaseClient, caro: SupabaseClient;
  let agua = "", barros = "";
  const persona = async (nombre: string) => {
    const c = await invitado();
    await guardarCuenta(c, `reco-${nombre.toLowerCase()}-${Date.now()}@demo.tablio.test`);
    await c.rpc("activar_comunidad", { _nombre: nombre, _acepto: true });
    return c;
  };
  const deAmigos = async (c: SupabaseClient) => (await c.rpc("recomendaciones_de_amigos", { _tenant_id: DEMO.tenant })).data as Reco[];

  beforeAll(async () => {
    const carta = (await anonimo().from("menu_items").select("id, name").eq("tenant_id", DEMO.tenant).in("name", ["Agua mineral", "Barros Luco"])).data!;
    agua = carta.find((m) => m.name === "Agua mineral")!.id;
    barros = carta.find((m) => m.name === "Barros Luco")!.id;
    ana = await persona("Ana"); beto = await persona("Beto"); caro = await persona("Caro");
    await ana.rpc("pedir_amistad", { _codigo: ((await beto.rpc("mi_comunidad")).data as { codigo: string }).codigo });
    await beto.rpc("responder_amistad", { _amistad_id: ((await beto.rpc("mi_comunidad")).data as { solicitudes: { id: string }[] }).solicitudes[0].id, _aceptar: true });
    // Ana paga un agua en el demo
    await ana.rpc("unirse_a_mesa", { _qr_token: qrMesa(9)!, _alias: "Ana" });
    const cot = (await ana.rpc("cotizar", { _qr_token: qrMesa(9)!, _items: [{ menu_item_id: agua, quantity: 1 }] })).data as { id: string };
    const p = await llamarFuncion("process-payment", { table_token: qrMesa(9), method: "card", tip_amount: 0, cotizacion_id: cot.id, idempotency_key: `reco-${Date.now()}` },
      (await ana.auth.getSession()).data.session!.access_token);
    expect(p.status, p.cuerpo).toBe(200);
  });

  it("solo se recomienda lo que se pagó, con un comentario sano", async () => {
    expect((await ana.rpc("recomendar_plato", { _menu_item_id: barros })).error?.message).toContain("lo que probaste");
    expect((await ana.rpc("recomendar_plato", { _menu_item_id: agua, _comentario: "sígueme en @ana" })).error).not.toBeNull();
    expect((await ana.rpc("recomendar_plato", { _menu_item_id: agua, _comentario: "La mejor agua de Ñuñoa" })).error).toBeNull();
    expect(((await ana.rpc("mis_recomendaciones", { _tenant_id: DEMO.tenant })).data as { visible: boolean }[])[0].visible).toBe(false);
  });

  it("el amigo la ve recién 24 horas después; quien no es amigo nunca; bloquear la esconde", async () => {
    expect(await deAmigos(beto)).toEqual([]); // desfase
    sql(`UPDATE recomendaciones_amigos SET created_at = now() - interval '25 hours', visible_desde = now() - interval '1 hour' WHERE menu_item_id = '${agua}' AND user_id = '${(await ana.auth.getUser()).data.user!.id}'`);
    const vistas = await deAmigos(beto);
    expect(vistas.map((v) => v.plato)).toEqual(["Agua mineral"]);
    expect(vistas[0].amigos).toEqual([{ nombre: "Ana", comentario: "La mejor agua de Ñuñoa" }]);
    expect(await deAmigos(caro)).toEqual([]);
    expect(await deAmigos(ana)).toEqual([]); // la propia no aparece como "de amigos"
  });

  it("Tablio la oculta con nota; quitarla la borra; las auditorías siguen vacías y detectan el desfase roto", async () => {
    const id = sql(`SELECT id FROM recomendaciones_amigos WHERE menu_item_id = '${agua}' AND user_id = '${(await ana.auth.getUser()).data.user!.id}'`);
    expect((await beto.rpc("ocultar_recomendacion", { _recomendacion_id: id, _nota: "no corresponde" })).error).not.toBeNull();
    const sa = (await conSesion("superadmin")).cliente;
    expect((await sa.rpc("ocultar_recomendacion", { _recomendacion_id: id, _nota: "" })).error?.message).toContain("nota");
    expect((await sa.rpc("ocultar_recomendacion", { _recomendacion_id: id, _nota: "Contenido no permitido" })).error).toBeNull();
    expect(await deAmigos(beto)).toEqual([]);
    expect((await ana.rpc("quitar_recomendacion", { _menu_item_id: agua })).error).toBeNull();
    expect(sql(`SELECT count(*) FROM recomendaciones_amigos WHERE id = '${id}'`)).toBe("0");
    // Una nueva, y Beto bloquea a Ana: deja de verla
    await ana.rpc("recomendar_plato", { _menu_item_id: agua });
    sql(`UPDATE recomendaciones_amigos SET created_at = now() - interval '25 hours', visible_desde = now() - interval '1 hour' WHERE menu_item_id = '${agua}' AND user_id = '${(await ana.auth.getUser()).data.user!.id}'`);
    expect((await deAmigos(beto)).length).toBe(1);
    await beto.rpc("bloquear_usuario", { _user_id: (await ana.auth.getUser()).data.user!.id });
    expect(await deAmigos(beto)).toEqual([]);

    for (const fn of ["auditoria_seguridad", "auditoria_plata", "auditoria_operacion"] as const) {
      expect((await sa.rpc(fn)).data ?? [], fn).toEqual([]);
    }
    const salida = execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1"], { input: `
      BEGIN;
      SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT user_id FROM platform_admins LIMIT 1), 'role', 'authenticated')::text, true) IS NULL;
      UPDATE recomendaciones_amigos SET visible_desde = created_at WHERE id = (SELECT id FROM recomendaciones_amigos LIMIT 1);
      SELECT 'hallazgo:' || tipo FROM auditoria_operacion();
      ROLLBACK;` }).toString();
    expect(salida).toContain("hallazgo:recomendacion_incoherente");
  });
});
