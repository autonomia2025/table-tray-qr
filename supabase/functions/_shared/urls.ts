/** Direcciones públicas para las pasarelas (a dónde vuelve el cliente después de pagar). */

/** URL pública de las funciones (en local, Supabase la ve como "kong": el navegador no). */
export function urlFunciones(): string {
  const propia = Deno.env.get("URL_PUBLICA_FUNCIONES");
  if (propia) return propia.replace(/\/$/, "");
  const base = Deno.env.get("SUPABASE_URL") ?? "";
  return `${/kong|host\.docker\.internal/.test(base) ? "http://127.0.0.1:54321" : base}/functions/v1`;
}

// Solo se vuelve a la app de Tablio (producción, vistas previas de Vercel o el computador local):
// nunca a una dirección cualquiera que venga en la petición.
const APPS = [
  /^https:\/\/table-tray-qr(-[a-z0-9-]+)?\.vercel\.app$/,
  /^https:\/\/([a-z0-9-]+\.)?tablio\.cl$/,
  /^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}$/,
];

export function appPermitida(origen: string | null | undefined): string | null {
  if (!origen) return null;
  const limpio = origen.replace(/\/$/, "");
  return APPS.some((r) => r.test(limpio)) ? limpio : null;
}

/**
 * La dirección de la app viaja en la dirección de regreso de la pasarela. Webpay vuelve a codificar
 * esa dirección, así que se manda en base64url (solo letras, números, "-" y "_"), que no se altera.
 */
export const codificarApp = (app: string) => btoa(app).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

export function decodificarApp(valor: string | null): string | null {
  if (!valor) return null;
  try {
    const b64 = valor.replaceAll("-", "+").replaceAll("_", "/");
    return appPermitida(atob(b64 + "===".slice((b64.length + 3) % 4)));
  } catch {
    return null;
  }
}
