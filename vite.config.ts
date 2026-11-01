import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 开发时页面由 Vite 提供（5173），接口和 WebSocket 转给后端（4317）。
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:4317", changeOrigin: true },
      "/ws": { target: "ws://127.0.0.1:4317", ws: true, changeOrigin: true },
    },
  },
});
