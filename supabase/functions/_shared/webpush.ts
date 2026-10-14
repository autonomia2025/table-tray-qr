// Web Push sin librerías (fase 3.4b): firma VAPID (RFC 8292) y cifrado aes128gcm (RFC 8291 / 8188),
// solo con WebCrypto. Funciona igual en Deno (funciones de Supabase) y en Node (pruebas).

const te = new TextEncoder();

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function deB64url(texto: string): Uint8Array {
  const relleno = "=".repeat((4 - (texto.length % 4)) % 4);
  const bin = atob((texto + relleno).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function unir(...partes: Uint8Array[]): Uint8Array {
  const total = new Uint8Array(partes.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of partes) { total.set(p, i); i += p.length; }
  return total;
}

async function hkdf(sal: Uint8Array, ikm: Uint8Array, info: Uint8Array, largo: number): Promise<Uint8Array> {
  const clave = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: sal, info }, clave, largo * 8));
}

/** Firma VAPID: "Authorization: vapid t=<jwt>, k=<clave pública>". */
export async function encabezadoVapid(endpoint: string, sujeto: string, publica: string, privada: string, ahora = Date.now()): Promise<string> {
  const pub = deB64url(publica); // 65 bytes: 0x04 || x || y
  if (pub.length !== 65 || pub[0] !== 4) throw new Error("Clave pública VAPID inválida");
  const jwk: JsonWebKey = {
    kty: "EC", crv: "P-256", ext: false,
    x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)), d: privada,
  };
  const clave = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const cabecera = b64url(te.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const cuerpo = b64url(te.encode(JSON.stringify({
    aud: new URL(endpoint).origin, exp: Math.floor(ahora / 1000) + 12 * 3600, sub: sujeto,
  })));
  const firma = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, clave, te.encode(`${cabecera}.${cuerpo}`)));
  return `vapid t=${cabecera}.${cuerpo}.${b64url(firma)}, k=${publica}`;
}

/** Cifra el aviso para un navegador (aes128gcm, un solo registro). */
export async function cifrarAviso(texto: string, p256dh: string, auth: string): Promise<Uint8Array> {
  const uaPublica = deB64url(p256dh);
  const secreto = deB64url(auth);
  if (uaPublica.length !== 65 || secreto.length < 16) throw new Error("Suscripción inválida");
  const claveUa = await crypto.subtle.importKey("raw", uaPublica, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const efimera = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const asPublica = new Uint8Array(await crypto.subtle.exportKey("raw", efimera.publicKey));
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: claveUa }, efimera.privateKey, 256));

  const ikm = await hkdf(secreto, ecdh, unir(te.encode("WebPush: info\0"), uaPublica, asPublica), 32);
  const sal = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(sal, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(sal, ikm, te.encode("Content-Encoding: nonce\0"), 12);

  const claveAes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const relleno = unir(te.encode(texto), new Uint8Array([2])); // 0x02 = último registro
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, claveAes, relleno));

  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return unir(sal, rs, new Uint8Array([asPublica.length]), asPublica, cifrado);
}

/** Envía un aviso. Devuelve el código HTTP del servicio de avisos (201 = entregado al servicio). */
export async function enviarAviso(
  sus: { endpoint: string; p256dh: string; auth: string },
  texto: string,
  vapid: { publica: string; privada: string; sujeto: string },
  opciones: { ttl?: number; urgencia?: "very-low" | "low" | "normal" | "high" } = {},
): Promise<number> {
  const cuerpo = await cifrarAviso(texto, sus.p256dh, sus.auth);
  const r = await fetch(sus.endpoint, {
    method: "POST",
    headers: {
      Authorization: await encabezadoVapid(sus.endpoint, vapid.sujeto, vapid.publica, vapid.privada),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(opciones.ttl ?? 600),
      Urgency: opciones.urgencia ?? "high",
    },
    body: cuerpo,
  });
  await r.body?.cancel();
  return r.status;
}
