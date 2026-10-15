import { test, expect } from "@playwright/test";
import { conSesion } from "../tests/seguridad/entorno";
import { cuenta, entrar, foto } from "./apoyo/recorrido";

// Fase 6.1 — Tablet compartida: el encargado deja este dispositivo como tablet, el mozo entra con su nombre
// y su PIN, trabaja a su nombre y toca "Cambiar de mozo" para dejarla lista para el siguiente.
test.skip(!cuenta("waiter"), "Falta privado/DEMO_CREDENCIALES.md");
test.skip(({ isMobile }) => isMobile, "La tablet se prueba en pantalla grande, una vez");

test("el encargado activa la tablet y el mozo entra con su PIN", async ({ page }) => {
  test.setTimeout(90_000);
  const PIN = "4826";
  const mozo = (await conSesion("waiter")).cliente;
  await mozo.rpc("definir_mi_pin", { _pin: PIN });
  const nombreMozo = (await mozo.rpc("mi_perfil")).data as { locales?: { staff_nombre: string }[] } | null;
  const nombre = nombreMozo?.locales?.[0]?.staff_nombre ?? "Camila (mozo)";

  await page.setViewportSize({ width: 1024, height: 768 });
  await entrar(page, "owner");
  await expect(page).toHaveURL(/\/admin\/demo-tablio\//, { timeout: 15_000 });
  await page.goto("/admin/demo-tablio/equipo");
  const seccion = page.getByTestId("tablets-equipo");
  await seccion.getByLabel("Nombre de esta tablet").fill("Tablet de la terraza");
  await seccion.getByRole("button", { name: "Activar este dispositivo como tablet" }).click();
  await expect(seccion.getByText("Este dispositivo es una tablet del local.")).toBeVisible({ timeout: 10_000 });
  await seccion.scrollIntoViewIfNeeded();
  await foto(page, "220-dueno-tablets-compartidas");

  await seccion.getByRole("link", { name: "Abrir la pantalla de la tablet" }).click();
  await expect(page.getByText("¿Quién eres?")).toBeVisible({ timeout: 15_000 });
  await foto(page, "221-tablet-quien-eres");
  await page.getByRole("button", { name: nombre }).click();
  for (const d of PIN) await page.getByRole("button", { name: `Número ${d}` }).click();
  await expect(page).toHaveURL(/\/mozo\/mesas/, { timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Cambiar de mozo" })).toBeVisible();
  await foto(page, "222-tablet-mozo-trabajando");

  await page.getByRole("button", { name: "Cambiar de mozo" }).click();
  await expect(page.getByText("¿Quién eres?")).toBeVisible({ timeout: 15_000 });

  // PIN equivocado: avisa y no entra
  await page.getByRole("button", { name: nombre }).click();
  for (const d of "0001") await page.getByRole("button", { name: `Número ${d}` }).click();
  await expect(page.getByRole("alert")).toContainText("PIN incorrecto");
  await foto(page, "223-tablet-pin-incorrecto");

  // Se deja la tablet desactivada para no acumular tablets de prueba
  const dueno = (await conSesion("owner")).cliente;
  const { data } = await dueno.from("equipos_compartidos").select("id").eq("nombre", "Tablet de la terraza").is("revocado_at", null);
  for (const t of data ?? []) await dueno.rpc("revocar_equipo_compartido", { _id: t.id });
});
