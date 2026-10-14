// Tablio — avisos al celular (fase 3.4b). Solo recibe notificaciones push y abre la app al tocarlas.
// No guarda nada en caché: la app siempre se carga fresca desde el servidor.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let datos = {};
  try { datos = event.data ? event.data.json() : {}; } catch { datos = { cuerpo: event.data && event.data.text() }; }
  event.waitUntil(Promise.all([
    // Si la app está abierta, también se entera (y las pruebas pueden comprobar la entrega)
    self.clients.matchAll({ type: "window", includeUncontrolled: true })
      .then((ventanas) => ventanas.forEach((v) => v.postMessage({ tipo: "aviso-push", datos }))),
    self.registration.showNotification(datos.titulo || "Tu pedido", {
      body: datos.cuerpo || "Ya está listo.",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: datos.tag || "tablio-pedido",
      renotify: true,
      vibrate: [200, 100, 200],
      data: { url: datos.url || "/" },
    }),
  ]));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destino = new URL(event.notification.data && event.notification.data.url ? event.notification.data.url : "/", self.location.origin).href;
  event.waitUntil((async () => {
    const ventanas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const v of ventanas) {
      if (v.url.startsWith(self.location.origin)) {
        await v.focus();
        if ("navigate" in v) await v.navigate(destino);
        return;
      }
    }
    await self.clients.openWindow(destino);
  })());
});
