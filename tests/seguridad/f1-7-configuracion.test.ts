import { describe, it, expect, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonimo, conSesion, hayCredenciales, invitado, qrMesa, DEMO } from "./entorno";

// Fase 1.7 — Configuración del local: carta, marca, sucursal, equipo, lealtad y auditoría.

describe.skipIf(!hayCredenciales)("configuración del local", () => {
  let dueno: SupabaseClient;
  let admin: SupabaseClient;
  let mozo: SupabaseClient;
  let caja: SupabaseClient;
  let superadmin: SupabaseClient;

  beforeAll(async () => {
    dueno = (await conSesion("owner")).cliente;
    admin = (await conSesion("admin")).cliente;
    mozo = (await conSesion("waiter")).cliente;
    caja = (await conSesion("cashier")).cliente;
    superadmin = (await conSesion("superadmin")).cliente;
  });

  it("la carta y la marca siguen públicas, pero sin costos, RUT, correo, teléfono ni plan", async () => {
    const anon = anonimo();
    const { data: carta, error } = await anon.from("menu_items").select("id, name, price").eq("tenant_id", DEMO.tenant).limit(3);
    expect(error).toBeNull();
    expect(carta!.length).toBeGreaterThan(0);
    expect((await anon.from("menu_items").select("cost_price").limit(1)).error).not.toBeNull();
    // Ni siquiera un invitado o el personal leen el costo
    expect((await (await invitado()).from("menu_items").select("cost_price").limit(1)).error).not.toBeNull();

    const { data: marca } = await anon.from("tenants").select("name, primary_color").eq("id", DEMO.tenant).single();
    expect(marca!.name).toBeTruthy();
    for (const columna of ["rut", "email", "phone", "plan_status", "plan_id", "trial_ends_at"]) {
      expect((await anon.from("tenants").select(columna).limit(1)).error, columna).not.toBeNull();
      expect((await dueno.from("tenants").select(columna).limit(1)).error, columna).not.toBeNull();
    }
    expect((await anon.rpc("tenants_privado").select("id").limit(1)).data ?? []).toHaveLength(0);
    expect((await dueno.rpc("tenants_privado").select("id").limit(1)).data ?? []).toHaveLength(0);
    const { data: privado } = await superadmin.rpc("tenants_privado").select("id, email, plan_status").eq("id", DEMO.tenant);
    expect(privado).toHaveLength(1);
  });

  it("sin ser del local no se ven el equipo, las estaciones, la auditoría ni los clientes", async () => {
    for (const cliente of [anonimo(), await invitado()]) {
      for (const tabla of ["staff_users", "stations", "audit_logs", "loyalty_customers", "tenant_members", "tenant_feature_flags"]) {
        const { data } = await cliente.from(tabla).select("*").eq("tenant_id", DEMO.tenant).limit(1);
        expect(data ?? [], tabla).toHaveLength(0);
      }
    }
    // El mozo ve a sus compañeros (para transferir mesas), pero no los clientes ni las cuentas del equipo
    expect((await mozo.from("staff_users").select("id").eq("tenant_id", DEMO.tenant)).data!.length).toBeGreaterThan(0);
    expect((await mozo.from("loyalty_customers").select("id").eq("tenant_id", DEMO.tenant)).data ?? []).toHaveLength(0);
    expect((await mozo.from("tenant_members").select("id").eq("tenant_id", DEMO.tenant)).data!.length).toBe(1); // solo la suya
  });

  it("el mozo no edita la carta, la marca ni la lealtad; el administrador sí edita la carta", async () => {
    const { data: plato } = await dueno.from("menu_items").select("id, price").eq("tenant_id", DEMO.tenant).eq("name", "Agua mineral").single();
    const intento = await mozo.from("menu_items").update({ price: 1 }).eq("id", plato!.id).select("id");
    expect(intento.data ?? []).toHaveLength(0);
    const marca = await mozo.from("tenants").update({ name: "Hackeado" }).eq("id", DEMO.tenant).select("id");
    expect(marca.data ?? []).toHaveLength(0);
    const lealtad = await mozo.from("loyalty_programs").update({ goal_visits: 1 }).eq("tenant_id", DEMO.tenant).select("id");
    expect(lealtad.data ?? []).toHaveLength(0);

    const cambio = await admin.from("menu_items").update({ price: plato!.price + 100 }).eq("id", plato!.id).select("price");
    expect(cambio.data?.[0]?.price).toBe(plato!.price + 100);
    await admin.from("menu_items").update({ price: plato!.price }).eq("id", plato!.id);
    // Las ventas de cada plato las cuenta el servidor: nadie las infla
    expect((await admin.from("menu_items").update({ total_orders: 9999 }).eq("id", plato!.id)).error).not.toBeNull();
    // Ni un precio negativo
    expect((await admin.from("menu_items").update({ price: -5 }).eq("id", plato!.id)).error).not.toBeNull();
  });

  it("el dueño edita la marca, pero nadie del local cambia el plan ni activa el local", async () => {
    const { data: antes } = await dueno.from("tenants").select("welcome_message").eq("id", DEMO.tenant).single();
    const cambio = await dueno.from("tenants").update({ welcome_message: "¡Hola de prueba!" }).eq("id", DEMO.tenant).select("welcome_message");
    expect(cambio.data?.[0]?.welcome_message).toBe("¡Hola de prueba!");
    await dueno.from("tenants").update({ welcome_message: antes!.welcome_message }).eq("id", DEMO.tenant);

    expect((await dueno.from("tenants").update({ plan_status: "active" }).eq("id", DEMO.tenant)).error).not.toBeNull();
    expect((await dueno.from("tenants").update({ is_active: false }).eq("id", DEMO.tenant)).error).not.toBeNull();
    expect((await dueno.rpc("sa_activar_local", { _tenant_id: DEMO.tenant, _activo: false })).error?.message).toContain("permiso");
  });

  it("nadie escribe en la auditoría; el dueño la lee", async () => {
    const falso = { tenant_id: DEMO.tenant, action: "falso", entity_type: "x" };
    expect((await anonimo().from("audit_logs").insert(falso)).error).not.toBeNull();
    expect((await dueno.from("audit_logs").insert(falso)).error).not.toBeNull();
    expect((await mozo.from("audit_logs").select("id").eq("tenant_id", DEMO.tenant).limit(1)).data ?? []).toHaveLength(0);
    expect((await dueno.from("audit_logs").select("id").eq("tenant_id", DEMO.tenant).limit(1)).error).toBeNull();
  });

  it("desactivar a alguien le quita el acceso al instante; activarlo se lo devuelve; queda en la auditoría", async () => {
    const { data: ficha } = await dueno.from("staff_users").select("id").eq("tenant_id", DEMO.tenant).eq("role", "cashier").single();
    const idMesa = (await dueno.from("tables").select("id").eq("branch_id", DEMO.sucursal).eq("number", 8).single()).data!.id;

    expect((await dueno.rpc("activar_personal", { _staff_id: ficha!.id, _activo: false })).error).toBeNull();
    try {
      // Con su sesión aún abierta, la caja ya no puede operar ni ver nada del local
      expect((await caja.rpc("cerrar_mesa", { _table_id: idMesa })).error?.message).toContain("permiso");
      expect((await caja.from("orders").select("id").eq("tenant_id", DEMO.tenant).limit(1)).data ?? []).toHaveLength(0);
    } finally {
      expect((await dueno.rpc("activar_personal", { _staff_id: ficha!.id, _activo: true })).error).toBeNull();
    }
    expect((await caja.from("staff_users").select("id").eq("tenant_id", DEMO.tenant).limit(1)).data!.length).toBe(1);
    const { data: registro } = await dueno.from("audit_logs").select("action").eq("entity_id", ficha!.id).order("created_at", { ascending: false }).limit(2);
    expect(registro!.map((r) => r.action)).toEqual(["personal_activado", "personal_desactivado"]);
  });

  it("los cambios de rol respetan la jerarquía y cambian también el acceso real", async () => {
    const { data: otroMozo } = await dueno.from("staff_users").select("id, name, auth_user_id").eq("tenant_id", DEMO.tenant).eq("name", "Diego (mozo)").single();
    // El mozo no cambia roles; el administrador no puede nombrar administradores
    expect((await mozo.rpc("actualizar_personal", { _staff_id: otroMozo!.id, _nombre: "Diego (mozo)", _rol: "manager" })).error?.message).toContain("permiso");
    expect((await admin.rpc("actualizar_personal", { _staff_id: otroMozo!.id, _nombre: "Diego (mozo)", _rol: "admin" })).error?.message).toContain("permiso");

    // El dueño lo pasa a cocina: su acceso real (tenant_members) también cambia
    expect((await dueno.rpc("actualizar_personal", { _staff_id: otroMozo!.id, _nombre: "Diego (mozo)", _rol: "kitchen" })).error).toBeNull();
    try {
      const { data: acceso } = await dueno.from("tenant_members").select("role").eq("tenant_id", DEMO.tenant).eq("user_id", otroMozo!.auth_user_id).single();
      expect(acceso!.role).toBe("kitchen");
    } finally {
      expect((await dueno.rpc("actualizar_personal", { _staff_id: otroMozo!.id, _nombre: "Diego (mozo)", _rol: "waiter" })).error).toBeNull();
    }
    // Nadie escribe la ficha del equipo directo
    expect((await dueno.from("staff_users").update({ role: "owner" }).eq("id", otroMozo!.id)).error).not.toBeNull();
    expect((await dueno.from("staff_users").insert({ tenant_id: DEMO.tenant, name: "x", role: "owner" })).error).not.toBeNull();
  });

  it("las invitaciones las crea el dueño, solo para mozo, cocina o caja", async () => {
    const base = { tenant_id: DEMO.tenant, branch_id: DEMO.sucursal };
    expect((await mozo.from("staff_invitations").insert({ ...base, role: "waiter" })).error).not.toBeNull();
    expect((await dueno.from("staff_invitations").insert({ ...base, role: "owner" })).error).not.toBeNull();
    const ok = await dueno.from("staff_invitations").insert({ ...base, role: "waiter" }).select("id").single();
    expect(ok.error).toBeNull();
    await dueno.from("staff_invitations").delete().eq("id", ok.data!.id);
  });

  it("las fotos de la carta las sube quien edita la carta, no el mozo ni un invitado", async () => {
    // PNG de 1×1 píxel
    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
    const ruta = `${DEMO.tenant}/prueba-${Date.now()}.png`;
    const subir = (c: SupabaseClient) => c.storage.from("menu-images").upload(ruta, png, { contentType: "image/png", upsert: true });
    expect((await subir(mozo)).error).not.toBeNull();
    expect((await subir(await invitado())).error).not.toBeNull();
    expect((await subir(dueno)).error).toBeNull();
    // El mozo tampoco la borra
    await mozo.storage.from("menu-images").remove([ruta]);
    const { data: sigue } = await dueno.storage.from("menu-images").list(DEMO.tenant, { search: ruta.split("/")[1] });
    expect(sigue).toHaveLength(1);
    expect((await dueno.storage.from("menu-images").remove([ruta])).error).toBeNull();
  });

  it("el comensal sigue viendo la carta y el programa de sellos", async () => {
    const comensal = await invitado();
    await comensal.rpc("unirse_a_mesa", { _qr_token: qrMesa(2)! });
    expect((await comensal.from("categories").select("id").eq("tenant_id", DEMO.tenant).limit(1)).data).toHaveLength(1);
    expect((await comensal.from("branches").select("payment_mode").eq("id", DEMO.sucursal)).data).toHaveLength(1);
    const { error } = await comensal.from("loyalty_programs").select("id").eq("tenant_id", DEMO.tenant).eq("is_active", true);
    expect(error).toBeNull();
  });

  // Solo en la base desechable, donde existe "Local Ajeno".
  it.skipIf(!process.env.DEMO_CREDENCIALES)("el dueño de otro local no ve el equipo del demo ni mete platos en su carta", async () => {
    const ajeno = (await conSesion("owner_ajeno")).cliente;
    expect((await ajeno.from("staff_users").select("id").eq("tenant_id", DEMO.tenant)).data ?? []).toHaveLength(0);
    const { data: categoria } = await dueno.from("categories").select("id").eq("tenant_id", DEMO.tenant).limit(1).single();
    const { data: miLocal } = await ajeno.from("tenant_members").select("tenant_id").limit(1).single();
    // Un plato de su local apuntando a una categoría del demo: rechazado
    const intruso = await ajeno.from("menu_items").insert({ tenant_id: miLocal!.tenant_id, category_id: categoria!.id, name: "Intruso", price: 1 });
    expect(intruso.error).not.toBeNull();
    expect((await ajeno.from("menu_items").update({ price: 1 }).eq("tenant_id", DEMO.tenant).select("id")).data ?? []).toHaveLength(0);
    const { data: fichaDemo } = await dueno.from("staff_users").select("id").eq("tenant_id", DEMO.tenant).limit(1).single();
    expect((await ajeno.rpc("activar_personal", { _staff_id: fichaDemo!.id, _activo: false })).error?.message).toContain("permiso");
  });
});
