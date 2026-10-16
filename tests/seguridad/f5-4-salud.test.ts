import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { anonimo, conSesion, confirmarPresencia, esBaseLocal, hayCredenciales, invitado, llamarFuncion, qrMesa, DEMO } from "./entorno";

// Fase 5.4 — Salud de la plataforma: la base se revisa sola cada hora y el superadmin la ve en vivo. Lo único
// público es el estado de la última revisión ("ok", "atencion" o "problema"), sin ningún detalle.

const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1"], { input: q }).toString().trim();

describe.skipIf(!hayCredenciales)("salud de la plataforma", () => {
  it("solo el superadmin ve el detalle; el público solo ve el estado, sin datos de nadie", async () => {
    const sa = (await conSesion("superadmin")).cliente;
    const r = await sa.rpc("salud_plataforma");
    expect(r.error).toBeNull();
    const s = r.data as { estado: string; relojes: { nombre: string }[]; auditorias: Record<string, number> };
    expect(["ok", "atencion", "problema"]).toContain(s.estado);
    // Los relojes que mantienen la plataforma están programados
    for (const reloj of ["revisar-pagos", "revisar-salud", "purgar-invitados", "purgar-claves-pasarela"]) {
      expect(s.relojes.map((x) => x.nombre), reloj).toContain(reloj);
    }
    expect(s.auditorias).toMatchObject({ auditoria_seguridad: 0, auditoria_plata: 0, auditoria_operacion: 0 });

    for (const rol of ["owner", "cashier", "waiter", "jefe_ventas"]) {
      const c = (await conSesion(rol)).cliente;
      expect((await c.rpc("salud_plataforma")).error, rol).not.toBeNull();
      expect((await c.from("salud_registros" as never).select("id").limit(1)).data ?? [], rol).toHaveLength(0);
    }
    expect((await (await invitado()).rpc("salud_plataforma")).error).not.toBeNull();
    expect((await anonimo().rpc("salud_plataforma")).error).not.toBeNull();

    // Lo público: solo el estado, cuándo y si es reciente
    const pub = (await anonimo().rpc("estado_salud")).data as Record<string, unknown>;
    expect(Object.keys(pub).sort()).toEqual(["estado", "reciente", "revisado_at"]);
    expect(["ok", "atencion", "problema", "sin_revisar"]).toContain(pub.estado);
    // El superadmin sí ve la historia
    expect(((await sa.from("salud_registros" as never).select("id").limit(1)).data ?? []).length).toBeGreaterThan(0);
  });

  it.skipIf(!esBaseLocal)("la revisión detecta un problema hecho a propósito y lo deja registrado (y se deshace)", async () => {
    // Un pago propio con la app (la prueba no depende de lo que hayan dejado otras)
    const c = await invitado();
    await c.rpc("unirse_a_mesa", { _qr_token: qrMesa(4)! });
    await confirmarPresencia(c, 4);
    const agua = (await anonimo().from("menu_items").select("id").eq("tenant_id", DEMO.tenant).eq("name", "Agua mineral").single()).data!.id;
    const token = (await c.auth.getSession()).data.session!.access_token;
    const pago = await llamarFuncion("process-payment", { table_token: qrMesa(4), method: "card", tip_amount: 0,
      cart_items: [{ menu_item_id: agua, quantity: 1 }], idempotency_key: `salud-${Date.now()}` }, token);
    expect(pago.status, pago.cuerpo).toBe(200);
    const salida = sql(`
      BEGIN;
      -- Un pago que salió a la pasarela hace dos horas y nadie confirmó
      UPDATE intentos_pago SET estado = 'reservado', token_externo = 'tbk-salud-${Date.now()}', created_at = now() - interval '2 hours'
       WHERE id = (SELECT id FROM intentos_pago ORDER BY created_at DESC LIMIT 1);
      SELECT 'estado:' || public._revisar_salud();
      SELECT 'publico:' || (public.estado_salud() ->> 'estado');
      SELECT 'motivo:' || (detalle -> 'problemas' ->> 0) FROM salud_registros ORDER BY id DESC LIMIT 1;
      ROLLBACK;`);
    expect(salida).toContain("estado:problema");
    expect(salida).toContain("publico:problema");
    expect(salida).toContain("motivo:Hay pagos con pasarela sin confirmar");
  });
});
