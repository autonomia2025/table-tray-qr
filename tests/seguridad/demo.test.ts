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

  it.skipIf(!hayCredenciales)("el superadmin sí puede, y deja el demo sin pedidos ni mesas ocupadas", async () => {
    const { cliente } = await conSesion("superadmin");
    const { data, error } = await cliente.rpc("reiniciar_demo");
    expect(error).toBeNull();
    expect(typeof data.pedidos_borrados).toBe("number");
    const { count } = await cliente.from("orders").select("id", { count: "exact", head: true }).eq("tenant_id", "651c363f-0084-50af-9873-be98cfeaaf47");
    expect(count).toBe(0);
    const { data: ocupadas } = await cliente.from("tables").select("id").eq("tenant_id", "651c363f-0084-50af-9873-be98cfeaaf47").neq("status", "free");
    expect(ocupadas ?? []).toHaveLength(0);
  });
});
