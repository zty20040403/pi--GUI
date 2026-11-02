import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 开发时页面由 Vite 提供（5173），接口和 WebSocket 转给后端（默认 4317，可用 PI_DESK_PORT 改）。
const backend = `127.0.0.1:${process.env.PI_DESK_PORT || 4317}`;
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
      "/api": { target: `http://${backend}`, changeOrigin: true },
      "/ws": { target: `ws://${backend}`, ws: true, changeOrigin: true },
    },
  },
});
