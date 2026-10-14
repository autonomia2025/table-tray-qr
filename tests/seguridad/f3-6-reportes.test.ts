import { describe, it, expect, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonimo, confirmarPresencia, conSesion, hayCredenciales, invitado, llamarFuncion, qrMesa, DEMO } from "./entorno";

// Fase 3.6 — Reportes calculados por la base e inicio del dueño. Solo dueño, administrador y encargado
// (y el superadmin) los ven; los números salen de los pagos (no de pedidos sin pagar) y por día de negocio.

type Reporte = {
  dias: number;
  resumen: { ventas: number; pagos: number; ticket: number; pedidos: number };
  canales: { app: number; efectivo: number; pos: number };
  horas: { dia_semana: number; hora: number; ventas: number }[];
  platos: { nombre: string; cantidad: number; ventas: number }[];
  por_dia: { dia: string; ventas: number }[];
};

const hoy = () => new Date(Date.now() - 6 * 3_600_000).toLocaleDateString("en-CA", { timeZone: "America/Santiago" });

describe.skipIf(!hayCredenciales)("reportes e inicio del dueño", () => {
  let dueno: SupabaseClient;

  beforeAll(async () => {
    dueno = (await conSesion("owner")).cliente;
  });

  it("un pago nuevo aparece en el reporte de hoy (ventas, canal, plato y hora) y en el inicio", async () => {
    const reporte = async () => {
      const { data, error } = await dueno.rpc("reporte_local", { _branch_id: DEMO.sucursal, _desde: hoy(), _hasta: hoy() });
      expect(error).toBeNull();
      return data as unknown as Reporte;
    };
    const antes = await reporte();
    const historiaAntes = (await dueno.rpc("historia_del_local", { _branch_id: DEMO.sucursal })).data as { hoy: { ventas: number } };

    const item = (await anonimo().from("menu_items").select("id").eq("tenant_id", DEMO.tenant).eq("name", "Barros Luco").single()).data!.id;
    const c = await invitado();
    await c.rpc("unirse_a_mesa", { _qr_token: qrMesa(9)! });
    const token = (await c.auth.getSession()).data.session!.access_token;
    const r = await llamarFuncion("process-payment", {
      table_token: qrMesa(9), method: "card", cart_items: [{ menu_item_id: item, quantity: 2 }], idempotency_key: `reportes-${Date.now()}`,
    }, token);
    expect(r.status).toBe(200);
    const pedido = JSON.parse(r.cuerpo).order.id as string;
    const total = (await dueno.from("orders").select("total_amount").eq("id", pedido).single()).data!.total_amount as number;

    // Otras pruebas corren en paralelo y también venden: los números suben al menos lo de este pago
    const despues = await reporte();
    expect(despues.dias).toBe(1);
    expect(despues.resumen.ventas - antes.resumen.ventas).toBeGreaterThanOrEqual(total);
    expect(despues.resumen.pagos).toBeGreaterThan(antes.resumen.pagos);
    expect(despues.canales.app - antes.canales.app).toBeGreaterThanOrEqual(total);
    const plato = (x: Reporte) => x.platos.find((p) => p.nombre === "Barros Luco")?.cantidad ?? 0;
    expect(plato(despues) - plato(antes)).toBeGreaterThanOrEqual(2);
    expect(despues.horas.length).toBeGreaterThan(0);
    expect(despues.por_dia).toHaveLength(1);
    expect(despues.por_dia[0].ventas).toBe(despues.resumen.ventas);

    const historia = (await dueno.rpc("historia_del_local", { _branch_id: DEMO.sucursal })).data as {
      hoy: { dia: string; ventas: number; pagos: number; mesas_abiertas: number };
      ultimo: unknown; alertas: { agotados: string[]; perdido_7_dias: number };
    };
    expect(historia.hoy.dia).toBe(hoy());
    expect(historia.hoy.ventas - historiaAntes.hoy.ventas).toBeGreaterThanOrEqual(total);
    expect(historia.hoy.mesas_abiertas).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(historia.alertas.agotados)).toBe(true);
    expect(typeof historia.alertas.perdido_7_dias).toBe("number");
  });

  it("un pedido sin pagar no cuenta como venta", async () => {
    const item = (await anonimo().from("menu_items").select("id").eq("tenant_id", DEMO.tenant).eq("name", "Barros Luco").single()).data!.id;
    const c = await invitado();
    await c.rpc("unirse_a_mesa", { _qr_token: qrMesa(9)! });
    await confirmarPresencia(c, 9);
    const antes = (await dueno.rpc("reporte_local", { _branch_id: DEMO.sucursal, _desde: hoy(), _hasta: hoy() })).data as unknown as Reporte;
    const r = await c.rpc("pedir_sin_pagar", { _qr_token: qrMesa(9)!, _items: [{ menu_item_id: item, quantity: 1 }], _forma: "mozo" });
    expect(r.error).toBeNull();
    const despues = (await dueno.rpc("reporte_local", { _branch_id: DEMO.sucursal, _desde: hoy(), _hasta: hoy() })).data as unknown as Reporte;
    // El pedido existe (cuenta como pedido) pero no hay plata nueva por él: los pagos no cambian por esto
    expect(despues.resumen.pedidos).toBeGreaterThan(antes.resumen.pedidos);
    const id = (r.data as { order_id: string }).order_id;
    const { data: pagos } = await dueno.from("payments").select("id").contains("pedidos", [id]);
    expect(pagos ?? []).toHaveLength(0);
  });

  it("solo dueño, administrador y superadmin (no mozo, cocina, caja, comensal ni anónimo)", async () => {
    const pedir = (c: SupabaseClient) => Promise.all([
      c.rpc("reporte_local", { _branch_id: DEMO.sucursal, _desde: hoy(), _hasta: hoy() }),
      c.rpc("historia_del_local", { _branch_id: DEMO.sucursal }),
    ]);
    for (const rol of ["admin", "superadmin"]) {
      const [a, b] = await pedir((await conSesion(rol)).cliente);
      expect(a.error, rol).toBeNull();
      expect(b.error, rol).toBeNull();
    }
    const negados: [string, SupabaseClient][] = [
      ["mozo", (await conSesion("waiter")).cliente], ["cocina", (await conSesion("kitchen")).cliente],
      ["caja", (await conSesion("cashier")).cliente], ["comensal", await invitado()], ["anónimo", anonimo()],
    ];
    for (const [quien, c] of negados) {
      const [a, b] = await pedir(c);
      expect(a.error, quien).not.toBeNull();
      expect(b.error, quien).not.toBeNull();
      expect(a.data, quien).toBeNull();
    }
    // Las funciones internas no se pueden llamar desde el navegador
    expect((await dueno.rpc("_ventas_dias" as never, { _branch_id: DEMO.sucursal, _desde: hoy(), _hasta: hoy() } as never)).error).not.toBeNull();
    expect((await dueno.rpc("_tenant_reportes" as never, { _branch_id: DEMO.sucursal } as never)).error).not.toBeNull();
    expect((await (await conSesion("superadmin")).cliente.rpc("_sembrar_historia_demo" as never)).error).not.toBeNull();
  });

  it("el período tiene que tener sentido: hasta un año y en orden", async () => {
    expect((await dueno.rpc("reporte_local", { _branch_id: DEMO.sucursal, _desde: "2025-01-01", _hasta: "2026-10-14" })).error?.message).toContain("hasta un año");
    expect((await dueno.rpc("reporte_local", { _branch_id: DEMO.sucursal, _desde: "2026-10-14", _hasta: "2026-10-01" })).error?.message).toContain("hasta un año");
    const largo = await dueno.rpc("reporte_local", { _branch_id: DEMO.sucursal, _desde: "2026-01-01", _hasta: "2026-10-14" });
    expect(largo.error).toBeNull();
    expect((largo.data as unknown as Reporte).por_dia.length).toBe(287);
  });

  it.skipIf(!process.env.DEMO_CREDENCIALES)("el dueño de otro local no ve los reportes del demo", async () => {
    const ajeno = (await conSesion("owner_ajeno")).cliente;
    expect((await ajeno.rpc("reporte_local", { _branch_id: DEMO.sucursal, _desde: hoy(), _hasta: hoy() })).error).not.toBeNull();
    expect((await ajeno.rpc("historia_del_local", { _branch_id: DEMO.sucursal })).error).not.toBeNull();
  });
});
