import { test, expect } from "@playwright/test";
import fs from "node:fs";

// Fase 1.3 — El comensal paga sin registrarse (invitado) y puede guardar su cuenta para sus sellos.
const archivo = process.env.DEMO_CREDENCIALES ?? "privado/DEMO_CREDENCIALES.md";
const texto = fs.existsSync(archivo) ? fs.readFileSync(archivo, "utf-8") : "";
const mesa = (n: number) => texto.match(new RegExp(`^\\| ${n} \\| \\w+ \\| \`([^\`]+)\` \\|$`, "m"))?.[1];
const BUZON = "http://127.0.0.1:54324"; // Mailpit de Supabase local

test.skip(!texto, "Falta privado/DEMO_CREDENCIALES.md");

test("el invitado ve 'Sellos' en la carta y la invitación a guardar su cuenta en el pago", async ({ page }) => {
  await page.goto(mesa(8)!);
  await expect(page.getByRole("button", { name: "Sellos" })).toBeVisible({ timeout: 15_000 });
  await page.getByText("Agua mineral", { exact: true }).first().click();
  await page.getByRole("button", { name: /Agregar al carrito/ }).click();
  await page.getByText("Ver pedido").click();
  await page.getByRole("button", { name: /Ir a pagar/ }).click();
  await expect(page.getByText("Guarda tus sellos")).toBeVisible();
});

test("el invitado guarda su cuenta con su correo y queda como cliente", async ({ page, request }) => {
  test.skip(process.env.E2E_BASE_DATOS !== "local", "Solo en la base desechable (usa el buzón de prueba)");
  const correo = `cliente-${Date.now()}@demo.tablio.test`;

  await page.goto(mesa(9)!);
  await page.getByRole("button", { name: "Sellos" }).click();
  await expect(page.getByText("Guarda tus sellos").first()).toBeVisible();
  await page.getByRole("button", { name: "Continuar con mi correo" }).click();
  await page.getByPlaceholder("tu@correo.com").fill(correo);
  await page.getByRole("button", { name: "Enviar código" }).click();
  await expect(page.getByText("Revisa tu correo")).toBeVisible({ timeout: 20_000 });

  // Abre el enlace del correo, como lo haría el comensal desde su app de correo
  let enlace = "";
  for (let i = 0; i < 20 && !enlace; i++) {
    const lista = await (await request.get(`${BUZON}/api/v1/messages`)).json();
    const msg = lista.messages.find((m: { To: Array<{ Address: string }> }) => m.To.some((t) => t.Address === correo));
    if (msg) {
      const completo = await (await request.get(`${BUZON}/api/v1/message/${msg.ID}`)).json();
      enlace = completo.Text.match(/\(\s*(http\S+\/verify\S+?)\s*\)/)?.[1] ?? "";
    } else {
      await page.waitForTimeout(500);
    }
  }
  expect(enlace).not.toBe("");
  await page.goto(enlace);

  // Vuelve a la carta: ya es cliente (su inicial en vez de "Sellos")
  await page.goto(mesa(9)!);
  await expect(page.getByRole("button", { name: "Mi cuenta" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Mi cuenta" }).click();
  await expect(page.getByText(correo)).toBeVisible();
});
