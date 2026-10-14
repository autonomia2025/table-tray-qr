import { describe, it, expect } from "vitest";
import { anonimo, conSesion, hayCredenciales } from "./entorno";

// reiniciar_demo() borra lo operado del demo: solo un superadmin puede ejecutarla.
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

  it.skipIf(!hayCredenciales)("el superadmin sí puede: hoy queda sin pedidos ni mesas ocupadas, con 4 semanas de ejemplo antes", async () => {
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
});
