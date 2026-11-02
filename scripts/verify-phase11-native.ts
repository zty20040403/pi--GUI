import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { _electron, expect, type Page } from "@playwright/test";
import { SESSION_KEY } from "../src/api/storage.js";
import { chooseModel, expectModelReady, setThinking } from "./ui-helpers.js";
import { macAppPath } from "./desktop-paths.js";
import { logText } from "../server/privacy.js";
const exec = promisify(execFile); const artifacts = resolve(".pi-desk/verification");
async function idle(page: Page) { await expect(page.getByTestId("connection-status")).toContainText("已连接", { timeout: 40000 }); await expectModelReady(page); }
async function main() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "pi-desk-native-"))); const project = join(root, "project"); const profile = join(root, "profile"); const settings = join(root, "settings.json"); const packaged = process.env.PI_DESK_VERIFY_PACKAGED === "1"; const suffix = packaged ? "packaged" : "dev"; const sessions = new Set<string>(); const errors: string[] = [];
  let app: Awaited<ReturnType<typeof _electron.launch>> | undefined;
  try {
    await mkdir(join(project, ".pi/extensions"), { recursive: true }); await mkdir(profile); await mkdir(artifacts, { recursive: true });
    await writeFile(join(project, ".pi/extensions/fixture.ts"), await readFile(resolve("scripts/fixtures/ui-extension.ts")));
    await writeFile(join(profile, "window.json"), JSON.stringify({ workspace: project })); await writeFile(settings, JSON.stringify({ engine: "builtin" }));
    app = await _electron.launch({ ...(packaged ? { executablePath: join(macAppPath, "Contents/MacOS/pi desk"), args: [`--user-data-dir=${profile}`] } : { args: [resolve("."), `--user-data-dir=${profile}`] }), env: { ...process.env, PATH: "/usr/bin:/bin", PI_DESK_APP_SETTINGS_FILE: settings }, timeout: 45000 });
    const page = await app.firstWindow(); page.on("pageerror", (error) => errors.push(error.message)); await idle(page); const port = Number(new URL(page.url()).port); await page.getByLabel("搜索对话").fill(root.split("/").at(-1)!);
    assert.deepEqual(await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.map((item) => item.label)), ["pi desk", "文件", "编辑", "视图", "窗口"]);
    assert.deepEqual(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getWindowButtonPosition()), { x: 14, y: 16 });
    const menu = (id: string) => app!.evaluate(({ Menu, BrowserWindow }, id) => { const item = Menu.getApplicationMenu()!.getMenuItemById(id)!; item.click(item, BrowserWindow.getAllWindows()[0], { triggeredByAccelerator: false }); }, id);
    assert.deepEqual(await app.evaluate(({ Menu }) => ["settings", "new-session", "close-window", "quit"].map((id) => Menu.getApplicationMenu()!.getMenuItemById(id)!.accelerator)), ["CommandOrControl+,", "CommandOrControl+N", "CommandOrControl+W", "CommandOrControl+Q"]);
    await menu("settings"); await expect(page.getByRole("dialog", { name: "设置", exact: true })).toBeVisible(); await expect(page.getByTestId("engine-current")).toContainText("内置 pi（1.4.0）"); await page.getByRole("button", { name: "关闭设置", exact: true }).click();
    for (const colorScheme of ["dark", "light"] as const) for (const width of [1440, 1024]) {
      await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 950), width); await page.emulateMedia({ colorScheme });
      assert.ok((await page.locator(".sidebar-heading .brand").boundingBox())!.x >= 88); await idle(page); await page.screenshot({ animations: "disabled", path: join(artifacts, `phase-11-native-${suffix}-${colorScheme}-${width}.png`) });
    }
    // 菜单项是原生 Electron 菜单；只替换确认弹窗的回答，不替换后台忙碌状态或退出逻辑。
    await app.evaluate(({ dialog }) => { (globalThis as any).quitDialogs = []; (globalThis as any).quitAnswer = 0; dialog.showMessageBox = (async (...args: any[]) => { const options = args.at(-1); (globalThis as any).quitDialogs.push(options); return { response: (globalThis as any).quitAnswer, checkboxChecked: false }; }) as typeof dialog.showMessageBox; });
    await chooseModel(page, "cliproxy", "gpt-6-luna"); await setThinking(page, "low");
    await page.getByLabel("消息", { exact: true }).fill("只回复 原生窗口验收通过，不要调用工具。"); await page.getByLabel("消息", { exact: true }).press("Enter"); await expect(page.getByRole("button", { name: "停止", exact: true })).toBeVisible({ timeout: 20000 });
    await app.evaluate(({ app }) => app.quit());
    await expect.poll(() => app!.evaluate(() => (globalThis as any).quitDialogs.length)).toBe(1);
    assert.equal(await app.evaluate(() => (globalThis as any).quitDialogs[0].message), "仍有项目在工作，要退出吗？"); assert.equal(await app.evaluate(() => (globalThis as any).quitDialogs[0].defaultId), 0);
    await expect(page.locator("article[data-role=assistant]").last()).toContainText("原生窗口验收通过", { timeout: 180000 }); await expect(page.getByRole("button", { name: "停止", exact: true })).toHaveCount(0, { timeout: 30000 }); await idle(page);
    const sessionPath = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)!).sessionPath as string, SESSION_KEY); assert.ok(sessionPath); sessions.add(sessionPath);
    await page.getByLabel("消息", { exact: true }).fill("关窗不能丢的草稿"); assert.equal(await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById("close-window")!.role), "close"); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length === 1 && !BrowserWindow.getAllWindows()[0].isVisible())).toBe(true);
    await app.evaluate(({ app }) => app.emit("activate", {}, false)); await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(true);
    await idle(page); await expect(page.getByLabel("消息", { exact: true })).toHaveValue("关窗不能丢的草稿"); await expect(page.locator("article[data-role=assistant]").last()).toContainText("原生窗口验收通过");
    await page.getByLabel("消息", { exact: true }).fill(""); await menu("new-session"); await idle(page); await expect(page.locator("article[data-role=user]")).toHaveCount(0);
    await page.getByRole("button", { name: "收起对话列表", exact: true }).click(); assert.ok((await page.locator(".topbar button").first().boundingBox())!.x >= 88); await page.screenshot({ animations: "disabled", path: join(artifacts, `phase-11-native-${suffix}-sidebar-hidden.png`) });
    await page.getByLabel("消息", { exact: true }).fill("/desk-test-confirm"); await page.getByLabel("消息", { exact: true }).press("Enter"); await expect(page.locator(".extension-dialog")).toBeVisible({ timeout: 20000 });
    await app.evaluate(({ app }) => app.quit()); await expect.poll(() => app!.evaluate(() => (globalThis as any).quitDialogs.length)).toBe(2); await expect(page.locator(".extension-dialog")).toBeVisible(); assert.equal(await app.evaluate(() => (globalThis as any).quitDialogs[1].message), "仍有项目在工作，要退出吗？");
    await app.evaluate(() => { (globalThis as any).quitAnswer = 1; }); const close = app.waitForEvent("close", { timeout: 20000 }); await menu("quit"); await close; app = undefined;
    await expect.poll(() => new Promise<boolean>((done) => { const socket = createConnection({ host: "127.0.0.1", port }); socket.once("connect", () => { socket.destroy(); done(false); }); socket.once("error", (error: NodeJS.ErrnoException) => done(error.code === "ECONNREFUSED")); socket.setTimeout(1000, () => { socket.destroy(); done(false); }); }), { timeout: 10000 }).toBe(true);
    assert.deepEqual(errors, []); await writeFile(join(artifacts, `phase-11-native-${suffix}-summary.json`), JSON.stringify({ packaged, chineseMenus: true, settingsMenu: true, newSessionMenu: true, acceleratorsRegistered: true, shortcutKeypresses: "requires manual verification",  closeRoleRegistered: true, windowCloseEventHidesWindow: true, activateRestoresHistoryAndDraft: true, quitWarnsWhileReplying: true, quitWarnsWhilePluginPending: true, quitCancelsSafely: true, quitStopsBackend: true, dialogAnswersMocked: true, realDockClick: "requires manual verification", windowButtonsPosition: { x: 14, y: 16 } }, null, 2));
    console.log(`${suffix} 原生验收通过：中文菜单接线及快捷键登记、关窗隐藏/activate 恢复草稿、真实回复和插件等待中的退出提醒、取消不退出、确认后回收后台。原生弹窗回答使用替身，Dock 实际点击和系统快捷键另需手动确认。`);
  } finally { if (app) { await app.evaluate(({ dialog }) => { dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox; }).catch(() => {}); await app.close(); } for (const path of sessions) { try { await stat(path); await exec("trash", [path]); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } } await exec("trash", [root]); }
}
void main().catch((error) => { console.error(`第 11 阶段原生验收失败：${logText(error instanceof Error ? error.stack ?? error.message : String(error))}`); process.exitCode = 1; });
