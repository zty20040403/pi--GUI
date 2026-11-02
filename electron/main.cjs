const { app, BrowserWindow, dialog, ipcMain, screen, shell } = require("electron");
const { spawn } = require("node:child_process");
const { mkdir, readFile, realpath, rename, stat, writeFile } = require("node:fs/promises");
const { homedir } = require("node:os");
const { isAbsolute, join, resolve } = require("node:path");
const { childEnvironment, LaunchUrl, loadWindow, windowBounds, trustedSender, preferenceValue, publicPreferences } = require("./runtime.cjs");
const { installMenu } = require("./menu.cjs");

app.setName("pi desk");
let window; let backend; let origin; let token; let preferences = {}; let quitting = false; let closed = false;
let preferencesFile; let preferencesWrite = Promise.resolve(); let checkingQuit = false;
function revealWindow() { if (!quitting && window && !window.isDestroyed()) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } }
// 显式命令行参数只用于独立配置目录（也是验收隔离），不读取私人对话到测试截图。
const customData = app.commandLine.getSwitchValue("user-data-dir");
if (customData && isAbsolute(customData)) app.setPath("userData", customData);
const single = app.requestSingleInstanceLock();
if (!single) app.quit();
else {
  app.on("second-instance", revealWindow);
  app.on("activate", revealWindow);
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
  app.on("before-quit", (event) => {
    if (closed) return;
    event.preventDefault(); if (quitting || checkingQuit) return; checkingQuit = true;
    void quitSafely().finally(() => { checkingQuit = false; });
  });
  void app.whenReady().then(start).catch(async (error) => {
    // 不把后台原始输出、启动口令或配置写入错误窗口/日志。
    if (quitting) return;
    dialog.showErrorBox("pi desk 无法启动", error instanceof Error ? error.message : "启动失败");
    app.quit();
  });
}
async function quitSafely() {
  try {
    let working = false; let unknown = false;
    if (backend && backend.exitCode === null && backend.signalCode === null) {
      try {
        if (!origin || !token) throw new Error("尚未连接");
        const response = await fetch(`${origin}/api/activity`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3000) });
        if (!response.ok) throw new Error("状态读取失败"); working = (await response.json()).working === true;
      } catch { unknown = true; }
    }
    if (working || unknown) {
      revealWindow(); const options = { type: "warning", title: "退出 pi desk", message: working ? "仍有项目在工作，要退出吗？" : "无法确认后台是否仍在工作，要退出吗？", detail: "退出会停止正在回复、等待审批或安装插件的操作。已经保存的对话不会删除。", buttons: ["继续使用", "退出 pi desk"], defaultId: 0, cancelId: 0, noLink: true };
      const answer = window && !window.isDestroyed() ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options);
      if (answer.response !== 1) return;
    }
    quitting = true;
    if (window && !window.isDestroyed()) { preferences.bounds = window.getNormalBounds(); preferences.maximized = window.isMaximized(); }
    await savePreferences(); await stopBackend(); await preferencesWrite.catch(() => {}); closed = true; app.quit();
  } catch { quitting = false; dialog.showErrorBox("暂时无法退出", "请先停止正在进行的工作，再尝试退出 pi desk。"); }
}
async function savePreferences() {
  if (!preferencesFile) return;
  const content = JSON.stringify(preferences);
  preferencesWrite = preferencesWrite.catch(() => {}).then(async () => { await writeFile(`${preferencesFile}.tmp`, content, { mode: 0o600 }); await rename(`${preferencesFile}.tmp`, preferencesFile); });
  await preferencesWrite.catch(() => {});
}
async function startBackend(workspace) {
  const env = childEnvironment(process.env, homedir()); env.PI_DESK_WORKSPACE = workspace;
  // Electron 自带的 Node；Finder 的 PATH 中即使没有 node，也可运行后台。
  env.ELECTRON_RUN_AS_NODE = "1";
  env.PI_DESK_PORT = "0";
  const root = resolve(__dirname, "..");
  env.PI_DESK_BUILTIN_PI = app.isPackaged ? join(process.resourcesPath, "runtime/engine/node_modules/@earendil-works/pi-coding-agent") : join(root, "node_modules/@earendil-works/pi-coding-agent");
  if (app.isPackaged) env.PI_DESK_ENGINE_BIN = join(process.resourcesPath, "runtime/engine/bin");
  const args = app.isPackaged ? [join(process.resourcesPath, "runtime/server/index.mjs")] : ["--import", "tsx", join(root, "server/index.ts")];
  return new Promise((done, reject) => {
    const decoder = new LaunchUrl(); let started = false;
    const child = spawn(process.execPath, args, { cwd: app.isPackaged ? workspace : root, env, detached: true, stdio: ["ignore", "pipe", "pipe"] }); backend = child;
    const timeout = setTimeout(() => reject(new Error("后台启动超过 30 秒，请退出后重新打开应用。")), 30000);
    child.once("error", () => { clearTimeout(timeout); reject(new Error("无法启动应用自带的后台，请重新安装 pi desk 后再试。")); });
    child.stderr.on("data", () => {}); // 消费诊断流，不保存可能包含私人配置的原文。
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (started) return;
      try { const url = decoder.feed(chunk); if (url) { started = true; clearTimeout(timeout); done(url); } }
      catch { clearTimeout(timeout); reject(new Error("后台启动输出异常，请重启应用。")); }
    });
    child.once("exit", () => {
      clearTimeout(timeout);
      if (!started) reject(new Error("应用自带的后台未能启动，请退出后重新打开；仍失败时请重新安装 pi desk。"));
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
  app.dock?.setIcon(join(__dirname, "resources/icon.png"));
  app.setAboutPanelOptions({ applicationName: "pi desk", applicationVersion: app.getVersion(), version: `Electron ${process.versions.electron}`, credits: "内置 pi 1.4.0 · 界面参考 pi-gui（MIT）", iconPath: join(__dirname, "resources/icon.png") });
  installMenu((action) => { revealWindow(); if (!quitting && window && !window.isDestroyed()) window.webContents.send("desktop:action", action); });
  preferencesFile = join(app.getPath("userData"), "window.json");
  await mkdir(app.getPath("userData"), { recursive: true });
  try { const value = JSON.parse(await readFile(preferencesFile, "utf8")); if (value && typeof value === "object") preferences = value; } catch {}
  let workspace = homedir();
  try { if (typeof preferences.workspace === "string" && isAbsolute(preferences.workspace) && (await stat(preferences.workspace)).isDirectory()) workspace = await realpath(preferences.workspace); } catch {}
  const launch = new URL(await startBackend(workspace)); origin = launch.origin; token = launch.searchParams.get("token");
  window = new BrowserWindow({ ...windowBounds(preferences.bounds, screen.getAllDisplays()), minWidth: 900, minHeight: 600, title: "pi desk", show: false, ...(process.platform === "darwin" ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 14, y: 16 } } : {}),
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
  const csp = `default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data:; connect-src 'self' ${origin.replace(/^http:/, "ws:")}; worker-src 'self' blob:; frame-src 'self' blob:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'`;
  session.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    if (details.resourceType === "mainFrame" && details.url.startsWith(`${origin}/`)) headers["Content-Security-Policy"] = [csp];
    callback({ responseHeaders: headers });
  });
  const authorize = (event) => { if (!trustedSender(event, window, origin)) throw new Error("不允许这个页面调用原生功能"); };
  ipcMain.handle("desktop:load-preferences", (event) => { authorize(event); return publicPreferences(preferences.ui); });
  ipcMain.handle("desktop:save-preference", async (event, key, value) => { authorize(event); const text = preferenceValue(key, value); preferences.ui = { ...publicPreferences(preferences.ui), [key]: text }; await savePreferences(); });
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
  window.on("close", (event) => { clearTimeout(saving); remember(); void savePreferences(); if (process.platform === "darwin" && !quitting) { event.preventDefault(); window.hide(); } });
  if (preferences.maximized) window.maximize();
  await loadWindow(window, launch.toString());
}
