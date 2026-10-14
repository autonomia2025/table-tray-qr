import { test, expect, devices } from "@playwright/test";
import { cuenta, entrarComoCliente, foto, linkMesa } from "./apoyo/recorrido";

// Fase 4.5 — Privacidad del comensal (Ley 21.719): desde "Mi cuenta" elige si recibe promociones,
// descarga sus datos y puede borrar su cuenta; la política de privacidad está a un toque.
test.skip(!cuenta("cliente"), "Falta la cuenta de cliente del demo");
test.skip(({ isMobile }) => !isMobile, "Es una pantalla del celular");

test("el cliente ve sus opciones de privacidad, descarga sus datos y lee la política", async ({ browser }) => {
  const ctx = await browser.newContext({ ...devices["Pixel 7"], acceptDownloads: true });
  const page = await ctx.newPage();
  await entrarComoCliente(page);
  await page.goto(linkMesa(2)!);
  await page.getByRole("button", { name: "Mi cuenta" }).click();
  await expect(page.getByText("Descargar mis datos")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("switch", { name: "Recibir promociones" })).toBeVisible();
  await foto(page, "150-cliente-mi-cuenta-privacidad");

  const [descarga] = await Promise.all([page.waitForEvent("download"), page.getByText("Descargar mis datos").click()]);
  expect(descarga.suggestedFilename()).toMatch(/^mis-datos-tablio-.*\.json$/);

  // Borrar pide confirmación clara (aquí no se confirma: es la cuenta de prueba del demo)
  await page.getByText("Borrar mi cuenta").click();
  await expect(page.getByText("¿Borrar tu cuenta?")).toBeVisible();
  await expect(page.getByText(/quedan en los registros de cada local, sin tu nombre/)).toBeVisible();
  await foto(page, "151-cliente-confirmar-borrado");
  await page.getByRole("button", { name: "Cancelar" }).click();

  await page.goto("/privacidad");
  await expect(page.getByRole("heading", { name: "Política de privacidad" })).toBeVisible();
  await foto(page, "152-politica-privacidad");
  await ctx.close();
});
