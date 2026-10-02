import { test, expect } from "@playwright/test";
import fs from "node:fs";

// Entra con cada cuenta del local de demo y revisa que llegue a su panel.
// Las contraseñas están en privado/DEMO_CREDENCIALES.md (fuera de git).
// Sin ese archivo, estas pruebas se saltan.
const archivo = process.env.DEMO_CREDENCIALES ?? "privado/DEMO_CREDENCIALES.md";
const texto = fs.existsSync(archivo) ? fs.readFileSync(archivo, "utf-8") : "";
const cuentas = Object.fromEntries(
  [...texto.matchAll(/^\| (\w+) \| `([^`]+)` \| `([^`]+)` \|$/gm)].map((m) => [m[1], { correo: m[2], clave: m[3] }]),
);
const mesa1 = texto.match(/^\| 1 \| \w+ \| `([^`]+)` \|$/m)?.[1];

const destinos: Array<[rol: string, ruta: RegExp]> = [
  ["owner", /\/admin\/demo-tablio\/mesas/],
  ["admin", /\/admin\/demo-tablio\/mesas/],
  ["waiter", /\/mozo\/mesas/],
  ["kitchen", /\/admin\/demo-tablio\/mesas/], // hoy la app manda a cocina al panel del dueño (se ordena en la fase 4)
  ["superadmin", /\/superadmin/],
  ["jefe_ventas", /\/jefe-ventas\/dashboard/],
  ["vendedor", /\/vendedor\/mi-dia/],
  ["finanzas", /\/finanzas\/revenue/],
];

test.describe("local de demo", () => {
  test.skip(!texto, "Falta privado/DEMO_CREDENCIALES.md");

  for (const [rol, ruta] of destinos) {
    test(`entra como ${rol} y llega a su panel`, async ({ page }) => {
      const c = cuentas[rol];
      expect(c, `no hay cuenta para ${rol}`).toBeTruthy();
      await page.goto("/login");
      await page.locator('input[type="email"]').fill(c.correo);
      await page.locator('input[type="password"]').fill(c.clave);
      await page.locator('button[type="submit"]').click();
      if (rol === "waiter") {
        // Error heredado de Lovable (DIAGNOSTICO N16): el panel del mozo manda al segundo
        // login antes de revisar la sesión, y el mozo tiene que entrar dos veces.
        await expect(page).toHaveURL(/\/mozo\/login/, { timeout: 15_000 });
        await page.locator('input[type="email"]').fill(c.correo);
        await page.locator('input[type="password"]').fill(c.clave);
        await page.locator('button[type="submit"]').click();
      }
      await expect(page).toHaveURL(ruta, { timeout: 15_000 });
    });
  }

  test("la carta del demo se ve desde la mesa 1", async ({ page }) => {
    await page.goto(mesa1!);
    await expect(page.getByText("Schop Torobayo 500cc").first()).toBeVisible();
    await expect(page.getByText(/Pisco Sour/).first()).toBeVisible();
  });
});
