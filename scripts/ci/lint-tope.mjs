// Corre ESLint y falla si hay MÁS errores que el tope registrado.
// El código heredado de Lovable trae errores; la regla es que nunca aumenten.
// Cuando bajen, se actualiza el tope con: node scripts/ci/lint-tope.mjs --actualizar
import { execSync } from "node:child_process";
import fs from "node:fs";

const archivoTope = "scripts/ci/lint-tope.json";
let salida;
try {
  salida = execSync("bunx eslint . -f json", { encoding: "utf-8", maxBuffer: 50 * 1024 * 1024 });
} catch (e) {
  salida = e.stdout; // ESLint sale con código 1 cuando hay errores
}
const resultados = JSON.parse(salida);
const errores = resultados.reduce((s, r) => s + r.errorCount, 0);
const advertencias = resultados.reduce((s, r) => s + r.warningCount, 0);

if (process.argv.includes("--actualizar")) {
  fs.writeFileSync(archivoTope, JSON.stringify({ errores, advertencias }, null, 2) + "\n");
  console.log(`Tope actualizado: ${errores} errores, ${advertencias} advertencias`);
  process.exit(0);
}

const tope = JSON.parse(fs.readFileSync(archivoTope, "utf-8"));
console.log(`ESLint: ${errores} errores (tope ${tope.errores}), ${advertencias} advertencias (tope ${tope.advertencias})`);
if (errores > tope.errores) {
  console.error(`❌ Hay ${errores - tope.errores} errores nuevos de estilo. Corrígelos antes de subir.`);
  process.exit(1);
}
if (errores < tope.errores) console.log("✅ Bajaron los errores: actualiza el tope con --actualizar");
