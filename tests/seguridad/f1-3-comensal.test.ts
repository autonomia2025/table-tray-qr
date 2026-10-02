import { describe, it, expect } from "vitest";
import { anonimo, conSesion, hayCredenciales, invitado, llamarFuncion, qrMesa, DEMO } from "./entorno";

// Fase 1.3 — Identidad del comensal: invitado (anónimo) o cliente registrado.

describe("entrar a una mesa (unirse_a_mesa)", () => {
  it("sin sesión no se puede", async () => {
    const { error } = await anonimo().rpc("unirse_a_mesa", { _qr_token: qrMesa(4) ?? "x" });
    expect(error).not.toBeNull();
  });

  it("un código de mesa inventado se rechaza", async () => {
    const { error } = await (await invitado()).rpc("unirse_a_mesa", { _qr_token: "no-existe" });
    expect(error).not.toBeNull();
  });

  it.skipIf(!hayCredenciales)("dos invitados en la misma mesa comparten la sesión, cada uno con su identidad", async () => {
    const qr = qrMesa(4)!;
    const a = await invitado();
    const b = await invitado();
    const ra = (await a.rpc("unirse_a_mesa", { _qr_token: qr, _alias: "Ana" })).data as { session_id: string; table_number: number; alias: string };
    const rb = (await b.rpc("unirse_a_mesa", { _qr_token: qr })).data as { session_id: string };
    expect(ra.table_number).toBe(4);
    expect(ra.alias).toBe("Ana");
    expect(rb.session_id).toBe(ra.session_id);
    // Volver a entrar no crea otra sesión
    const ra2 = (await a.rpc("unirse_a_mesa", { _qr_token: qr })).data as { session_id: string; alias: string };
    expect(ra2.session_id).toBe(ra.session_id);
    expect(ra2.alias).toBe("Ana");
  });

  it.skipIf(!hayCredenciales)("cada comensal ve solo su propia fila", async () => {
    const qr = qrMesa(5)!;
    const a = await invitado();
    const b = await invitado();
    await a.rpc("unirse_a_mesa", { _qr_token: qr });
    await b.rpc("unirse_a_mesa", { _qr_token: qr });
    const { data: deA } = await a.from("comensales_mesa").select("user_id");
    const idA = (await a.auth.getUser()).data.user!.id;
    expect(deA?.length).toBeGreaterThan(0);
    expect(deA!.every((f) => f.user_id === idA)).toBe(true);
  });

  it.skipIf(!hayCredenciales)("el personal del local ve a los comensales; un anónimo no ve nada", async () => {
    const a = await invitado();
    await a.rpc("unirse_a_mesa", { _qr_token: qrMesa(6)! });
    const mozo = (await conSesion("waiter")).cliente;
    const { data } = await mozo.from("comensales_mesa").select("id").eq("tenant_id", DEMO.tenant);
    expect(data?.length).toBeGreaterThan(0);
    const { data: nada } = await anonimo().from("comensales_mesa").select("id");
    expect(nada ?? []).toHaveLength(0);
  });

  it("nadie puede escribir directo en comensales_mesa", async () => {
    const a = await invitado();
    const yo = (await a.auth.getUser()).data.user!.id;
    const { error } = await a.from("comensales_mesa").insert({
      tenant_id: DEMO.tenant, branch_id: DEMO.sucursal, table_id: DEMO.sucursal, session_id: DEMO.sucursal, user_id: yo,
    });
    expect(error).not.toBeNull();
  });
});

describe("perfil del comensal", () => {
  it("mi_perfil marca al invitado como anónimo", async () => {
    const { data } = await (await invitado()).rpc("mi_perfil");
    expect((data as { es_anonimo: boolean }).es_anonimo).toBe(true);
  });
});

describe("sellos solo con cuenta verificada (N4)", () => {
  it("sin sesión no se pueden ver sellos", async () => {
    const r = await llamarFuncion("loyalty-status", { tenant_id: DEMO.tenant, email: "victima@demo.tablio.test" });
    expect(r.status).toBe(401);
  });

  it("un invitado tampoco", async () => {
    const a = await invitado();
    const token = (await a.auth.getSession()).data.session!.access_token;
    const r = await llamarFuncion("loyalty-status", { tenant_id: DEMO.tenant, email: "victima@demo.tablio.test" }, token);
    expect(r.status).toBe(401);
  });

  it.skipIf(!hayCredenciales)("un invitado que manda el correo de otra persona no suma sellos a nadie, y el pedido queda a su nombre", async () => {
    const a = await invitado();
    const token = (await a.auth.getSession()).data.session!.access_token;
    const yo = (await a.auth.getUser()).data.user!.id;
    const { data: item } = await anonimo().from("menu_items").select("id").eq("tenant_id", DEMO.tenant).eq("name", "Agua mineral").single();
    const r = await llamarFuncion(
      "process-payment",
      { table_token: qrMesa(7), method: "card", email: "victima@demo.tablio.test", cart_items: [{ menu_item_id: item!.id, quantity: 1 }], idempotency_key: `t-${Date.now()}` },
      token,
    );
    expect(r.status).toBe(200);
    const cuerpo = JSON.parse(r.cuerpo);
    expect(cuerpo.loyalty).toBeNull();
    const dueno = (await conSesion("owner")).cliente;
    const { data: pedido } = await dueno.from("orders").select("user_id").eq("order_number", cuerpo.order.order_number).eq("tenant_id", DEMO.tenant).single();
    expect(pedido!.user_id).toBe(yo);
  });
});
