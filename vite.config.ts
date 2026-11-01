import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;
const proxy = {
  "/api/cbr-usd": {
    target: "https://www.cbr.ru",
    changeOrigin: true,
    rewrite: () => "/scripts/XML_daily.asp",
  },
};
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  preview: { proxy },
  server: {
    proxy,
    port: 1420,
    strictPort: true,
    host: host || "0.0.0.0",
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
});
