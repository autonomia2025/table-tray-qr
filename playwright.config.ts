import { defineConfig, devices } from "@playwright/test";

// Pruebas de punta a punta: abren la app en un navegador y recorren pantallas.
// E2E_BASE_URL permite apuntar a una app ya publicada (por ejemplo Vercel).
// Sin E2E_BASE_URL, se levanta la app local con `bun run dev`.
const puerto = process.env.E2E_PORT ?? "8080";
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${puerto}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    locale: "es-CL",
    timezoneId: "America/Santiago",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "escritorio", use: { ...devices["Desktop Chrome"] } },
    { name: "celular", use: { ...devices["Pixel 7"] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `bun run dev --port ${puerto} --strictPort`,
        url: `http://localhost:${puerto}`,
        reuseExistingServer: !process.env.E2E_BASE_DATOS,
        timeout: 60_000,
      },
});
