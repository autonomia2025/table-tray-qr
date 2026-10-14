import { describe, it, expect } from "vitest";
import { ESTADOS_MESA, ESTADOS_PAGO, ESTADOS_PEDIDO, ESTADOS_PEDIDO_PLURAL, textoLlamado, textoMesa, textoPago, textoPedido } from "./estados";

// Los estados que acepta la base (restricciones de orders/order_items, tables y payments).
const PEDIDO = ["confirmed", "in_kitchen", "ready", "delivered", "cancelled"];
const MESA = ["free", "occupied", "waiting_bill"];
const PAGO = ["approved", "pending", "failed", "refunded", "partially_refunded"];
const INGLES = /\b(confirmed|kitchen|ready|delivered|cancelled|free|occupied|waiting|approved|pending|failed|refunded)\b/i;

describe("capa única de estados", () => {
  it("cada estado de la base tiene su texto en español, para el personal y para el cliente", () => {
    for (const e of PEDIDO) {
      for (const para of ["personal", "comensal"] as const) {
        expect(textoPedido(e, para)).toBeTruthy();
        expect(textoPedido(e, para)).not.toMatch(INGLES);
      }
      expect(ESTADOS_PEDIDO_PLURAL[e as keyof typeof ESTADOS_PEDIDO_PLURAL]).not.toMatch(INGLES);
    }
    for (const e of MESA) expect(textoMesa(e)).not.toMatch(INGLES);
    for (const e of PAGO) expect(textoPago(e)).not.toMatch(INGLES);
    expect(Object.keys(ESTADOS_PEDIDO).sort()).toEqual([...PEDIDO].sort());
    expect(Object.keys(ESTADOS_MESA).sort()).toEqual([...MESA].sort());
    expect(Object.keys(ESTADOS_PAGO).sort()).toEqual([...PAGO].sort());
  });

  it("un estado desconocido nunca se muestra en inglés", () => {
    for (const f of [textoPedido, textoMesa, textoPago, textoLlamado]) {
      expect(f("something_new")).toBe("En proceso");
      expect(f(null)).toBe("En proceso");
    }
  });
});
