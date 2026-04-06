import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
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
