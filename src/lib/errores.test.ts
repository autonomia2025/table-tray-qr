import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { mensajeError } from "./errores";

describe("mensajeError (regla 10: nunca un error técnico ni en inglés)", () => {
  it("deja pasar nuestros mensajes en español", () => {
    expect(mensajeError({ message: "Ingresa el código de 4 números que está en tu mesa", code: "P0001" }))
      .toBe("Ingresa el código de 4 números que está en tu mesa");
    expect(mensajeError({ message: "Tu cuenta llegó al máximo de $30.000 para esta visita" })).toContain("máximo");
  });

  it("traduce o esconde lo técnico", () => {
    expect(mensajeError({ message: 'new row violates row-level security policy for table "orders"', code: "42501" }))
      .toBe("No tienes permiso para hacer esto.");
    expect(mensajeError({ message: 'duplicate key value violates unique constraint "x"', code: "23505" })).toBe("Eso ya existe. Revisa que no esté repetido.");
    expect(mensajeError(new TypeError("Failed to fetch"))).toBe("Sin conexión. Revisa tu internet e intenta de nuevo.");
    expect(mensajeError({ message: "JWT expired" })).toBe("Tu sesión se cerró. Vuelve a entrar.");
    expect(mensajeError({ message: "column orders.foo does not exist" })).toBe("No se pudo hacer el cambio. Intenta de nuevo.");
    expect(mensajeError({ message: "Something went wrong" }, "No se pudo pagar.")).toBe("No se pudo pagar.");
    expect(mensajeError(null, "Otro")).toBe("Otro");
  });
});

// Guardia: ninguna pantalla muestra el mensaje crudo de un error. Se pasa por mensajeError.
describe("pantallas sin errores crudos", () => {
  const archivos: string[] = [];
  const recorrer = (dir: string) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) recorrer(p);
      else if (/\.tsx$/.test(f.name)) archivos.push(p);
    }
  };
  recorrer(path.resolve(__dirname, ".."));

  it("ningún toast ni aviso en pantalla usa error.message directo", () => {
    const crudo = /(description:\s*|toast\.error\(\s*|setError(Msg)?\(\s*|title:\s*)(\w+)\.message\b/;
    const malos = archivos.flatMap((f) =>
      fs.readFileSync(f, "utf-8").split("\n").map((l, i) => (crudo.test(l) ? `${path.relative(process.cwd(), f)}:${i + 1}` : null)).filter(Boolean),
    );
    expect(malos).toEqual([]);
  });
});
