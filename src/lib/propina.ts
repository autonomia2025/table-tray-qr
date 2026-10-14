// Propina del cliente (decisión del fundador del 14 de octubre de 2026 y art. 64 del Código del Trabajo):
// la cuenta sugiere al menos un 10% (viene marcado), el cliente puede elegir 15%, 20%, otro monto o
// no dejar propina, y la propina es íntegra del equipo.

export type Propina = { tipo: "pct"; pct: number } | { tipo: "monto"; monto: number };

export const PORCENTAJES_PROPINA = [10, 15, 20] as const;
export const PROPINA_SUGERIDA: Propina = { tipo: "pct", pct: 10 };
export const SIN_PROPINA: Propina = { tipo: "monto", monto: 0 };

export const montoPropina = (p: Propina, subtotal: number) =>
  p.tipo === "pct" ? Math.round(Math.max(0, subtotal) * (p.pct / 100)) : Math.max(0, Math.round(p.monto));

/** Porcentaje que se informa al pedir la cuenta (0 si eligió un monto propio). */
export const porcentajePropina = (p: Propina) => (p.tipo === "pct" ? p.pct : 0);
