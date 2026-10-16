import { describe, it, expect, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonimo, conSesion, confirmarPresencia, esBaseLocal, hayCredenciales, invitado, llamarFuncion, qrMesa, DEMO } from "./entorno";

// Fase 7.4 — Invitar una ronda. Quien invita paga su propio pedido (cada uno paga lo suyo): la plata no
// cambia. El pedido queda marcado como ronda y los demás de la mesa lo ven en la mesa en vivo; nadie de otra
// mesa lo ve, y una ronda sin pagar no aparece. Paga de verdad: solo en la base desechable.

const MESA = 6;
type Mesa = { rondas: { quien: string; mia: boolean; items: { nombre: string; cantidad: number }[] }[] };

describe.skipIf(!hayCredenciales || !esBaseLocal)("invitar una ronda", () => {
  let agua = "";
  const comensal = async (mesa: number, alias: string) => {
    const c = await invitado();
    await c.rpc("unirse_a_mesa", { _qr_token: qrMesa(mesa)!, _alias: alias });
    await confirmarPresencia(c, mesa);
    return { c, token: (await c.auth.getSession()).data.session!.access_token };
  };
  const enVivo = async (c: SupabaseClient, mesa = MESA) => (await c.rpc("mi_mesa_en_vivo", { _qr_token: qrMesa(mesa)! })).data as unknown as Mesa;

  beforeAll(async () => {
    agua = (await anonimo().from("menu_items").select("id").eq("tenant_id", DEMO.tenant).eq("name", "Agua mineral").single()).data!.id;
    const dueno = (await conSesion("owner")).cliente;
    for (const n of [MESA, MESA + 1]) {
      const id = (await dueno.from("tables").select("id").eq("branch_id", DEMO.sucursal).eq("number", n).single()).data!.id;
      await dueno.rpc("cerrar_mesa", { _table_id: id, _motivo: "preparar prueba" });
    }
  });

  it("quien invita paga su pedido marcado como ronda, y el resto de su mesa (solo de su mesa) la ve", async () => {
    const camila = await comensal(MESA, "Camila");
    const diego = await comensal(MESA, "Diego");
    const otraMesa = await comensal(MESA + 1, "Ana");

    // Sin pagar todavía: no aparece
    const cot = (await camila.c.rpc("cotizar", { _qr_token: qrMesa(MESA)!, _items: [{ menu_item_id: agua, quantity: 3 }], _ronda: true })).data as { id: string; subtotal: number };
    expect((await enVivo(diego.c)).rondas).toHaveLength(0);

    const r = await llamarFuncion("process-payment", { table_token: qrMesa(MESA), method: "card", tip_amount: 0, cotizacion_id: cot.id,
      idempotency_key: `ronda-${Date.now()}` }, camila.token);
    expect(r.status, r.cuerpo).toBe(200);
    // La plata no cambia: Camila pagó exactamente su pedido
    expect((JSON.parse(r.cuerpo).payment as { amount: number }).amount).toBe(cot.subtotal);

    const vistoPorDiego = (await enVivo(diego.c)).rondas;
    expect(vistoPorDiego).toHaveLength(1);
    expect(vistoPorDiego[0]).toMatchObject({ quien: "Camila", mia: false, items: [{ nombre: "Agua mineral", cantidad: 3 }] });
    expect((await enVivo(camila.c)).rondas[0].mia).toBe(true);
    // Alguien de otra mesa no la ve
    expect((await enVivo(otraMesa.c, MESA + 1)).rondas).toHaveLength(0);

    // Un pedido normal no es ronda
    const normal = (await diego.c.rpc("cotizar", { _qr_token: qrMesa(MESA)!, _items: [{ menu_item_id: agua, quantity: 1 }] })).data as { id: string };
    await llamarFuncion("process-payment", { table_token: qrMesa(MESA), method: "card", tip_amount: 0, cotizacion_id: normal.id,
      idempotency_key: `normal-${Date.now()}` }, diego.token);
    expect((await enVivo(camila.c)).rondas).toHaveLength(1);
    expect((await (await conSesion("superadmin")).cliente.rpc("auditoria_plata")).data ?? []).toEqual([]);
  });
});
