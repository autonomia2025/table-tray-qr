import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { GUIAS, guiaDeRol } from "./guias";

// Las guías nombran botones de la app entre «comillas»: si alguien cambia el texto de un botón, esta prueba
// avisa que la guía quedó desactualizada.
function archivos(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return archivos(p);
    return /\.(tsx?|ts)$/.test(e.name) && !/guias(\.test)?\.ts$/.test(e.name) && !p.includes("integrations") ? [p] : [];
  });
}
const codigo = archivos(path.resolve(__dirname, "..")).map((f) => fs.readFileSync(f, "utf-8")).join("\n");

describe("guías de capacitación", () => {
  it("cada rol tiene su guía, con pasos y qué hacer si algo falla", () => {
    for (const g of Object.values(GUIAS)) {
      expect(g.pasos.length, g.rol).toBeGreaterThanOrEqual(5);
      expect(g.siFalla.length, g.rol).toBeGreaterThanOrEqual(2);
    }
    expect(guiaDeRol("waiter")).toBe("mozo");
    expect(guiaDeRol("kitchen")).toBe("cocina");
    expect(guiaDeRol("cashier")).toBe("caja");
    expect(guiaDeRol("owner")).toBe("dueno");
    expect(guiaDeRol("manager")).toBe("dueno");
  });

  it("cada botón que nombran existe en la app", () => {
    const faltan: string[] = [];
    for (const g of Object.values(GUIAS)) {
      for (const p of [...g.pasos, ...g.siFalla]) {
        for (const m of `${p.titulo} ${p.texto}`.matchAll(/«([^»]+)»/g)) {
          if (!codigo.includes(m[1])) faltan.push(`${g.rol}: «${m[1]}»`);
        }
      }
    }
    expect(faltan).toEqual([]);
  });
});
