import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonimo, conSesion, esBaseLocal, guardarCuenta, hayCredenciales, invitado, llamarFuncion, qrMesa, DEMO } from "./entorno";

// Fase 9.6 — Compuerta de la fase 9 (comunidad). No depende del orden de los archivos: arma lo que necesita.
// Revisa el aislamiento de todo lo nuevo, los casos difíciles que cruzan etapas (suspender a alguien lo saca
// de todo, borrar una cuenta lo borra todo, pedidos de amistad cruzados a la vez, muchos "salud" a la vez,
// dos personas respondiendo la misma invitación a la vez) y las tres auditorías: vacías y atentas.

const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();
const TABLAS = ["perfiles_comunidad", "amistades", "bloqueos_usuario", "reportes_comunidad", "planes_amigos", "plan_invitados",
  "recomendaciones_amigos", "presencias_comunidad", "saludos_amigos"];

describe.skipIf(!hayCredenciales)("compuerta de la fase 9", () => {
  const auditorias = async () => {
    const sa = (await conSesion("superadmin")).cliente;
    const salida: string[] = [];
    for (const fn of ["auditoria_seguridad", "auditoria_plata", "auditoria_operacion"] as const) {
      const { data, error } = await sa.rpc(fn);
      expect(error, fn).toBeNull();
      for (const h of (data ?? []) as Record<string, string>[]) salida.push(`${fn}: ${Object.values(h).join(" · ")}`);
    }
    return salida;
  };

  it("todo lo de la comunidad está aislado: nadie fuera de Tablio lo lee directo", async () => {
    const quienes: [string, SupabaseClient][] = [["anónimo", anonimo()], ["invitado", await invitado()]];
    for (const rol of ["cliente", "owner", "admin", "waiter", "cashier", "owner_ajeno", "vendedor", "finanzas"]) {
      const c = await conSesion(rol).then((s) => s.cliente, () => null);
      if (c) quienes.push([rol, c]);
    }
    for (const [quien, c] of quienes) {
      for (const t of TABLAS) expect((await c.from(t as never).select("*").limit(1)).data ?? [], `${quien}: ${t}`).toHaveLength(0);
      // Las invitaciones entre mesas solo las ve el personal de ese local
      if (!["owner", "admin", "waiter", "cashier"].includes(quien)) {
        expect((await c.from("invitaciones_mesa" as never).select("*").eq("tenant_id", DEMO.tenant).limit(1)).data ?? [], `${quien}: invitaciones`).toHaveLength(0);
      }
      expect((await c.rpc("reportes_comunidad_abiertos")).error, quien).not.toBeNull();
    }
  });

  describe.skipIf(!esBaseLocal)("casos difíciles", () => {
    let ana: SupabaseClient, beto: SupabaseClient;
    let agua = "";
    const id = async (c: SupabaseClient) => (await c.auth.getUser()).data.user!.id;
    const persona = async (nombre: string, mesa: number) => {
      const c = await invitado();
      await c.rpc("unirse_a_mesa", { _qr_token: qrMesa(mesa)!, _alias: nombre });
      await guardarCuenta(c, `f9c-${nombre.toLowerCase()}-${Date.now()}@demo.tablio.test`);
      await c.rpc("activar_comunidad", { _nombre: nombre, _acepto: true });
      return c;
    };
    const pagarAgua = async (c: SupabaseClient, mesa: number) => {
      const cot = (await c.rpc("cotizar", { _qr_token: qrMesa(mesa)!, _items: [{ menu_item_id: agua, quantity: 1 }] })).data as { id: string };
      return llamarFuncion("process-payment", { table_token: qrMesa(mesa), method: "card", tip_amount: 0, cotizacion_id: cot.id, idempotency_key: `f9c-${Date.now()}-${Math.random()}` },
        (await c.auth.getSession()).data.session!.access_token);
    };

    beforeAll(async () => {
      agua = (await anonimo().from("menu_items").select("id").eq("tenant_id", DEMO.tenant).eq("name", "Agua mineral").single()).data!.id;
      const dueno = (await conSesion("owner")).cliente;
      for (const n of [3, 4]) await dueno.rpc("cerrar_mesa", { _table_id: sql(`SELECT id FROM tables WHERE branch_id = '${DEMO.sucursal}' AND number = ${n}`), _motivo: "preparar prueba" });
      ana = await persona("Ana", 3);
      beto = await persona("Beto", 4);
    });

    it("dos pedidos de amistad cruzados al mismo tiempo dejan una sola relación, aceptada", async () => {
      const [ca, cb] = [((await ana.rpc("mi_comunidad")).data as { codigo: string }).codigo, ((await beto.rpc("mi_comunidad")).data as { codigo: string }).codigo];
      await Promise.all([ana.rpc("pedir_amistad", { _codigo: cb }), beto.rpc("pedir_amistad", { _codigo: ca })]);
      const filas = sql(`SELECT estado FROM amistades WHERE least(de_user_id, para_user_id) = least('${await id(ana)}'::uuid, '${await id(beto)}'::uuid)
                         AND greatest(de_user_id, para_user_id) = greatest('${await id(ana)}'::uuid, '${await id(beto)}'::uuid)`).split("\n").filter(Boolean);
      expect(filas).toHaveLength(1);
      // Si quedó pendiente (llegaron justo a la vez), un nuevo pedido de quien la recibió la acepta
      if (filas[0] === "pendiente") {
        await ana.rpc("pedir_amistad", { _codigo: cb });
        await beto.rpc("pedir_amistad", { _codigo: ca });
      }
      expect(((await ana.rpc("mi_comunidad")).data as { amigos: { nombre: string }[] }).amigos.map((a) => a.nombre)).toEqual(["Beto"]);
    });

    it("muchos «salud» a la vez cuentan uno; dos personas respondiendo la misma invitación a la vez: gana una", async () => {
      await ana.rpc("avisar_que_estoy", { _qr_token: qrMesa(3)!, _activar: true });
      await beto.rpc("avisar_que_estoy", { _qr_token: qrMesa(4)!, _activar: true });
      const r = await Promise.all(Array.from({ length: 10 }, async () => ana.rpc("mandar_salud", { _qr_token: qrMesa(3)!, _amigo_id: await id(beto) })));
      expect(r.filter((x) => !x.error).length).toBeLessThanOrEqual(1);
      expect(Number(sql(`SELECT count(*) FROM saludos_amigos WHERE de_user_id = '${await id(ana)}'`))).toBe(1);

      sql(`UPDATE branches SET invitar_mesas = true WHERE id = '${DEMO.sucursal}'`);
      const caro = await invitado();
      await caro.rpc("unirse_a_mesa", { _qr_token: qrMesa(4)!, _alias: "Caro" });
      const inv = (await ana.rpc("invitar_otra_mesa", { _qr_token: qrMesa(3)!, _mesa: 4, _menu_item_id: agua })).data as string;
      const [acepta, rechaza] = await Promise.all([
        beto.rpc("responder_invitacion", { _qr_token: qrMesa(4)!, _invitacion_id: inv, _aceptar: true }),
        caro.rpc("responder_invitacion", { _qr_token: qrMesa(4)!, _invitacion_id: inv, _aceptar: false }),
      ]);
      expect([acepta.error, rechaza.error].filter((e) => e === null)).toHaveLength(1);
      expect(["aceptada", "rechazada"]).toContain(sql(`SELECT estado FROM invitaciones_mesa WHERE id = '${inv}'`));
      sql(`UPDATE branches SET invitar_mesas = false WHERE id = '${DEMO.sucursal}'`);
      expect(await auditorias()).toEqual([]);
    });

    it("si Tablio suspende a alguien, desaparece de todo: amigos, planes, recomendaciones y presencia", async () => {
      // Beto recomienda y está invitado a un plan de Ana; los dos avisan que están
      await pagarAgua(ana, 3);
      expect((await pagarAgua(beto, 4)).status).toBe(200);
      await beto.rpc("recomendar_plato", { _menu_item_id: agua });
      sql(`UPDATE recomendaciones_amigos SET created_at = now() - interval '25 hours', visible_desde = now() - interval '1 hour' WHERE user_id = '${await id(beto)}'`);
      await ana.rpc("crear_plan", { _tenant_id: DEMO.tenant, _fecha: new Date(Date.now() + 86_400_000).toISOString(), _amigos: [await id(beto)] });
      expect(((await ana.rpc("recomendaciones_de_amigos", { _tenant_id: DEMO.tenant })).data as unknown[]).length).toBe(1);
      await ana.rpc("reportar_usuario", { _user_id: await id(beto), _motivo: "Prueba de la compuerta" });
      const sa = (await conSesion("superadmin")).cliente;
      const rep = ((await sa.rpc("reportes_comunidad_abiertos")).data as { id: string; reportado: string; estado: string }[]).find((x) => x.reportado === "Beto" && x.estado === "abierto")!;
      expect((await sa.rpc("moderar_reporte", { _reporte_id: rep.id, _suspender: true, _nota: "Compuerta de la fase 9" })).error).toBeNull();

      expect(((await ana.rpc("mi_comunidad")).data as { amigos: unknown[] }).amigos).toEqual([]);
      expect((await ana.rpc("recomendaciones_de_amigos", { _tenant_id: DEMO.tenant })).data).toEqual([]);
      expect(((await ana.rpc("mis_planes")).data as { invitados: unknown[] }[])[0].invitados).toEqual([]);
      expect(((await ana.rpc("amigos_aqui", { _qr_token: qrMesa(3)! })).data as { amigos: unknown[] }).amigos).toEqual([]);
      expect(sql(`SELECT count(*) FROM presencias_comunidad WHERE user_id = '${await id(beto)}'`)).toBe("0");
      expect(await auditorias()).toEqual([]);
    });

    it("borrar la cuenta borra todo lo de la comunidad (y deja la plata del local sin su nombre)", async () => {
      const yo = await id(ana);
      const r = await llamarFuncion("borrar-mi-cuenta", { confirmar: true }, (await ana.auth.getSession()).data.session!.access_token);
      expect(r.status, r.cuerpo).toBe(200);
      for (const [t, col] of [["perfiles_comunidad", "user_id"], ["amistades", "de_user_id"], ["amistades", "para_user_id"], ["planes_amigos", "creador_id"],
                              ["plan_invitados", "user_id"], ["recomendaciones_amigos", "user_id"], ["presencias_comunidad", "user_id"],
                              ["saludos_amigos", "de_user_id"], ["bloqueos_usuario", "user_id"]]) {
        expect(sql(`SELECT count(*) FROM ${t} WHERE ${col} = '${yo}'`), `${t}.${col}`).toBe("0");
      }
      expect(sql(`SELECT count(*) FROM invitaciones_mesa WHERE de_user_id = '${yo}' AND (de_alias IS NOT NULL OR mensaje IS NOT NULL)`)).toBe("0");
      expect(await auditorias()).toEqual([]);
    });
  });

  it("las tres auditorías salen vacías", async () => {
    expect(await auditorias()).toEqual([]);
  });

  it.skipIf(!esBaseLocal)("y detectan lo de la fase 9 cuando algo no calza (se descuadra a propósito y se deshace)", async () => {
    const salida = execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1"], { input: `
      BEGIN;
      SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT user_id FROM platform_admins LIMIT 1), 'role', 'authenticated')::text, true) IS NULL;
      -- Dos perfiles nuevos, amigos y bloqueados; un plan que se invita a sí mismo; una recomendación sin desfase;
      -- un aviso de presencia de otro local
      INSERT INTO perfiles_comunidad (user_id, nombre, codigo, consentimiento_at)
        SELECT id, 'Z' || left(id::text, 4), 'TAB-' || upper(left(md5(id::text), 5)), now() FROM auth.users WHERE id NOT IN (SELECT user_id FROM perfiles_comunidad) LIMIT 2;
      INSERT INTO amistades (de_user_id, para_user_id, estado)
        SELECT (array_agg(user_id))[1], (array_agg(user_id))[2], 'aceptada' FROM (SELECT user_id FROM perfiles_comunidad WHERE nombre LIKE 'Z%' LIMIT 2) x;
      INSERT INTO bloqueos_usuario (user_id, bloqueado_id) SELECT de_user_id, para_user_id FROM amistades ORDER BY created_at DESC LIMIT 1;
      INSERT INTO planes_amigos (creador_id, tenant_id, fecha) SELECT user_id, '${DEMO.tenant}', now() + interval '1 day' FROM perfiles_comunidad WHERE nombre LIKE 'Z%' LIMIT 1;
      INSERT INTO plan_invitados (plan_id, user_id) SELECT id, creador_id FROM planes_amigos ORDER BY created_at DESC LIMIT 1;
      INSERT INTO recomendaciones_amigos (user_id, tenant_id, menu_item_id, visible_desde)
        SELECT (SELECT user_id FROM perfiles_comunidad WHERE nombre LIKE 'Z%' LIMIT 1), tenant_id, id, now() FROM menu_items WHERE tenant_id = '${DEMO.tenant}' LIMIT 1;
      INSERT INTO presencias_comunidad (user_id, tenant_id, session_id, hasta)
        SELECT (SELECT user_id FROM perfiles_comunidad WHERE nombre LIKE 'Z%' OFFSET 1 LIMIT 1), (SELECT id FROM tenants WHERE id <> '${DEMO.tenant}' LIMIT 1),
               (SELECT id FROM table_sessions WHERE tenant_id = '${DEMO.tenant}' LIMIT 1), now() + interval '1 hour';
      SELECT 'hallazgo:' || tipo FROM auditoria_operacion();
      ROLLBACK;` }).toString();
    for (const t of ["amistad_incoherente", "plan_incoherente", "recomendacion_incoherente", "presencia_incoherente"]) expect(salida, t).toContain(`hallazgo:${t}`);
  });
});
