import { test, expect, firefox } from "@playwright/test";
import { cuenta, entrar, foto, linkMesa } from "./apoyo/recorrido";

// Fase 3.4b — Entrega REAL de un aviso: un Firefox de verdad se suscribe (servicio de avisos de Mozilla),
// la cocina deja listo el pedido y el aviso llega a su "celular". Usa internet y un servicio externo de
// los navegadores, así que no corre en la integración continua: se activa con AVISOS_REALES=1.
test.skip(!process.env.AVISOS_REALES, "Solo con AVISOS_REALES=1 (entrega real por internet)");
test.skip(!cuenta("kitchen"), "Falta privado/DEMO_CREDENCIALES.md");
test.skip(({ isMobile }) => isMobile, "Se prueba una vez");

test("el aviso de «ya está listo» llega de verdad al navegador del comensal", async ({ page, baseURL }) => {
  test.setTimeout(150_000);
  const ff = await firefox.launch({
    firefoxUserPrefs: {
      "permissions.default.desktop-notification": 1, // acepta avisos sin preguntar (como si el comensal dijera "Permitir")
      "dom.push.enabled": true,
      "dom.push.connection.enabled": true,
      // El Firefox de pruebas trae los avisos apagados; aquí se conecta al servicio real de Mozilla
      "dom.push.serverURL": "wss://push.services.mozilla.com/",
      "dom.serviceWorkers.enabled": true,
    },
  });
  const comensal = await (await ff.newContext({ baseURL })).newPage();
  try {
    await comensal.goto(linkMesa(10)!);
    await comensal.getByText("Agua mineral", { exact: true }).first().click();
    await comensal.getByRole("button", { name: /Agregar al carrito/ }).click();
    await comensal.getByText("Ver pedido").click();
    await comensal.getByRole("button", { name: /Ir a pagar/ }).click();
    await comensal.getByRole("button", { name: /Pagar con tarjeta/ }).click();
    await expect(comensal.getByText("¡Pago listo!")).toBeVisible({ timeout: 20_000 });
    const numero = (await comensal.getByText(/Tu pedido #\d+/).innerText()).match(/#(\d+)/)![1].padStart(3, "0");
    await comensal.getByRole("button", { name: "Ver estado de mi pedido" }).click();

    // Activa los avisos y queda esperando el mensaje del archivo de avisos
    await comensal.getByRole("button", { name: /Avísame cuando esté listo, aunque bloquee/ }).click();
    await expect(comensal.getByText("🔔 Te avisaremos aunque bloquees el celular")).toBeVisible({ timeout: 30_000 });
    await comensal.evaluate(() => {
      (window as unknown as { avisos: unknown[] }).avisos = [];
      navigator.serviceWorker.addEventListener("message", (e) => (window as unknown as { avisos: unknown[] }).avisos.push(e.data));
    });
    await foto(comensal, "104-comensal-avisos-activados");

    // La cocina lo deja listo (desde su pantalla, que dispara el aviso)
    await entrar(page, "kitchen");
    await expect(page).toHaveURL(/\/kds\?branch=/, { timeout: 15_000 });
    const tarjeta = page.locator("div.mb-3").filter({ hasText: `#${numero}` });
    await tarjeta.getByRole("button", { name: "ACEPTAR" }).click();
    await tarjeta.getByRole("button", { name: "LISTO" }).click();

    // El aviso llega por internet al navegador del comensal
    const aviso = await comensal.waitForFunction(
      () => (window as unknown as { avisos: { tipo: string; datos: { cuerpo: string } }[] }).avisos.find((a) => a.tipo === "aviso-push"),
      undefined, { timeout: 60_000 },
    );
    const datos = await aviso.jsonValue() as { datos: { titulo: string; cuerpo: string } };
    expect(datos.datos.cuerpo).toContain("Ya está listo: Agua mineral");
    expect(datos.datos.titulo).toBe("Demo Tablio");
  } finally {
    await ff.close();
  }
});
