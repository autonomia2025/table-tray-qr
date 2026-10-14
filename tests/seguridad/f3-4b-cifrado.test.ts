import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { b64url, cifrarAviso, deB64url, encabezadoVapid } from "../../supabase/functions/_shared/webpush";

// Fase 3.4b — El cifrado y la firma de los avisos (Web Push) se comprueban de punta a punta: lo que
// cifra el servidor lo descifra el "celular" (con la receta oficial, RFC 8291), y la firma VAPID es
// válida para la clave pública de Tablio. Sin servicios externos.

function clavesP256() {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  return { publica: new Uint8Array(ecdh.getPublicKey()), privada: new Uint8Array(ecdh.getPrivateKey()), ecdh };
}

describe("cifrado y firma de los avisos", () => {
  it("lo que cifra el servidor, el celular lo descifra igual", async () => {
    const celular = clavesP256();
    const auth = crypto.randomBytes(16);
    const texto = JSON.stringify({ titulo: "Demo Tablio", cuerpo: "Ya está listo: Agua mineral. El mozo te lo trae." });

    const cuerpo = await cifrarAviso(texto, b64url(celular.publica), b64url(new Uint8Array(auth)));

    // Descifrar como lo hace el navegador (RFC 8291 / 8188)
    const sal = cuerpo.slice(0, 16);
    const rs = Buffer.from(cuerpo.slice(16, 20)).readUInt32BE(0);
    const largoId = cuerpo[20];
    const asPublica = cuerpo.slice(21, 21 + largoId);
    const cifrado = cuerpo.slice(21 + largoId);
    expect(rs).toBe(4096);
    expect(largoId).toBe(65);

    const ecdh = celular.ecdh.computeSecret(Buffer.from(asPublica));
    const info = Buffer.concat([Buffer.from("WebPush: info\0"), Buffer.from(celular.publica), Buffer.from(asPublica)]);
    const ikm = Buffer.from(crypto.hkdfSync("sha256", ecdh, auth, info, 32));
    const cek = Buffer.from(crypto.hkdfSync("sha256", ikm, sal, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
    const nonce = Buffer.from(crypto.hkdfSync("sha256", ikm, sal, Buffer.from("Content-Encoding: nonce\0"), 12));
    const descifrador = crypto.createDecipheriv("aes-128-gcm", cek, nonce);
    descifrador.setAuthTag(Buffer.from(cifrado.slice(-16)));
    const plano = Buffer.concat([descifrador.update(Buffer.from(cifrado.slice(0, -16))), descifrador.final()]);
    expect(plano[plano.length - 1]).toBe(2); // marca de último registro
    expect(plano.subarray(0, -1).toString("utf8")).toBe(texto);
  });

  it("la firma VAPID es válida para la clave pública de Tablio y apunta al servicio de avisos", async () => {
    const tablio = clavesP256();
    const endpoint = "https://fcm.googleapis.com/fcm/send/abc123";
    const ahora = Date.now();
    const encabezado = await encabezadoVapid(endpoint, "https://table-tray-qr.vercel.app", b64url(tablio.publica), b64url(tablio.privada), ahora);
    const [, jwt, k] = encabezado.match(/^vapid t=([^,]+), k=(.+)$/)!;
    expect(k).toBe(b64url(tablio.publica));

    const [cab, cuerpo, firma] = jwt.split(".");
    expect(JSON.parse(Buffer.from(deB64url(cab)).toString())).toEqual({ typ: "JWT", alg: "ES256" });
    const reclamos = JSON.parse(Buffer.from(deB64url(cuerpo)).toString());
    expect(reclamos).toMatchObject({ aud: "https://fcm.googleapis.com", sub: "https://table-tray-qr.vercel.app" });
    expect(reclamos.exp).toBeGreaterThan(ahora / 1000);
    expect(reclamos.exp).toBeLessThanOrEqual(ahora / 1000 + 24 * 3600); // los servicios rechazan más de 24 h

    const clavePublica = crypto.createPublicKey({
      key: { kty: "EC", crv: "P-256", x: b64url(tablio.publica.slice(1, 33)), y: b64url(tablio.publica.slice(33)) },
      format: "jwk",
    });
    const valida = crypto.verify("sha256", Buffer.from(`${cab}.${cuerpo}`), { key: clavePublica, dsaEncoding: "ieee-p1363" }, Buffer.from(deB64url(firma)));
    expect(valida).toBe(true);
  });

  it("una suscripción con claves inválidas da un error normal (no bota el servidor)", async () => {
    await expect(cifrarAviso("hola", "B" + "x".repeat(86), "a".repeat(22))).rejects.toThrow();
    await expect(cifrarAviso("hola", "corta", "a".repeat(22))).rejects.toThrow();
  });
});
