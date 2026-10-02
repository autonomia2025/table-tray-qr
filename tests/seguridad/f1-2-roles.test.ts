import { describe, it, expect } from "vitest";
import { anonimo, conSesion, hayCredenciales, llamarFuncion, DEMO } from "./entorno";

// Fase 1.2 — Un solo modelo de roles. La base dice quién es cada uno y qué puede asignar.

const esperado: Array<[cuenta: string, rol: string]> = [
  ["owner", "owner"],
  ["admin", "admin"],
  ["waiter", "waiter"],
  ["kitchen", "kitchen"],
  ["cashier", "cashier"],
];

describe("mi_perfil()", () => {
  it("un anónimo no puede consultarla", async () => {
    const { error } = await anonimo().rpc("mi_perfil");
    expect(error).not.toBeNull();
  });

  for (const [cuenta, rol] of esperado) {
    it.skipIf(!hayCredenciales)(`la cuenta ${cuenta} aparece con rol ${rol} en el demo`, async () => {
      const { cliente } = await conSesion(cuenta);
      const { data, error } = await cliente.rpc("mi_perfil");
      expect(error).toBeNull();
      const perfil = data as { locales: Array<{ tenant_id: string; rol: string; branch_id: string }>; es_superadmin: boolean };
      expect(perfil.es_superadmin).toBe(false);
      expect(perfil.locales).toHaveLength(1);
      expect(perfil.locales[0].tenant_id).toBe(DEMO.tenant);
      expect(perfil.locales[0].rol).toBe(rol);
      expect(perfil.locales[0].branch_id).toBe(DEMO.sucursal);
    });
  }

  it.skipIf(!hayCredenciales)("el superadmin y el backoffice se reconocen", async () => {
    const sa = (await (await conSesion("superadmin")).cliente.rpc("mi_perfil")).data as { es_superadmin: boolean; locales: unknown[] };
    expect(sa.es_superadmin).toBe(true);
    expect(sa.locales).toHaveLength(0);
    const jefe = (await (await conSesion("jefe_ventas")).cliente.rpc("mi_perfil")).data as { backoffice: { rol: string } };
    expect(jefe.backoffice.rol).toBe("jefe_ventas");
  });
});

describe("tiene_rol()", () => {
  it.skipIf(!hayCredenciales)("responde según el rol y el local", async () => {
    const { data: otro } = await anonimo().from("tenants").select("id").neq("id", DEMO.tenant).limit(1);
    const dueno = (await conSesion("owner")).cliente;
    expect((await dueno.rpc("tiene_rol", { _tenant_id: DEMO.tenant, _roles: ["owner"] })).data).toBe(true);
    expect((await dueno.rpc("tiene_rol", { _tenant_id: otro![0].id, _roles: ["owner"] })).data).toBe(false);
    const mozo = (await conSesion("waiter")).cliente;
    expect((await mozo.rpc("tiene_rol", { _tenant_id: DEMO.tenant, _roles: ["owner", "admin"] })).data).toBe(false);
    expect((await mozo.rpc("tiene_rol", { _tenant_id: DEMO.tenant, _roles: ["waiter"] })).data).toBe(true);
  });
});

describe("lista cerrada de roles", () => {
  it.skipIf(!hayCredenciales)("no se puede crear una membresía con un rol inventado", async () => {
    const { cliente } = await conSesion("superadmin");
    const { data: otro } = await anonimo().from("tenants").select("id").neq("id", DEMO.tenant).limit(1);
    const { error } = await cliente
      .from("tenant_members")
      .insert({ user_id: DEMO.dueno, tenant_id: otro![0].id, role: "staff" });
    expect(error?.code).toBe("23514"); // viola la lista de roles
  });

  it.skipIf(!hayCredenciales)("una invitación no puede ser para dueño", async () => {
    const { cliente } = await conSesion("owner");
    const { error } = await cliente
      .from("staff_invitations")
      .insert({ tenant_id: DEMO.tenant, branch_id: DEMO.sucursal, role: "owner" });
    expect(error?.code).toBe("23514");
  });
});

describe("quién puede asignar qué rol (create-tenant-user)", () => {
  it.skipIf(!hayCredenciales)("el dueño no puede crear otro dueño", async () => {
    const { token } = await conSesion("owner");
    const r = await llamarFuncion("create-tenant-user", { email: "x@demo.tablio.test", password: "123456", tenant_id: DEMO.tenant, role: "owner" }, token);
    expect(r.status).toBe(403);
  });

  it.skipIf(!hayCredenciales)("el administrador no puede crear administradores", async () => {
    const { token } = await conSesion("admin");
    const r = await llamarFuncion("create-tenant-user", { email: "x@demo.tablio.test", password: "123456", tenant_id: DEMO.tenant, role: "admin" }, token);
    expect(r.status).toBe(403);
  });

  it.skipIf(!hayCredenciales)("un rol inventado se rechaza", async () => {
    const { token } = await conSesion("owner");
    const r = await llamarFuncion("create-tenant-user", { email: "x@demo.tablio.test", password: "123456", tenant_id: DEMO.tenant, role: "host" }, token);
    expect(r.status).toBe(400);
  });

  it.skipIf(!hayCredenciales)("el dueño sí puede asignar cocina (pasa la autorización; contraseña corta)", async () => {
    const { token } = await conSesion("owner");
    const r = await llamarFuncion("create-tenant-user", { email: "x@demo.tablio.test", password: "123", tenant_id: DEMO.tenant, role: "kitchen" }, token);
    expect(r.status).toBe(400);
  });
});
