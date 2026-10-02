import { describe, it, expect, beforeAll } from "vitest";
import { anonimo, conSesion, hayCredenciales, llamarFuncion, DEMO } from "./entorno";

// Fase 1.1 — Contención inmediata. Cada prueba es un ataque del diagnóstico que debe FALLAR.
let otroLocal: string; // un local que no es el demo (La parrillada)

beforeAll(async () => {
  const { data } = await anonimo().from("tenants").select("id").neq("id", DEMO.tenant).limit(1);
  otroLocal = data?.[0]?.id;
});

describe("membresías de local (problema 1)", () => {
  it("un anónimo no puede agregar miembros a un local", async () => {
    const { data, error } = await anonimo()
      .from("tenant_members")
      .insert({ user_id: DEMO.dueno, tenant_id: otroLocal, role: "owner" })
      .select();
    expect(error).not.toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it.skipIf(!hayCredenciales)("el dueño del demo no puede meterse como miembro de otro local", async () => {
    const { cliente } = await conSesion("owner");
    const { data, error } = await cliente
      .from("tenant_members")
      .insert({ user_id: DEMO.dueno, tenant_id: otroLocal, role: "owner" })
      .select();
    expect(error).not.toBeNull();
    expect(data ?? []).toHaveLength(0);
  });
});

describe("PIN del personal (problema 3)", () => {
  it("la columna del PIN en texto plano ya no existe", async () => {
    const { error } = await anonimo().from("staff_users").select("pin").limit(1);
    expect(error?.code).toBe("42703"); // columna inexistente
  });
});

describe("invitaciones (agravante del problema 4)", () => {
  it("un anónimo no puede listar invitaciones de mozo", async () => {
    const { data } = await anonimo().from("staff_invitations").select("token").limit(5);
    expect(data ?? []).toHaveLength(0);
  });

  it("un anónimo no puede listar invitaciones de backoffice", async () => {
    const { data } = await anonimo().from("backoffice_invitations").select("token").limit(5);
    expect(data ?? []).toHaveLength(0);
  });

  it("un anónimo no puede modificar invitaciones", async () => {
    // Cambio que no altera nada: si devuelve filas, la política pública de escritura sigue abierta.
    const { data: mozo } = await anonimo().from("staff_invitations").update({ used_at: null }).is("used_at", null).select("id");
    const { data: bo } = await anonimo().from("backoffice_invitations").update({ used_at: null }).is("used_at", null).select("id");
    expect(mozo ?? []).toHaveLength(0);
    expect(bo ?? []).toHaveLength(0);
  });

  it.skipIf(!hayCredenciales)("una invitación válida se puede consultar por su código, sin ver las demás", async () => {
    const { cliente } = await conSesion("owner");
    const { data: inv, error } = await cliente
      .from("staff_invitations")
      .insert({ tenant_id: DEMO.tenant, branch_id: DEMO.sucursal, role: "waiter" })
      .select("id, token")
      .single();
    expect(error).toBeNull();
    try {
      const { data: info, error: e2 } = await anonimo().rpc("ver_invitacion_mozo", { _token: inv!.token });
      expect(e2).toBeNull();
      expect(info?.[0]?.local).toBe("Demo Tablio");
      expect(info?.[0]?.estado).toBe("vigente");
      const { data: falsa } = await anonimo().rpc("ver_invitacion_mozo", { _token: "no-existe" });
      expect(falsa?.[0]?.estado).toBe("no_existe");
    } finally {
      await cliente.from("staff_invitations").delete().eq("id", inv!.id);
    }
  });
});

describe("creación de usuarios (problema 5 y N1)", () => {
  it("crear usuarios sin sesión está prohibido", async () => {
    const r = await llamarFuncion("create-tenant-user", { email: "x@demo.tablio.test", password: "123456", tenant_id: otroLocal });
    expect(r.status).toBe(401);
  });

  it.skipIf(!hayCredenciales)("el dueño del demo no puede crear usuarios en otro local", async () => {
    const { token } = await conSesion("owner");
    const r = await llamarFuncion("create-tenant-user", { email: "x@demo.tablio.test", password: "123456", tenant_id: otroLocal }, token);
    expect(r.status).toBe(403);
  });

  it.skipIf(!hayCredenciales)("el dueño del demo no puede crear usuarios sin local (eso es solo del superadmin)", async () => {
    const { token } = await conSesion("owner");
    const r = await llamarFuncion("create-tenant-user", { email: "x@demo.tablio.test", password: "123456" }, token);
    expect(r.status).toBe(403);
  });

  it.skipIf(!hayCredenciales)("en su propio local, el dueño pasa la autorización (y se valida la contraseña)", async () => {
    const { token } = await conSesion("owner");
    const r = await llamarFuncion("create-tenant-user", { email: "x@demo.tablio.test", password: "123", tenant_id: DEMO.tenant }, token);
    expect(r.status).toBe(400); // contraseña corta: pasó la autorización, no creó nada
  });

  it("las funciones para crear superadmin y jefe de ventas no existen", async () => {
    expect((await llamarFuncion("create-platform-admin", {})).status).toBe(404);
    expect((await llamarFuncion("create-jefe-ventas", {})).status).toBe(404);
  });
});

describe("chat de soporte (problema 9)", () => {
  it("el chat no se puede usar sin sesión", async () => {
    const r = await llamarFuncion("support-chat", { messages: [{ role: "user", content: "hola" }] });
    expect(r.status).toBe(401);
  });
});
