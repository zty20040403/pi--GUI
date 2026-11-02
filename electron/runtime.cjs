const { access, stat } = require("node:fs/promises");
const { constants } = require("node:fs");
const { join, isAbsolute } = require("node:path");

function childEnvironment(source, home) {
  // Finder 的 PATH 往往没有 Nix 和用户 pi 启动器；不读取/改写 shell 配置。
  const paths = [join(home, ".local/bin"), join(home, ".nix-profile/bin"), "/nix/var/nix/profiles/default/bin", "/opt/homebrew/bin", "/usr/local/bin", ...(source.PATH || "").split(":"), "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  const env = { ...source, PATH: [...new Set(paths.filter((path) => isAbsolute(path) && !path.endsWith("/node_modules/.bin")))].join(":"), NODE_ENV: "production" };
  delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS; delete env.NODE_PATH;
  return env;
}
async function findNode(env) {
  const candidates = env.PI_DESK_NODE ? [env.PI_DESK_NODE] : env.PATH.split(":").map((path) => join(path, "node"));
  for (const path of candidates) {
    if (!isAbsolute(path)) continue;
    try { await access(path, constants.X_OK); if ((await stat(path)).isFile()) return path; } catch {}
  }
  throw new Error("找不到 Node.js。请安装 Node.js 22 或更新版本，或用 PI_DESK_NODE 指定它的绝对路径。");
}
class LaunchUrl {
  buffer = "";
  feed(chunk) {
    this.buffer += chunk;
    if (this.buffer.length > 65536) throw new Error("后台启动输出异常");
    let newline;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline); this.buffer = this.buffer.slice(newline + 1);
      const match = line.match(/http:\/\/127\.0\.0\.1:4317\/\?token=([0-9a-f]{64})(?:\s|$)/);
      if (match) return `http://127.0.0.1:4317/?token=${match[1]}`;
    }
  }
}
function windowBounds(saved, displays) {
  const width = Math.max(900, Math.min(2400, Number(saved?.width) || 1400));
  const height = Math.max(600, Math.min(1600, Number(saved?.height) || 900));
  const bounds = { width, height };
  if (Number.isFinite(saved?.x) && Number.isFinite(saved?.y) && displays.some(({ workArea: area }) => saved.x + width > area.x + 80 && saved.x < area.x + area.width - 80 && saved.y + height > area.y + 80 && saved.y < area.y + area.height - 80)) {
    bounds.x = saved.x; bounds.y = saved.y;
  }
  return bounds;
}
function trustedSender(event, window, origin) {
  if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return false;
  try { return new URL(event.senderFrame.url).origin === origin; } catch { return false; }
}
module.exports = { childEnvironment, findNode, LaunchUrl, windowBounds, trustedSender };
