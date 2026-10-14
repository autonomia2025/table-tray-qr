import { describe, it, expect, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonimo, conSesion, hayCredenciales, invitado, llamarFuncion, qrMesa, DEMO } from "./entorno";

// Fase 3.3 — Control del equipo: quién entregó, quién atendía la mesa (y su calificación), tiempos de
// respuesta y de entrega con objetivo, ranking y metas por mozo.

type Desempeno = { staff_id: string; mesas: number; pedidos_entregados: number; ventas: number; llamados: number;
  entregas: number; calificaciones: number; calificacion_promedio: number | null; llamado_promedio_min: number | null };

const hoy = () => new Date(Date.now() - 6 * 3_600_000).toLocaleDateString("en-CA", { timeZone: "America/Santiago" });

describe.skipIf(!hayCredenciales)("control del equipo", () => {
  let dueno: SupabaseClient;
  let mozo: SupabaseClient;
  let cocina: SupabaseClient;
  let miFicha: string;
  let miUsuario: string;
  let otroMozo: string;
  let item: string;
  const idMesa = async (n: number) => (await dueno.from("tables").select("id").eq("branch_id", DEMO.sucursal).eq("number", n).single()).data!.id as string;

  beforeAll(async () => {
    dueno = (await conSesion("owner")).cliente;
    mozo = (await conSesion("waiter")).cliente;
    cocina = (await conSesion("kitchen")).cliente;
    miUsuario = (await mozo.auth.getUser()).data.user!.id;
    miFicha = (await dueno.from("staff_users").select("id").eq("tenant_id", DEMO.tenant).eq("auth_user_id", miUsuario).single()).data!.id;
    otroMozo = (await dueno.from("staff_users").select("id").eq("tenant_id", DEMO.tenant).eq("role", "waiter").neq("id", miFicha).limit(1).single()).data!.id;
    item = (await anonimo().from("menu_items").select("id").eq("tenant_id", DEMO.tenant).eq("name", "Barros Luco").single()).data!.id;
  });

  it("queda anotado quién entregó, quién atendía la mesa y su calificación; el ranking lo muestra", async () => {
    const mesa = await idMesa(8);
    await dueno.rpc("cerrar_mesa", { _table_id: mesa, _motivo: "preparar prueba" });
    // Un cliente se sienta, la mozo toma la mesa, el cliente paga y llama
    const c = await invitado();
    await c.rpc("unirse_a_mesa", { _qr_token: qrMesa(8)! });
    expect((await mozo.rpc("tomar_mesa", { _table_id: mesa })).error).toBeNull();
    const token = (await c.auth.getSession()).data.session!.access_token;
    const r = await llamarFuncion("process-payment", {
      table_token: qrMesa(8), method: "card", cart_items: [{ menu_item_id: item, quantity: 1 }], idempotency_key: `equipo-${Date.now()}`,
    }, token);
    expect(r.status).toBe(200);
    const pedido = JSON.parse(r.cuerpo).order.id as string;
    const llamado = (await c.rpc("llamar_mozo", { _qr_token: qrMesa(8)!, _motivo: "help" })).data as { id: string };
    expect((await mozo.rpc("atender_llamado", { _id: llamado.id })).error).toBeNull();

    // La cocina lo deja listo y la mozo lo lleva: queda a su nombre
    expect((await cocina.rpc("cambiar_estado_pedido", { _order_id: pedido, _estado: "ready" })).error).toBeNull();
    expect((await mozo.rpc("cambiar_estado_pedido", { _order_id: pedido, _estado: "delivered" })).error).toBeNull();
    const { data: items } = await dueno.from("order_items").select("delivered_by").eq("order_id", pedido);
    expect(items!.every((i) => i.delivered_by === miUsuario)).toBe(true);

    // Cierra la mesa y el cliente califica: la calificación es de la mozo que la atendía
    expect((await mozo.rpc("cerrar_mesa", { _table_id: mesa })).error).toBeNull();
    expect((await c.rpc("calificar_mesa", { _qr_token: qrMesa(8)!, _estrellas: 5 })).error).toBeNull();
    const { data: ses } = await dueno.from("table_sessions").select("staff_id, rating").eq("table_id", mesa).order("opened_at", { ascending: false }).limit(1).single();
    expect(ses).toMatchObject({ staff_id: miFicha, rating: 5 });

    // El ranking del día la muestra con todo eso
    const ranking = await dueno.rpc("ranking_equipo", { _branch_id: DEMO.sucursal, _desde: hoy(), _hasta: hoy() });
    expect(ranking.error).toBeNull();
    const yo = (ranking.data as { mozos: Desempeno[] }).mozos.find((m) => m.staff_id === miFicha)!;
    expect(yo.mesas).toBeGreaterThanOrEqual(1);
    expect(yo.pedidos_entregados).toBeGreaterThanOrEqual(1);
    expect(yo.ventas).toBeGreaterThan(0);
    expect(yo.llamados).toBeGreaterThanOrEqual(1);
    expect(yo.llamado_promedio_min).not.toBeNull();
    expect(yo.calificaciones).toBeGreaterThanOrEqual(1);

    // Y ella ve su propio desempeño, con el avance de la meta general del demo
    const mio = await mozo.rpc("mi_desempeno", { _branch_id: DEMO.sucursal });
    expect(mio.error).toBeNull();
    const d = mio.data as { hoy: Desempeno; metas: { tipo: string; periodo: string; avance: number }[] };
    expect(d.hoy.ventas).toBe(yo.ventas);
    expect(d.metas.find((m) => m.tipo === "ventas" && m.periodo === "dia")?.avance).toBe(yo.ventas);
  });

  it("solo el dueño o el encargado ven el ranking, y con un período razonable", async () => {
    for (const [quien, c] of [["mozo", mozo], ["cocina", cocina], ["caja", (await conSesion("cashier")).cliente], ["comensal", await invitado()], ["anónimo", anonimo()]] as const) {
      expect((await c.rpc("ranking_equipo", { _branch_id: DEMO.sucursal, _desde: hoy(), _hasta: hoy() })).error, quien).not.toBeNull();
    }
    expect((await dueno.rpc("ranking_equipo", { _branch_id: DEMO.sucursal, _desde: "2026-01-01", _hasta: "2026-12-31" })).error?.message).toContain("tres meses");
    // El comensal y el anónimo tampoco ven desempeños
    expect((await (await invitado()).rpc("mi_desempeno", { _branch_id: DEMO.sucursal })).error).not.toBeNull();
  });

  it("metas: las pone el dueño; cada mozo ve la suya y la general, no la de otro", async () => {
    const { data: meta, error } = await dueno.from("metas_mozo")
      .insert({ tenant_id: DEMO.tenant, branch_id: DEMO.sucursal, staff_id: otroMozo, tipo: "mesas", periodo: "semana", objetivo: 30 })
      .select("id").single();
    expect(error).toBeNull();
    try {
      const { data: veo } = await mozo.from("metas_mozo").select("id, staff_id");
      expect((veo ?? []).some((m) => m.id === meta!.id)).toBe(false);
      expect((veo ?? []).some((m) => m.staff_id === null)).toBe(true);
      expect((await mozo.from("metas_mozo").insert({ tenant_id: DEMO.tenant, branch_id: DEMO.sucursal, tipo: "ventas", periodo: "mes", objetivo: 1 })).error).not.toBeNull();
      expect((await cocina.from("metas_mozo").select("id")).data ?? []).toHaveLength(0);
      // Dos metas iguales para la misma persona: no
      expect((await dueno.from("metas_mozo").insert({ tenant_id: DEMO.tenant, branch_id: DEMO.sucursal, staff_id: otroMozo, tipo: "mesas", periodo: "semana", objetivo: 5 })).error).not.toBeNull();
    } finally {
      await dueno.from("metas_mozo").delete().eq("id", meta!.id);
    }
  });

  it("los tiempos objetivo los cambia el dueño, dentro de lo razonable", async () => {
    expect((await dueno.from("branches").update({ objetivo_llamado_min: 0 }).eq("id", DEMO.sucursal)).error).not.toBeNull();
    expect((await dueno.from("branches").update({ objetivo_retiro_min: 7 }).eq("id", DEMO.sucursal)).error).toBeNull();
    try {
      await mozo.from("branches").update({ objetivo_retiro_min: 60 }).eq("id", DEMO.sucursal);
      const { data } = await dueno.from("branches").select("objetivo_retiro_min").eq("id", DEMO.sucursal).single();
      expect(data!.objetivo_retiro_min).toBe(7);
    } finally {
      await dueno.from("branches").update({ objetivo_retiro_min: 5 }).eq("id", DEMO.sucursal);
    }
  });

  it.skipIf(!process.env.DEMO_CREDENCIALES)("el dueño de otro local no ve el ranking ni pone metas en el demo", async () => {
    const ajeno = (await conSesion("owner_ajeno")).cliente;
    expect((await ajeno.rpc("ranking_equipo", { _branch_id: DEMO.sucursal, _desde: hoy(), _hasta: hoy() })).error).not.toBeNull();
    expect((await ajeno.from("metas_mozo").insert({ tenant_id: DEMO.tenant, branch_id: DEMO.sucursal, tipo: "ventas", periodo: "dia", objetivo: 1 })).error).not.toBeNull();
    expect((await ajeno.from("metas_mozo").select("id").eq("branch_id", DEMO.sucursal)).data ?? []).toHaveLength(0);
  });
});
