import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { _electron, chromium, expect, type Page } from "@playwright/test";
import { SESSION_KEY } from "../src/api/storage.js";
import { logText } from "../server/privacy.js";
import { chooseModel, setThinking, expectModelReady } from "./ui-helpers.js";
const exec = promisify(execFile); const appPath = resolve("release/mac-arm64/pi desk.app"); const artifacts = resolve(".pi-desk/verification");
async function idle(page: Page) { await expect(page.getByTestId("connection-status")).toContainText("已连接", { timeout: 30000 }); await expectModelReady(page); }
async function port() { const server = createServer(); await new Promise<void>((done) => server.listen(0, "127.0.0.1", done)); const value = (server.address() as { port: number }).port; await new Promise<void>((done) => server.close(() => done())); return value; }
// 不用 fetch 的 keep-alive 池探测正在退出的进程：Node 24.16 的 undici 曾在关闭 socket 时抛出未捕获的 setTypeOfService EINVAL。
async function httpReady(url: string): Promise<boolean> { return new Promise((done) => { const request = get(url, { agent: false }, (response) => { response.resume(); done(response.statusCode === 200); }); request.on("error", () => done(false)); request.setTimeout(1000, () => request.destroy()); }); }
async function noBackend() { await expect.poll(() => new Promise<boolean>((done) => {
  const socket = createConnection({ host: "127.0.0.1", port: 4317 });
  socket.once("connect", () => { socket.destroy(); done(false); });
  socket.once("error", (error: NodeJS.ErrnoException) => done(error.code === "ECONNREFUSED"));
  socket.setTimeout(1000, () => { socket.destroy(); done(false); });
}), { timeout: 10000 }).toBe(true); }
async function saved(page: Page) { return page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) ?? "{}").sessionPath as string | undefined, SESSION_KEY); }
async function main() {
  await mkdir(artifacts, { recursive: true }); const root = await realpath(await mkdtemp(join(tmpdir(), "pi-gui-phase6-"))); const project = join(root, "project"); const other = join(root, "other");
  await mkdir(project); await mkdir(other); await writeFile(join(project, "sample.md"), "# DESKTOP PREVIEW OK\n"); await writeFile(join(other, "other.txt"), "NATIVE FOLDER FIXTURE");
  const sessions = new Set<string>(); let cost = 0; let errors: string[] = []; let changedSession: string | undefined;
  const verifyChanges = process.env.PI_DESK_VERIFY_CHANGES === "1";
  try {
    await noBackend();
    const devData = join(root, "dev-profile"); await mkdir(devData); await writeFile(join(devData, "window.json"), JSON.stringify({ workspace: project }));
    const dev = await _electron.launch({ args: [resolve("."), `--user-data-dir=${devData}`], env: { ...process.env, PATH: "/usr/bin:/bin" }, timeout: 30000 });
    try {
      const page = await dev.firstWindow(); await idle(page);
      const security = await dev.evaluate(({ BrowserWindow, app }) => ({ version: process.versions.electron, windows: BrowserWindow.getAllWindows().length, packaged: app.isPackaged }));
      assert.equal(security.version, "35.7.5"); assert.equal(security.windows, 1); assert.equal(security.packaged, false);
      assert.deepEqual(await page.evaluate(() => Object.keys(window.piDeskDesktop ?? {}).sort()), ["openExternal", "pickDirectory", "reveal"]); assert.equal(await page.evaluate(() => typeof (window as any).require), "undefined");
      // 原生函数的调用接线用明确替身，避免自动控制用户的原生文件夹选择器。
      await dev.evaluate(({ dialog, shell }, cwd) => {
        (globalThis as any).nativeCalls = [];
        dialog.showOpenDialog = (async () => { (globalThis as any).nativeCalls.push("pick"); return { canceled: false, filePaths: [cwd] }; }) as typeof dialog.showOpenDialog;
        shell.showItemInFolder = (path) => { (globalThis as any).nativeCalls.push(path); };
        shell.openExternal = async (url) => { (globalThis as any).nativeCalls.push(url); };
      }, other);
      await page.getByRole("button", { name: "打开文件夹", exact: true }).click(); await idle(page);
      await expect(page.getByRole("treeitem", { name: "预览 other.txt", exact: true })).toBeVisible();
      await page.evaluate(async ({ cwd, path }) => { await window.piDeskDesktop!.reveal(cwd, path); }, { cwd: other, path: join(other, "other.txt") });
      assert.deepEqual(await dev.evaluate(() => (globalThis as any).nativeCalls), ["pick", join(other, "other.txt")]);
      await assert.rejects(page.evaluate(async (cwd) => window.piDeskDesktop!.reveal(cwd, "/etc/hosts"), other), /不允许/);
      await page.evaluate(() => window.piDeskDesktop!.openExternal("https://github.com/example/pi-plugin"));
      assert.equal((await dev.evaluate(() => (globalThis as any).nativeCalls)).at(-1), "https://github.com/example/pi-plugin");
      for (const url of ["file:///etc/hosts", "https://example.invalid", "https://github.com/a/../b"]) await assert.rejects(page.evaluate((url) => window.piDeskDesktop!.openExternal(url), url), /只允许/);
      await dev.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.setBounds({ x: 30, y: 40, width: 1300, height: 800 }); }); await page.waitForTimeout(500);
      const path = await saved(page); if (path) sessions.add(path);
    } finally { await dev.close(); }
    await noBackend(); const preferences = JSON.parse(await readFile(join(devData, "window.json"), "utf8")); assert.equal(preferences.workspace, other); assert.equal(preferences.bounds.width, 1300); assert.ok(!JSON.stringify(preferences).includes("token"));
    console.log("开发 Electron 入口通过：Finder 最小 PATH、真实 pi 连接、上下文隔离/沙箱、原生文件/仓库浏览器接线与越界拒绝、窗口位置保存、退出回收后台（无模型调用）。");
    // 真正通过 macOS LaunchServices 打开 .app，等同 Finder 双击，不直接执行包里的二进制。
    const installed = join(root, "installed", "pi desk.app"); await mkdir(join(root, "installed")); await exec("ditto", [appPath, installed]);
    const packagedData = join(root, "packaged-profile"); await mkdir(packagedData); await writeFile(join(packagedData, "window.json"), JSON.stringify({ workspace: project })); const debugPort = await port();
    await exec("open", ["-n", installed, "--args", `--user-data-dir=${packagedData}`, `--remote-debugging-port=${debugPort}`]);
    let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
    try {
      await expect.poll(() => httpReady(`http://127.0.0.1:${debugPort}/json/version`), { timeout: 30000 }).toBe(true);
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
      await expect.poll(() => browser!.contexts()[0]?.pages().length ?? 0, { timeout: 30000 }).toBeGreaterThan(0);
      const page = browser.contexts()[0].pages()[0]; page.on("pageerror", (error) => errors.push(error.message)); await idle(page);
      await page.getByLabel("搜索对话").fill(root.split("/").at(-1)!);
      await chooseModel(page, "cliproxy", "gpt-6-luna"); await idle(page); await setThinking(page, "low"); await idle(page);
      const replies: any[] = []; page.on("websocket", (socket) => socket.on("framereceived", ({ payload }) => { try { const event = JSON.parse(payload.toString()); if (event.record?.type === "message_end" && event.record.message?.role === "assistant") replies.push(event.record.message); } catch {} }));
      // 现有 WS 已建立：通过刷新让监听附在新连接上，再发唯一一次模型请求。
      await page.reload(); await idle(page);
      // 尚未保存的空对话刷新可能被 pi 重新创建；在最后一次刷新之后再确认模型。
      await chooseModel(page, "cliproxy", "gpt-6-luna"); await idle(page);
      await setThinking(page, "low"); await idle(page);
      await expect(page.getByTestId("model-trigger")).toHaveAttribute("data-provider", "cliproxy");
      await expect(page.getByTestId("model-trigger")).toHaveAttribute("data-model", "gpt-6-luna");
      await expect(page.getByTestId("model-trigger")).toHaveAttribute("data-thinking", "low");
      await page.getByLabel("消息", { exact: true }).fill("只回复 桌面验收通过，不要工具。"); await page.getByLabel("消息", { exact: true }).press("Enter");
      await expect(page.locator("article[data-role=assistant]").last()).toContainText("桌面验收通过", { timeout: 180000 }); await expect(page.getByRole("button", { name: "停止", exact: true })).toHaveCount(0, { timeout: 30000 }); await idle(page);
      assert.ok(replies.length); for (const reply of replies) { assert.equal(reply.provider, "cliproxy"); assert.equal(reply.model, "gpt-6-luna"); assert.equal(reply.thinkingLevel, "low"); }
      cost = Number((await page.getByTestId("session-cost").innerText()).match(/\$([\d.]+)/)?.[1] || 0); const path = await saved(page); if (path) sessions.add(path);
      await page.getByRole("treeitem", { name: "预览 sample.md", exact: true }).click(); await expect(page.locator(".file-preview")).toContainText("DESKTOP PREVIEW OK");
      // 这里真正调用 shell.showItemInFolder（没有替身），Finder 选择的是合成文件。
      await page.getByRole("button", { name: "在 Finder 中显示", exact: true }).click();
      await page.getByLabel("搜索对话").fill(root.split("/").at(-1)!);
      if (verifyChanges) {
        await page.getByLabel("消息", { exact: true }).fill("只用 edit 把 sample.md 中 DESKTOP PREVIEW OK 改为 DESKTOP CHANGE OK，其余内容不变。完成后简短回复。"); await page.getByLabel("消息", { exact: true }).press("Enter");
        const card = page.getByTestId("turn-changes"); await expect(card).toHaveCount(1, { timeout: 180000 }); await expect(card).toContainText("改动了 1 个文件"); await expect(card.locator("header .change-added")).toHaveText("+1"); await expect(card.locator("header .change-removed")).toHaveText("−1");
        await card.locator('[data-change-path="sample.md"]').click(); await expect(page.getByTestId("review-panel").locator(".diff-row.added")).toContainText("DESKTOP CHANGE OK");
        changedSession = await saved(page); assert.ok(changedSession); sessions.add(changedSession);
        cost = Number((await page.getByTestId("session-cost").innerText()).match(/\$([\d.]+)/)?.[1] || 0);
        await page.screenshot({ path: join(artifacts, "phase-10-desktop-diff.png") });
      }
      await page.screenshot({ path: join(artifacts, "phase-6-desktop.png") }); assert.deepEqual(errors, []);
      console.log(`Mac .app 验收通过：LaunchServices 实际打开、自带后台/网页/权限插件、luna/low 回复、Markdown 预览和真实 Finder 显示；聊天 $${cost.toFixed(6)}。`);
    } finally {
      if (browser) { const page = browser.contexts()[0]?.pages()[0]; if (page) await page.evaluate(() => window.close()).catch(() => {}); await browser.close(); }
      await noBackend();
    }
    if (changedSession) {
      const reopenPort = await port(); await exec("open", ["-n", installed, "--args", `--user-data-dir=${packagedData}`, `--remote-debugging-port=${reopenPort}`]);
      let reopened: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
      try {
        await expect.poll(() => httpReady(`http://127.0.0.1:${reopenPort}/json/version`), { timeout: 30000 }).toBe(true);
        reopened = await chromium.connectOverCDP(`http://127.0.0.1:${reopenPort}`); await expect.poll(() => reopened!.contexts()[0]?.pages().length ?? 0, { timeout: 30000 }).toBeGreaterThan(0);
        const page = reopened.contexts()[0].pages()[0]; await idle(page); await page.getByLabel("搜索对话").fill(root.split("/").at(-1)!);
        await page.locator(`[data-session-path="${changedSession}"] .session-open`).click(); await idle(page);
        await expect(page.getByTestId("turn-changes")).toHaveCount(1); await page.getByTestId("turn-changes").locator('[data-change-path="sample.md"]').click(); await expect(page.getByTestId("review-panel").getByTestId("diff-view")).toContainText("DESKTOP CHANGE OK");
        await page.screenshot({ path: join(artifacts, "phase-10-desktop-reopened.png") });
        console.log("第 10 阶段打包 App 验收通过：真实 edit 的 +1/-1、打包快照扩展、退出并通过 LaunchServices 重开 App 后恢复同一张历史卡片和 diff。");
      } finally { if (reopened) { const page = reopened.contexts()[0]?.pages()[0]; if (page) await page.evaluate(() => window.close()).catch(() => {}); await reopened.close(); } await noBackend(); }
    }
    await writeFile(join(artifacts, "phase-6-mac-summary.json"), JSON.stringify({ macApp: true, launchServices: true, chatCost: cost, model: "cliproxy/gpt-6-luna", thinkingLevel: "low", windowPersistence: true, nativeWiring: true, realFinderCall: true, changesCapturedAndAppReopened: !!changedSession, windows: "pending user verification" }, null, 2));
    console.log("Mac 必要验收完成；Windows 仍须用户在真机确认，不算已通过。");
  } finally { for (const path of sessions) { try { await stat(path); await exec("trash", [path]); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } } await exec("trash", [root]); }
}
void main().catch((error: Error) => { console.error(`桌面验收失败：${logText(error.message)}`); process.exitCode = 1; });
