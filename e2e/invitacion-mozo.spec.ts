import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

// La pantalla de registro del mozo muestra la invitación usando la consulta segura
// (ya no puede leer la tabla de invitaciones). Crea y borra una invitación en el demo.
const archivo = "privado/DEMO_CREDENCIALES.md";
const texto = fs.existsSync(archivo) ? fs.readFileSync(archivo, "utf-8") : "";
const env = Object.fromEntries(
  fs.readFileSync(".env", "utf-8").split("\n").filter((l) => l.includes("=")).map((l) => {
    const [k, ...v] = l.split("=");
    return [k.trim(), v.join("=").trim().replace(/^"|"$/g, "")];
  }),
);
const dueno = texto.match(/^\| owner \| `([^`]+)` \| `([^`]+)` \|$/m);

test.skip(!dueno, "Falta privado/DEMO_CREDENCIALES.md");

test("el link de invitación muestra el local y una invitación falsa se rechaza", async ({ page }) => {
  const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  await sb.auth.signInWithPassword({ email: dueno![1], password: dueno![2] });
  const { data: inv } = await sb
    .from("staff_invitations")
    .insert({ tenant_id: "651c363f-0084-50af-9873-be98cfeaaf47", branch_id: "aebe7faa-0e29-5aa9-83c2-1e1b336f1554", role: "waiter" })
    .select("id, token")
    .single();
  try {
    await page.goto(`/mozo/join/${inv!.token}`);
    await expect(page.getByRole("heading", { name: "Demo Tablio" })).toBeVisible();
    await page.goto("/mozo/join/codigo-que-no-existe");
    await expect(page.getByRole("heading", { name: "Demo Tablio" })).toHaveCount(0);
  } finally {
    await sb.from("staff_invitations").delete().eq("id", inv!.id);
  }
});
