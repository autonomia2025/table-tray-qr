import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonimo, conSesion, confirmarPresencia, esBaseLocal, hayCredenciales, invitado, llamarFuncion, qrMesa, DEMO } from "./entorno";

// Fase 9.1 — Invitar un trago a otra mesa. La otra mesa acepta primero y recién ahí quien invita paga (nunca se
// cobra una invitación que nadie aceptó). El precio sale de la base; el pedido va a la mesa que recibe y a
// cocina solo pagado; si la invitación se canceló cuando llega el pago, se devuelve sola. Quien recibe puede
// rechazar y bloquear; nadie tiene más de 3 invitaciones abiertas; el mensaje va sin enlaces ni teléfonos.

const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();
const sesion = (rol: string) => conSesion(rol).then((s) => s.cliente, () => null);
type Persona = { c: SupabaseClient; token: string; mesa: number };
type Mesa = { invitar_activo: boolean; invitaciones: { recibidas: { id: string; de_mesa: number; estado: string; mensaje: string | null }[]; enviadas: { id: string; para_mesa: number; estado: string }[] } };

describe.skipIf(!hayCredenciales)("invitar a otra mesa", () => {
  it("sin sesión no se usa; nadie lee las invitaciones directo", async () => {
    expect((await anonimo().rpc("invitar_otra_mesa", { _qr_token: qrMesa(3)!, _mesa: 4, _menu_item_id: "00000000-0000-0000-0000-000000000000" })).error).not.toBeNull();
    for (const c of [await invitado(), await sesion("cliente"), await sesion("owner_ajeno"), await sesion("kitchen")]) {
      if (!c) continue;
      for (const t of ["invitaciones_mesa", "bloqueos_invitacion"]) {
        expect((await c.from(t as never).select("*").eq("tenant_id", DEMO.tenant).limit(1)).data ?? [], t).toHaveLength(0);
      }
    }
  });
});

