import { describe, it, expect, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonimo, conSesion, hayCredenciales, invitado, llamarFuncion, qrMesa, DEMO } from "./entorno";

// Fase 3.1 — Turnos de mozo y propina para el mozo que tomó la mesa (decisión del fundador, 14 de
// octubre de 2026: el cliente no elige).

type Turno = { turno_id: string; staff_id: string; abierto_por: string; fin: string | null; propinas: number; pagos: number; mesas: number };

describe.skipIf(!hayCredenciales)("turnos y propinas", () => {
  let dueno: SupabaseClient;
  let mozo: SupabaseClient;
  let caja: SupabaseClient;
  let miFicha: string;
  let otroMozo: string;
  const ids: Record<string, string> = {};
  const linea = (nombre: string, cantidad = 1) => [{ menu_item_id: ids[nombre], quantity: cantidad }];
  const idMesa = async (n: number) => (await dueno.from("tables").select("id").eq("branch_id", DEMO.sucursal).eq("number", n).single()).data!.id as string;
  const liberar = async (n: number) => dueno.rpc("cerrar_mesa", { _table_id: await idMesa(n), _motivo: "preparar prueba" });
  const miTurno = async () => (await mozo.rpc("mi_turno", { _branch_id: DEMO.sucursal })).data as unknown as Turno | null;

  // Deja al mozo sin mesas a su cargo y sin turno abierto
  async function mozoLibre() {
    const { data: mias } = await dueno.from("tables").select("id").eq("assigned_waiter_id", miFicha);
    for (const t of mias ?? []) await dueno.rpc("cerrar_mesa", { _table_id: t.id, _motivo: "preparar prueba" });
    if (await miTurno()) expect((await mozo.rpc("cerrar_turno")).error).toBeNull();
  }

  async function comensalEn(mesa: number) {
    const c = await invitado();
    await c.rpc("unirse_a_mesa", { _qr_token: qrMesa(mesa)! });
    return { c, token: (await c.auth.getSession()).data.session!.access_token };
  }

  beforeAll(async () => {
    dueno = (await conSesion("owner")).cliente;
    mozo = (await conSesion("waiter")).cliente;
    caja = (await conSesion("cashier")).cliente;
    const { data: { user } } = await mozo.auth.getUser();
    miFicha = (await dueno.from("staff_users").select("id").eq("tenant_id", DEMO.tenant).eq("auth_user_id", user!.id).single()).data!.id;
    otroMozo = (await dueno.from("staff_users").select("id").eq("tenant_id", DEMO.tenant).eq("role", "waiter").neq("id", miFicha).limit(1).single()).data!.id;
    const { data } = await anonimo().from("menu_items").select("id, name").eq("tenant_id", DEMO.tenant);
    for (const p of data ?? []) ids[p.name] = p.id;
  });

  it("el mozo empieza y termina su turno; un doble toque no abre dos", async () => {
    await mozoLibre();
    expect(await miTurno()).toBeNull();
    const [a, b] = await Promise.all([
      mozo.rpc("abrir_turno", { _branch_id: DEMO.sucursal }),
      mozo.rpc("abrir_turno", { _branch_id: DEMO.sucursal }),
    ]);
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    expect((a.data as { turno_id: string }).turno_id).toBe((b.data as { turno_id: string }).turno_id);
    const abierto = await miTurno();
    expect(abierto).toMatchObject({ staff_id: miFicha, abierto_por: "mozo", fin: null });

    const cierre = await mozo.rpc("cerrar_turno");
    expect(cierre.error).toBeNull();
    expect((cierre.data as unknown as Turno).fin).not.toBeNull();
    expect(await miTurno()).toBeNull();
    expect((await mozo.rpc("cerrar_turno")).error?.message).toContain("No tienes un turno abierto");
  });

  it("tomar una mesa sin turno abre el turno solo; no se termina el turno con mesas a cargo", async () => {
    await mozoLibre();
    await liberar(2);
    const { c } = await comensalEn(2);
    await c.rpc("pedir_sin_pagar", { _qr_token: qrMesa(2)!, _items: linea("Agua mineral"), _forma: "mozo" });
    expect((await mozo.rpc("tomar_mesa", { _table_id: await idMesa(2) })).error).toBeNull();
    expect(await miTurno()).toMatchObject({ abierto_por: "automatico", fin: null });

    expect((await mozo.rpc("cerrar_turno")).error?.message).toContain("a tu cargo");
    await liberar(2);
    expect((await mozo.rpc("cerrar_turno")).error).toBeNull();
  });

  it("la propina es del mozo que tomó la mesa, aunque cobre la caja", async () => {
    await mozoLibre();
    await liberar(3);
    expect((await mozo.rpc("tomar_mesa", { _table_id: await idMesa(3) })).error).toBeNull();
    const turno = (await miTurno())!;
    const { c } = await comensalEn(3);
    const pedido = (await c.rpc("pedir_sin_pagar", { _qr_token: qrMesa(3)!, _items: linea("Agua mineral"), _forma: "mozo" })).data as { order_id: string };
    const cobro = await caja.rpc("registrar_cobro_mozo", { _order_ids: [pedido.order_id], _metodo: "cash", _propina: 500 });
    expect(cobro.error).toBeNull();
    const { data: pago } = await dueno.from("payments").select("staff_id, turno_id, tip_amount, provider_payload").eq("id", (cobro.data as { payment_id: string }).payment_id).single();
    expect(pago).toMatchObject({ staff_id: miFicha, turno_id: turno.turno_id, tip_amount: 500 });
    // Quién cobró queda anotado aparte
    expect((pago!.provider_payload as { rol: string }).rol).toBe("cashier");
    expect((await miTurno())!.propinas).toBe(500);
    await liberar(3);
  });

  it("si el cliente paga antes de que un mozo tome la mesa, la propina es del primero que la tome; transferir no se la quita", async () => {
    await mozoLibre();
    await liberar(4);
    const { token } = await comensalEn(4);
    const pagar = (clave: string) => llamarFuncion("process-payment", {
      table_token: qrMesa(4), method: "card", tip_amount: 300, cart_items: linea("Agua mineral"), idempotency_key: clave,
    }, token);
    const r1 = await pagar(`antes-${Date.now()}`);
    expect(r1.status).toBe(200);
    const pago1 = JSON.parse(r1.cuerpo).payment.id as string;
    const staffDe = async (id: string) => (await dueno.from("payments").select("staff_id, turno_id").eq("id", id).single()).data!;
    expect((await staffDe(pago1)).staff_id).toBeNull();

    // La toma el mozo: la propina pasa a ser suya, en su turno
    expect((await mozo.rpc("tomar_mesa", { _table_id: await idMesa(4) })).error).toBeNull();
    const turno = (await miTurno())!;
    expect(await staffDe(pago1)).toMatchObject({ staff_id: miFicha, turno_id: turno.turno_id });

    // Se la transfiere a otro mozo: lo ya pagado sigue siendo suyo; lo nuevo es del otro
    expect((await mozo.rpc("transferir_mesa", { _table_id: await idMesa(4), _staff_id: otroMozo })).error).toBeNull();
    const r2 = await pagar(`despues-${Date.now()}`);
    expect(r2.status).toBe(200);
    expect((await staffDe(pago1)).staff_id).toBe(miFicha);
    expect((await staffDe(JSON.parse(r2.cuerpo).payment.id)).staff_id).toBe(otroMozo);
    await liberar(4);
  });

  it("cada uno ve solo su turno; el encargado cierra un turno olvidado con motivo y queda registrado", async () => {
    await mozoLibre();
    const abierto = (await mozo.rpc("abrir_turno", { _branch_id: DEMO.sucursal })).data as { turno_id: string };
    // El mozo ve solo sus turnos; cocina no ve el del mozo; comensal y anónimo, nada
    const { data: delMozo } = await mozo.from("turnos").select("staff_id");
    expect((delMozo ?? []).every((t) => t.staff_id === miFicha)).toBe(true);
    const cocina = (await conSesion("kitchen")).cliente;
    expect((await cocina.from("turnos").select("id").eq("id", abierto.turno_id)).data ?? []).toHaveLength(0);
    expect((await (await invitado()).from("turnos").select("id")).data ?? []).toHaveLength(0);
    expect((await anonimo().from("turnos").select("id")).data ?? []).toHaveLength(0);
    // Nadie escribe turnos directo, ni abre turnos sin ser del local
    expect((await mozo.from("turnos").update({ inicio: "2020-01-01" }).eq("id", abierto.turno_id)).error).not.toBeNull();
    expect((await (await invitado()).rpc("abrir_turno", { _branch_id: DEMO.sucursal })).error).not.toBeNull();
    // Otro mozo o la cocina no cierran turnos ajenos; el encargado sí, con motivo
    expect((await cocina.rpc("cerrar_turno", { _turno_id: abierto.turno_id })).error?.message).toContain("Solo un encargado");
    expect((await dueno.rpc("cerrar_turno", { _turno_id: abierto.turno_id })).error?.message).toContain("por qué");
    expect((await dueno.rpc("cerrar_turno", { _turno_id: abierto.turno_id, _nota: "Se fue y olvidó cerrar" })).error).toBeNull();
    const { data: registro } = await dueno.from("audit_logs").select("action").eq("entity_id", abierto.turno_id);
    expect(registro?.map((r) => r.action)).toContain("cerrar_turno_ajeno");
    // El dueño ve los turnos con sus propinas; el mozo no ve los de la sucursal
    const lista = await dueno.rpc("turnos_sucursal", { _branch_id: DEMO.sucursal, _desde: "2026-10-01", _hasta: "2030-01-01" });
    expect(lista.error?.message).toContain("dos meses");
    const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
    const ayer = new Date(Date.now() - 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
    const semana = await dueno.rpc("turnos_sucursal", { _branch_id: DEMO.sucursal, _desde: ayer, _hasta: hoy });
    expect(semana.error).toBeNull();
    expect((semana.data as unknown as Turno[]).some((t) => t.turno_id === abierto.turno_id)).toBe(true);
    expect((await mozo.rpc("turnos_sucursal", { _branch_id: DEMO.sucursal, _desde: ayer, _hasta: hoy })).error).not.toBeNull();
  });

  it.skipIf(!process.env.DEMO_CREDENCIALES)("el dueño de otro local no ve ni cierra turnos del demo", async () => {
    const ajeno = (await conSesion("owner_ajeno")).cliente;
    const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
    expect((await ajeno.rpc("turnos_sucursal", { _branch_id: DEMO.sucursal, _desde: hoy, _hasta: hoy })).error).not.toBeNull();
    const { data } = await dueno.from("turnos").select("id").eq("branch_id", DEMO.sucursal).limit(1);
    if (data?.[0]) {
      expect((await ajeno.from("turnos").select("id").eq("id", data[0].id)).data ?? []).toHaveLength(0);
      expect((await ajeno.rpc("cerrar_turno", { _turno_id: data[0].id, _nota: "ataque de otro local" })).error).not.toBeNull();
    }
  });
});
