import { describe, it, expect } from "vitest";
import { leerCartaPegada, leerPrecio } from "./primerosPasos";

describe("leer la carta pegada", () => {
  it("lee precios chilenos en sus formas comunes", () => {
    expect(leerPrecio("$4.500")).toBe(4500);
    expect(leerPrecio("4500")).toBe(4500);
    expect(leerPrecio("12,990")).toBe(12990);
    expect(leerPrecio("1 200")).toBe(1200);
    expect(leerPrecio("gratis")).toBeNull();
    expect(leerPrecio("0")).toBeNull();
  });

  it("lista con títulos de categoría y precio al final", () => {
    const r = leerCartaPegada(`Cervezas:
Kunstmann Torobayo 500cc - $4.500
Austral Calafate ..... 4900

# Para picar
Papas fritas - 3.500 | Con merkén
Empanaditas de queso (6) $5.900`);
    expect(r.errores).toEqual([]);
    expect(r.lineas).toEqual([
      { categoria: "Cervezas", nombre: "Kunstmann Torobayo 500cc", precio: 4500 },
      { categoria: "Cervezas", nombre: "Austral Calafate", precio: 4900 },
      { categoria: "Para picar", nombre: "Papas fritas", precio: 3500, descripcion: "Con merkén" },
      { categoria: "Para picar", nombre: "Empanaditas de queso (6)", precio: 5900 },
    ]);
  });

  it("columnas copiadas de una planilla, con fila de títulos", () => {
    const r = leerCartaPegada("Categoría\tPlato\tPrecio\tDescripción\nTragos\tPisco sour\t$5.500\tCon limón de pica\nTragos\tMojito\t6000\n");
    expect(r.errores).toEqual([]);
    expect(r.lineas).toEqual([
      { categoria: "Tragos", nombre: "Pisco sour", precio: 5500, descripcion: "Con limón de pica" },
      { categoria: "Tragos", nombre: "Mojito", precio: 6000 },
    ]);
  });

  it("avisa las líneas que no entiende, sin perder las demás", () => {
    const r = leerCartaPegada("Bebidas:\nCoca-Cola 350 ml - 2.000\nAgua con gas\nJugo natural - mil pesos");
    expect(r.lineas).toEqual([{ categoria: "Bebidas", nombre: "Coca-Cola 350 ml", precio: 2000 }]);
    expect(r.errores.map((e) => e.linea)).toEqual([3, 4]);
  });
});
