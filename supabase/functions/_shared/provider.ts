/**
 * Adaptador de proveedor de pagos.
 * Hoy resuelve los cobros en modo simulado. Para conectar un proveedor real
 * (Mercado Pago, Transbank, Stripe) basta con reemplazar este archivo:
 * el resto del sistema (pagos, cocina, ingresos, conciliación, reembolsos,
 * lealtad) no cambia.
 */

export type PaymentMethod = "apple_pay" | "google_pay" | "card" | "cash";

export interface ChargeInput {
  amount: number;
  tip: number;
  method: PaymentMethod;
  reference: string;
  email?: string | null;
}

export interface ChargeResult {
  approved: boolean;
  externalReference: string;
  payload: Record<string, unknown>;
  declineReason?: string;
}

export const PROVIDER_NAME = "simulated";

export async function charge(input: ChargeInput): Promise<ChargeResult> {
  // Simulación: latencia de red y aprobación determinística.
  await new Promise((r) => setTimeout(r, 350));

  const total = input.amount + input.tip;
  const approved = total > 0;

  return {
    approved,
    externalReference: `SIM-${Date.now().toString(36).toUpperCase()}-${input.reference.slice(0, 8).toUpperCase()}`,
    payload: {
      simulated: true,
      method: input.method,
      amount: input.amount,
      tip: input.tip,
      total,
      captured_at: new Date().toISOString(),
    },
    declineReason: approved ? undefined : "Monto inválido",
  };
}

export async function refund(
  externalReference: string | null,
  amount: number,
): Promise<{ ok: boolean; externalReference: string }> {
  await new Promise((r) => setTimeout(r, 200));
  return {
    ok: true,
    externalReference: `SIMREF-${Date.now().toString(36).toUpperCase()}-${amount}${
      externalReference ? "-" + externalReference.slice(-6) : ""
    }`,
  };
}
