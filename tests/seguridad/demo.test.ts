import { describe, it, expect } from "vitest";
import { anonimo, conSesion, esBaseLocal, hayCredenciales } from "./entorno";

// reiniciar_demo() borra lo operado del demo: solo un superadmin puede ejecutarla.
// Reiniciar de verdad solo en la base desechable: en la base real el fundador prueba el demo a mano (20-10-2026).
describe("reinicio del demo", () => {
  it("un anónimo no puede reiniciar el demo", async () => {
    const { error } = await anonimo().rpc("reiniciar_demo");
    expect(error).not.toBeNull();
  });

  it.skipIf(!hayCredenciales)("el dueño del demo no puede reiniciarlo", async () => {
    const { cliente } = await conSesion("owner");
    const { error } = await cliente.rpc("reiniciar_demo");
    expect(error?.message).toContain("superadmin");
  });

  it.skipIf(!hayCredenciales || !esBaseLocal)("el superadmin sí puede: hoy queda sin pedidos ni mesas ocupadas, con 4 semanas de ejemplo antes", async () => {
    const { cliente } = await conSesion("superadmin");
    const { data, error } = await cliente.rpc("reiniciar_demo");
    expect(error).toBeNull();
    expect(typeof data.pedidos_borrados).toBe("number");
    const demo = "651c363f-0084-50af-9873-be98cfeaaf47";
    // Hoy (desde el corte de las 06:00 en Chile) no hay nada; la historia de ejemplo es de días anteriores
    const inicioDia = new Date(`${new Date(Date.now() - 6 * 3_600_000).toLocaleDateString("en-CA", { timeZone: "America/Santiago" })}T06:00:00-03:00`);
    const hoy = await cliente.from("orders").select("id", { count: "exact", head: true }).eq("tenant_id", demo).gte("created_at", inicioDia.toISOString());
    expect(hoy.count).toBe(0);
    const historia = await cliente.from("orders").select("id", { count: "exact", head: true }).eq("tenant_id", demo);
    expect(historia.count).toBeGreaterThan(100);
    // Todo lo sembrado está pagado y entregado: nada queda pendiente en cocina, con el mozo ni en la caja
    const pendientes = await cliente.from("orders").select("id", { count: "exact", head: true }).eq("tenant_id", demo)
      .or("payment_status.neq.paid,status.neq.delivered");
    expect(pendientes.count).toBe(0);
    const abiertas = await cliente.from("table_sessions").select("id", { count: "exact", head: true }).eq("tenant_id", demo).eq("is_active", true);
    expect(abiertas.count).toBe(0);
    const auditoria = await cliente.rpc("auditoria_plata");
    expect(auditoria.error).toBeNull();
    expect(auditoria.data ?? []).toHaveLength(0);
    const { data: ocupadas } = await cliente.from("tables").select("id").eq("tenant_id", "651c363f-0084-50af-9873-be98cfeaaf47").neq("status", "free");
    expect(ocupadas ?? []).toHaveLength(0);
  });

  it.skipIf(!hayCredenciales || !esBaseLocal)("en cero: sin historia ni pagos, con la carta, las mesas y el equipo intactos", async () => {
    const { cliente } = await conSesion("superadmin");
    const demo = "651c363f-0084-50af-9873-be98cfeaaf47";
    const contar = async (tabla: string) =>
      (await cliente.from(tabla).select("id", { count: "exact", head: true }).eq("tenant_id", demo)).count;
    const carta = await contar("menu_items");
    const mesas = await contar("tables");
    const { error } = await cliente.rpc("reiniciar_demo", { _con_historia: false });
    expect(error).toBeNull();
    expect(await contar("orders")).toBe(0);
    expect(await contar("payments")).toBe(0);
    expect(await contar("table_sessions")).toBe(0);
    expect(await contar("menu_items")).toBe(carta);
    expect(await contar("tables")).toBe(mesas);
    for (const auditoria of ["auditoria_seguridad", "auditoria_plata", "auditoria_operacion"]) {
      const { data, error: e } = await cliente.rpc(auditoria);
      expect(e).toBeNull();
      expect(data ?? []).toHaveLength(0);
    }
    // Las demás pruebas esperan la historia de ejemplo: se vuelve a sembrar
    expect((await cliente.rpc("reiniciar_demo")).error).toBeNull();
  });
});
