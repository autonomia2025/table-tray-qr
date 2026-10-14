import { describe, it, expect, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonimo, codigoMesa, conSesion, hayCredenciales, invitado, llamarFuncion, qrMesa, DEMO } from "./entorno";

// Fase 3.5 — Código de presencia (prueba que el comensal está en la mesa), cuenta abierta controlada
// (límite por persona, pérdidas registradas y visibles) y unir mesas para grupos grandes.

describe.skipIf(!hayCredenciales)("mesas: presencia, cuenta abierta y unir", () => {
  let dueno: SupabaseClient;
  let mozo: SupabaseClient;
  let cocina: SupabaseClient;
  let caja: SupabaseClient;
  let agua: string;
  const idMesa = async (n: number) => (await dueno.from("tables").select("id").eq("branch_id", DEMO.sucursal).eq("number", n).single()).data!.id as string;
  const liberar = async (n: number, motivo = "preparar prueba") => dueno.rpc("cerrar_mesa", { _table_id: await idMesa(n), _motivo: motivo });
  const linea = (cantidad = 1) => [{ menu_item_id: agua, quantity: cantidad }];
  async function sentarse(mesa: number) {
    const c = await invitado();
    await c.rpc("unirse_a_mesa", { _qr_token: qrMesa(mesa)! });
    return c;
  }
  const sucursal = (cambios: Record<string, unknown>) => dueno.from("branches").update(cambios).eq("id", DEMO.sucursal);

  beforeAll(async () => {
    dueno = (await conSesion("owner")).cliente;
    mozo = (await conSesion("waiter")).cliente;
    cocina = (await conSesion("kitchen")).cliente;
    caja = (await conSesion("cashier")).cliente;
    agua = (await anonimo().from("menu_items").select("id").eq("tenant_id", DEMO.tenant).eq("name", "Agua mineral").single()).data!.id;
  });

  it("sin el código de la mesa no se pide sin pagar; con el código correcto, sí; probar códigos al azar se bloquea", async () => {
    await liberar(2);
    const c = await sentarse(2);
    const pedir = () => c.rpc("pedir_sin_pagar", { _qr_token: qrMesa(2)!, _items: linea(), _forma: "mozo" });
    expect((await pedir()).error?.message).toContain("código de 4 números");
    expect((await c.rpc("estado_presencia", { _qr_token: qrMesa(2)! })).data).toMatchObject({ pide: "sin_pagar", confirmado: false });

    const codigo = await codigoMesa(2);
    const malo = codigo === "0000" ? "1111" : "0000";
    const r1 = (await c.rpc("confirmar_presencia", { _qr_token: qrMesa(2)!, _codigo: malo })).data as { ok: boolean; mensaje: string };
    expect(r1.ok).toBe(false);
    expect(r1.mensaje).toContain("no es el código");
    expect((await c.rpc("confirmar_presencia", { _qr_token: qrMesa(2)!, _codigo: codigo })).data).toMatchObject({ ok: true });
    expect((await pedir()).error).toBeNull();

    // Otro comensal prueba 5 códigos malos: queda bloqueado, aunque después acierte
    const adivino = await sentarse(2);
    for (let i = 0; i < 5; i++) await adivino.rpc("confirmar_presencia", { _qr_token: qrMesa(2)!, _codigo: malo });
    const bloqueado = (await adivino.rpc("confirmar_presencia", { _qr_token: qrMesa(2)!, _codigo: codigo })).data as { ok: boolean; bloqueado: boolean };
    expect(bloqueado).toMatchObject({ ok: false, bloqueado: true });
    await liberar(2);
  });

  it("el código no lo ve el comensal (ni leyendo su mesa); el mozo y el dueño sí; la cocina no; el dueño lo cambia", async () => {
    const c = await sentarse(3);
    expect((await c.from("codigos_mesa").select("codigo")).data ?? []).toHaveLength(0);
    const { data: suMesa } = await c.from("tables").select("*").eq("id", await idMesa(3));
    expect(JSON.stringify(suMesa ?? [])).not.toContain(await codigoMesa(3));
    expect((await mozo.from("codigos_mesa").select("codigo").eq("table_id", await idMesa(3))).data).toHaveLength(1);
    expect((await cocina.from("codigos_mesa").select("codigo")).data ?? []).toHaveLength(0);
    expect((await anonimo().from("codigos_mesa").select("codigo")).data ?? []).toHaveLength(0);
    expect((await mozo.from("codigos_mesa").update({ codigo: "1234" }).eq("table_id", await idMesa(3))).error).not.toBeNull();

    const antes = await codigoMesa(3);
    expect((await mozo.rpc("cambiar_codigos_mesa", { _branch_id: DEMO.sucursal })).error).not.toBeNull();
    expect((await dueno.rpc("cambiar_codigos_mesa", { _branch_id: DEMO.sucursal })).error).toBeNull();
    const despues = await codigoMesa(3);
    expect(despues).toMatch(/^\d{4}$/);
    // (puede repetirse por azar 1 en 10.000 veces; basta con que el cambio quede registrado)
    const { data: registro } = await dueno.from("audit_logs").select("action").eq("action", "cambiar_codigos_mesa").limit(1);
    expect(registro).toHaveLength(1);
    void antes;
    await liberar(3);
  });

  it("el local elige: sin código nunca, o también para pagar con la app", async () => {
    await liberar(4);
    try {
      expect((await sucursal({ pedir_codigo: "nunca" })).error).toBeNull();
      const c = await sentarse(4);
      expect((await c.rpc("pedir_sin_pagar", { _qr_token: qrMesa(4)!, _items: linea(), _forma: "mozo" })).error).toBeNull();

      expect((await sucursal({ pedir_codigo: "siempre" })).error).toBeNull();
      const otro = await sentarse(4);
      const token = (await otro.auth.getSession()).data.session!.access_token;
      const r = await llamarFuncion("process-payment", { table_token: qrMesa(4), method: "card", cart_items: linea(), idempotency_key: `siempre-${Date.now()}` }, token);
      expect(r.status).toBe(409);
      expect(JSON.parse(r.cuerpo).error).toContain("código");
      await otro.rpc("confirmar_presencia", { _qr_token: qrMesa(4)!, _codigo: await codigoMesa(4) });
      const r2 = await llamarFuncion("process-payment", { table_token: qrMesa(4), method: "card", cart_items: linea(), idempotency_key: `siempre2-${Date.now()}` }, token);
      expect(r2.status).toBe(200);
    } finally {
      await sucursal({ pedir_codigo: "sin_pagar" });
      await liberar(4);
    }
  });

  it("cuenta abierta: hay un límite por persona; lo que queda sin pagar al cerrar es una pérdida registrada y visible", async () => {
    await liberar(5);
    expect((await sucursal({ payment_mode: "open_tab", limite_cuenta_persona: 5000 })).error).toBeNull();
    try {
      const c = await sentarse(5);
      await c.rpc("confirmar_presencia", { _qr_token: qrMesa(5)!, _codigo: await codigoMesa(5) });
      const cuenta = (n: number) => c.rpc("pedir_sin_pagar", { _qr_token: qrMesa(5)!, _items: linea(n), _forma: "cuenta" });
      expect((await cuenta(2)).error).toBeNull(); // $4.000
      expect((await cuenta(1)).error?.message).toContain("máximo"); // pasaría a $6.000

      // El encargado ve lo que se arriesga; el mozo no
      const riesgo = (await caja.rpc("riesgo_cuenta_abierta", { _branch_id: DEMO.sucursal })).data as { en_riesgo: { monto: number } };
      expect(riesgo.en_riesgo.monto).toBeGreaterThanOrEqual(4000);
      expect((await mozo.rpc("riesgo_cuenta_abierta", { _branch_id: DEMO.sucursal })).error).not.toBeNull();

      // Se van sin pagar: el mozo no puede cerrar; el encargado sí, con motivo, y queda como pérdida
      expect((await mozo.rpc("cerrar_mesa", { _table_id: await idMesa(5) })).error).not.toBeNull();
      const antes = (await caja.rpc("riesgo_cuenta_abierta", { _branch_id: DEMO.sucursal })).data as { perdido_30_dias: { monto: number } };
      expect((await liberar(5, "Se fueron sin pagar")).error).toBeNull();
      const despues = (await caja.rpc("riesgo_cuenta_abierta", { _branch_id: DEMO.sucursal })).data as {
        perdido_30_dias: { monto: number }; ultimas_perdidas: { mesa: number; motivo: string }[] };
      expect(despues.perdido_30_dias.monto - antes.perdido_30_dias.monto).toBe(4000);
      expect(despues.ultimas_perdidas[0]).toMatchObject({ mesa: 5, motivo: "Se fueron sin pagar" });
      const { data: registro } = await dueno.from("audit_logs").select("metadata").eq("action", "mesa_sin_pagar").order("created_at", { ascending: false }).limit(1);
      expect((registro![0].metadata as { monto: number }).monto).toBe(4000);
    } finally {
      await sucursal({ payment_mode: "prepaid", limite_cuenta_persona: 30000 });
    }
  });

  it("unir mesas: la secundaria pasa a la principal (comensales, pedidos y pagos) y su QR lleva a la principal; separar y cerrar la liberan", async () => {
    await Promise.all([liberar(7), liberar(8)]);
    const [m7, m8] = [await idMesa(7), await idMesa(8)];
    // Alguien ya pagó en la 8
    const x = await sentarse(8);
    const token = (await x.auth.getSession()).data.session!.access_token;
    const pago = await llamarFuncion("process-payment", { table_token: qrMesa(8), method: "card", cart_items: linea(), idempotency_key: `unir-${Date.now()}` }, token);
    const pedidoX = JSON.parse(pago.cuerpo).order.id as string;

    // La cocina no une mesas; el mozo sí
    expect((await cocina.rpc("unir_mesas", { _principal: m7, _secundaria: m8 })).error).not.toBeNull();
    const u = await mozo.rpc("unir_mesas", { _principal: m7, _secundaria: m8 });
    expect(u.error).toBeNull();
    const sesion7 = (u.data as { session_id: string }).session_id;
    const { data: ped } = await dueno.from("orders").select("session_id, table_id").eq("id", pedidoX).single();
    expect(ped).toMatchObject({ session_id: sesion7, table_id: m8 }); // sigue diciendo de qué mesa física es
    expect((await dueno.from("payments").select("session_id").eq("order_id", pedidoX).single()).data!.session_id).toBe(sesion7);

    // Quien escanea la 8 entra a la mesa unida (y prueba presencia con el código de la 8)
    const y = await sentarse(8);
    const vivo = (await y.rpc("mi_mesa_en_vivo", { _qr_token: qrMesa(8)! })).data as { mesa: number; personas: unknown[] };
    expect(vivo.mesa).toBe(7);
    expect(vivo.personas).toHaveLength(2);
    expect((await y.rpc("confirmar_presencia", { _qr_token: qrMesa(8)!, _codigo: await codigoMesa(8) })).data).toMatchObject({ ok: true });

    // Separar: la 8 vuelve a ser una mesa libre
    expect((await mozo.rpc("separar_mesa", { _secundaria: m8 })).error).toBeNull();
    expect((await dueno.from("tables").select("unida_a, status").eq("id", m8).single()).data).toMatchObject({ unida_a: null, status: "free" });

    // Unir otra vez y cerrar la principal: la 8 también queda libre
    expect((await mozo.rpc("unir_mesas", { _principal: m7, _secundaria: m8 })).error).toBeNull();
    expect((await liberar(7)).error).toBeNull();
    expect((await dueno.from("tables").select("unida_a, status").eq("id", m8).single()).data).toMatchObject({ unida_a: null, status: "free" });
  });

  it("no se une una mesa de otro mozo ni una ya unida", async () => {
    await Promise.all([liberar(9), liberar(10)]);
    const [m9, m10] = [await idMesa(9), await idMesa(10)];
    const { data: { user } } = await mozo.auth.getUser();
    const { data: otro } = await dueno.from("staff_users").select("id").eq("tenant_id", DEMO.tenant).eq("role", "waiter").neq("auth_user_id", user!.id).limit(1).single();
    await dueno.rpc("abrir_mesa", { _table_id: m10 });
    await dueno.rpc("transferir_mesa", { _table_id: m10, _staff_id: otro!.id });
    expect((await mozo.rpc("unir_mesas", { _principal: m9, _secundaria: m10 })).error?.message).toContain("mozo a cargo");
    expect((await mozo.rpc("unir_mesas", { _principal: m9, _secundaria: m9 })).error).not.toBeNull();
    await Promise.all([liberar(9), liberar(10)]);
  });
});
