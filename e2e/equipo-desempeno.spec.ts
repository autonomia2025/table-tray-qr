import { test, expect, devices, type Page } from "@playwright/test";
import { cuenta, entrar, foto, linkMesa } from "./apoyo/recorrido";

// Fase 3.3 — Control del equipo: tiempos objetivo del local, alerta cuando algo listo nadie lo lleva,
// desempeño del equipo y metas que el mozo ve en su perfil.
test.skip(!cuenta("owner"), "Falta privado/DEMO_CREDENCIALES.md");
test.skip(({ isMobile }) => isMobile, "Se prueba una vez, en escritorio");

async function objetivoRetiro(page: Page, minutos: number) {
  await page.goto("/admin/demo-tablio/sucursal");
  const campo = page.getByLabel("Llevar a la mesa lo que está listo");
  await expect(campo).toBeVisible({ timeout: 15_000 });
  await campo.fill(String(minutos));
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText(/guardad|actualizad/i).first()).toBeVisible({ timeout: 10_000 });
}

test("si algo listo espera más del objetivo, el mozo y la cocina lo ven; el dueño mide al equipo y pone metas", async ({ browser }) => {
  test.setTimeout(240_000);
  const escritorio = { viewport: { width: 1280, height: 720 } };
  const duenoCtx = await browser.newContext(escritorio);
  const dueno = await duenoCtx.newPage();
  await entrar(dueno, "owner");
  await expect(dueno).toHaveURL(/\/admin\/demo-tablio\//, { timeout: 15_000 });

  // El dueño fija el objetivo: llevar lo listo en 1 minuto (para la prueba)
  await objetivoRetiro(dueno, 1);
  await dueno.getByText("Tiempos objetivo").scrollIntoViewIfNeeded();
  await foto(dueno, "90-dueno-tiempos-objetivo");

  try {
    // Un cliente paga un Barros Luco en la mesa 4
    const celCtx = await browser.newContext({ ...devices["Pixel 7"] });
    const comensal = await celCtx.newPage();
    await comensal.goto(linkMesa(4)!);
    await comensal.getByText("Barros Luco", { exact: true }).first().click();
    await comensal.getByRole("button", { name: /Agregar al carrito/ }).click();
    await comensal.getByText("Ver pedido").click();
    await comensal.getByRole("button", { name: /Ir a pagar/ }).click();
    await comensal.getByRole("button", { name: /Pagar con tarjeta/ }).click();
    await expect(comensal.getByText("¡Pago listo!")).toBeVisible({ timeout: 20_000 });
    const numero = (await comensal.getByText(/Tu pedido #\d+/).innerText()).match(/#(\d+)/)![1].padStart(3, "0");
    await celCtx.close();

    // La cocina lo acepta y lo deja listo
    const kdsCtx = await browser.newContext(escritorio);
    const kds = await kdsCtx.newPage();
    await entrar(kds, "kitchen");
    await expect(kds).toHaveURL(/\/kds\?branch=/, { timeout: 15_000 });
    const tarjeta = kds.locator("div.mb-3").filter({ hasText: `#${numero}` });
    await tarjeta.getByRole("button", { name: "ACEPTAR" }).click();
    await tarjeta.getByRole("button", { name: "LISTO" }).click();
    await expect(tarjeta.getByRole("button", { name: /ENTREGADO/ })).toBeVisible({ timeout: 10_000 });

    // La mozo toma la mesa... y se distrae: pasado el minuto, su pantalla y la cocina avisan
    const mozoCtx = await browser.newContext({ ...devices["Pixel 7"] });
    const mozo = await mozoCtx.newPage();
    await entrar(mozo, "waiter");
    await expect(mozo).toHaveURL(/\/mozo\/mesas/, { timeout: 15_000 });
    const mesa = mozo.locator("div.rounded-xl").filter({ has: mozo.locator("span.text-4xl", { hasText: /^4$/ }) }).first();
    await mesa.click();
    const tomar = mozo.getByRole("dialog").getByRole("button", { name: "Tomar mesa", exact: true });
    if (await tomar.isVisible().catch(() => false)) {
      await tomar.click();
      await expect(mozo.getByText("Mesa tomada").first()).toBeVisible({ timeout: 10_000 });
    }
    await mozo.getByRole("dialog").getByRole("button", { name: "Cerrar", exact: true }).click();
    await expect(mozo.getByRole("alert").getByText("Hay pedidos listos esperando")).toBeVisible({ timeout: 100_000 });
    await expect(mozo.getByRole("alert").getByText(/Mesa 4: listo hace/)).toBeVisible();
    await foto(mozo, "91-mozo-alerta-listo-esperando");
    await expect(tarjeta.getByText(/nadie lo ha llevado/)).toBeVisible({ timeout: 30_000 });
    await foto(kds, "92-cocina-alerta-nadie-lo-lleva");
    await kdsCtx.close();

    // Lo lleva
    await mesa.getByRole("button", { name: "Entregado ✓" }).click();
    await expect(mozo.getByText("✓ Entregado").first()).toBeVisible({ timeout: 10_000 });

    // El dueño ve el desempeño del día y le pone una meta a Camila
    await dueno.goto("/admin/demo-tablio/equipo");
    await dueno.getByRole("group", { name: "Período" }).getByRole("button", { name: "Hoy" }).click();
    const fila = dueno.locator("tr").filter({ hasText: "Camila" }).first();
    await expect(fila).toBeVisible({ timeout: 15_000 });
    await dueno.getByLabel("Para quién").click();
    await dueno.getByRole("option", { name: /Camila/ }).click();
    await dueno.getByLabel("Qué se mide").click();
    await dueno.getByRole("option", { name: "Mesas cerradas" }).click();
    await dueno.getByLabel("Mesas", { exact: true }).fill("3");
    await dueno.getByRole("button", { name: "Guardar meta" }).click();
    await expect(dueno.getByText(/Meta (creada|actualizada)/).first()).toBeVisible({ timeout: 10_000 });
    await dueno.getByRole("heading", { name: "Desempeño del equipo" }).scrollIntoViewIfNeeded();
    await foto(dueno, "93-dueno-desempeno-y-metas");

    // Camila ve sus metas y cómo va hoy
    await mozo.goto("/mozo/perfil");
    await expect(mozo.getByText("Mis metas")).toBeVisible({ timeout: 15_000 });
    await expect(mozo.getByText(/Mesas cerradas hoy/)).toBeVisible();
    await mozo.getByText("Mis metas").scrollIntoViewIfNeeded();
    await foto(mozo, "94-mozo-mis-metas");
    await mozoCtx.close();
  } finally {
    // El demo vuelve a su objetivo normal (5 minutos)
    await objetivoRetiro(dueno, 5);
    await duenoCtx.close();
  }
});