describe.skipIf(!hayCredenciales || !esBaseLocal)("invitar a otra mesa: aceptar, pagar, cancelar y bloquear", () => {
  let agua = "";
  let ana: Persona;
  let beto: Persona;
  const persona = async (mesa: number, alias: string): Promise<Persona> => {
    const c = await invitado();
    await c.rpc("unirse_a_mesa", { _qr_token: qrMesa(mesa)!, _alias: alias });
    return { c, token: (await c.auth.getSession()).data.session!.access_token, mesa };
  };
  const enVivo = async (p: Persona) => (await p.c.rpc("mi_mesa_en_vivo", { _qr_token: qrMesa(p.mesa)! })).data as unknown as Mesa;
  const invitar = (p: Persona, mesa: number, mensaje: string | null = null) =>
    p.c.rpc("invitar_otra_mesa", { _qr_token: qrMesa(p.mesa)!, _mesa: mesa, _menu_item_id: agua, _mensaje: mensaje });
  const responder = (p: Persona, id: string, aceptar: boolean, bloquear = false) =>
    p.c.rpc("responder_invitacion", { _qr_token: qrMesa(p.mesa)!, _invitacion_id: id, _aceptar: aceptar, _bloquear: bloquear });
  const pagar = async (p: Persona, cot: string) => llamarFuncion("process-payment", { table_token: qrMesa(p.mesa), method: "card", tip_amount: 0,
    cotizacion_id: cot, idempotency_key: `invitar-${Date.now()}-${Math.random()}` }, p.token);

  beforeAll(async () => {
    agua = (await anonimo().from("menu_items").select("id").eq("tenant_id", DEMO.tenant).eq("name", "Agua mineral").single()).data!.id;
    const dueno = (await conSesion("owner")).cliente;
    for (const n of [3, 4, 5, 6, 7]) {
      await dueno.rpc("cerrar_mesa", { _table_id: sql(`SELECT id FROM tables WHERE branch_id = '${DEMO.sucursal}' AND number = ${n}`), _motivo: "preparar prueba" });
    }
    ana = await persona(3, "Ana");
    beto = await persona(4, "Beto");
  });
  afterAll(() => sql(`UPDATE branches SET invitar_mesas = false, pedir_codigo = 'sin_pagar' WHERE id = '${DEMO.sucursal}'`));

  it("viene apagado; el dueño lo activa (la caja no)", async () => {
    expect((await invitar(ana, 4)).error?.message).toContain("no tiene invitaciones");
    const caja = (await conSesion("cashier")).cliente;
    expect(((await caja.from("branches").update({ invitar_mesas: true } as never).eq("id", DEMO.sucursal).select("id")).data ?? [])).toHaveLength(0);
    expect((await (await conSesion("owner")).cliente.from("branches").update({ invitar_mesas: true } as never).eq("id", DEMO.sucursal)).error).toBeNull();
    expect((await enVivo(ana)).invitar_activo).toBe(true);
  });

  it("la otra mesa acepta, quien invita paga y el pedido (pagado) va a la otra mesa", async () => {
    expect((await invitar(ana, 3)).error).not.toBeNull(); // su propia mesa
    expect((await invitar(ana, 5)).error?.message).toContain("no hay nadie"); // mesa vacía
    expect((await invitar(ana, 4, "escríbeme a www.misitio.cl")).error?.message).toContain("sin enlaces");
    expect((await invitar(ana, 4, "llámame al 987654321")).error?.message).toContain("sin enlaces");
    const r = await invitar(ana, 4, "¡Salud desde la mesa 3!");
    expect(r.error).toBeNull();
    const id = r.data as string;
    expect((await invitar(ana, 4)).error?.message).toContain("Ya invitaste");

    // Beto la ve; Ana no puede pagar todavía
    expect((await enVivo(beto)).invitaciones.recibidas[0]).toMatchObject({ id, de_mesa: 3, estado: "ofrecida", mensaje: "¡Salud desde la mesa 3!" });
    expect((await ana.c.rpc("cotizar_invitacion", { _qr_token: qrMesa(3)!, _invitacion_id: id })).error?.message).toContain("todavía no fue aceptada");
    // Alguien de otra mesa no puede responderla
    expect((await responder(ana, id, true)).error).not.toBeNull();
    expect((await responder(beto, id, true)).error).toBeNull();

    // Ana paga: precio de la base, pedido en la mesa 4, pagado, con la nota para el mozo
    const cot = (await ana.c.rpc("cotizar_invitacion", { _qr_token: qrMesa(3)!, _invitacion_id: id })).data as { id: string; subtotal: number };
    expect(cot.subtotal).toBe(Number(sql(`SELECT price FROM menu_items WHERE id = '${agua}'`)));
    const p = await pagar(ana, cot.id);
    expect(p.status, p.cuerpo).toBe(200);
    expect(sql(`SELECT o.payment_status || '|' || t.number || '|' || o.notes FROM invitaciones_mesa i JOIN orders o ON o.id = i.order_id JOIN tables t ON t.id = o.table_id WHERE i.id = '${id}'`))
      .toBe("paid|4|Invitación de la mesa 3");
    expect((await enVivo(beto)).invitaciones.recibidas.find((x) => x.id === id)!.estado).toBe("pagada");
    expect((await enVivo(ana)).invitaciones.enviadas.find((x) => x.id === id)!.estado).toBe("pagada");
    expect((await (await conSesion("superadmin")).cliente.rpc("auditoria_plata")).data ?? []).toEqual([]);
  });

  it("si quien invita la cancela y el pago llega igual, se devuelve solo", async () => {
    const id = (await invitar(ana, 4)).data as string;
    await responder(beto, id, true);
    const cot = (await ana.c.rpc("cotizar_invitacion", { _qr_token: qrMesa(3)!, _invitacion_id: id })).data as { id: string };
    expect((await ana.c.rpc("cancelar_invitacion", { _qr_token: qrMesa(3)!, _invitacion_id: id })).error).toBeNull();
    const p = await pagar(ana, cot.id);
    expect(JSON.parse(p.cuerpo).payment?.id).toBeUndefined();
    expect(sql(`SELECT estado || '|' || motivo FROM intentos_pago WHERE cotizacion_id = '${cot.id}'`)).toBe("reembolsado|Esa invitación ya no estaba vigente: se devuelve automáticamente");
    expect(sql(`SELECT estado || '|' || (order_id IS NULL) FROM invitaciones_mesa WHERE id = '${id}'`)).toBe("cancelada|true");
  });

  it("quien recibe rechaza y bloquea; nadie tiene más de 3 abiertas; el código de presencia se pide en la mesa de quien invita", async () => {
    const id = (await invitar(ana, 4)).data as string;
    expect((await responder(beto, id, false, true)).error).toBeNull();
    expect((await invitar(ana, 4)).error?.message).toContain("no está recibiendo");
    expect((await ana.c.rpc("mesas_para_invitar", { _qr_token: qrMesa(3)! })).data as number[]).not.toContain(4);

    await persona(5, "Caro"); await persona(6, "Dani"); await persona(7, "Eli");
    const ids: string[] = [];
    for (const n of [5, 6, 7]) ids.push((await invitar(ana, n)).data as string);
    const cuarta = await persona(8, "Fran");
    expect(cuarta).toBeTruthy();
    expect((await invitar(ana, 8)).error?.message).toContain("3 invitaciones");

    // Con el código siempre: Ana confirmó su mesa (la 3) y puede pagar a otra mesa
    sql(`UPDATE branches SET pedir_codigo = 'siempre' WHERE id = '${DEMO.sucursal}'`);
    sql(`UPDATE invitaciones_mesa SET estado = 'aceptada', vence_at = now() + interval '10 minutes' WHERE id = '${ids[0]}'`);
    expect((await ana.c.rpc("cotizar_invitacion", { _qr_token: qrMesa(3)!, _invitacion_id: ids[0] })).error?.message).toContain("código");
    await confirmarPresencia(ana.c, 3);
    expect((await ana.c.rpc("cotizar_invitacion", { _qr_token: qrMesa(3)!, _invitacion_id: ids[0] })).error).toBeNull();
    sql(`UPDATE branches SET pedir_codigo = 'sin_pagar' WHERE id = '${DEMO.sucursal}'`);
    for (const x of ids) await ana.c.rpc("cancelar_invitacion", { _qr_token: qrMesa(3)!, _invitacion_id: x });
  });

  it("las auditorías siguen vacías y detectan una invitación pagada con el pedido en otra mesa", async () => {
    const superadmin = (await conSesion("superadmin")).cliente;
    for (const fn of ["auditoria_seguridad", "auditoria_plata", "auditoria_operacion"] as const) {
      expect((await superadmin.rpc(fn)).data ?? [], fn).toEqual([]);
    }
    const salida = execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1"], { input: `
      BEGIN;
      SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT user_id FROM platform_admins LIMIT 1), 'role', 'authenticated')::text, true) IS NULL;
      UPDATE invitaciones_mesa SET para_table_id = (SELECT id FROM tables WHERE branch_id = '${DEMO.sucursal}' AND number = 9) WHERE id = (SELECT id FROM invitaciones_mesa WHERE estado = 'pagada' LIMIT 1);
      SELECT 'hallazgo:' || tipo FROM auditoria_plata();
      ROLLBACK;` }).toString();
    expect(salida).toContain("hallazgo:invitacion_incoherente");
  });
});
