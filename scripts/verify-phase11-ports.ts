import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { _electron, expect, type Page } from "@playwright/test";
import { startBackend } from "./server-runner.js";
import { expectModelReady } from "./ui-helpers.js";
import { logText } from "../server/privacy.js";
import { macAppPath } from "./desktop-paths.js";
const exec = promisify(execFile);
async function idle(page: Page) { await expect(page.getByTestId("connection-status")).toContainText("已连接", { timeout: 40000 }); await expectModelReady(page); }
async function closed(port: number) { await expect.poll(() => new Promise<boolean>((done) => { const socket = createConnection({ host: "127.0.0.1", port }); socket.once("connect", () => { socket.destroy(); done(false); }); socket.once("error", () => done(true)); }), { timeout: 10000 }).toBe(true); }
async function main() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "pi-desk-phase11-ports-"))); const profile = join(root, "profile"); const project = join(root, "project"); const appSettings = join(root, "app/settings.json");
  let backend: Awaited<ReturnType<typeof startBackend>> | undefined; let app: Awaited<ReturnType<typeof _electron.launch>> | undefined; let occupied: ReturnType<typeof createServer> | undefined;
  const packaged = process.env.PI_DESK_VERIFY_PACKAGED === "1";
  const executable = packaged ? join(macAppPath, "Contents/MacOS/pi desk") : resolve("node_modules/electron/dist/Electron.app/Contents/MacOS/Electron");
  const args = [...(packaged ? [] : [resolve(".")]), `--user-data-dir=${profile}`]; const env: NodeJS.ProcessEnv = { ...process.env, PI_DESK_APP_SETTINGS_FILE: appSettings, PATH: "/usr/bin:/bin" }; delete env.ELECTRON_RUN_AS_NODE;
  const launch = () => _electron.launch({ executablePath: executable, args, env: Object.fromEntries(Object.entries(env).filter((row): row is [string, string] => typeof row[1] === "string")), timeout: 45000 });
  try {
    await mkdir(profile); await mkdir(project); await writeFile(join(profile, "window.json"), JSON.stringify({ workspace: project }));
    backend = await startBackend({ production: true, env: { PI_DESK_PORT: "4317", PI_DESK_APP_SETTINGS_FILE: join(root, "browser/settings.json") } }); assert.equal(new URL(backend.url).port, "4317");
    app = await launch(); let page = await app.firstWindow(); const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message)); await idle(page); const original = page.url(); const firstPort = Number(new URL(original).port); assert.notEqual(firstPort, 4317);
    const width = page.getByRole("separator", { name: "调整对话列表宽度", exact: true }); await width.focus(); await width.press("ArrowRight"); const savedWidth = Number(await width.getAttribute("aria-valuenow"));
    await expect.poll(async () => { const data = JSON.parse(await readFile(join(profile, "window.json"), "utf8")); return JSON.parse(data.ui?.["pi-desk.layout"] ?? "{}").width; }).toBe(savedWidth);
    await assert.rejects(page.evaluate(() => window.piDeskDesktop!.savePreference("pi-desk.token", '"must-not-persist"')), /不保存口令/);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
    await new Promise<void>((done, reject) => { const child = spawn(executable, args, { env, stdio: "ignore" }); const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("第二次打开没有退出额外进程")); }, 20000); child.once("error", (error) => { clearTimeout(timer); reject(error); }); child.once("exit", (code) => { clearTimeout(timer); code === 0 ? done() : reject(new Error("第二次打开退出状态不正确")); }); });
    await expect.poll(() => app!.evaluate(({ BrowserWindow }) => { const windows = BrowserWindow.getAllWindows(); return windows.length === 1 && !windows[0].isMinimized() && windows[0].isVisible(); })).toBe(true); assert.equal(page.url(), original); assert.equal(app.windows().length, 1);
    await page.getByLabel("搜索对话").fill(root.split("/").at(-1)!); await mkdir(resolve(".pi-desk/verification"), { recursive: true }); await page.screenshot({ path: resolve(`.pi-desk/verification/phase-11-ports-${packaged ? "packaged" : "dev"}.png`) });
    await app.close(); app = undefined; await closed(firstPort);
    // 占住旧端口，确保重开真的换了 Origin，而不是偶然复用同一个端口。
    occupied = createServer((_req, res) => { res.writeHead(410); res.end(); }); await new Promise<void>((done, reject) => { occupied!.once("error", reject); occupied!.listen(firstPort, "127.0.0.1", done); });
    app = await launch(); page = await app.firstWindow(); page.on("pageerror", (error) => errors.push(error.message)); await idle(page); const secondPort = Number(new URL(page.url()).port); assert.notEqual(secondPort, firstPort); assert.notEqual(secondPort, 4317);
    await expect(page.getByRole("separator", { name: "调整对话列表宽度", exact: true })).toHaveAttribute("aria-valuenow", String(savedWidth));
    const preferences = JSON.parse(await readFile(join(profile, "window.json"), "utf8")); assert.ok(!JSON.stringify(preferences).includes("token")); assert.ok(!JSON.stringify(preferences).includes("must-not-persist")); assert.ok(JSON.parse(preferences.ui["pi-desk.projects"]).some((row: any) => row.cwd === project)); assert.deepEqual(errors, []);
    await app.close(); app = undefined; await closed(secondPort);
    await writeFile(resolve(`.pi-desk/verification/phase-11-ports-${packaged ? "packaged" : "dev"}-summary.json`), JSON.stringify({ packaged, npmStartOn4317: true, dynamicPort: true, singleInstance: true, restoresMinimizedWindow: true, preferencePersistenceAcrossOrigins: true, noStoredToken: true, bothBackendsStopped: true }, null, 2));
    console.log(`${packaged ? "打包 App" : "开发 Electron"}端口验收通过：npm start 占用 4317 时仍连接真实 pi，重复启动恢复原窗口，真正换端口后布局和最近项目仍在，退出回收自己的后台。`);
  } finally { await app?.close(); if (occupied) await new Promise<void>((done) => occupied!.close(() => done())); await backend?.stop(); await exec("trash", [root]); }
}
void main().catch((error) => { console.error(`第 11 阶段端口验收失败：${logText(String(error))}`); process.exitCode = 1; });
