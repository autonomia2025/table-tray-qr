import { defineConfig } from "vitest/config";

// Pruebas de seguridad: corren en Node contra la base de pruebas (la que diga .env).
// Intentan los ataques del diagnóstico y comprueban que fallen.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/seguridad/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
