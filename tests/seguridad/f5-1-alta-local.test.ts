import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonimo, conSesion, esBaseLocal, hayCredenciales, invitado, llamarFuncion } from "./entorno";

// Fase 5.1 — Alta del local por Tablio: el local se crea completo de una vez en el servidor (sucursal, carta,
// mesas con QR y código, estación principal) y el dueño lo activa con un enlace de un solo uso, eligiendo su
// propia contraseña. Lo que crea locales solo corre en la base desechable (no se llenan de locales de prueba
// los datos reales); en la real se prueba que nadie más pueda crearlos.

const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();
const unico = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

type Creado = { tenant_id: string; branch_id: string; slug: string; token: string };

describe.skipIf(!hayCredenciales)("alta del local por Tablio", () => {
  let superadmin: SupabaseClient;
  const crear = async (c: SupabaseClient, extra: Record<string, unknown> = {}) => {
    const id = unico();
    return c.rpc("crear_local", { _nombre: `Bar Prueba ${id}`, _slug: `bar-prueba-${id}`, _correo_dueno: `dueno-${id}@demo.tablio.test`, _mesas: 6, ...extra });
  };
  const activar = (token: string, cuerpo: Record<string, unknown> = {}, jwt?: string) =>
    llamarFuncion("activar-local", { token, nombre: "Dueña de Prueba", password: "clave-segura-123", ...cuerpo }, jwt);

  beforeAll(async () => {
    superadmin = (await conSesion("superadmin")).cliente;
  });

  it("nadie fuera de Tablio da de alta locales (ni el dueño de un local, ni el mozo, ni un cliente, ni alguien sin sesión)", async () => {
    for (const rol of ["owner", "waiter", "cashier", "finanzas"]) {
      const r = await crear((await conSesion(rol)).cliente);
      expect(r.error?.message, rol).toContain("Solo Tablio");
    }
    expect((await crear(await invitado())).error).not.toBeNull();
    expect((await crear(anonimo())).error).not.toBeNull();
    // Ni pedir un enlace nuevo, ni ver las activaciones, ni leer los enlaces
    const dueno = (await conSesion("owner")).cliente;
    expect((await dueno.rpc("estado_activaciones")).error).not.toBeNull();
    expect((await dueno.rpc("nuevo_enlace_activacion", { _tenant_id: "00000000-0000-0000-0000-000000000000" })).error).not.toBeNull();
    expect((await superadmin.from("activaciones_local" as never).select("token").limit(1)).data ?? []).toHaveLength(0);
    // Un enlace inventado no dice nada
    expect((await anonimo().rpc("ver_activacion", { _token: "0".repeat(48) })).data).toMatchObject({ estado: "no_existe" });
    expect((await activar("0".repeat(48))).status).toBe(409);
    expect((await activar("corto")).status).toBe(400);
  });

  it.skipIf(!esBaseLocal)("el superadmin crea el local completo de una vez; las auditorías siguen vacías", async () => {
    const r = await crear(superadmin, { _mesas: 12, _modo: "open_tab", _color: "#112233" });
    expect(r.error).toBeNull();
    const c = r.data as unknown as Creado;
    expect(c.token).toMatch(/^[0-9a-f]{48}$/);
    // Mesas con QR y código de presencia, estación principal, carta vacía; sin cobros con la app
    expect(sql(`SELECT count(*) FROM tables WHERE branch_id = '${c.branch_id}' AND qr_token IS NOT NULL`)).toBe("12");
    expect(sql(`SELECT count(*) FROM codigos_mesa cm JOIN tables t ON t.id = cm.table_id WHERE t.branch_id = '${c.branch_id}'`)).toBe("12");
    expect(sql(`SELECT count(*) FROM stations WHERE branch_id = '${c.branch_id}' AND es_predeterminada`)).toBe("1");
    expect(sql(`SELECT count(*) FROM menus WHERE branch_id = '${c.branch_id}'`)).toBe("1");
    expect(sql(`SELECT payment_mode || '|' || pagos_simulados || '|' || is_open FROM branches WHERE id = '${c.branch_id}'`)).toBe("open_tab|false|false");
    expect(sql(`SELECT primary_color || '|' || plan_status FROM tenants WHERE id = '${c.tenant_id}'`)).toBe("#112233|trial");
    // Todavía no tiene dueño: nadie entra hasta que se active
    expect(sql(`SELECT count(*) FROM tenant_members WHERE tenant_id = '${c.tenant_id}'`)).toBe("0");
    expect(sql(`SELECT count(*) FROM audit_logs WHERE entity_id = '${c.tenant_id}' AND action = 'local_creado'`)).toBe("1");
    for (const fn of ["auditoria_seguridad", "auditoria_plata", "auditoria_operacion"] as const) {
      expect((await superadmin.rpc(fn)).data ?? [], fn).toHaveLength(0);
    }
  });

  it.skipIf(!esBaseLocal)("datos malos no crean nada: dirección repetida o reservada, correo o mesas inválidos", async () => {
    const ok = (await crear(superadmin)).data as unknown as Creado;
    expect((await crear(superadmin, { _slug: ok.slug })).error?.message).toContain("ya la usa otro local");
    expect((await crear(superadmin, { _slug: "admin" })).error?.message).toContain("reservada");
    expect((await crear(superadmin, { _slug: "Con Espacios" })).error?.message).toContain("minúsculas");
    expect((await crear(superadmin, { _correo_dueno: "no-es-correo" })).error?.message).toContain("correo");
    expect((await crear(superadmin, { _mesas: 0 })).error?.message).toContain("mesas");
    expect((await crear(superadmin, { _mesas: 500 })).error?.message).toContain("mesas");
    expect((await crear(superadmin, { _color: "rojo" })).error?.message).toContain("color");
  });

  it.skipIf(!esBaseLocal)("el dueño activa su local con su propia contraseña; el enlace sirve una sola vez, aunque lo usen dos a la vez", async () => {
    const c = (await crear(superadmin, { _nombre_dueno: "Carla" })).data as unknown as Creado;
    const vista = (await anonimo().rpc("ver_activacion", { _token: c.token })).data as { estado: string; correo: string; nombre: string };
    expect(vista).toMatchObject({ estado: "vigente", nombre: "Carla" });
    expect(vista.correo).toMatch(/^d•••@demo\.tablio\.test$/);
    expect((await activar(c.token, { password: "corta" })).status).toBe(400);

    const [a, b] = await Promise.all([activar(c.token), activar(c.token)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const ok = JSON.parse((a.status === 200 ? a : b).cuerpo) as { slug: string; correo: string };
    expect(ok.slug).toBe(c.slug);
    expect((await anonimo().rpc("ver_activacion", { _token: c.token })).data).toMatchObject({ estado: "usado" });

    // Entra con su contraseña y es dueño de su local (y solo de él)
    const dueno = anonimo();
    expect((await dueno.auth.signInWithPassword({ email: ok.correo, password: "clave-segura-123" })).error).toBeNull();
    const yo = (await dueno.auth.getUser()).data.user!.id;
    expect(sql(`SELECT string_agg(role || ':' || tenant_id, ',') FROM tenant_members WHERE user_id = '${yo}'`)).toBe(`owner:${c.tenant_id}`);
    expect((await dueno.from("branches").update({ is_open: true }).eq("id", c.branch_id)).error).toBeNull();
    expect(sql(`SELECT is_open FROM branches WHERE id = '${c.branch_id}'`)).toBe("t");
    expect(sql(`SELECT count(*) FROM audit_logs WHERE entity_id = '${c.tenant_id}' AND action = 'local_activado'`)).toBe("1");
    // Un enlace nuevo ya no se puede pedir: el dueño ya activó
    expect((await superadmin.rpc("nuevo_enlace_activacion", { _tenant_id: c.tenant_id })).error?.message).toContain("ya activó");
  });

  it.skipIf(!esBaseLocal)("si el dueño ya tiene cuenta con ese correo, entra con ella y suma el local; con otra cuenta, no", async () => {
    const id = unico();
    const correo = `multi-${id}@demo.tablio.test`;
    const primero = (await crear(superadmin, { _correo_dueno: correo })).data as unknown as Creado;
    expect((await activar(primero.token)).status).toBe(200);
    const segundo = (await crear(superadmin, { _correo_dueno: correo })).data as unknown as Creado;
    // Sin entrar: le avisa que ya tiene cuenta (y el enlace sigue sirviendo)
    const sinEntrar = await activar(segundo.token);
    expect(sinEntrar.status).toBe(409);
    expect(JSON.parse(sinEntrar.cuerpo)).toMatchObject({ ya_tiene_cuenta: true });
    expect((await anonimo().rpc("ver_activacion", { _token: segundo.token })).data).toMatchObject({ estado: "vigente" });
    // Con otra cuenta, no
    const otro = (await conSesion("cliente")).token;
    expect((await llamarFuncion("activar-local", { token: segundo.token }, otro)).status).toBe(403);
    // Con la suya, sí
    const dueno = anonimo();
    await dueno.auth.signInWithPassword({ email: correo, password: "clave-segura-123" });
    const jwt = (await dueno.auth.getSession()).data.session!.access_token;
    expect((await llamarFuncion("activar-local", { token: segundo.token }, jwt)).status).toBe(200);
    const yo = (await dueno.auth.getUser()).data.user!.id;
    expect(sql(`SELECT count(*) FROM tenant_members WHERE user_id = '${yo}' AND role = 'owner'`)).toBe("2");
  });

  it.skipIf(!esBaseLocal)("un enlace nuevo deja sin efecto el anterior; uno vencido no sirve", async () => {
    const c = (await crear(superadmin)).data as unknown as Creado;
    const nuevo = ((await superadmin.rpc("nuevo_enlace_activacion", { _tenant_id: c.tenant_id })).data as { token: string }).token;
    expect(nuevo).not.toBe(c.token);
    expect((await anonimo().rpc("ver_activacion", { _token: c.token })).data).toMatchObject({ estado: "anulado" });
    expect((await activar(c.token)).status).toBe(409);
    const estado = ((await superadmin.rpc("estado_activaciones")).data as { tenant_id: string; activado_at: string | null }[]).find((x) => x.tenant_id === c.tenant_id);
    expect(estado).toMatchObject({ activado_at: null });
    sql(`UPDATE activaciones_local SET expires_at = now() - interval '1 minute' WHERE token = '${nuevo}'`);
    expect((await anonimo().rpc("ver_activacion", { _token: nuevo })).data).toMatchObject({ estado: "vencido" });
    expect((await activar(nuevo)).status).toBe(409);
  });

  it.skipIf(!esBaseLocal)("el equipo de ventas también da de alta, y el posible cliente queda como convertido", async () => {
    const vendedor = (await conSesion("vendedor")).cliente;
    const lead = sql(`INSERT INTO leads (restaurant_name, stage, source) VALUES ('Lead ${unico()}', 'demo_hecha', 'terreno') RETURNING id`).split("\n")[0];
    const r = await crear(vendedor, { _lead_id: lead });
    expect(r.error).toBeNull();
    const c = r.data as unknown as Creado;
    expect(sql(`SELECT converted_tenant_id || '|' || stage FROM leads WHERE id = '${lead}'`)).toBe(`${c.tenant_id}|piloto_activo`);
  });
});
