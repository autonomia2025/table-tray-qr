import { supabase } from "@/integrations/supabase/client";
import { mensajeAmigable } from "@/lib/pedidos";

// App instalable y avisos al celular aunque la pantalla esté bloqueada (fase 3.4b).
// Estándar de los navegadores (Web Push): sin cuentas externas ni costo.

/** Clave pública de avisos de Tablio (VAPID). Es pública a propósito; la privada vive en el servidor. */
export const CLAVE_PUBLICA_AVISOS = "BCCjkmChn7J00J5rC1SXS3Lg51CMkIWilo2zNgsaXdlRvHXJ6zYKYKlDUwOFdgY92XV36YyqdekIXzNf3ppbjy8";

const esIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const instalada = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

/**
 * Qué se puede hacer en este celular:
 * - "listo": puede recibir avisos con la pantalla bloqueada;
 * - "ios-instalar": iPhone sin instalar (en iPhone los avisos llegan solo con la app en la pantalla de inicio);
 * - "no": el navegador no permite avisos.
 */
export function capacidadAvisos(): "listo" | "ios-instalar" | "no" {
  try {
    if ("serviceWorker" in navigator && "PushManager" in window && "Notification" in window) return "listo";
    if (esIOS() && !instalada()) return "ios-instalar";
  } catch { /* navegador antiguo */ }
  return "no";
}

function aBytes(base64url: string) {
  const relleno = "=".repeat((4 - (base64url.length % 4)) % 4);
  const b64 = (base64url + relleno).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** ¿Este celular ya tiene los avisos activados? */
export async function avisosActivos(): Promise<boolean> {
  try {
    if (capacidadAvisos() !== "listo" || Notification.permission !== "granted") return false;
    const reg = await navigator.serviceWorker.getRegistration("/");
    return !!(await reg?.pushManager.getSubscription());
  } catch {
    return false;
  }
}

/** Pide permiso, registra el aviso del navegador y lo guarda en la base ligado a la mesa. */
export async function activarAvisos(tokenMesa: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (capacidadAvisos() !== "listo") return { ok: false, error: "Este celular no permite avisos desde el navegador." };
    const permiso = await Notification.requestPermission();
    if (permiso !== "granted") return { ok: false, error: "Sin permiso no podemos avisarte. Puedes activarlo en los ajustes del navegador." };
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    const sus = (await reg.pushManager.getSubscription())
      ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: aBytes(CLAVE_PUBLICA_AVISOS) }));
    const datos = sus.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    const { error } = await supabase.rpc("guardar_suscripcion_push", {
      _qr_token: tokenMesa, _endpoint: datos.endpoint ?? "", _p256dh: datos.keys?.p256dh ?? "", _auth: datos.keys?.auth ?? "",
    });
    if (error) return { ok: false, error: mensajeAmigable(error.message) };
    return { ok: true };
  } catch {
    return { ok: false, error: "No pudimos activar los avisos en este celular." };
  }
}

/* ---------- Instalar la app (sin tienda) ---------- */

type EventoInstalar = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let eventoInstalar: EventoInstalar | null = null;
const oyentes = new Set<() => void>();

/** Se llama una vez al cargar la app: el navegador avisa muy temprano que se puede instalar. */
export function escucharInstalacion() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    eventoInstalar = e as EventoInstalar;
    oyentes.forEach((f) => f());
  });
  window.addEventListener("appinstalled", () => {
    eventoInstalar = null;
    oyentes.forEach((f) => f());
  });
}

export const sePuedeInstalar = () => !!eventoInstalar && !instalada();
export function alCambiarInstalacion(f: () => void) {
  oyentes.add(f);
  return () => { oyentes.delete(f); };
}
export async function instalarApp() {
  if (!eventoInstalar) return false;
  await eventoInstalar.prompt();
  const { outcome } = await eventoInstalar.userChoice;
  eventoInstalar = null;
  oyentes.forEach((f) => f());
  return outcome === "accepted";
}

/**
 * Al instalarla desde la carta o el seguimiento, la app lleva el nombre del local y abre directo esa
 * mesa (no la pantalla de inicio de sesión).
 */
export function manifiestoDelLocal(nombre: string, urlMesa: string) {
  try {
    const origen = window.location.origin;
    const manifiesto = {
      name: nombre, short_name: nombre.slice(0, 12), lang: "es-CL",
      start_url: new URL(urlMesa, origen).href, scope: origen + "/", display: "standalone",
      background_color: "#FAF7F2", theme_color: "#E8531D",
      icons: [
        { src: origen + "/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: origen + "/icon-512.png", sizes: "512x512", type: "image/png" },
        { src: origen + "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    };
    const enlace = document.getElementById("manifiesto") as HTMLLinkElement | null;
    if (!enlace) return;
    const anterior = enlace.href;
    enlace.href = URL.createObjectURL(new Blob([JSON.stringify(manifiesto)], { type: "application/manifest+json" }));
    if (anterior.startsWith("blob:")) URL.revokeObjectURL(anterior);
  } catch { /* sin manifiesto dinámico: queda el general */ }
}
