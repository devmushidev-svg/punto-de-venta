import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const viteAppBuild =
  process.env.VITE_APP_BUILD?.trim() ||
  `dev ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;

export default defineConfig({
  define: {
    "import.meta.env.VITE_APP_BUILD": JSON.stringify(viteAppBuild),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      // Íconos (192/512/maskable/apple-touch) generados desde el SVG de marca.
      pwaAssets: { image: "public/favicon.svg" },
      manifest: {
        name: "MultiPOS — Punto de venta",
        short_name: "MultiPOS",
        description: "Sistema de punto de venta",
        lang: "es",
        theme_color: "#fff7ed",
        background_color: "#fff7ed",
        display: "standalone",
        start_url: "/",
        scope: "/",
      },
      workbox: {
        // SPA: rutas de cliente sirven index.html offline; las del backend nunca caen aquí.
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api/, /^\/auth/, /^\/uploads/, /^\/health/],
        // Catálogo (productos/clientes): última respuesta cacheada para vender offline.
        runtimeCaching: [
          {
            urlPattern: /\/api\/(products|customers)(\b|\/|\?)/,
            handler: "NetworkFirst",
            method: "GET",
            options: {
              cacheName: "pf-api-catalog",
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 300, maxAgeSeconds: 604800 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/auth": "http://localhost:3001",
      "/api": "http://localhost:3001",
      "/health": "http://localhost:3001",
    },
  },
  preview: {
    port: 4173,
    proxy: {
      "/auth": "http://localhost:3001",
      "/api": "http://localhost:3001",
      "/health": "http://localhost:3001",
    },
  },
});
