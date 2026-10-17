import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { DEMO } from "../tests/seguridad/entorno";
import { entrar, foto, liberarMesa, linkMesa } from "./apoyo/recorrido";

// Fase 8.4 — Noche de trivia en vivo: el dueño la prepara en la pantalla del local, un cliente se une desde su
// mesa, responde, y la pantalla muestra la respuesta y el ranking. Solo en la base desechable (crea la noche).
test.skip(process.env.E2E_BASE_DATOS !== "local", "Solo en la base desechable (crea una trivia en vivo)");
test.skip(({ isMobile }) => isMobile, "Dos pantallas a la vez; se prueba una vez");

const DB = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-At", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();
test.beforeAll(() => sql(`DELETE FROM trivias_vivo WHERE tenant_id = '${DEMO.tenant}'`));
test.afterAll(() => sql(`DELETE FROM trivias_vivo WHERE tenant_id = '${DEMO.tenant}'`));

test("el local lanza la trivia en su pantalla y un cliente juega desde la mesa", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await liberarMesa(5);
  await entrar(page, "owner");
  await expect(page).toHaveURL(/\/admin\/demo-tablio\//, { timeout: 15_000 });
  await page.getByRole("button", { name: "Trivia en vivo" }).first().click();
  await page.getByLabel("Preguntas").fill("5");
  await page.getByRole("button", { name: "Preparar la trivia" }).click();
  const pantalla = page.getByTestId("pantalla-trivia");
  await expect(pantalla.getByText("¡Trivia en vivo!")).toBeVisible({ timeout: 15_000 });
  await foto(page, "350-pantalla-trivia-esperando");

  // Un cliente en la mesa 5 ve el aviso y entra
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  const cliente = await ctx.newPage();
  await cliente.goto(linkMesa(5)!);
  const aviso = cliente.getByTestId("aviso-trivia-vivo");
  await expect(aviso).toBeVisible({ timeout: 25_000 });
  await foto(cliente, "351-cliente-aviso-trivia");
  await aviso.click();
  await expect(cliente.getByText("¡Ya estás adentro!")).toBeVisible({ timeout: 15_000 });

  // Empieza: la misma pregunta en la pantalla y en el celular
  await page.getByRole("button", { name: "Empezar" }).click();
  await expect(page.getByTestId("pregunta-pantalla")).toBeVisible({ timeout: 15_000 });
  const pregunta = cliente.getByTestId("pregunta-celular");
  await expect(pregunta).toBeVisible({ timeout: 15_000 });
  const correcta = Number(sql(`SELECT q.correcta FROM trivias_vivo t JOIN preguntas_trivia q ON q.id = t.preguntas[1] WHERE t.tenant_id = '${DEMO.tenant}' AND t.estado = 'pregunta'`));
  await pregunta.getByRole("button").nth(correcta).click();
  await expect(cliente.getByText("Listo. Espera el resultado en la pantalla.")).toBeVisible({ timeout: 10_000 });
  await foto(cliente, "352-cliente-responde");
  await foto(page, "353-pantalla-pregunta");

  // La pantalla muestra la respuesta y el ranking; el cliente ve su puntaje
  await page.getByRole("button", { name: "Mostrar respuesta" }).click();
  await expect(page.getByTestId("ranking-trivia")).not.toContainText("Todavía nadie suma puntos", { timeout: 15_000 });
  await foto(page, "354-pantalla-resultado-y-ranking");
  await expect(cliente.getByTestId("mi-resultado")).toContainText("¡Bien!", { timeout: 15_000 });
  await foto(cliente, "355-cliente-acerto");
  await ctx.close();
});
