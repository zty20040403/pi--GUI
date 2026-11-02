import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { chromium, expect, type Page } from "@playwright/test";
import { startBackend } from "./server-runner.js";
import { DeskClient } from "./ws-client.js";
import { SESSION_KEY } from "../src/api/storage.js";
import { logText } from "../server/privacy.js";
const exec = promisify(execFile); const artifacts = resolve(".pi-desk/verification");
async function shot(page: Page, name: string) {
  for (const colorScheme of ["dark", "light"] as const) for (const width of [1440, 1024]) {
    await page.emulateMedia({ colorScheme }); await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
    await expect(page.locator(".desk-layout")).toHaveCount(1);
    await page.screenshot({ path: join(artifacts, `phase-7-${name}-${colorScheme}-${width}.png`), animations: "disabled" });
  }
}
async function main() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "pi-desk-errors-"))); const cwd = join(root, "workspace"); const old = join(root, "moved-project"); const target = join(root, "replacement");
  for (const dir of [cwd, old, target, join(root, "sessions/saved"), join(root, "agent"), artifacts]) await mkdir(dir, { recursive: true });
  const path = join(root, "sessions/saved/fixture.jsonl"); const contents = JSON.stringify({ type: "session", version: 3, id: "missing-fixture", cwd: old, timestamp: "2026-11-02T00:00:00.000Z" }) + "\n" + JSON.stringify({ type: "message", id: "first", parentId: null, timestamp: "2026-11-02T00:00:00.000Z", message: { role: "user", content: "MISSING PROJECT HISTORY", timestamp: 1 } }) + "\n";
  await writeFile(path, contents);
  let mode = "401"; let rejected = 0; let disconnected = 0;
  const service = createServer((req, res) => {
    req.resume();
    if (mode === "offline") { disconnected++; req.socket.destroy(); return; }
    assert.equal(req.headers.authorization, "Bearer synthetic-wrong-credential"); rejected++;
    res.writeHead(401, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: { message: "401 Unauthorized: invalid credential", type: "authentication_error" } }));
  });
  await new Promise<void>((done) => service.listen(0, "127.0.0.1", done)); const address = service.address(); assert.ok(address && typeof address !== "string");
  const backend = await startBackend({ production: true, entry: "scripts/phase7-errors-server.ts", env: { PI_DESK_TEST_ROOT: root, PI_DESK_WORKSPACE: cwd, PI_DESK_TEST_FAILURE_ENDPOINT: `http://127.0.0.1:${address.port}/v1` } });
  const browser = await chromium.launch({ channel: "chrome", headless: true }); const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  await context.addInitScript(({ key, cwd }) => sessionStorage.setItem(key, JSON.stringify({ cwd })), { key: SESSION_KEY, cwd });
  const page = await context.newPage(); const pageErrors: string[] = []; page.on("pageerror", (error) => pageErrors.push(error.message));
  const rpc = new DeskClient(backend.url); await rpc.ready;
  async function idle() { await expect(page.getByTestId("connection-status")).toContainText("已连接", { timeout: 30000 }); await expect(page.getByRole("button", { name: "停止", exact: true })).toHaveCount(0, { timeout: 90000 }); }
  async function send(text: string) {
    await page.getByLabel("消息", { exact: true }).fill(text);
    const button = page.getByRole("button", { name: "发送", exact: true });
    if (await button.isDisabled()) throw new Error(`合成测试发送被禁用：${text} / ${await page.locator(".sync-banner, .error-banner").allTextContents()}`);
    await button.click();
  }
  try {
    await page.goto(backend.url); await idle(); await page.getByLabel("搜索对话").fill(basename(old));
    const group = page.locator(`.project-group[data-cwd=${JSON.stringify(old)}]`); await expect(group).toBeVisible();
    await page.getByLabel("消息", { exact: true }).fill("草稿：查看失效项目不能丢失");
    await exec("trash", [old]); await expect(group).toContainText("文件夹已不存在", { timeout: 5000 });
    await group.locator(".session-open").click(); await expect(page.getByTestId("missing-project-empty")).toBeVisible(); await expect(page.getByLabel("消息", { exact: true })).toBeHidden();
    await shot(page, "missing");
    await page.getByTestId("missing-project-empty").getByRole("button", { name: "关闭", exact: true }).click();
    await expect(page.getByLabel("消息", { exact: true })).toHaveValue("草稿：查看失效项目不能丢失"); await page.getByLabel("消息", { exact: true }).fill("");
    await group.locator(".session-open").click();
    await page.getByTestId("missing-project-empty").getByRole("button", { name: "重新指定文件夹", exact: true }).click(); await page.getByLabel("文件夹路径", { exact: true }).fill(target); await page.getByRole("button", { name: "指定并打开", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 30000 }); await idle(); await expect(page.getByTestId("missing-project-empty")).toHaveCount(0); await expect(page.locator("article[data-role=user]")).toContainText("MISSING PROJECT HISTORY");
    assert.ok((await readFile(path, "utf8")).startsWith(contents.split("\n")[0] + "\n")); assert.equal(JSON.parse(await readFile(join(root, "app/settings.json"), "utf8")).projectMappings[old], target);
    // 删除整组：只删合成对话，每次仍通过原有鉴权与废纸篓接口。
    await exec("trash", [target]); await page.getByLabel("搜索对话").fill(basename(target));
    const movedGroup = page.locator(`.project-group[data-cwd=${JSON.stringify(target)}]`); await expect(movedGroup).toContainText("文件夹已不存在", { timeout: 5000 }); await movedGroup.locator(".session-open").click();
    await page.getByRole("button", { name: "删除这些对话", exact: true }).click(); await expect(page.getByRole("dialog")).toContainText("1 个对话"); await page.getByRole("button", { name: "移到废纸篓", exact: true }).click(); await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByLabel("搜索对话").fill(""); await page.getByRole("button", { name: "打开文件夹", exact: true }).click(); await page.getByLabel("文件夹路径", { exact: true }).fill(cwd); await page.getByRole("button", { name: "打开", exact: true }).click(); await expect(page.getByRole("dialog")).toHaveCount(0); await idle(); await expect(page.locator(".workspace-path")).toHaveText(cwd);
    console.log("失效项目验收通过，开始 401 / 断网 / 进程意外退出测试。");
    await rpc.rpc(cwd, { type: "set_auto_retry", enabled: false });
    await send("合成故障测试，不调用工具。"); const banner = page.locator(".composer-section .error-banner"); await expect(banner).toContainText("凭据", { timeout: 90000 }); await idle(); assert.ok(rejected > 0);
    await banner.getByText("详情", { exact: true }).click(); await expect(banner.locator("pre")).toContainText("401"); await shot(page, "unauthorized");
    mode = "offline"; await send("合成断网测试，不调用工具。"); await expect(banner).toContainText("连接模型服务失败", { timeout: 90000 }); await idle(); assert.ok(disconnected > 0); await shot(page, "network");
    await send("/desk-test-crash"); await expect(page.getByTestId("connection-status")).toContainText("pi 已退出", { timeout: 15000 }); await expect(banner).toContainText("重新连接"); await shot(page, "process-exit");
    await page.getByRole("button", { name: "重新连接", exact: true }).click(); await idle();
    // 通知是来自真正 pi 的 ctx.ui.notify，不用前端伪造事件。
    await send("/desk-test-notices 1"); const toasts = page.locator(".extension-toasts");
    await expect(toasts).toContainText("notice-fixture:"); await expect(toasts).not.toContainText("ccstyle:"); await shot(page, "notice");
    await toasts.getByRole("button", { name: "不再提示这类", exact: true }).click(); await expect(toasts).not.toContainText("notice-fixture:");
    await send("/desk-test-notices 29"); await idle(); await expect(toasts).not.toContainText("notice-fixture:");
    await page.reload(); await idle(); await send("/desk-test-notices 301"); await idle(); await expect(toasts).not.toContainText("notice-fixture:");
    await page.getByRole("button", { name: "设置", exact: true }).click(); const settings = page.getByRole("dialog");
    await expect(settings.getByTestId("hidden-notice")).toHaveCount(2); await expect(settings).toContainText("ccstyle"); await expect(settings).toContainText("notice-fixture"); await shot(page, "hidden-notices");
    await settings.getByRole("button", { name: "恢复 notice-fixture 的提醒", exact: true }).click(); await expect(settings.getByTestId("hidden-notice")).toHaveCount(1); await settings.getByRole("button", { name: "关闭设置", exact: true }).click();
    await send("/desk-test-notices 88"); await expect(toasts).toContainText("notice-fixture:"); await expect(toasts).not.toContainText("ccstyle:");
    await page.getByRole("button", { name: "设置", exact: true }).click(); await settings.getByRole("button", { name: "恢复 ccstyle 的提醒", exact: true }).click(); await expect(settings).toContainText("没有隐藏任何提醒"); await settings.getByRole("button", { name: "关闭设置", exact: true }).click();
    await send("/desk-test-notices 89"); await expect(toasts).toContainText("ccstyle:");
    assert.deepEqual(pageErrors, []);
    await writeFile(join(artifacts, "phase-7-errors-summary.json"), JSON.stringify({ missingWithinFiveSeconds: true, missingEmptyState: true, relocatedWithoutRewritingHeader: true, deleteGroupToTrash: true, realPiCrash: true, realHttpUnauthorized: rejected, realConnectionInterrupted: disconnected, detailsExpandable: true, ccstyleDefaultHidden: true, noticeTypeHidden: true, hiddenPersistsAfterRefresh: true, restoredNoticeAndDefault: true, pageErrors: 0 }, null, 2));
    console.log("失效项目/错误验收通过：项目移走自动标记，空状态/重新指定/整组废纸篓删除；真实 pi 意外退出、实际 HTTP 401、实际连接中断均中文显示且详情可展开（隔离服务，无真实凭据）；真实插件通知的默认过滤、隐藏、刷新保留、设置恢复均通过。");
  } finally { rpc.close(); await browser.close(); await backend.stop(); service.closeAllConnections(); await new Promise<void>((done) => service.close(() => done())); await exec("trash", [root]); }
}
void main().catch((error: Error) => { console.error(logText(error.message)); process.exitCode = 1; });
