/**
 * Detección y solicitud de pago con billeteras (Apple Pay / Google Pay)
 * mediante la Payment Request API del navegador.
 *
 * El cobro real se resuelve siempre en el servidor. Aquí solo se abre la hoja
 * nativa cuando el dispositivo la soporta; si no, se continúa igual con el
 * adaptador de pago del backend (hoy simulado).
 */

export type WalletKind = "apple_pay" | "google_pay";

export function detectWallets(): { applePay: boolean; googlePay: boolean } {
  if (typeof window === "undefined") return { applePay: false, googlePay: false };

  const ua = window.navigator.userAgent || "";
  const isApple = /iPhone|iPad|iPod|Macintosh/i.test(ua);
  const applePay = isApple && ("ApplePaySession" in window || "PaymentRequest" in window);
  const googlePay = !isApple && "PaymentRequest" in window;

  return { applePay, googlePay };
}

export interface WalletRequestResult {
  outcome: "authorized" | "cancelled" | "unsupported";
}

export async function requestWalletPayment(
  kind: WalletKind,
  totalCLP: number,
  label: string,
): Promise<WalletRequestResult> {
  if (typeof window === "undefined" || !("PaymentRequest" in window)) {
    return { outcome: "unsupported" };
  }

  const methodData: PaymentMethodData[] =
    kind === "apple_pay"
      ? [
          {
            supportedMethods: "https://apple.com/apple-pay",
            data: {
              version: 3,
              merchantIdentifier: "merchant.dev.tablio.sandbox",
              merchantCapabilities: ["supports3DS"],
              supportedNetworks: ["visa", "masterCard", "amex"],
              countryCode: "CL",
            },
          } as PaymentMethodData,
        ]
      : [
          {
            supportedMethods: "https://google.com/pay",
            data: {
              environment: "TEST",
              apiVersion: 2,
              apiVersionMinor: 0,
              allowedPaymentMethods: [
                {
                  type: "CARD",
                  parameters: {
                    allowedAuthMethods: ["PAN_ONLY", "CRYPTOGRAM_3DS"],
                    allowedCardNetworks: ["VISA", "MASTERCARD"],
                  },
                  tokenizationSpecification: {
                    type: "PAYMENT_GATEWAY",
                    parameters: { gateway: "example", gatewayMerchantId: "tablio-sandbox" },
                  },
                },
              ],
              merchantInfo: { merchantId: "TABLIO-SANDBOX", merchantName: "tablio" },
            },
          } as PaymentMethodData,
        ];

  const details: PaymentDetailsInit = {
    total: {
      label,
      amount: { currency: "CLP", value: String(totalCLP) },
    },
  };

  try {
    const request = new PaymentRequest(methodData, details);
    const canPay = await request.canMakePayment().catch(() => false);
    if (!canPay) return { outcome: "unsupported" };

    const response = await request.show();
    await response.complete("success");
    return { outcome: "authorized" };
  } catch (err: unknown) {
    const name = (err as { name?: string })?.name;
    if (name === "AbortError") return { outcome: "cancelled" };
    return { outcome: "unsupported" };
  }
}
