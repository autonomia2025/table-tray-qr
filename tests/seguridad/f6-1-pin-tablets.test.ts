import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anonimo, conSesion, esBaseLocal, hayCredenciales, invitado, llamarFuncion, DEMO } from "./entorno";

// Fase 6.1 — PIN del mozo en tablets compartidas: la tablet tiene su token; el mozo entra con su PIN y la
// tablet queda con la sesión de ESE mozo. El PIN es cifrado y nadie lo lee; 5 intentos lo bloquean.

const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();
const PIN = "4826";

describe.skipIf(!hayCredenciales)("PIN del mozo en tablets compartidas", () => {
  let dueno: SupabaseClient;
  let mozo: SupabaseClient;
  let staffMozo: string;
  let token = "";

  beforeAll(async () => {
    dueno = (await conSesion("owner")).cliente;
    mozo = (await conSesion("waiter")).cliente;
    const yo = (await mozo.auth.getUser()).data.user!.id;
    staffMozo = (await dueno.from("staff_users").select("id").eq("auth_user_id", yo).single()).data!.id;
    expect((await mozo.rpc("definir_mi_pin", { _pin: PIN })).error).toBeNull();
    const t = await dueno.rpc("crear_equipo_compartido", { _branch_id: DEMO.sucursal, _nombre: "Tablet de prueba" });
    expect(t.error).toBeNull();
    token = (t.data as { token: string }).token;
  });

  it("el PIN se guarda cifrado y nadie lo lee; los PIN fáciles no se aceptan", async () => {
    for (const c of [dueno, mozo, (await conSesion("superadmin")).cliente]) {
      expect((await c.from("pines_personal" as never).select("*").limit(1)).data ?? []).toHaveLength(0);
    }
    expect((await mozo.rpc("definir_mi_pin", { _pin: "1234" })).error?.message).toContain("fácil");
    expect((await mozo.rpc("definir_mi_pin", { _pin: "12a4" })).error?.message).toContain("4 números");
    expect((await anonimo().rpc("definir_mi_pin", { _pin: "5839" })).error).not.toBeNull();
    // Un cliente no tiene PIN
    expect((await (await invitado()).rpc("definir_mi_pin", { _pin: "5839" })).error).not.toBeNull();
    // El dueño ve quién tiene PIN (sin el PIN); el token de la tablet tampoco se lee
    const estado = (await dueno.rpc("estado_pines", { _branch_id: DEMO.sucursal })).data as { staff_id: string; tiene_pin: boolean }[];
    expect(estado.find((p) => p.staff_id === staffMozo)?.tiene_pin).toBe(true);
    expect((await dueno.from("equipos_compartidos").select("token_hash" as never)).error).not.toBeNull();
  });

  it("con la tablet y el PIN correcto, la tablet queda con la sesión de ese mozo (y lo que hace queda a su nombre)", async () => {
    // La pantalla de la tablet ve los nombres de quienes tienen PIN (y nada sin un token válido)
    const equipo = (await anonimo().rpc("equipo_de_tablet", { _token: token })).data as { personas: { id: string }[]; tablet: string };
    expect(equipo.tablet).toBe("Tablet de prueba");
    expect(equipo.personas.map((p) => p.id)).toContain(staffMozo);
    expect((await anonimo().rpc("equipo_de_tablet", { _token: "f".repeat(64) })).data).toBeNull();

    const r = await llamarFuncion("entrar-con-pin", { equipo: token, persona: staffMozo, pin: PIN });
    expect(r.status, r.cuerpo).toBe(200);
    const s = JSON.parse(r.cuerpo) as { access_token: string; refresh_token: string };
    const tablet = anonimo();
    await tablet.auth.setSession({ access_token: s.access_token, refresh_token: s.refresh_token });
    expect((await tablet.auth.getUser()).data.user?.id).toBe((await mozo.auth.getUser()).data.user!.id);
    // Queda registrado
    const { data: log } = await dueno.from("audit_logs").select("id").eq("action", "entrada_con_pin").eq("user_id", (await mozo.auth.getUser()).data.user!.id).limit(1);
    expect(log ?? []).toHaveLength(1);
  });

  it("PIN equivocado no entra; 5 intentos lo bloquean; una tablet desactivada ya no sirve", async () => {
    const malo = await llamarFuncion("entrar-con-pin", { equipo: token, persona: staffMozo, pin: "0001" });
    expect(malo.status).toBe(403);
    expect(JSON.parse(malo.cuerpo).error).toContain("incorrecto");
    // Sin tablet válida, ni con el PIN correcto
    expect((await llamarFuncion("entrar-con-pin", { equipo: "a".repeat(64), persona: staffMozo, pin: PIN })).status).toBe(403);
    expect((await llamarFuncion("entrar-con-pin", { equipo: token, persona: staffMozo })).status).toBe(400);

    if (esBaseLocal) {
      for (let i = 0; i < 5; i++) await llamarFuncion("entrar-con-pin", { equipo: token, persona: staffMozo, pin: "0002" });
      const bloqueado = await llamarFuncion("entrar-con-pin", { equipo: token, persona: staffMozo, pin: PIN });
      expect(bloqueado.status).toBe(403);
      expect(JSON.parse(bloqueado.cuerpo).error).toContain("Demasiados intentos");
      // El encargado borra el PIN; el mozo crea uno nuevo y vuelve a entrar
      expect((await dueno.rpc("borrar_pin", { _staff_id: staffMozo })).error).toBeNull();
      expect((await mozo.rpc("definir_mi_pin", { _pin: PIN })).error).toBeNull();
      expect((await llamarFuncion("entrar-con-pin", { equipo: token, persona: staffMozo, pin: PIN })).status).toBe(200);
    }
    // El mozo no borra el PIN de otros ni desactiva tablets
    expect((await mozo.rpc("borrar_pin", { _staff_id: staffMozo })).error).not.toBeNull();
    const id = (await dueno.from("equipos_compartidos").select("id").eq("nombre", "Tablet de prueba").is("revocado_at", null).limit(1).single()).data!.id;
    expect((await mozo.rpc("revocar_equipo_compartido", { _id: id })).error).not.toBeNull();
    expect((await dueno.rpc("revocar_equipo_compartido", { _id: id })).error).toBeNull();
    expect((await llamarFuncion("entrar-con-pin", { equipo: token, persona: staffMozo, pin: PIN })).status).toBe(403);
    expect((await anonimo().rpc("equipo_de_tablet", { _token: token })).data).toBeNull();
  });

  it("solo el dueño, administrador o encargado activan tablets; el dueño de otro local no toca las del demo", async () => {
    for (const rol of ["waiter", "cashier", "kitchen"]) {
      expect((await (await conSesion(rol)).cliente.rpc("crear_equipo_compartido", { _branch_id: DEMO.sucursal, _nombre: "x" })).error, rol).not.toBeNull();
    }
    expect((await anonimo().rpc("crear_equipo_compartido", { _branch_id: DEMO.sucursal, _nombre: "x" })).error).not.toBeNull();
    if (process.env.DEMO_CREDENCIALES) {
      const ajeno = (await conSesion("owner_ajeno")).cliente;
      expect((await ajeno.rpc("crear_equipo_compartido", { _branch_id: DEMO.sucursal, _nombre: "x" })).error).not.toBeNull();
      expect((await ajeno.from("equipos_compartidos").select("id").eq("branch_id", DEMO.sucursal)).data ?? []).toHaveLength(0);
      expect((await ajeno.rpc("estado_pines", { _branch_id: DEMO.sucursal })).error).not.toBeNull();
    }
    if (esBaseLocal) {
      // Un mozo desactivado no entra aunque tenga PIN y la tablet esté activa
      const t2 = ((await dueno.rpc("crear_equipo_compartido", { _branch_id: DEMO.sucursal, _nombre: "Tablet 2" })).data as { token: string }).token;
      sql(`UPDATE tenant_members SET is_active = false WHERE user_id = (SELECT auth_user_id FROM staff_users WHERE id = '${staffMozo}')`);
      try {
        expect((await llamarFuncion("entrar-con-pin", { equipo: t2, persona: staffMozo, pin: PIN })).status).toBe(403);
      } finally {
        sql(`UPDATE tenant_members SET is_active = true WHERE user_id = (SELECT auth_user_id FROM staff_users WHERE id = '${staffMozo}')`);
      }
    }
  });
});
