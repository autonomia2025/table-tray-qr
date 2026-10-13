import { describe, it, expect, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonimo, conSesion, hayCredenciales, invitado, DEMO } from "./entorno";

// Fase 1.8 — Plataforma y backoffice de Tablio: ventas, finanzas, soporte y auditoría.

async function miMiembro(cliente: SupabaseClient): Promise<string> {
  const { data: { user } } = await cliente.auth.getUser();
  const { data } = await cliente.from("backoffice_members").select("id").eq("user_id", user!.id).single();
  return data!.id;
}

describe.skipIf(!hayCredenciales)("plataforma y backoffice", () => {
  let superadmin: SupabaseClient;
  let jefe: SupabaseClient;
  let vendedor: SupabaseClient;
  let finanzas: SupabaseClient;
  let dueno: SupabaseClient;
  let mozo: SupabaseClient;
  let idVendedor: string;
  let idJefe: string;

  beforeAll(async () => {
    superadmin = (await conSesion("superadmin")).cliente;
    jefe = (await conSesion("jefe_ventas")).cliente;
    vendedor = (await conSesion("vendedor")).cliente;
    finanzas = (await conSesion("finanzas")).cliente;
    dueno = (await conSesion("owner")).cliente;
    mozo = (await conSesion("waiter")).cliente;
    idVendedor = await miMiembro(vendedor);
    idJefe = await miMiembro(jefe);
  });

  it("sin sesión (o como comensal) no se leen pagos, prospectos, equipo de Tablio ni sus finanzas", async () => {
    for (const cliente of [anonimo(), await invitado()]) {
      for (const tabla of ["payments", "leads", "backoffice_members", "configuracion_tablio", "gastos_tablio", "seller_goals", "support_tickets"]) {
        const { data } = await cliente.from(tabla).select("*").limit(1);
        expect(data ?? [], tabla).toHaveLength(0);
      }
    }
  });

  it("el vendedor trabaja solo sus prospectos y no se los pasa a otro", async () => {
    const nombre = `Prospecto prueba ${Date.now()}`;
    const propio = await vendedor.from("leads").insert({ restaurant_name: nombre, assigned_seller_id: idVendedor, stage: "prospecto" }).select("id").single();
    expect(propio.error).toBeNull();
    try {
      // No crea prospectos a nombre de otro, ni le pasa el suyo
      expect((await vendedor.from("leads").insert({ restaurant_name: "x", assigned_seller_id: idJefe })).error).not.toBeNull();
      const pasar = await vendedor.from("leads").update({ assigned_seller_id: idJefe }).eq("id", propio.data!.id).select("id");
      expect(pasar.error ?? (pasar.data?.length === 0 ? null : "cambió")).not.toBe("cambió");
      const { data: sigue } = await jefe.from("leads").select("assigned_seller_id").eq("id", propio.data!.id).single();
      expect(sigue!.assigned_seller_id).toBe(idVendedor);

      // Un prospecto del jefe sin vendedor no lo ve
      const ajeno = await jefe.from("leads").insert({ restaurant_name: `Del jefe ${Date.now()}`, stage: "prospecto" }).select("id").single();
      expect((await vendedor.from("leads").select("id").eq("id", ajeno.data!.id)).data ?? []).toHaveLength(0);
      await jefe.from("leads").delete().eq("id", ajeno.data!.id);

      // La actividad la firma la base con su ficha, aunque el navegador mande otra
      const act = await vendedor.from("lead_activities").insert({ lead_id: propio.data!.id, type: "visita", description: "prueba", user_id: idJefe }).select("user_id").single();
      expect(act.error).toBeNull();
      expect(act.data!.user_id).toBe(idVendedor);
      // Y el historial no se reescribe
      expect((await vendedor.from("lead_activities").update({ description: "otra" }).eq("lead_id", propio.data!.id)).error).not.toBeNull();
    } finally {
      await jefe.from("leads").delete().eq("id", propio.data!.id);
    }
  });

  it("nadie del equipo comercial cambia roles, cuentas ni correos; cada uno edita su perfil", async () => {
    expect((await vendedor.from("backoffice_members").update({ role: "jefe_ventas" }).eq("id", idVendedor)).error).not.toBeNull();
    expect((await jefe.from("backoffice_members").update({ role: "finanzas" }).eq("id", idVendedor)).error).not.toBeNull();
    expect((await jefe.from("backoffice_members").update({ email: "otro@x.cl" }).eq("id", idVendedor)).error).not.toBeNull();
    // El jefe no toca a finanzas
    const { data: fichaFinanzas } = await finanzas.from("backoffice_members").select("id, name").eq("id", await miMiembro(finanzas)).single();
    const toque = await jefe.from("backoffice_members").update({ name: "Cambiado" }).eq("id", fichaFinanzas!.id).select("id");
    expect(toque.data ?? []).toHaveLength(0);

    const { data: antes } = await vendedor.from("backoffice_members").select("phone").eq("id", idVendedor).single();
    const propio = await vendedor.from("backoffice_members").update({ phone: "+56 9 0000 0000" }).eq("id", idVendedor).select("phone");
    expect(propio.data?.[0]?.phone).toBe("+56 9 0000 0000");
    await vendedor.from("backoffice_members").update({ phone: antes!.phone }).eq("id", idVendedor);
  });

  it("un vendedor desactivado pierde el acceso al instante, y queda registrado", async () => {
    const lead = await vendedor.from("leads").insert({ restaurant_name: `Acceso ${Date.now()}`, assigned_seller_id: idVendedor }).select("id").single();
    expect((await jefe.from("backoffice_members").update({ is_active: false }).eq("id", idVendedor)).error).toBeNull();
    try {
      expect((await vendedor.from("leads").select("id").eq("id", lead.data!.id)).data ?? []).toHaveLength(0);
    } finally {
      expect((await jefe.from("backoffice_members").update({ is_active: true }).eq("id", idVendedor)).error).toBeNull();
    }
    expect((await vendedor.from("leads").select("id").eq("id", lead.data!.id)).data).toHaveLength(1);
    const { data: registro } = await superadmin.from("audit_logs").select("action").eq("entity_id", idVendedor).order("created_at", { ascending: false }).limit(2);
    expect(registro!.map((r) => r.action)).toEqual(["miembro_activado", "miembro_desactivado"]);
    await jefe.from("leads").delete().eq("id", lead.data!.id);
  });

  it("el jefe invita solo vendedores", async () => {
    expect((await jefe.from("backoffice_invitations").insert({ role: "finanzas" })).error).not.toBeNull();
    expect((await vendedor.from("backoffice_invitations").insert({ role: "vendedor" })).error).not.toBeNull();
    const ok = await jefe.from("backoffice_invitations").insert({ role: "vendedor" }).select("id").single();
    expect(ok.error).toBeNull();
    await jefe.from("backoffice_invitations").delete().eq("id", ok.data!.id);
  });

  it("finanzas lee el embudo sin editarlo y guarda los gastos en la base; nadie más los ve", async () => {
    const lead = await jefe.from("leads").insert({ restaurant_name: `Embudo ${Date.now()}` }).select("id").single();
    expect((await finanzas.from("leads").select("id").eq("id", lead.data!.id)).data).toHaveLength(1);
    const editar = await finanzas.from("leads").update({ stage: "cliente_pagando" }).eq("id", lead.data!.id).select("id");
    expect(editar.data ?? []).toHaveLength(0);
    await jefe.from("leads").delete().eq("id", lead.data!.id);

    const gasto = await finanzas.from("gastos_tablio").insert({ categoria: "Software", descripcion: "Prueba", monto: 12345 }).select("id, creado_por").single();
    expect(gasto.error).toBeNull();
    expect((await vendedor.from("gastos_tablio").select("id").eq("id", gasto.data!.id)).data ?? []).toHaveLength(0);
    expect((await jefe.from("gastos_tablio").select("id").eq("id", gasto.data!.id)).data ?? []).toHaveLength(0);
    expect((await finanzas.from("gastos_tablio").insert({ categoria: "Otros", descripcion: "x", monto: -5 })).error).not.toBeNull();
    expect((await finanzas.from("gastos_tablio").delete().eq("id", gasto.data!.id)).error).toBeNull();
  });

  it("la configuración de Tablio la cambia solo el superadmin y el equipo la lee", async () => {
    const valor = { base: 50, bonus: 25, threshold: 5 };
    expect((await superadmin.from("configuracion_tablio").upsert({ clave: "comisiones", valor })).error).toBeNull();
    const { data } = await jefe.from("configuracion_tablio").select("valor").eq("clave", "comisiones").single();
    expect(data!.valor).toEqual(valor);
    expect((await jefe.from("configuracion_tablio").upsert({ clave: "comisiones", valor: { base: 1 } })).error).not.toBeNull();
    expect((await dueno.from("configuracion_tablio").select("clave")).data ?? []).toHaveLength(0);
  });

  it("los tickets de soporte los ven y crean el dueño, el administrador y el encargado", async () => {
    const { data: { user } } = await dueno.auth.getUser();
    const ticket = await dueno.from("support_tickets").insert({ tenant_id: DEMO.tenant, user_id: user!.id, subject: "Prueba", message: "Hola" }).select("id").single();
    expect(ticket.error).toBeNull();
    try {
      expect((await mozo.from("support_tickets").select("id").eq("id", ticket.data!.id)).data ?? []).toHaveLength(0);
      expect((await mozo.from("support_tickets").insert({ tenant_id: DEMO.tenant, subject: "x", message: "x" })).error).not.toBeNull();
      // No se firma a nombre de otro
      const { data: { user: otro } } = await mozo.auth.getUser();
      expect((await dueno.from("support_tickets").insert({ tenant_id: DEMO.tenant, user_id: otro!.id, subject: "x", message: "x" })).error).not.toBeNull();
    } finally {
      await superadmin.from("support_tickets").delete().eq("id", ticket.data!.id);
    }
  });

  it("entrar al panel de un local o 'ver como' un vendedor queda en la auditoría, solo para quien puede", async () => {
    expect((await dueno.rpc("registrar_acceso_soporte", { _tipo: "local", _id: DEMO.tenant })).error?.message).toContain("permiso");
    expect((await superadmin.rpc("registrar_acceso_soporte", { _tipo: "local", _id: DEMO.tenant })).error).toBeNull();
    const { data } = await superadmin.from("audit_logs").select("action").eq("tenant_id", DEMO.tenant).eq("action", "soporte_ingreso_local").limit(1);
    expect(data).toHaveLength(1);

    expect((await jefe.rpc("registrar_acceso_soporte", { _tipo: "miembro", _id: idVendedor })).error).toBeNull();
    const idFinanzas = await miMiembro(finanzas);
    expect((await jefe.rpc("registrar_acceso_soporte", { _tipo: "miembro", _id: idFinanzas })).error?.message).toContain("permiso");
  });
});
