import { describe, it, expect, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonimo, conSesion, hayCredenciales, invitado, llamarFuncion, DEMO } from "./entorno";

// Fase 1.10 — Compuerta de seguridad: auditoría automática de la base, barrido de todo lo sensible
// sin sesión, plata solo para quien la maneja y cierre de caja protegido.

// Tablas con datos privados u operación: sin sesión no se lee ni se escribe nada.
const SENSIBLES = [
  "payments", "refunds", "payment_settlements", "orders", "order_items", "order_events",
  "table_sessions", "tables", "table_events", "comensales_mesa", "waiter_calls", "bill_requests",
  "staff_users", "tenant_members", "staff_invitations", "audit_logs", "loyalty_customers", "loyalty_rewards",
  "support_tickets", "support_chat_uso", "leads", "lead_activities", "seller_goals", "backoffice_members",
  "backoffice_invitations", "platform_admins", "gastos_tablio", "configuracion_tablio", "contadores_pedidos",
  "stations", "tenant_feature_flags",
];

describe.skipIf(!hayCredenciales)("compuerta de seguridad", () => {
  let superadmin: SupabaseClient;
  let dueno: SupabaseClient;
  let mozo: SupabaseClient;
  let cocina: SupabaseClient;
  let caja: SupabaseClient;

  beforeAll(async () => {
    superadmin = (await conSesion("superadmin")).cliente;
    dueno = (await conSesion("owner")).cliente;
    mozo = (await conSesion("waiter")).cliente;
    cocina = (await conSesion("kitchen")).cliente;
    caja = (await conSesion("cashier")).cliente;
  });

  it("la auditoría automática de la base no encuentra nada abierto", async () => {
    const { data, error } = await superadmin.rpc("auditoria_seguridad");
    expect(error).toBeNull();
    // Si esto falla, el mensaje dice exactamente qué tabla, regla o función quedó abierta.
    expect((data as { tipo: string; objeto: string }[]).map((h) => `${h.tipo}: ${h.objeto}`)).toEqual([]);
  });

  it("la auditoría solo la corre el superadmin", async () => {
    expect((await dueno.rpc("auditoria_seguridad")).error).not.toBeNull();
    expect((await anonimo().rpc("auditoria_seguridad")).error).not.toBeNull();
  });

  it("sin sesión, ninguna tabla sensible se lee ni se escribe", async () => {
    const anon = anonimo();
    for (const tabla of SENSIBLES) {
      const { data } = await anon.from(tabla).select("*").limit(1);
      expect(data ?? [], `lectura ${tabla}`).toHaveLength(0);
      const escritura = await anon.from(tabla).insert({ tenant_id: DEMO.tenant });
      expect(escritura.error, `escritura ${tabla}`).not.toBeNull();
    }
  });

  it("un comensal invitado solo ve lo suyo: nada del personal ni de la plata", async () => {
    const comensal = await invitado();
    for (const tabla of ["payments", "refunds", "payment_settlements", "staff_users", "tenant_members", "audit_logs",
      "loyalty_customers", "leads", "backoffice_members", "gastos_tablio", "table_events", "order_events"]) {
      const { data } = await comensal.from(tabla).select("*").limit(1);
      expect(data ?? [], tabla).toHaveLength(0);
    }
  });

  it("los pagos los ven solo la caja, el encargado y el dueño; nadie los escribe desde el navegador", async () => {
    const { data: deDueno } = await dueno.from("payments").select("id").eq("tenant_id", DEMO.tenant).limit(1);
    const { data: deCaja } = await caja.from("payments").select("id").eq("tenant_id", DEMO.tenant).limit(1);
    expect(deCaja?.length ?? 0).toBe(deDueno?.length ?? 0);
    expect((await mozo.from("payments").select("id").eq("tenant_id", DEMO.tenant).limit(1)).data ?? []).toHaveLength(0);
    expect((await cocina.from("payments").select("id").eq("tenant_id", DEMO.tenant).limit(1)).data ?? []).toHaveLength(0);
    expect((await mozo.from("refunds").select("id").limit(1)).data ?? []).toHaveLength(0);
    expect((await mozo.from("payment_settlements").select("id").limit(1)).data ?? []).toHaveLength(0);
    expect((await dueno.from("payments").insert({ tenant_id: DEMO.tenant, amount: 1, status: "approved" })).error).not.toBeNull();
    expect((await dueno.from("refunds").insert({ tenant_id: DEMO.tenant, amount: 1 })).error).not.toBeNull();
  });

  it("no se puede pagar sin sesión (todo pago queda ligado a una persona)", async () => {
    const r = await llamarFuncion("process-payment", { table_token: "cualquiera", method: "card", cart_items: [{ menu_item_id: "x", quantity: 1 }] });
    expect(r.status).toBe(401);
    expect(JSON.parse(r.cuerpo).error).toContain("QR");
  });

  it("el cierre de caja: el mozo no puede; la caja sí; un día cerrado no se cambia (N10)", async () => {
    const fecha = `2001-${String(1 + Math.floor(Math.random() * 12)).padStart(2, "0")}-${String(1 + Math.floor(Math.random() * 28)).padStart(2, "0")}`;
    const mozo = (await conSesion("waiter")).cliente;
    const caja = (await conSesion("cashier")).cliente;
    const cuerpo = { _branch_id: DEMO.sucursal, _dia: fecha, _efectivo_contado: 0 };

    expect((await mozo.rpc("cerrar_caja", cuerpo)).error).not.toBeNull();
    expect((await caja.rpc("resumen_caja", { _branch_id: DEMO.sucursal, _dia: fecha })).error).toBeNull();
    expect((await caja.rpc("cerrar_caja", cuerpo)).error).toBeNull();
    const otraVez = await caja.rpc("cerrar_caja", { ...cuerpo, _notas: "reescribir" });
    expect(otraVez.error?.message).toContain("ya está cerrada");
  });

  it("las funciones antiguas ya no se pueden llamar desde afuera", async () => {
    for (const fn of ["get_tenant_id", "is_tenant_member", "has_staff_role", "has_backoffice_role"]) {
      expect((await dueno.rpc(fn as never, {} as never)).error, fn).not.toBeNull();
      expect((await anonimo().rpc(fn as never, {} as never)).error, fn).not.toBeNull();
    }
  });

  // Crea cuentas: solo en la base desechable.
  it.skipIf(!process.env.DEMO_CREDENCIALES)("una invitación de mozo sirve para una sola persona, aunque la usen dos a la vez", async () => {
    const { data: inv } = await dueno.from("staff_invitations").insert({ tenant_id: DEMO.tenant, branch_id: DEMO.sucursal, role: "waiter" }).select("token").single();
    const alta = (n: number) => llamarFuncion("register-waiter", {
      email: `mozo-inv-${Date.now()}-${n}@demo.tablio.test`, password: "clave-segura-123", name: `Mozo ${n}`, token: inv!.token,
    });
    const [a, b] = await Promise.all([alta(1), alta(2)]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);
  });
});
