const { join, isAbsolute } = require("node:path");

function childEnvironment(source, home) {
  // Finder 的 PATH 往往没有 Nix 和用户 pi 启动器；不读取/改写 shell 配置。
  const paths = [join(home, ".local/bin"), join(home, ".nix-profile/bin"), "/nix/var/nix/profiles/default/bin", "/opt/homebrew/bin", "/usr/local/bin", ...(source.PATH || "").split(":"), "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  const env = { ...source, PATH: [...new Set(paths.filter((path) => isAbsolute(path) && !path.endsWith("/node_modules/.bin")))].join(":"), NODE_ENV: "production" };
  delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS; delete env.NODE_PATH;
  return env;
}
class LaunchUrl {
  buffer = "";
  feed(chunk) {
    this.buffer += chunk;
    if (this.buffer.length > 65536) throw new Error("后台启动输出异常");
    let newline;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline); this.buffer = this.buffer.slice(newline + 1);
      const match = line.match(/http:\/\/127\.0\.0\.1:([1-9]\d{0,4})\/\?token=([0-9a-f]{64})(?:\s|$)/);
      if (match && Number(match[1]) <= 65535) return `http://127.0.0.1:${match[1]}/?token=${match[2]}`;
    }
  }
}
async function loadWindow(window, url) {
  try { await window.loadURL(url); }
  catch { throw new Error("应用界面未能加载，请退出后重新打开应用。"); } // Chromium 的原始错误可能包含完整启动口令。
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
const preferenceKeys = ["pi-desk.layout", "pi-desk.file-layout", "pi-desk.groups", "pi-desk.projects"];
function preferenceValue(key, text) {
  if (!preferenceKeys.includes(key) || typeof text !== "string" || text.length > 128 * 1024) throw new Error("只允许保存界面布局和最近项目，不保存口令或对话内容");
  const value = JSON.parse(text);
  if (key === "pi-desk.layout" || key === "pi-desk.file-layout") {
    const toggle = key === "pi-desk.layout" ? "open" : "shown"; const [min, max] = toggle === "open" ? [220, 460] : [280, 720];
    if (!value || typeof value[toggle] !== "boolean" || !Number.isFinite(value.width) || value.width < min || value.width > max) throw new Error("界面布局格式不正确");
    return JSON.stringify({ [toggle]: value[toggle], width: value.width });
  }
  if (!Array.isArray(value)) throw new Error("项目列表格式不正确");
  const path = (text) => typeof text === "string" && isAbsolute(text) && text.length <= 4096 && !/[\x00-\x1f]/.test(text);
  return JSON.stringify(key === "pi-desk.groups" ? value.filter(path).slice(0, 512) : value.filter((row) => row && path(row.cwd) && Number.isFinite(row.openedAt)).slice(0, 20).map(({ cwd, openedAt }) => ({ cwd, openedAt })));
}
function publicPreferences(value) {
  const result = {}; for (const key of preferenceKeys) { try { if (typeof value?.[key] === "string") result[key] = preferenceValue(key, value[key]); } catch {} } return result;
}
module.exports = { childEnvironment, LaunchUrl, loadWindow, windowBounds, trustedSender, preferenceValue, publicPreferences };
