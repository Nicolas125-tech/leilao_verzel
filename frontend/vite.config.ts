import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/api/v1/ws": {
        target: process.env.VITE_WS_PROXY_TARGET || "ws://localhost:8000",
        ws: true,
        changeOrigin: true,
      },
      "/api": {
        target: process.env.VITE_API_PROXY_TARGET || "http://localhost:8000",
        changeOrigin: true,
        ws: true,
      },
      "/ws": {
        target: process.env.VITE_WS_PROXY_TARGET || "ws://localhost:8000",
        ws: true,
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
});
