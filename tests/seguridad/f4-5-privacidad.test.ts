import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonimo, conSesion, esBaseLocal, guardarCuenta, hayCredenciales, invitado, llamarFuncion, qrMesa, DEMO } from "./entorno";

// Fase 4.5 — Privacidad del comensal (Ley 21.719): ver y descargar sus datos, consentimiento aparte
// para promociones, borrar su cuenta (los registros de plata del local quedan, sin su nombre) y
// limpieza automática de invitados que no vuelven en 90 días.

const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();
const MESA = 7;

describe.skipIf(!hayCredenciales)("privacidad del comensal", () => {
  let dueno: SupabaseClient;
  let item: string;
  const pagar = async (c: SupabaseClient) => {
    await c.rpc("unirse_a_mesa", { _qr_token: qrMesa(MESA)! });
    const token = (await c.auth.getSession()).data.session!.access_token;
    const r = await llamarFuncion("process-payment", {
      table_token: qrMesa(MESA), method: "card", cart_items: [{ menu_item_id: item, quantity: 1, notes: "sin cebolla, soy Ana" }],
      idempotency_key: `priv-${Date.now()}-${Math.random()}`,
    }, token);
    expect(r.status).toBe(200);
    return JSON.parse(r.cuerpo) as { payment: { id: string }; order: { id: string } };
  };

  beforeAll(async () => {
    dueno = (await conSesion("owner")).cliente;
    item = (await anonimo().from("menu_items").select("id").eq("tenant_id", DEMO.tenant).eq("name", "Barros Luco").single()).data!.id;
  });

  it("cada uno ve y descarga solo sus propios datos; sin sesión, nada", async () => {
    expect((await anonimo().rpc("mis_datos")).error).not.toBeNull();
    const c = await invitado();
    const { order } = await pagar(c);
    const d = (await c.rpc("mis_datos")).data as { cuenta: { invitado: boolean }; pedidos: { numero: number }[] };
    expect(d.cuenta.invitado).toBe(true);
    expect(d.pedidos.length).toBe(1);
    // Otra persona no ve ese pedido en sus datos
    const otro = (await (await invitado()).rpc("mis_datos")).data as { pedidos: unknown[] };
    expect(otro.pedidos).toHaveLength(0);
    expect(order.id).toBeTruthy();
  });

  it("las promociones se aceptan aparte, y solo la propia persona con cuenta; nadie las escribe directo", async () => {
    expect((await (await invitado()).rpc("guardar_consentimiento", { _promociones: true })).error?.message).toContain("Guarda tu cuenta");
    const c = (await conSesion("cliente")).cliente;
    expect((await c.rpc("guardar_consentimiento", { _promociones: true })).error).toBeNull();
    expect((await c.from("consentimientos_comensal").select("promociones").single()).data!.promociones).toBe(true);
    expect((await c.rpc("guardar_consentimiento", { _promociones: false })).error).toBeNull();
    expect((await c.from("consentimientos_comensal").select("promociones").single()).data!.promociones).toBe(false);
    expect((await c.from("consentimientos_comensal").insert({ user_id: (await c.auth.getUser()).data.user!.id, promociones: true, politica_version: "x" })).error).not.toBeNull();
    // Nadie más ve la preferencia de otra persona
    expect((await dueno.from("consentimientos_comensal").select("user_id")).data ?? []).toHaveLength(0);
  });

  it("las cuentas del equipo no se borran por aquí; sin confirmar, tampoco", async () => {
    const r = await llamarFuncion("borrar-mi-cuenta", { confirmar: true }, (await conSesion("waiter")).token);
    expect(r.status).toBe(403);
    expect(JSON.parse(r.cuerpo).error).toContain("equipo");
    expect((await llamarFuncion("borrar-mi-cuenta", {}, (await conSesion("cliente")).token)).status).toBe(400);
    expect((await llamarFuncion("borrar-mi-cuenta", { confirmar: true })).status).toBe(401);
  });

  it.skipIf(!esBaseLocal)("al borrar su cuenta se borran sus datos personales y la plata del local queda, sin su nombre", async () => {
    const c = await invitado();
    const correo = `borrar-${Date.now()}@demo.tablio.test`;
    await guardarCuenta(c, correo);
    const yo = (await c.auth.getUser()).data.user!.id;
    const { payment, order } = await pagar(c);
    await c.rpc("mis_sellos", { _tenant_id: DEMO.tenant, _branch_id: DEMO.sucursal });
    await c.rpc("guardar_consentimiento", { _promociones: true });
    expect((await dueno.from("loyalty_customers").select("id").eq("user_id", yo)).data).toHaveLength(1);

    const token = (await c.auth.getSession()).data.session!.access_token;
    const r = await llamarFuncion("borrar-mi-cuenta", { confirmar: true }, token);
    expect(r.status, r.cuerpo).toBe(200);

    // La persona ya no existe ni puede entrar con esa sesión
    expect(sql(`SELECT count(*) FROM auth.users WHERE id = '${yo}'`)).toBe("0");
    // Sus sellos, preferencias y correo se borraron
    expect((await dueno.from("loyalty_customers").select("id").eq("email", correo)).data ?? []).toHaveLength(0);
    expect(sql(`SELECT count(*) FROM consentimientos_comensal WHERE user_id = '${yo}'`)).toBe("0");
    // La plata del local queda, sin su nombre ni lo que escribió
    const { data: pedido } = await dueno.from("orders").select("user_id, notes, total_amount").eq("id", order.id).single();
    expect(pedido).toMatchObject({ user_id: null, notes: null });
    const { data: pago } = await dueno.from("payments").select("user_id, amount, customer_email").eq("id", payment.id).single();
    expect(pago).toMatchObject({ user_id: null, customer_email: null });
    expect(sql(`SELECT count(*) FROM intentos_pago WHERE payment_id = '${payment.id}'`)).toBe("1");
    // Y la plata sigue calzando
    expect((await (await conSesion("superadmin")).cliente.rpc("auditoria_plata")).data ?? []).toHaveLength(0);
  });

  it.skipIf(!esBaseLocal)("un invitado que no vuelve en 90 días se borra solo; su pedido queda en el local", async () => {
    const c = await invitado();
    const yo = (await c.auth.getUser()).data.user!.id;
    const { order } = await pagar(c);
    sql(`UPDATE auth.users SET created_at = now() - interval '100 days', last_sign_in_at = now() - interval '100 days' WHERE id = '${yo}'`);
    expect(Number(sql("SELECT public._purgar_invitados()"))).toBeGreaterThanOrEqual(1);
    expect(sql(`SELECT count(*) FROM auth.users WHERE id = '${yo}'`)).toBe("0");
    expect((await dueno.from("orders").select("user_id").eq("id", order.id).single()).data!.user_id).toBeNull();
    expect(sql("SELECT schedule FROM cron.job WHERE jobname = 'purgar-invitados'")).toBe("43 9 * * *");
  });
});
