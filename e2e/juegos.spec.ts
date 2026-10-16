import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { foto, liberarMesa, linkMesa } from "./apoyo/recorrido";

const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();

// Fase 7.8 — Juegos en la mesa: mientras esperan, una persona juega la trivia (la corrige el servidor) y otra
// gira la ruleta "¿quién invita la próxima?"; los resultados se ven en la mesa.
test.skip(!linkMesa(9), "Falta privado/DEMO_CREDENCIALES.md");
// En la base real las pruebas corren de a dos y esta comparte mesa con otras: ahí la cubren las de seguridad.
test.skip(process.env.E2E_BASE_DATOS !== "local", "Solo en la base desechable (dos celulares en una mesa compartida)");
test.skip(({ isMobile }) => isMobile, "Dos celulares a la vez; se prueba una vez");

test("la mesa juega la trivia y gira la ruleta mientras espera", async ({ browser }) => {
  test.setTimeout(120_000);
  await liberarMesa(9);
  const celular = () => browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  const ctxA = await celular();
  const ctxB = await celular();
  const ana = await ctxA.newPage();
  const beto = await ctxB.newPage();

  // Los dos piden algo y pagan con la app; quedan en el seguimiento
  for (const p of [ana, beto]) {
    await p.goto(linkMesa(9)!);
    await p.getByText("Agua mineral", { exact: true }).last().click();
    await p.getByRole("button", { name: /Agregar al carrito/ }).click();
    await p.getByText("Ver pedido").click();
    await p.getByRole("button", { name: /Ir a pagar/ }).click();
    await p.getByRole("button", { name: /Pagar con tarjeta/ }).click();
    await expect(p.getByText("¡Pago listo!")).toBeVisible({ timeout: 20_000 });
    await p.getByText("Ver estado de mi pedido").click();
    await expect(p.getByTestId("juegos-mesa")).toBeVisible({ timeout: 15_000 });
  }
  await ana.getByText("Ponte un nombre").click();
  await ana.getByLabel("Tu nombre en la mesa").fill("Ana");
  await ana.getByRole("button", { name: "Listo" }).click();

  // Ana juega la trivia
  await ana.getByRole("button", { name: /Trivia/ }).click();
  await expect(ana.getByText("Pregunta 1 de 5")).toBeVisible({ timeout: 10_000 });
  await foto(ana, "270-ana-juega-la-trivia");
  // Ana acierta 4 y se equivoca en la última (la prueba conoce las correctas; el celular nunca las recibe)
  for (let i = 0; i < 5; i++) {
    await expect(ana.getByText(`Pregunta ${i + 1} de 5`)).toBeVisible();
    const texto = (await ana.getByRole("dialog").locator("p").first().innerText()).trim();
    const correcta = Number(sql(`SELECT correcta FROM preguntas_trivia WHERE pregunta = '${texto.replace(/'/g, "''")}'`));
    const elegida = i < 4 ? correcta : (correcta + 1) % 4;
    await ana.getByRole("dialog").locator("div.space-y-2 > button").nth(elegida).click();
  }
  await expect(ana.getByText("Acertaste 4 de 5")).toBeVisible({ timeout: 10_000 });
  await foto(ana, "271-ana-resultado-trivia");
  await ana.getByRole("button", { name: "Listo" }).click();

  // Beto gira la ruleta: el servidor elige a alguien de la mesa
  await beto.reload();
  await expect(beto.getByTestId("ranking-trivia")).toContainText("Ana", { timeout: 15_000 });
  await beto.getByRole("button", { name: /Quién invita la próxima/ }).click();
  await expect(beto.getByTestId("resultado-ruleta")).toBeVisible({ timeout: 10_000 });
  await foto(beto, "272-beto-gira-la-ruleta");
  await beto.keyboard.press("Escape");
  await expect(beto.getByText(/La ruleta eligió a/)).toBeVisible({ timeout: 10_000 });
  await beto.getByTestId("juegos-mesa").scrollIntoViewIfNeeded();
  await foto(beto, "273-la-mesa-ve-los-juegos");

  await ctxA.close();
  await ctxB.close();
});
