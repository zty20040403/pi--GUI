import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 开发时页面由 Vite 提供（5173），接口和 WebSocket 转给后端（4317）。
export default defineConfig({
  plugins: [react()],
  worker: { format: "es" },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    allowedHosts: ["127.0.0.1", "localhost"],
    cors: { origin: /^http:\/\/(127\.0\.0\.1|localhost):5173$/ },
    fs: { strict: true, deny: ["**/.git/**", "**/.env", "**/.env.*", "**/.ssh/**", "**/.gnupg/**", "**/.pi/agent/**", "**/.config/sops/**", "**/.config/cortexkit/**", "**/.local/share/pi-agent/**", "**/.npmrc", "**/.netrc", "**/.git-credentials", "**/*.{pem,key,p12,pfx}"] },
    proxy: {
      "/api": { target: "http://127.0.0.1:4317", changeOrigin: true },
      "/ws": { target: "ws://127.0.0.1:4317", ws: true, changeOrigin: true },
    },
  },
});
