import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonimo, conSesion, confirmarPresencia, esBaseLocal, hayCredenciales, invitado, qrMesa, DEMO } from "./entorno";

// Fase 6.3 — Permisos finos: el dueño decide qué puede hacer cada rol y la base lo hace cumplir. Lo que
// cambia permisos corre en la base desechable (en la real no se tocan los permisos del demo).

const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();
const hoy = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });

type Fila = { permiso: string; roles: Record<string, { permitido: boolean; posible: boolean; de_fabrica: boolean }> };

describe.skipIf(!hayCredenciales)("permisos finos por rol", () => {
  let dueno: SupabaseClient;
  let caja: SupabaseClient;
  let mozo: SupabaseClient;
  let cocina: SupabaseClient;
  let agua: string;
  const guardar = (c: SupabaseClient, rol: string, permiso: string, permitido: boolean) =>
    c.rpc("guardar_permiso_rol", { _tenant_id: DEMO.tenant, _rol: rol, _permiso: permiso, _permitido: permitido });
  const pedidoEsperando = async (mesa: number) => {
    const c = await invitado();
    await c.rpc("unirse_a_mesa", { _qr_token: qrMesa(mesa)! });
    await confirmarPresencia(c, mesa);
    return ((await c.rpc("pedir_sin_pagar", { _qr_token: qrMesa(mesa)!, _items: [{ menu_item_id: agua, quantity: 1 }], _forma: "mozo" })).data as { order_id: string }).order_id;
  };

  beforeAll(async () => {
    dueno = (await conSesion("owner")).cliente;
    caja = (await conSesion("cashier")).cliente;
    mozo = (await conSesion("waiter")).cliente;
    cocina = (await conSesion("kitchen")).cliente;
    agua = (await anonimo().from("menu_items").select("id").eq("tenant_id", DEMO.tenant).eq("name", "Agua mineral").single()).data!.id;
  });
  afterAll(() => {
    if (esBaseLocal) sql(`DELETE FROM permisos_rol WHERE tenant_id = '${DEMO.tenant}'`);
  });

  it("solo el dueño o el administrador ven y cambian los permisos; nadie los escribe directo", async () => {
    const tabla = (await dueno.rpc("permisos_del_local", { _tenant_id: DEMO.tenant })).data as unknown as Fila[];
    expect(tabla.map((f) => f.permiso)).toEqual(["cobrar", "tomar_pedidos", "anular_pedidos", "reembolsar", "cerrar_caja", "ver_reportes", "editar_carta", "marcar_agotado"]);
    expect((await (await conSesion("admin")).cliente.rpc("permisos_del_local", { _tenant_id: DEMO.tenant })).error).toBeNull();
    const otros = [caja, mozo, cocina, await invitado(), anonimo()];
    if (process.env.DEMO_CREDENCIALES) otros.push((await conSesion("owner_ajeno")).cliente);
    for (const c of otros) {
      expect((await c.rpc("permisos_del_local", { _tenant_id: DEMO.tenant })).error).not.toBeNull();
      expect((await guardar(c, "waiter", "cobrar", false)).error).not.toBeNull();
      expect((await c.from("permisos_rol" as never).select("permiso").eq("tenant_id", DEMO.tenant)).data ?? []).toHaveLength(0);
    }
    // Ni el dueño escribe la tabla directo: solo con guardar_permiso_rol
    expect((await dueno.from("permisos_rol" as never).insert({ tenant_id: DEMO.tenant, rol: "waiter", permiso: "reembolsar", permitido: true } as never)).error).not.toBeNull();
  });

  it("la plata no se le da a quien no la puede ver: hay combinaciones que no existen", async () => {
    for (const [rol, permiso] of [["waiter", "reembolsar"], ["waiter", "cerrar_caja"], ["kitchen", "cobrar"], ["kitchen", "editar_carta"], ["owner", "reembolsar"], ["waiter", "inventado"]]) {
      expect((await guardar(dueno, rol, permiso, true)).error, `${rol}/${permiso}`).not.toBeNull();
    }
  });

  it("cada persona recibe sus permisos; los de fábrica son los de siempre", async () => {
    const permisos = async (c: SupabaseClient) =>
      ((await c.rpc("mi_perfil")).data as unknown as { locales: { tenant_id: string; permisos: string[] }[] }).locales.find((l) => l.tenant_id === DEMO.tenant)!.permisos;
    expect(await permisos(dueno)).toHaveLength(8);
    if (esBaseLocal) {
      expect(await permisos(caja)).toEqual(["cobrar", "reembolsar", "cerrar_caja"]);
      expect(await permisos(mozo)).toEqual(["cobrar", "tomar_pedidos"]);
      expect(await permisos(cocina)).toEqual(["marcar_agotado"]);
    }
  });

  it.skipIf(!esBaseLocal)("lo que el dueño quita, la base lo bloquea; lo que da, funciona", async () => {
    // El mozo sin permiso para cobrar
    const pedido = await pedidoEsperando(9);
    expect((await guardar(dueno, "waiter", "cobrar", false)).error).toBeNull();
    const sinPermiso = await mozo.rpc("registrar_cobro_mozo", { _order_ids: [pedido], _metodo: "cash" });
    expect(sinPermiso.error?.message).toContain("no tiene permiso para cobrar");
    expect((await guardar(dueno, "waiter", "cobrar", true)).error).toBeNull();
    expect((await mozo.rpc("registrar_cobro_mozo", { _order_ids: [pedido], _metodo: "cash" })).error).toBeNull();

    // La caja sin cortes ni cierre
    expect((await guardar(dueno, "cashier", "cerrar_caja", false)).error).toBeNull();
    expect((await caja.rpc("hacer_corte_caja", { _branch_id: DEMO.sucursal, _efectivo_contado: 0 })).error?.message).toContain("no tiene permiso");
    expect((await caja.rpc("cerrar_caja", { _branch_id: DEMO.sucursal, _dia: "2001-01-01", _efectivo_contado: 0 })).error?.message).toContain("no tiene permiso");

    // La caja con reportes, anular pedidos y la carta
    expect((await caja.rpc("reporte_local", { _branch_id: DEMO.sucursal, _desde: hoy(), _hasta: hoy() })).error).not.toBeNull();
    for (const p of ["ver_reportes", "anular_pedidos", "editar_carta"]) expect((await guardar(dueno, "cashier", p, true)).error).toBeNull();
    expect((await caja.rpc("reporte_local", { _branch_id: DEMO.sucursal, _desde: hoy(), _hasta: hoy() })).error).toBeNull();
    const otro = await pedidoEsperando(9);
    expect((await caja.rpc("cambiar_estado_pedido", { _order_id: otro, _estado: "cancelled", _motivo: "Cliente se fue" })).error).toBeNull();
    const precio = sql(`SELECT price FROM menu_items WHERE id = '${agua}'`);
    const descripcion = sql(`SELECT coalesce(description_short, '') FROM menu_items WHERE id = '${agua}'`);
    const editado = await caja.from("menu_items").update({ description_short: "Con o sin gas" }).eq("id", agua).select("id");
    expect(editado.data).toHaveLength(1);
    expect(sql(`SELECT price FROM menu_items WHERE id = '${agua}'`)).toBe(precio);

    // La cocina sin marcar agotados
    expect((await guardar(dueno, "kitchen", "marcar_agotado", false)).error).toBeNull();
    expect((await cocina.rpc("marcar_agotado", { _menu_item_id: agua, _agotado: true })).error).not.toBeNull();

    // Cada cambio quedó registrado: quién, qué rol, qué permiso, antes y ahora
    const registro = sql(`SELECT count(*) FROM audit_logs WHERE tenant_id = '${DEMO.tenant}' AND action = 'permiso_cambiado' AND created_at > now() - interval '5 minutes'`);
    expect(Number(registro)).toBeGreaterThanOrEqual(7);

    // De vuelta a lo de fábrica: la caja ya no edita la carta
    sql(`DELETE FROM permisos_rol WHERE tenant_id = '${DEMO.tenant}'`);
    expect((await caja.from("menu_items").update({ description_short: "Otra" }).eq("id", agua).select("id")).data ?? []).toHaveLength(0);
    sql(`UPDATE menu_items SET description_short = nullif('${descripcion.replace(/'/g, "''")}', '') WHERE id = '${agua}'`);
    expect((await (await conSesion("superadmin")).cliente.rpc("auditoria_seguridad")).data ?? []).toHaveLength(0);
  });
});
