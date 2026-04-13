import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const viteAppBuild =
  process.env.VITE_APP_BUILD?.trim() ||
  `dev ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;

export default defineConfig({
  define: {
    "import.meta.env.VITE_APP_BUILD": JSON.stringify(viteAppBuild),
  },
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/auth": "http://localhost:3001",
      "/api": "http://localhost:3001",
      "/health": "http://localhost:3001",
    },
  },
});
