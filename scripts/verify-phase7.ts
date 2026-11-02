import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, realpath, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { chromium, expect, type Page } from "@playwright/test";
import { piEnvironment } from "../server/pi-process.js";
import { logText } from "../server/privacy.js";
import { SESSIONS_DIR } from "../server/sessions.js";
import { SESSION_KEY } from "../src/api/storage.js";
import { startBackend } from "./server-runner.js";
import { chooseModel, setThinking, expectModelReady } from "./ui-helpers.js";
const exec = promisify(execFile);
const artifacts = resolve(".pi-desk/verification");
async function idle(page: Page) {
  await expect(page.getByTestId("connection-status")).toContainText("已连接", { timeout: 30000 });
  await expect(page.getByRole("button", { name: "停止", exact: true })).toHaveCount(0, { timeout: 150000 });
  await expectModelReady(page);
}
function terminal(cwd: string, dir: string, id: string, marker: string) {
  const child = spawn("python3", ["scripts/check-terminal-sync.py", cwd, dir, id, marker], { env: piEnvironment(), stdio: ["pipe", "pipe", "pipe"] });
  const closed = new Promise<void>((done) => child.once("close", () => done()));
  let buffer = ""; const inbox: any[] = []; const waiting: { resolve: (value: any) => void; reject: (error: Error) => void }[] = [];
  const fail = () => { for (const waiter of waiting.splice(0)) waiter.reject(new Error("真正交互式终端测试退出，原始内容已省略")); };
  child.on("error", fail); child.on("close", fail); child.stderr.on("data", () => {});
  child.stdout.setEncoding("utf8"); child.stdout.on("data", (chunk: string) => {
    buffer += chunk; let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const value = JSON.parse(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1);
      const waiter = waiting.shift(); if (waiter) waiter.resolve(value); else inbox.push(value);
    }
  });
  const next = () => inbox.length ? Promise.resolve(inbox.shift()) : new Promise<any>((resolve, reject) => waiting.push({ resolve, reject }));
  return { next, send: (message: string, expected: string) => { child.stdin.write(JSON.stringify({ op: "send", message, expect: expected }) + "\n"); return next(); },
    stop: async () => { if (child.exitCode === null) child.stdin.end(JSON.stringify({ op: "close" }) + "\n"); const timer = setTimeout(() => child.kill("SIGTERM"), 5000); try { await closed; } finally { clearTimeout(timer); } } };
}
async function screenshots(page: Page, name: string) {
  for (const theme of ["dark", "light"] as const) for (const width of [1440, 1024]) {
    await page.emulateMedia({ colorScheme: theme }); await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "窗口不能横向溢出");
    await page.screenshot({ path: join(artifacts, `phase-7-${name}-${theme}-${width}.png`) });
  }
}
async function main() {
  await mkdir(artifacts, { recursive: true }); const root = await realpath(await mkdtemp(join(tmpdir(), "pi-desk-phase7-")));
  await writeFile(join(root, "README.txt"), "Synthetic terminal synchronization fixture\n");
  const id = `desk-sync-${randomUUID()}`; const sessionDir = join(SESSIONS_DIR, `--${id}--`); await mkdir(sessionDir, { recursive: true });
  const backend = await startBackend({ production: true }); const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  await context.addInitScript(({ key, cwd }) => { if (window === window.top) sessionStorage.setItem(key, JSON.stringify({ cwd })); }, { key: SESSION_KEY, cwd: root });
  const page = await context.newPage(); const errors: string[] = []; const owned = new Set<string>(); const wire: any[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("websocket", (socket) => socket.on("framereceived", ({ payload }) => { const message = JSON.parse(payload.toString()); wire.push(message); if (message.cwd === root && message.op === "opened" && message.state.sessionFile) owned.add(message.state.sessionFile); }));
  let tui: ReturnType<typeof terminal> | undefined;
  try {
    await page.goto(backend.url); await idle(page); await page.getByLabel("搜索对话").fill(basename(root));
    if (await page.getByRole("button", { name: "隐藏文件面板", exact: true }).count()) await page.getByRole("button", { name: "隐藏文件面板", exact: true }).click();
    const first = `TERMINAL FIRST ${id}`; tui = terminal(root, sessionDir, id, first);
    const ready = await tui.next(); assert.equal(ready.ready, true); owned.add(ready.sessionPath);
    const row = page.locator(`.session-row[data-session-path=${JSON.stringify(ready.sessionPath)}]`);
    await expect(row).toContainText(first, { timeout: 5000 }); assert.ok(wire.some((message) => message.op === "projects_changed"));
    console.log("同步验收 1：真正交互式终端 pi 创建并回复，App 左栏 5 秒内自动出现，未手动刷新。");
    await row.locator(".session-open").click(); await idle(page); await expect(page.locator("article[data-role=assistant]").last()).toContainText(first);
    const draft = "重新载入后不能丢失的草稿"; await page.getByLabel("消息", { exact: true }).fill(draft);
    const second = `TERMINAL SECOND ${id}`; await tui.send(`只回复 ${second}，不要工具。`, second);
    await expect(page.getByTestId("external-change-banner")).toBeVisible({ timeout: 5000 }); await expect(page.getByRole("button", { name: "发送", exact: true })).toBeDisabled();
    await page.getByLabel("消息", { exact: true }).press("Enter"); await expect(page.getByLabel("消息", { exact: true })).toHaveValue(draft);
    await screenshots(page, "sync");
    // 终端退出时，插件还可能写入 session_shutdown 状态；先退出，再载入最终的完整文件。
    await tui.stop(); tui = undefined;
    await page.getByRole("button", { name: "重新载入", exact: true }).click(); await idle(page);
    await expect(page.getByTestId("external-change-banner")).toHaveCount(0); await expect(page.locator("article[data-role=assistant]").last()).toContainText(second); await expect(page.getByLabel("消息", { exact: true })).toHaveValue(draft);
    await expect(page.getByRole("button", { name: "发送", exact: true })).toBeEnabled();
    console.log("同步验收 2：App/终端同时打开同一对话，终端再发一句；App 黄色提示、按钮/Enter 禁止发送，switch_session 后看到终端回复且草稿保留。");
    // 重新载入以后真正从 App 回复，不能把自己的持久化当成外部写入。
    await chooseModel(page, "cliproxy", "gpt-6-luna"); await idle(page); await setThinking(page, "low"); await idle(page);
    await page.getByLabel("消息", { exact: true }).fill("只回复 APP SELF SYNC OK，不要工具。"); await page.getByLabel("消息", { exact: true }).press("Enter");
    await expect(page.locator("article[data-role=assistant]").last()).toContainText("APP SELF SYNC OK", { timeout: 150000 }); await idle(page); await page.waitForTimeout(1000); await expect(page.getByTestId("external-change-banner")).toHaveCount(0);
    assert.deepEqual(errors, []); await writeFile(join(artifacts, "phase-7-sync-summary.json"), JSON.stringify({ terminalNewSession: true, withinFiveSeconds: true, simultaneous: true, blockedButtonAndEnter: true, reloaded: true, draftPreserved: true, selfWriteNotMisclassified: true, pageErrors: 0 }, null, 2));
    console.log("同步验收 3：重新载入后 App 用 Luna/low 真正回复，自身写入不误报。深浅色 1440/1024 截图已保存。");
  } finally {
    await tui?.stop(); await browser.close(); await backend.stop();
    for (const path of owned) { try { await stat(path); await exec("trash", [path]); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
    await exec("trash", [sessionDir, root]);
  }
}
void main().catch((error: Error) => { console.error(`第 7 阶段验收失败：${logText(error.message)}`); process.exitCode = 1; });
