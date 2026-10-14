import { test, expect } from "@playwright/test";
import { cuenta, foto, linkMesa } from "./apoyo/recorrido";

// Fase 3.4b — Tablio se puede instalar sin tienda: manifiesto, íconos y archivo de avisos publicados;
// desde la mesa, la app instalada lleva el nombre del local y abre esa mesa; el comensal puede pedir
// que le avisen aunque bloquee el celular.
test.skip(!cuenta("kitchen"), "Falta privado/DEMO_CREDENCIALES.md");
test.skip(({ isMobile }) => !isMobile, "Se prueba una vez, en celular");

test("la app se puede instalar con el nombre del local y ofrece avisos con el celular bloqueado", async ({ page, request }) => {
  // Archivos de la app instalable
  const manifiesto = await (await request.get("/manifest.webmanifest")).json();
  expect(manifiesto).toMatchObject({ name: "Tablio", display: "standalone" });
  for (const archivo of ["/icon-192.png", "/icon-512.png", "/icon-maskable-512.png", "/apple-touch-icon.png"]) {
    const r = await request.get(archivo);
    expect(r.status(), archivo).toBe(200);
    expect(r.headers()["content-type"], archivo).toContain("image/png");
  }
  const sw = await request.get("/sw.js");
  expect(sw.headers()["content-type"]).toContain("javascript");
  expect(await sw.text()).toContain("showNotification");

  // Desde la mesa: el manifiesto pasa a ser el del local y abre esa mesa
  await page.goto(linkMesa(1)!);
  await expect(page.getByText("Demo Tablio").first()).toBeVisible({ timeout: 15_000 });
  const delLocal = await page.evaluate(async () => {
    const href = (document.getElementById("manifiesto") as HTMLLinkElement).href;
    return { href, m: await (await fetch(href)).json() };
  });
  expect(delLocal.href.startsWith("blob:")).toBe(true);
  expect(delLocal.m.name).toBe("Demo Tablio");
  expect(delLocal.m.start_url).toMatch(/\/demo-tablio\/menu\?t=/);

  // Tras pedir y pagar, el seguimiento ofrece los avisos con el celular bloqueado
  await page.getByText("Agua mineral", { exact: true }).first().click();
  await page.getByRole("button", { name: /Agregar al carrito/ }).click();
  await page.getByText("Ver pedido").click();
  await page.getByRole("button", { name: /Ir a pagar/ }).click();
  await page.getByRole("button", { name: /Pagar con tarjeta/ }).click();
  await expect(page.getByText("¡Pago listo!")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Ver estado de mi pedido" }).click();
  await expect(page.getByRole("button", { name: /Avísame cuando esté listo, aunque bloquee el celular/ })).toBeVisible({ timeout: 15_000 });
  await foto(page, "105-comensal-ofrece-avisos");
});
