import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  build: {
    target: "es2019",
    sourcemap: false,
  },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "script-defer",
      includeAssets: ["favicon.svg", "icons/apple-touch-icon.png"],
      manifest: {
        name: "Spidey — Seguimiento de tareas",
        short_name: "Spidey",
        description:
          "Tablero Kanban, lista, calendario e indicadores para organizar tus tareas.",
        lang: "es",
        dir: "ltr",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait-primary",
        background_color: "#101010",
        theme_color: "#D30000",
        categories: ["productivity", "business"],
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallback: "/index.html",
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Tipografías: se sirven desde caché y se refrescan en segundo plano.
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "tipografias",
              expiration: { maxEntries: 24, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
        // Nunca cachear las llamadas a Supabase: los datos deben venir frescos
        // y el modo sin conexión se resuelve con la caché local de la app.
        navigateFallbackDenylist: [/^\/auth/, /^\/rest/],
      },
      devOptions: { enabled: false },
    }),
  ],
});
