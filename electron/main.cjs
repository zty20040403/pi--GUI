const { app, BrowserWindow, dialog, ipcMain, screen, shell } = require("electron");
const { spawn } = require("node:child_process");
const { mkdir, readFile, realpath, stat, writeFile } = require("node:fs/promises");
const { homedir } = require("node:os");
const { isAbsolute, join, resolve } = require("node:path");
const { childEnvironment, findNode, LaunchUrl, windowBounds, trustedSender } = require("./runtime.cjs");

app.setName("pi desk");
let window; let backend; let origin; let token; let preferences = {}; let quitting = false; let closed = false;
let preferencesFile;
// 显式命令行参数只用于独立配置目录（也是验收隔离），不读取私人对话到测试截图。
const customData = app.commandLine.getSwitchValue("user-data-dir");
if (customData && isAbsolute(customData)) app.setPath("userData", customData);
const single = app.requestSingleInstanceLock();
if (!single) app.quit();
else {
  app.on("second-instance", () => { if (window && !window.isDestroyed()) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (event) => {
    if (closed) return;
    event.preventDefault(); if (quitting) return; quitting = true;
    void stopBackend().finally(() => { closed = true; app.quit(); });
  });
  void app.whenReady().then(start).catch(async (error) => {
    // 不把后台原始输出、启动口令或配置写入错误窗口/日志。
    dialog.showErrorBox("pi desk 无法启动", error instanceof Error ? error.message : "启动失败");
    app.quit();
  });
}
async function savePreferences() {
  if (!preferencesFile) return;
  try { await writeFile(preferencesFile, JSON.stringify(preferences), { mode: 0o600 }); } catch {}
}
async function startBackend(workspace) {
  const env = childEnvironment(process.env, homedir()); env.PI_DESK_WORKSPACE = workspace;
  const node = await findNode(env);
  const root = resolve(__dirname, "..");
  const args = app.isPackaged ? [join(process.resourcesPath, "runtime/server/index.mjs")] : ["--import", "tsx", join(root, "server/index.ts")];
  return new Promise((done, reject) => {
    const decoder = new LaunchUrl(); let started = false; let occupied = false;
    const child = spawn(node, args, { cwd: app.isPackaged ? workspace : root, env, detached: true, stdio: ["ignore", "pipe", "pipe"] }); backend = child;
    const timeout = setTimeout(() => reject(new Error("后台启动超过 30 秒，请先在终端确认 pi --version 可以运行。")), 30000);
    child.once("error", () => { clearTimeout(timeout); reject(new Error("无法启动 Node.js 后台，请检查 Node.js 和 pi 是否安装。")); });
    child.stderr.on("data", (bytes) => { if (bytes.toString().includes("EADDRINUSE")) occupied = true; });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (started) return;
      try { const url = decoder.feed(chunk); if (url) { started = true; clearTimeout(timeout); done(url); } }
      catch { clearTimeout(timeout); reject(new Error("后台启动输出异常，请重启应用。")); }
    });
    child.once("exit", () => {
      clearTimeout(timeout);
      if (!started) reject(new Error(occupied ? "4317 端口已被占用。请先关闭其他 pi desk，或在启动 npm run dev / npm start 的终端按 Ctrl+C，再打开应用。" : "后台未能启动，请先在终端确认 Node.js 和 pi 可以运行。"));
      else if (!quitting) { dialog.showErrorBox("pi desk 后台已退出", "请重新打开应用；已保存的对话仍在。"); app.quit(); }
    });
  });
}
async function stopBackend() {
  const child = backend; backend = undefined;
  if (!child?.pid || child.exitCode !== null) return;
  await new Promise((done) => {
    const timer = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} done(); }, 5000);
    child.once("exit", () => { clearTimeout(timer); done(); });
    try { child.kill("SIGTERM"); } catch { clearTimeout(timer); done(); }
  });
}
async function start() {
  preferencesFile = join(app.getPath("userData"), "window.json");
  await mkdir(app.getPath("userData"), { recursive: true });
  try { const value = JSON.parse(await readFile(preferencesFile, "utf8")); if (value && typeof value === "object") preferences = value; } catch {}
  let workspace = homedir();
  try { if (typeof preferences.workspace === "string" && isAbsolute(preferences.workspace) && (await stat(preferences.workspace)).isDirectory()) workspace = await realpath(preferences.workspace); } catch {}
  const launch = new URL(await startBackend(workspace)); origin = launch.origin; token = launch.searchParams.get("token");
  window = new BrowserWindow({ ...windowBounds(preferences.bounds, screen.getAllDisplays()), minWidth: 900, minHeight: 600, title: "pi desk", show: false,
    webPreferences: { preload: join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, nodeIntegrationInSubFrames: false, webSecurity: true, allowRunningInsecureContent: false } });
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => { try { if (new URL(url).origin !== origin) event.preventDefault(); } catch { event.preventDefault(); } });
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  const session = window.webContents.session;
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    let trusted = false; try { trusted = contents === window.webContents && new URL(details.requestingUrl).origin === origin && details.isMainFrame; } catch {}
    callback(!!trusted && permission === "clipboard-sanitized-write");
  });
  session.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => contents === window.webContents && requestingOrigin === origin && details.isMainFrame && permission === "clipboard-sanitized-write");
  // Blob HTML 的手动脚本开关需要 inline；其 sandbox 和独立 CSP 仍限制子框架。
  const csp = "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data:; connect-src 'self' ws://127.0.0.1:4317; worker-src 'self' blob:; frame-src 'self' blob:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'";
  session.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    if (details.resourceType === "mainFrame" && details.url.startsWith(`${origin}/`)) headers["Content-Security-Policy"] = [csp];
    callback({ responseHeaders: headers });
  });
  const authorize = (event) => { if (!trustedSender(event, window, origin)) throw new Error("不允许这个页面调用原生功能"); };
  ipcMain.handle("desktop:pick-directory", async (event) => {
    authorize(event); const result = await dialog.showOpenDialog(window, { title: "选择项目文件夹", defaultPath: preferences.workspace || workspace, properties: ["openDirectory"] });
    if (result.canceled || !result.filePaths[0]) return undefined;
    const cwd = await realpath(result.filePaths[0]); preferences.workspace = cwd; await savePreferences(); return { cwd };
  });
  ipcMain.handle("desktop:open-external", async (event, url) => {
    authorize(event);
    // 插件来源仅允许规范化的 GitHub 仓库，不给网页任意协议/本地文件能力。
    if (typeof url !== "string" || !/^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(url) || url.split("/").some((part) => part === "." || part === "..")) throw new Error("只允许打开 GitHub 插件仓库");
    await shell.openExternal(url); return { ok: true };
  });
  ipcMain.handle("desktop:reveal", async (event, cwd, path) => {
    authorize(event);
    if (typeof cwd !== "string" || typeof path !== "string" || cwd.length > 4096 || path.length > 4096) throw new Error("文件路径格式不正确");
    // 原生接口同样经过后台的已打开项目/敏感路径/realpath 校验，不给网页任意文件能力。
    const response = await fetch(`${origin}/api/file-info?${new URLSearchParams({ cwd, path })}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error("这个文件不允许在 Finder 中显示");
    const file = await response.json(); shell.showItemInFolder(file.path); return { ok: true };
  });
  window.once("ready-to-show", () => window.show());
  let saving;
  const remember = () => { if (!window.isDestroyed()) { preferences.bounds = window.getNormalBounds(); preferences.maximized = window.isMaximized(); } };
  for (const event of ["resize", "move"]) window.on(event, () => { clearTimeout(saving); saving = setTimeout(() => { remember(); void savePreferences(); }, 400); });
  window.on("close", () => { clearTimeout(saving); remember(); void savePreferences(); });
  if (preferences.maximized) window.maximize();
  await window.loadURL(launch.toString());
}
