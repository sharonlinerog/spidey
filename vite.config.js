import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  build: {
    target: "es2019",
    sourcemap: false,
  },
  plugins: [
    VitePWA({
      // injectManifest en vez de generateSW: el service worker se escribe a
      // mano en src/sw.js porque necesita atender el evento `push`, cosa que
      // un service worker generado no hace.
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.js",
      registerType: "autoUpdate",
      injectRegister: "script-defer",
      includeAssets: ["favicon.svg", "icons/apple-touch-icon.png"],
      manifest: {
        name: "Spidey — Seguimiento de tareas",
        short_name: "Spidey",
        description:
          "Tableros compartidos, subtareas, comentarios y adjuntos para organizar el trabajo de tu equipo.",
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
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
      },
      devOptions: { enabled: false, type: "module" },
    }),
  ],
});
