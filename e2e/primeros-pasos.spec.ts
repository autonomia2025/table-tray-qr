import { test, expect } from "@playwright/test";
import { conSesion, llamarFuncion } from "../tests/seguridad/entorno";
import { foto } from "./apoyo/recorrido";

// Fase 5.2 — Primeros pasos: la dueña de un local recién creado ve lo que le falta para abrir, pega su carta
// de una vez y la lista se va marcando sola. Solo en la base desechable (crea un local).
test.skip(process.env.E2E_BASE_DATOS !== "local", "Solo en la base desechable (crea un local de verdad)");
test.skip(({ isMobile }) => isMobile, "Pantalla de escritorio; se prueba una vez");

const CARTA = `Cervezas:
Kunstmann Torobayo 500cc - $4.500
Austral Calafate 500cc - $4.900

Para picar:
Papas fritas - $3.500 | Con merkén y mayo casera
Empanaditas de queso (6) - $5.900
Tabla para compartir`;

test("la dueña de un local nuevo ve qué le falta, pega su carta y la lista se marca sola", async ({ page }) => {
  test.setTimeout(120_000);
  const id = Date.now().toString(36);
  const correo = `dueña-${id}@demo.tablio.test`.replace("ñ", "n");
  const sa = (await conSesion("superadmin")).cliente;
  const c = (await sa.rpc("crear_local", { _nombre: `El Rincón ${id}`, _slug: `el-rincon-${id}`, _correo_dueno: correo, _mesas: 6 })).data as { token: string; slug: string };
  expect((await llamarFuncion("activar-local", { token: c.token, nombre: "Rosa", password: "clave-segura-123" })).status).toBe(200);

  await page.goto("/login");
  await page.locator('input[type="email"]').fill(correo);
  await page.locator('input[type="password"]').fill("clave-segura-123");
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(new RegExp(`/admin/${c.slug}/`), { timeout: 15_000 });

  const lista = page.getByTestId("primeros-pasos");
  await expect(lista.getByText("Llevas 0 de 7")).toBeVisible({ timeout: 15_000 });
  await foto(page, "190-inicio-primeros-pasos");

  // Pega su carta
  await lista.getByRole("link", { name: "Ir al Menú" }).click();
  await page.getByRole("button", { name: "Pegar carta" }).click();
  await page.getByLabel("Carta pegada").fill(CARTA);
  const vista = page.getByTestId("vista-previa-carta");
  await expect(vista.getByText("4 platos en 2 categorías")).toBeVisible();
  await expect(vista.getByText(/No entendí 1 línea/)).toBeVisible();
  await foto(page, "191-menu-pegar-carta");
  await page.getByRole("button", { name: "Importar 4 platos" }).click();
  await expect(page.getByText("Listo: 4 platos nuevos").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Kunstmann Torobayo 500cc")).toBeVisible();
  await foto(page, "192-menu-carta-importada");

  // Descarga los QR
  await page.goto(`/admin/${c.slug}/qr`);
  const marcado = page.waitForResponse((r) => r.url().includes("/rpc/marcar_paso"));
  await page.getByRole("button", { name: "Descargar todos" }).click();
  expect((await marcado).ok()).toBe(true);

  // De vuelta en el Inicio, la carta y los QR están marcados
  await page.goto(`/admin/${c.slug}/inicio`);
  await expect(page.getByTestId("primeros-pasos").getByText("Llevas 2 de 7")).toBeVisible({ timeout: 15_000 });
  await foto(page, "193-inicio-pasos-avanzando");
});
