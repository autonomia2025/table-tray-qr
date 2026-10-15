import { supabase } from "@/integrations/supabase/client";
import { mensajeError } from "@/lib/errores";

// Primeros pasos del dueño (fase 5.2): qué le falta al local para abrir (lo calcula la base) e importar la
// carta pegando una lista.

export type ClavePaso = "marca" | "carta" | "equipo" | "cobro" | "qr" | "prueba" | "abrir";

export interface PrimerosPasos {
  pasos: { clave: ClavePaso; hecho: boolean; platos?: number }[];
  hechos: number;
  total: number;
  ocultos: boolean;
}

export interface LineaCarta { categoria: string; nombre: string; precio: number; descripcion?: string }

export async function primerosPasos(sucursal: string): Promise<PrimerosPasos | null> {
  const { data, error } = await supabase.rpc("primeros_pasos", { _branch_id: sucursal });
  if (error) return null;
  return data as unknown as PrimerosPasos;
}

export async function marcarPaso(sucursal: string, paso: "qr" | "ocultar" | "mostrar"): Promise<void> {
  await supabase.rpc("marcar_paso", { _branch_id: sucursal, _paso: paso });
}

export async function importarCarta(sucursal: string, lineas: LineaCarta[]):
  Promise<{ ok: true; categorias: number; platos: number; repetidos: number } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("importar_carta", { _branch_id: sucursal, _lineas: lineas as never });
  if (error) return { ok: false, error: mensajeError(error, "No se pudo importar la carta. Revisa la lista e intenta de nuevo.") };
  const r = data as unknown as { categorias_nuevas: number; platos_nuevos: number; repetidos: number };
  return { ok: true, categorias: r.categorias_nuevas, platos: r.platos_nuevos, repetidos: r.repetidos };
}

/** "$4.500", "4500", "4,500", "4 500" → 4500 (pesos enteros). */
export function leerPrecio(texto: string): number | null {
  const limpio = texto.replace(/\$|clp/gi, "").trim();
  if (!/^\d{1,3}([.,\s]\d{3})*$|^\d+$/.test(limpio)) return null;
  const n = parseInt(limpio.replace(/[.,\s]/g, ""), 10);
  return n > 0 ? n : null;
}

/**
 * Lee una carta pegada. Acepta dos formas:
 *  1. Lista con títulos de categoría ("Cervezas:" o "# Cervezas") y un plato por línea con su precio al final
 *     ("Torobayo 500cc - $4.500", "Papas fritas ..... 3500"); lo que va después de "|" es la descripción.
 *  2. Columnas copiadas de una planilla (separadas por tabulación o ";"): Categoría, Plato, Precio y, si se
 *     quiere, Descripción. Una primera fila de títulos se ignora.
 */
export function leerCartaPegada(texto: string): { lineas: LineaCarta[]; errores: { linea: number; texto: string }[] } {
  const lineas: LineaCarta[] = [];
  const errores: { linea: number; texto: string }[] = [];
  let categoria = "Carta";
  texto.split(/\r?\n/).forEach((cruda, i) => {
    const linea = cruda.trim();
    if (!linea) return;
    // Planilla: columnas
    if (linea.includes("\t") || linea.includes(";")) {
      const cols = linea.split(/\t|;/).map((c) => c.trim());
      const [cat, nombre, precioTxt, descripcion] = cols;
      const precio = leerPrecio(precioTxt ?? "");
      if (precio === null) {
        // Fila de títulos ("Categoría; Plato; Precio") u otra cosa sin precio
        if (i === 0 || /precio/i.test(linea)) return;
        errores.push({ linea: i + 1, texto: linea });
        return;
      }
      if (!nombre) { errores.push({ linea: i + 1, texto: linea }); return; }
      lineas.push({ categoria: cat || categoria, nombre, precio, ...(descripcion ? { descripcion } : {}) });
      return;
    }
    // Título de categoría
    const titulo = linea.match(/^#+\s*(.+)$/) ?? linea.match(/^(.+):\s*$/);
    if (titulo) { categoria = titulo[1].trim().slice(0, 40); return; }
    // Plato con el precio al final
    const [principal, ...resto] = linea.split("|");
    const descripcion = resto.join("|").trim();
    const m = principal.match(/^(.*?)[\s.\-–—:]*\$?\s*(\d{1,3}(?:[.,\s]\d{3})+|\d+)\s*$/);
    const precio = m ? leerPrecio(m[2]) : null;
    const nombre = m ? m[1].replace(/[\s.\-–—:]+$/, "").trim() : "";
    if (!m || precio === null || !nombre) { errores.push({ linea: i + 1, texto: linea }); return; }
    lineas.push({ categoria, nombre, precio, ...(descripcion ? { descripcion } : {}) });
  });
  return { lineas, errores };
}
