import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonimo, conSesion, confirmarPresencia, esBaseLocal, hayCredenciales, invitado, llamarFuncion, qrMesa, DEMO } from "./entorno";

// Fase 7.1 — Campañas. Solo le llegan a quien aceptó promociones, tiene cuenta verificada y junta sellos en
// el local; nadie más las arma ni las ve; las direcciones de los celulares nunca llegan al navegador; los
// límites y el horario los pone la base; el enlace de cada aviso abre la promoción y permite darse de baja.
// Lo que envía corre en la base desechable (en la real no se le escribe a nadie).

const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();
const sqlSesion = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1"], { input: q }).toString().trim();

type Alcance = { total: number; con_aviso: number; descansando: number };

describe.skipIf(!hayCredenciales)("campañas", () => {
  let dueno: SupabaseClient;
  let tokenDueno: string;
  let cliente = "";
  const alcance = async (publico: string, plato?: string) =>
    (await dueno.rpc("publico_campana", { _tenant_id: DEMO.tenant, _publico: publico, _plato: plato })).data as unknown as Alcance;
  const nueva = async (titulo: string, mensaje = "Este viernes con la receta de la casa. ¡Te esperamos!", publico = "todos") =>
    dueno.rpc("guardar_campana", { _tenant_id: DEMO.tenant, _titulo: titulo, _mensaje: mensaje, _publico: publico });
  const enviar = async (id: string, token = tokenDueno) => {
    const r = await llamarFuncion("enviar-campana", { campana_id: id }, token);
    return { status: r.status, cuerpo: JSON.parse(r.cuerpo) as Record<string, unknown> };
  };
  const limpiar = () => sql(`DELETE FROM campanas WHERE tenant_id = '${DEMO.tenant}'; DELETE FROM bajas_campanas WHERE tenant_id = '${DEMO.tenant}';
                             DELETE FROM suscripciones_push WHERE endpoint LIKE 'https://push.prueba.invalid/%';`);

  beforeAll(async () => {
    ({ cliente: dueno, token: tokenDueno } = await conSesion("owner"));
    cliente = (await (await conSesion("cliente")).cliente.auth.getUser()).data.user!.id;
    if (esBaseLocal) {
      limpiar();
      // Las pruebas corren a cualquier hora: el horario permitido se abre solo en la base desechable
      sql(`INSERT INTO configuracion_tablio (clave, valor) VALUES ('campanas', '{"desde_hora": 0, "hasta_hora": 24}')
           ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor;
           INSERT INTO consentimientos_comensal (user_id, promociones, politica_version) VALUES ('${cliente}', true, 'prueba')
           ON CONFLICT (user_id) DO UPDATE SET promociones = true;`);
    }
  });
  afterAll(() => {
    if (!esBaseLocal) return;
    limpiar();
    sql(`DELETE FROM configuracion_tablio WHERE clave = 'campanas'`);
  });

  it("solo el dueño o el administrador (o el encargado si se lo dan) arman y ven campañas", async () => {
    expect((await dueno.rpc("resultados_campanas", { _tenant_id: DEMO.tenant })).error).toBeNull();
    expect((await (await conSesion("admin")).cliente.rpc("publico_campana", { _tenant_id: DEMO.tenant, _publico: "todos" })).error).toBeNull();
    const otros: SupabaseClient[] = [(await conSesion("cashier")).cliente, (await conSesion("waiter")).cliente, (await conSesion("kitchen")).cliente,
      (await conSesion("cliente")).cliente, await invitado(), anonimo()];
    if (process.env.DEMO_CREDENCIALES) otros.push((await conSesion("owner_ajeno")).cliente);
    for (const c of otros) {
      expect((await c.rpc("publico_campana", { _tenant_id: DEMO.tenant, _publico: "todos" })).error).not.toBeNull();
      expect((await c.rpc("guardar_campana", { _tenant_id: DEMO.tenant, _titulo: "Hola", _mensaje: "Un mensaje de prueba", _publico: "todos" })).error).not.toBeNull();
      expect((await c.rpc("resultados_campanas", { _tenant_id: DEMO.tenant })).error).not.toBeNull();
      for (const t of ["campanas", "envios_campana", "bajas_campanas"]) {
        expect((await c.from(t as never).select("*").eq("tenant_id", DEMO.tenant).limit(1)).data ?? [], t).toHaveLength(0);
      }
    }
    // Ni el dueño lee los envíos (a quién se le escribió) ni las direcciones de los celulares
    expect((await dueno.from("envios_campana" as never).select("*").limit(1)).data ?? []).toHaveLength(0);
    expect((await dueno.rpc("_avisos_por_mandar" as never, { _campana_id: "00000000-0000-0000-0000-000000000000" } as never)).error).not.toBeNull();
  });

  it("sin enlaces y nada que premie tomar más alcohol", async () => {
    expect((await nueva("Visítanos", "Entra a www.promo-falsa.cl y gana")).error?.message).toContain("enlaces");
    expect((await nueva("Viernes de schop", "2x1 en schops toda la noche")).error?.message).toContain("alcohol");
    expect((await nueva("Happy hour", "Ven al happy hour del jueves")).error?.message).toContain("alcohol");
    if (esBaseLocal) expect((await nueva("Volvió el pastel de choclo")).error).toBeNull();
  });

  it.skipIf(!esBaseLocal)("solo le llega a quien aceptó, tiene cuenta y junta sellos aquí; y no a quien se dio de baja", async () => {
    // El cliente de ejemplo fue hace 3, 8, 13 y 19 días: es frecuente, no está "dormido"
    expect((await alcance("todos")).total).toBe(1);
    expect((await alcance("frecuentes")).total).toBe(1);
    expect((await alcance("dormidos")).total).toBe(0);
    // Sin consentimiento, nadie
    sql(`UPDATE consentimientos_comensal SET promociones = false WHERE user_id = '${cliente}'`);
    expect((await alcance("todos")).total).toBe(0);
    sql(`UPDATE consentimientos_comensal SET promociones = true WHERE user_id = '${cliente}'`);
    // Sin cuenta guardada (invitado), tampoco: se prueba volviéndolo invitado por un momento
    expect(sqlSesion(`BEGIN;
      UPDATE auth.users SET is_anonymous = true WHERE id = '${cliente}';
      SELECT 'n:' || count(*) FROM public._destinatarios_campana('${DEMO.tenant}', 'todos', NULL);
      ROLLBACK;`)).toContain("n:0");
  });

  it.skipIf(!esBaseLocal)("se envía una vez (aunque se apriete dos veces), descansa 7 días y el aviso no repite", async () => {
    const id = (await nueva("Volvió el pastel de choclo")).data as string;
    const [a, b] = await Promise.all([enviar(id), enviar(id)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(sql(`SELECT count(*) FROM envios_campana WHERE campana_id = '${id}'`)).toBe("1");
    // Sin la app instalada: queda para el correo (sin aviso)
    expect(sql(`SELECT estado FROM envios_campana WHERE campana_id = '${id}'`)).toBe("sin_aviso");
    expect((await enviar(id)).cuerpo.ya_enviada).toBe(true);
    // Una enviada no se cambia ni se borra
    expect((await dueno.rpc("guardar_campana", { _tenant_id: DEMO.tenant, _titulo: "Otro", _mensaje: "Otro mensaje más", _publico: "todos", _campana_id: id })).error).not.toBeNull();
    expect((await dueno.rpc("borrar_campana", { _campana_id: id })).error).not.toBeNull();
    // Recién recibió una: descansa
    expect((await alcance("todos"))).toMatchObject({ total: 1, descansando: 1 });
    const otra = (await nueva("Llegó la cazuela")).data as string;
    expect((await enviar(otra)).cuerpo.destinatarios).toBe(0);
  });

  it.skipIf(!esBaseLocal)("con la app instalada, el aviso sale desde el servidor y se anota si llegó", async () => {
    sql(`UPDATE envios_campana SET created_at = now() - interval '8 days' WHERE tenant_id = '${DEMO.tenant}';
         DELETE FROM campanas WHERE tenant_id = '${DEMO.tenant}' AND estado = 'enviada';
         INSERT INTO suscripciones_push (tenant_id, user_id, endpoint, p256dh, auth)
         VALUES ('${DEMO.tenant}', '${cliente}', 'https://push.prueba.invalid/${Date.now()}',
                 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', 'tBHItJI5svbpez7KI4CCXg');`);
    const id = (await nueva("Probando avisos")).data as string;
    const r = await enviar(id);
    expect(r.status).toBe(200);
    expect(r.cuerpo).toMatchObject({ destinatarios: 1, con_aviso: 1 });
    // Ese "celular" no existe: el aviso queda como fallido (y se ve en los resultados)
    const fila = ((await dueno.rpc("resultados_campanas", { _tenant_id: DEMO.tenant })).data as { id: string; fallidos: number; entregados: number }[]).find((c) => c.id === id)!;
    expect(fila).toMatchObject({ entregados: 0, fallidos: 1 });
    // El resultado nunca trae direcciones de celulares
    expect(JSON.stringify(fila)).not.toContain("push.prueba.invalid");
  });

  it.skipIf(!esBaseLocal)("el enlace del aviso abre la promoción, mide la apertura y permite darse de baja", async () => {
    const token = sql(`SELECT token FROM envios_campana WHERE tenant_id = '${DEMO.tenant}' ORDER BY created_at DESC LIMIT 1`);
    const promo = (await anonimo().rpc("ver_promo", { _token: token })).data as { titulo: string; local: string; de_baja: boolean };
    expect(promo).toMatchObject({ titulo: "Probando avisos", de_baja: false });
    expect(JSON.stringify(promo)).not.toContain(cliente);
    expect((await anonimo().rpc("ver_promo", { _token: "f".repeat(32) })).data).toBeNull();
    expect((await anonimo().rpc("ver_promo", { _token: "' OR 1=1 --" })).data).toBeNull();
    const fila = ((await dueno.rpc("resultados_campanas", { _tenant_id: DEMO.tenant })).data as { titulo: string; abiertos: number }[]).find((c) => c.titulo === "Probando avisos")!;
    expect(fila.abiertos).toBe(1);
    // Se da de baja: ya no está en ningún público de este local
    expect((await anonimo().rpc("baja_promo", { _token: token })).data).toBe(true);
    expect((await alcance("todos")).total).toBe(0);
    expect(((await anonimo().rpc("ver_promo", { _token: token })).data as { de_baja: boolean }).de_baja).toBe(true);
    sql(`DELETE FROM bajas_campanas WHERE tenant_id = '${DEMO.tenant}'`);
  });

  it.skipIf(!esBaseLocal)("se mide quién volvió y cuánto gastó en los 7 días siguientes", async () => {
    const id = sql(`SELECT id FROM campanas WHERE tenant_id = '${DEMO.tenant}' AND titulo = 'Probando avisos'`);
    // El cliente vuelve y paga (un cobro del mozo que queda a su nombre)
    const inv = await invitado();
    await inv.rpc("unirse_a_mesa", { _qr_token: qrMesa(6)! });
    await confirmarPresencia(inv, 6);
    const agua = (await anonimo().from("menu_items").select("id").eq("tenant_id", DEMO.tenant).eq("name", "Agua mineral").single()).data!.id;
    const p = (await inv.rpc("pedir_sin_pagar", { _qr_token: qrMesa(6)!, _items: [{ menu_item_id: agua, quantity: 1 }], _forma: "mozo" })).data as { order_id: string };
    const cobro = (await (await conSesion("cashier")).cliente.rpc("registrar_cobro_mozo", { _order_ids: [p.order_id], _metodo: "cash" })).data as { payment_id: string; total: number };
    sql(`UPDATE payments SET user_id = '${cliente}' WHERE id = '${cobro.payment_id}'`);
    const fila = ((await dueno.rpc("resultados_campanas", { _tenant_id: DEMO.tenant })).data as { id: string; volvieron: number; ventas: number }[]).find((c) => c.id === id)!;
    expect(fila.volvieron).toBe(1);
    expect(fila.ventas).toBeGreaterThan(0);
    // El cliente ve en sus datos qué campañas recibió
    const datos = (await (await conSesion("cliente")).cliente.rpc("mis_datos")).data as { campanas_recibidas: { titulo: string }[] };
    expect(datos.campanas_recibidas.map((c) => c.titulo)).toContain("Probando avisos");
  });

  it.skipIf(!esBaseLocal)("límites: fuera de horario no sale y hay máximo 4 campañas en 30 días", async () => {
    sql(`UPDATE configuracion_tablio SET valor = '{"desde_hora": 23, "hasta_hora": 23}' WHERE clave = 'campanas'`);
    const id = (await nueva("Fuera de horario")).data as string;
    const r = await enviar(id);
    expect(r.status).toBe(409);
    expect(String(r.cuerpo.error)).toContain("entre las");
    sql(`UPDATE configuracion_tablio SET valor = '{"desde_hora": 0, "hasta_hora": 24}' WHERE clave = 'campanas'`);
    const enviadas = Number(sql(`SELECT count(*) FROM campanas WHERE tenant_id = '${DEMO.tenant}' AND estado = 'enviada'`));
    for (let i = enviadas; i < 4; i++) expect((await enviar((await nueva(`Campaña ${i}`)).data as string)).status).toBe(200);
    const quinta = await enviar((await nueva("La quinta")).data as string);
    expect(quinta.status).toBe(409);
    expect(String(quinta.cuerpo.error)).toContain("30 días");
    // Un mozo no la puede mandar, aunque tenga el id
    expect((await enviar(id, (await conSesion("waiter")).token)).status).toBe(403);
  });

  it.skipIf(!esBaseLocal)("las auditorías salen vacías y detectan un aviso a quien se dio de baja", async () => {
    const superadmin = (await conSesion("superadmin")).cliente;
    for (const fn of ["auditoria_seguridad", "auditoria_plata", "auditoria_operacion"] as const) {
      expect((await superadmin.rpc(fn)).data ?? [], fn).toEqual([]);
    }
    const salida = sqlSesion(`
      BEGIN;
      SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT user_id FROM platform_admins LIMIT 1), 'role', 'authenticated')::text, true) IS NULL;
      INSERT INTO bajas_campanas (tenant_id, user_id, created_at) VALUES ('${DEMO.tenant}', '${cliente}', now() - interval '30 days');
      SELECT 'hallazgo:' || tipo FROM auditoria_operacion();
      ROLLBACK;`);
    expect(salida).toContain("hallazgo:envio_campana_incoherente");
  });
});
