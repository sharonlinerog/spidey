/**
 * Service worker de Spidey.
 *
 * Antes lo generaba el plugin solo. Ahora se escribe a mano porque hace
 * falta algo que un service worker generado no trae: atender el evento
 * `push`, que es lo que permite recibir un recordatorio con la app cerrada.
 *
 * Todo lo demás —precargar los archivos, servirlos sin conexión, refrescar
 * las tipografías en segundo plano— sigue siendo el mismo Workbox de antes.
 */

import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { StaleWhileRevalidate } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";

// El plugin sustituye esto por la lista real de archivos al compilar.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Cualquier ruta de la app devuelve index.html: es una SPA.
// Se excluyen las rutas de Supabase para que jamás se sirvan desde caché.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL("index.html"), {
    denylist: [/^\/auth/, /^\/rest/, /^\/storage/, /^\/functions/],
  })
);

// Tipografías: se sirven desde caché y se refrescan en segundo plano.
registerRoute(
  ({ url }) => url.origin === "https://fonts.googleapis.com" || url.origin === "https://fonts.gstatic.com",
  new StaleWhileRevalidate({
    cacheName: "tipografias",
    plugins: [new ExpirationPlugin({ maxEntries: 24, maxAgeSeconds: 60 * 60 * 24 * 365 })],
  })
);

// La versión nueva toma el control sin esperar a que se cierren las pestañas.
self.skipWaiting();
self.addEventListener("activate", (evento) => evento.waitUntil(self.clients.claim()));

/* ===================== Recordatorios ===================== */

/**
 * El servidor manda un JSON con { titulo, cuerpo, url, etiqueta }. Si algo
 * viniera mal formado igual hay que mostrar algo: el navegador castiga con
 * un aviso genérico ("Este sitio se actualizó en segundo plano") a quien
 * recibe un push y no notifica nada.
 */
self.addEventListener("push", (evento) => {
  let datos = {};
  try {
    datos = evento.data ? evento.data.json() : {};
  } catch {
    datos = { cuerpo: evento.data ? evento.data.text() : "" };
  }

  const titulo = datos.titulo || "Spidey";
  const opciones = {
    body: datos.cuerpo || "Tienes tareas que necesitan atención.",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: datos.etiqueta || "spidey",
    renotify: true,
    data: { url: datos.url || "/" },
  };

  evento.waitUntil(
    (async () => {
      await self.registration.showNotification(titulo, opciones);
      // El contador del ícono en Android/escritorio, cuando el navegador lo admite.
      if (self.navigator && "setAppBadge" in self.navigator && Number.isFinite(datos.total)) {
        try {
          await self.navigator.setAppBadge(datos.total);
        } catch {
          /* el navegador no lo permite: no es motivo para fallar */
        }
      }
    })()
  );
});

/** Al tocar el aviso: traer al frente una pestaña abierta, o abrir una. */
self.addEventListener("notificationclick", (evento) => {
  evento.notification.close();
  const destino = (evento.notification.data && evento.notification.data.url) || "/";

  evento.waitUntil(
    (async () => {
      const abiertas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const cliente of abiertas) {
        if ("focus" in cliente) {
          await cliente.focus();
          if ("navigate" in cliente && new URL(cliente.url).pathname !== destino) {
            await cliente.navigate(destino).catch(() => {});
          }
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(destino);
    })()
  );
});
