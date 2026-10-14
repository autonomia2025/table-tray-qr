import { test, expect, devices } from "@playwright/test";
import { cuenta, entrar, foto, linkMesa } from "./apoyo/recorrido";

// Fase 3.1 — Turnos de mozo y propina para el mozo que tomó la mesa (decisión del fundador: el cliente
// no elige). El cliente paga con propina antes de que nadie tome la mesa; la mozo la toma y la propina
// pasa a su turno. No puede terminar el turno con la mesa a cargo. El dueño ve los turnos en Equipo.
test.skip(!cuenta("waiter"), "Falta privado/DEMO_CREDENCIALES.md");
test.skip(({ isMobile }) => !isMobile, "Se prueba una vez, en celular");

const pesos = (texto: string) => parseInt(texto.replace(/\D/g, ""), 10) || 0;

test("la propina es de la mozo que tomó la mesa y queda en su turno", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await entrar(page, "waiter");
  await expect(page).toHaveURL(/\/mozo\/mesas/, { timeout: 15_000 });

  // Empieza su turno (si ya tenía uno abierto, sigue con ese)
  const empezar = page.getByRole("button", { name: "Empezar turno" });
  const enTurno = page.getByRole("button", { name: /En turno desde/ });
  await expect(empezar.or(enTurno)).toBeVisible({ timeout: 15_000 });
  if (await empezar.isVisible()) {
    await foto(page, "70-mozo-sin-turno");
    await empezar.click();
    await expect(page.getByText("¡Turno empezado!").first()).toBeVisible({ timeout: 10_000 });
  }
  await expect(enTurno).toBeVisible({ timeout: 10_000 });
  const propinasAntes = pesos((await enTurno.innerText()).split("Propinas")[1] ?? "0");
  await foto(page, "71-mozo-en-turno");

  // Un cliente paga con la app (con propina) en la mesa 5, antes de que nadie la tome
  const celCtx = await browser.newContext({ ...devices["Pixel 7"] });
  const comensal = await celCtx.newPage();
  await comensal.goto(linkMesa(5)!);
  await comensal.getByText("Agua mineral", { exact: true }).first().click();
  await comensal.getByRole("button", { name: /Agregar al carrito/ }).click();
  await comensal.getByText("Ver pedido").click();
  await comensal.getByRole("button", { name: /Ir a pagar/ }).click();
  await comensal.getByRole("button", { name: /Pagar con tarjeta/ }).click();
  await expect(comensal.getByText("¡Pago listo!")).toBeVisible({ timeout: 20_000 });
  await celCtx.close();

  // La mozo toma la mesa: la propina pasa a su turno
  const tarjeta = page.locator("div.rounded-xl").filter({ has: page.locator("span.text-4xl", { hasText: /^5$/ }) }).first();
  await tarjeta.click();
  // (si ya era suya de una corrida anterior, la propina le llega directo)
  const tomar = page.getByRole("dialog").getByRole("button", { name: "Tomar mesa", exact: true });
  await expect(tomar.or(page.getByRole("button", { name: /Transferir a otro mozo/ }))).toBeVisible({ timeout: 10_000 });
  if (await tomar.isVisible()) {
    await tomar.click();
    await expect(page.getByText("Mesa tomada").first()).toBeVisible({ timeout: 10_000 });
  }
  await page.getByRole("dialog").getByRole("button", { name: "Cerrar", exact: true }).click();
  await expect.poll(async () => pesos((await enTurno.innerText()).split("Propinas")[1] ?? "0"), { timeout: 15_000 })
    .toBeGreaterThan(propinasAntes);
  await foto(page, "72-mozo-propina-en-su-turno");

  // En su perfil ve el resumen; no puede terminar el turno con la mesa a cargo
  await enTurno.click();
  await expect(page.getByText("Tus propinas")).toBeVisible({ timeout: 10_000 });
  await foto(page, "73-mozo-mi-turno");
  await page.getByRole("button", { name: "Terminar turno" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Terminar turno" }).click();
  await expect(page.getByText(/a tu cargo/).first()).toBeVisible({ timeout: 10_000 });
  await foto(page, "74-mozo-no-termina-con-mesas");

  // El dueño ve el turno en Equipo, con la propina
  const escritorio = await browser.newContext({ ...devices["Desktop Chrome"] });
  const dueno = await escritorio.newPage();
  await entrar(dueno, "owner");
  await expect(dueno).toHaveURL(/\/admin\/demo-tablio\//, { timeout: 15_000 });
  await dueno.goto("/admin/demo-tablio/equipo");
  const fila = dueno.locator("tr").filter({ hasText: "En turno" }).first();
  await expect(fila).toBeVisible({ timeout: 15_000 });
  await dueno.getByRole("heading", { name: "Turnos" }).scrollIntoViewIfNeeded();
  await foto(dueno, "75-dueno-turnos-del-equipo");
  await escritorio.close();

  // Deja la mesa libre y termina el turno
  await page.goto("/mozo/mesas");
  await tarjeta.click();
  await page.getByRole("button", { name: "Cerrar mesa", exact: true }).click();
  await page.getByRole("button", { name: "Sí, cerrar mesa" }).click();
  await expect(page.getByText("✅ Mesa cerrada").first()).toBeVisible({ timeout: 10_000 });
  await page.goto("/mozo/perfil");
  await page.getByRole("button", { name: "Terminar turno" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Terminar turno" }).click();
  // (en la batería completa, otras pruebas le dejan mesas a cargo: entonces la regla le impide terminar)
  const terminado = page.getByText("Turno terminado").first();
  await expect(terminado.or(page.getByText(/a tu cargo/).first())).toBeVisible({ timeout: 10_000 });
  if (await terminado.isVisible()) await foto(page, "76-mozo-turno-terminado");
});
