import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { chromium, expect, type Browser, type Page, type WebSocketRoute } from "@playwright/test";
import { BASE_URL } from "../server/auth.js";
import { logText } from "../server/privacy.js";
import { SESSION_KEY } from "../src/api/storage.js";
import { startBackend } from "./server-runner.js";
const exec = promisify(execFile);
const artifacts = resolve(".pi-desk/verification");
async function run(command: string, args: string[]) {
  const { stdout } = await exec(command, args, { maxBuffer: 1024 * 1024, timeout: 90000 }); process.stdout.write(logText(stdout));
}
async function viteReady() {
  for (let index = 0; index < 150; index++) { try { if ((await fetch("http://127.0.0.1:5173/")).ok) return; } catch {} await new Promise((done) => setTimeout(done, 100)); }
  throw new Error("Vite 启动超时");
}
async function pageFor(browser: Browser, target: object) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await context.addInitScript(({ key, target }) => { if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, JSON.stringify(target)); }, { key: SESSION_KEY, target });
  return { context, page: await context.newPage() };
}
async function idle(page: Page) {
  await expect(page.getByTestId("connection-status")).toContainText("已连接", { timeout: 30000 });
  await expect(page.getByRole("button", { name: "停止", exact: true })).toHaveCount(0, { timeout: 180000 });
  await expect(page.getByLabel("模型", { exact: true })).toBeEnabled({ timeout: 30000 });
}
async function cheap(page: Page) {
  await idle(page); await page.getByLabel("模型", { exact: true }).selectOption(JSON.stringify(["cliproxy", "gpt-6-luna"])); await idle(page);
  await page.getByLabel("推理强度").selectOption("low"); await idle(page);
}
const row = (page: Page, path: string) => page.locator(`.session-row[data-session-path=${JSON.stringify(path)}]`);
async function menu(page: Page, path: string, action: string) { const item = row(page, path); if (await item.locator(".session-menu").getAttribute("open") === null) await item.locator("summary").click(); await item.getByRole("button", { name: action, exact: true }).click(); }
async function ask(page: Page, text: string, expected: string) {
  await page.getByLabel("消息", { exact: true }).fill(text); await page.getByLabel("消息", { exact: true }).press("Enter");
  await expect(page.locator("article[data-role=assistant]").last()).toContainText(expected, { timeout: 180000 }); await idle(page);
}
async function checkTerminal(cwd: string, paths: string[]) {
  await new Promise<void>((done, reject) => {
    const child = spawn("python3", ["scripts/check-session-list.py", cwd], { stdio: ["pipe", "pipe", "pipe"] });
    child.stdin.end(JSON.stringify(paths)); child.stdout.on("data", (chunk) => process.stdout.write(logText(chunk.toString())));
    child.stderr.on("data", (chunk) => process.stderr.write(logText(chunk.toString()))); child.once("error", reject);
    child.once("close", (code) => code === 0 ? done() : reject(new Error("真实终端 All 列表比对失败")));
  });
}

async function mockTests(browser: Browser) {
  const { context, page } = await pageFor(browser, { cwd: "/fixture-a", sessionPath: "/fixture-a.jsonl" });
  const model = { provider: "cliproxy", id: "gpt-6-luna" };
  const sessions = new Map<string, any>([
    ["/fixture-a.jsonl", { id: "a", path: "/fixture-a.jsonl", cwd: "/fixture-a", name: "alpha-name", title: "alpha-first", mtime: 1, messages: [{ role: "user", timestamp: 1, content: "alpha-first" }, { role: "assistant", timestamp: 2, content: "alpha-reply", stopReason: "stop" }] }],
    ["/fixture-b.jsonl", { id: "b", path: "/fixture-b.jsonl", cwd: "/fixture-b", name: "beta-name", title: "beta-first", mtime: 2, messages: [{ role: "user", timestamp: 3, content: "beta-first" }, { role: "assistant", timestamp: 4, content: "beta-reply", stopReason: "stop" }] }],
    ["/home.jsonl", { id: "h", path: "/home.jsonl", cwd: "/fixture-home", title: "home first", mtime: 0, messages: [] }],
  ]);
  let current = sessions.get("/fixture-a.jsonl"); let ws: WebSocketRoute; let sequence = 1; let emptyIndex = 0; let failDelete = true;
  const busy = new Set<string>(); const received: any[] = [];
  const emit = (cwd: string, path: string, record: object) => ws.send(JSON.stringify({ op: "event", cwd, sessionPath: path, seq: sequence++, record }));
  const state = () => ({ model, thinkingLevel: "low", sessionId: current.id, sessionFile: current.path, sessionName: current.name, isStreaming: busy.has(current.path) });
  const grouped = () => { const map = new Map<string, any[]>(); for (const value of sessions.values()) if (!value.virtual) map.set(value.cwd, [...(map.get(value.cwd) ?? []), value]); return [...map].map(([cwd, sessions]) => ({ cwd, sessions })); };
  await page.route("**/api/workspace", (route) => route.fulfill({ json: { cwd: "/fixture-a", home: "/fixture-home" } }));
  await page.route("**/api/projects", (route) => route.fulfill({ json: { projects: grouped(), activity: [...sessions.values()].map((session) => ({ cwd: session.cwd, sessionPath: session.path, busy: busy.has(session.path) })) } }));
  await page.route("**/api/check-dir", (route) => { const path = route.request().postDataJSON().path; return path === "/fixture-b" ? route.fulfill({ json: { cwd: path } }) : route.fulfill({ status: 400, json: { error: "文件夹不存在" } }); });
  await page.route("**/api/sessions/delete", async (route) => {
    if (failDelete) { await route.fulfill({ status: 500, json: { error: "移到废纸篓失败" } }); return; }
    const path = route.request().postDataJSON().path; const session = sessions.get(path); sessions.delete(path);
    ws.send(JSON.stringify({ op: "session_deleted", cwd: session.cwd, sessionPath: path })); await route.fulfill({ json: { ok: true } });
  });
  await page.routeWebSocket(/\/ws\?/, (route) => {
    ws = route;
    route.onMessage((raw) => {
      const message = JSON.parse(raw.toString()); received.push(message);
      if (message.op === "open") {
        if (message.sessionPath) current = sessions.get(message.sessionPath);
        else { const path = `${message.cwd}/new-${++emptyIndex}.jsonl`; current = { path, cwd: message.cwd, id: `new-${emptyIndex}`, title: "new", mtime: 0, virtual: true, messages: [] }; sessions.set(path, current); }
        route.send(JSON.stringify({ op: "opened", cwd: current.cwd, state: state(), messages: current.messages, models: [model], commands: [], stats: {}, seq: sequence })); return;
      }
      if (message.op !== "rpc") return;
      const cmd = message.cmd;
      if (cmd.type === "set_session_name") { current.name = cmd.name; current.virtual = false; emit(current.cwd, current.path, { type: "session_info_changed", name: cmd.name }); }
      const data = cmd.type === "get_state" ? state() : cmd.type === "get_available_thinking_levels" ? { levels: ["low"] } : {};
      route.send(JSON.stringify({ op: "rpc_result", reqId: message.reqId, response: { success: true, data } }));
    });
  });
  try {
    await page.goto("http://127.0.0.1:5173/?token=fixture"); await idle(page);
    await expect(page.getByTestId("home-memory-hint")).toHaveText("在这里没有长期记忆");
    await page.getByLabel("搜索对话").fill("alpha-first"); await expect(page.getByTestId("session-row")).toHaveCount(1); await page.getByLabel("搜索对话").fill("");
    await page.getByRole("button", { name: "折叠项目 fixture-a" }).click(); await expect(row(page, "/fixture-a.jsonl")).toHaveCount(0);
    await page.getByLabel("搜索对话").fill("alpha-name"); await expect(row(page, "/fixture-a.jsonl")).toBeVisible(); await page.getByLabel("搜索对话").fill("");
    await page.getByRole("button", { name: "折叠项目 fixture-a" }).click();
    await page.getByLabel("消息", { exact: true }).fill("alpha draft"); await row(page, "/fixture-b.jsonl").locator(".session-open").click(); await idle(page);
    await expect(page.getByLabel("消息", { exact: true })).toHaveValue("");
    await menu(page, "/fixture-a.jsonl", "改名"); await page.getByLabel("对话名称").fill("alpha-renamed"); await page.getByRole("button", { name: "保存名称" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0); await idle(page); await expect(page.getByRole("button", { name: "重命名当前对话" })).toHaveText("alpha-renamed");
    await expect(page.getByLabel("消息", { exact: true })).toHaveValue("alpha draft");
    busy.add("/fixture-a.jsonl"); emit("/fixture-a", "/fixture-a.jsonl", { type: "agent_start" });
    await expect(row(page, "/fixture-a.jsonl").getByTestId("session-running")).toBeVisible();
    await row(page, "/fixture-b.jsonl").locator(".session-open").click(); await idle(page);
    await expect(row(page, "/fixture-a.jsonl").getByTestId("session-running")).toBeVisible(); await expect(page.locator("article[data-role=assistant]").last()).toContainText("beta-reply");
    busy.delete("/fixture-a.jsonl"); emit("/fixture-a", "/fixture-a.jsonl", { type: "agent_settled", aborted: false });
    await expect(row(page, "/fixture-a.jsonl").getByTestId("session-running")).toHaveCount(0);
    await page.getByRole("button", { name: "打开文件夹", exact: true }).click(); await page.getByLabel("文件夹路径").fill("/missing"); await page.getByRole("button", { name: "打开", exact: true }).click(); await expect(page.getByRole("dialog").getByRole("alert")).toContainText("不存在"); await page.getByRole("button", { name: "取消", exact: true }).click();
    await menu(page, "/fixture-a.jsonl", "删除"); await page.getByRole("button", { name: "移到废纸篓" }).click(); await expect(page.getByRole("dialog").getByRole("alert")).toContainText("失败");
    assert.ok(sessions.has("/fixture-a.jsonl")); await page.getByRole("button", { name: "取消", exact: true }).click();
    failDelete = false; await row(page, "/fixture-a.jsonl").locator(".session-open").click(); await idle(page);
    await menu(page, "/fixture-a.jsonl", "删除"); await page.getByRole("button", { name: "移到废纸篓" }).click(); await expect(page.getByRole("dialog")).toHaveCount(0); await idle(page);
    await expect(row(page, "/fixture-a.jsonl")).toHaveCount(0); assert.equal(received.filter((message) => message.op === "open").at(-1).sessionPath, undefined);
    const divider = page.getByRole("separator", { name: "调整对话列表宽度" }); const old = Number(await divider.getAttribute("aria-valuenow")); await divider.focus(); await divider.press("ArrowRight"); await expect(divider).toHaveAttribute("aria-valuenow", String(old + 10));
    await page.getByRole("button", { name: "收起对话列表", exact: true }).click(); await expect(page.getByRole("complementary")).toHaveCount(0); await page.getByRole("button", { name: "展开对话列表", exact: true }).click();
    await page.setViewportSize({ width: 600, height: 800 }); await page.locator(".session-sidebar").getByRole("button", { name: "收起对话列表" }).click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    console.log("左栏补充浏览器测试通过：搜索/折叠、家目录提示、跨项目改名、草稿隔离、后台回复标记、目录错误、删除失败/取消/当前删除恢复、收起/宽度/窄窗口");
  } finally { await context.close(); }
}

async function main() {
  await run("npm", ["run", "typecheck"]); await run("npm", ["test"]); await run("npm", ["run", "build"]); await mkdir(artifacts, { recursive: true });
  const root = await realpath(await mkdtemp(join(tmpdir(), "pi-desk-list-"))); const a = join(root, "Project A"); const b = join(root, "Project B"); await mkdir(a); await mkdir(b);
  await writeFile(join(a, "marker.txt"), "A fixture\n"); await writeFile(join(b, "marker.txt"), "B fixture\n");
  const owned = new Set<string>(); let browser: Browser | undefined; let backend: Awaited<ReturnType<typeof startBackend>> | undefined;
  try {
    backend = await startBackend({ development: true }); await viteReady(); browser = await chromium.launch({ channel: "chrome", headless: true }); await mockTests(browser);
    const { context, page } = await pageFor(browser, { cwd: a }); const commands: any[] = []; const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("websocket", (socket) => { socket.on("framesent", ({ payload }) => { try { commands.push(JSON.parse(payload.toString())); } catch {} }); socket.on("framereceived", ({ payload }) => { try { const message = JSON.parse(payload.toString()); if (message.op === "opened" && [a, b].includes(message.cwd)) owned.add(message.state.sessionFile); } catch {} }); });
    await page.goto(backend.url); await idle(page);
    const token = new URL(backend.url).searchParams.get("token")!;
    const snapshot = async () => { const response = await fetch(`${BASE_URL}/api/projects`, { headers: { Authorization: `Bearer ${token}` } }); assert.equal(response.status, 200); return (await response.json()).projects as any[]; };
    const paths = (projects: any[]) => projects.flatMap((project) => project.sessions.map((session: any) => session.path)).sort();
    const allBefore = paths(await snapshot());
    await expect.poll(() => page.locator('.session-row[data-persisted="true"]').count()).toBe(allBefore.length);
    const browserPaths = await page.locator('.session-row[data-persisted="true"]').evaluateAll((rows) => rows.map((row) => row.getAttribute("data-session-path")).sort()); assert.deepEqual(browserPaths, allBefore);
    await checkTerminal(a, allBefore); console.log(`验收 1/3 通过：浏览器、API 与真实 /resume All 的 ${allBefore.length} 个文件一致`);
    const currentPath = async () => (await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)!), SESSION_KEY)).sessionPath as string;
    const marker = `phase3-${Date.now().toString(36)}`;
    await cheap(page); await ask(page, `${marker}-alpha-first：只回复 alpha-ok`, "alpha-ok"); const a1 = await currentPath();
    await page.getByRole("button", { name: "重命名当前对话" }).click(); await page.getByLabel("对话名称").fill(`${marker}-alpha-named`); await page.getByRole("button", { name: "保存名称" }).click(); await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(row(page, a1)).toContainText(`${marker}-alpha-named`); await page.getByLabel("搜索对话").fill("alpha-first"); await expect(page.getByTestId("session-row")).toHaveCount(1); await page.getByLabel("搜索对话").fill("");
    await page.getByLabel("消息", { exact: true }).fill("A unsent draft"); await page.locator(".sidebar-actions").getByRole("button", { name: "＋ 新对话", exact: true }).click(); await idle(page); await expect(page.getByLabel("消息", { exact: true })).toHaveValue("");
    await cheap(page); await ask(page, `${marker}-second-first：只回复 second-ok`, "second-ok"); const a2 = await currentPath(); assert.notEqual(a1, a2);
    await row(page, a1).locator(".session-open").click(); await idle(page); await expect(page.locator("article[data-role=assistant]").last()).toContainText("alpha-ok"); await expect(page.getByLabel("消息", { exact: true })).toHaveValue("A unsent draft");
    await page.getByRole("button", { name: "打开文件夹", exact: true }).click(); await page.getByLabel("文件夹路径").fill("relative"); await page.getByRole("button", { name: "打开", exact: true }).click(); await expect(page.getByRole("dialog").getByRole("alert")).toContainText("绝对路径");
    await page.getByLabel("文件夹路径").fill(b); await page.getByRole("button", { name: "打开", exact: true }).click(); await expect(page.getByRole("dialog")).toHaveCount(0); await idle(page); await cheap(page);
    await ask(page, "当前目录是什么？请使用 bash 执行 pwd，最后只回复得到的绝对路径。", b); const b1 = await currentPath();
    await expect(page.locator(".workspace-path")).toHaveText(b); await expect(page.locator('details[data-tool="bash"]').first()).toBeVisible();
    console.log("验收 3/3 通过：打开另一个项目后，真实 AI 的 bash/pwd 输出及最终回复是该项目的绝对路径");
    await menu(page, a2, "改名"); await page.getByLabel("对话名称").fill(`${marker}-second-renamed`); await page.getByRole("button", { name: "保存名称" }).click(); await expect(page.getByRole("dialog")).toHaveCount(0); await idle(page);
    const named = (await snapshot()).flatMap((project) => project.sessions); assert.equal(named.find((session: any) => session.path === a2).name, `${marker}-second-renamed`); assert.notEqual(named.find((session: any) => session.path === b1).name, `${marker}-second-renamed`);
    await menu(page, a2, "删除"); await page.getByRole("button", { name: "取消", exact: true }).click(); assert.ok((await stat(a2)).isFile());
    const deletionStart = commands.length; await menu(page, a2, "删除"); await page.getByRole("button", { name: "移到废纸篓" }).click(); await expect(page.getByRole("dialog")).toHaveCount(0); await idle(page);
    await expect(row(page, a2)).toHaveCount(0); await assert.rejects(stat(a2)); assert.ok((await stat(join(homedir(), ".Trash", basename(a2)))).isFile());
    assert.ok(commands.slice(deletionStart).filter((message) => message.op === "open").every((message) => message.sessionPath !== a2));
    await cheap(page); await ask(page, "只回复 after-trash-ok", "after-trash-ok"); const fresh = await currentPath(); assert.notEqual(fresh, a2); await assert.rejects(stat(a2));
    console.log("验收 2/3 通过：真实新建/切换/改名、取消删除及确认删除；文件确实在废纸篓，当前删除后开启新对话且不会重建旧文件");
    await page.reload(); await idle(page); await expect(page.locator("article[data-role=assistant]").last()).toContainText("after-trash-ok");
    const after = paths(await snapshot()); await checkTerminal(a, after);
    const modelMessages = (await readFile(fresh, "utf8")).split("\n").flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } }).filter((row) => row.message?.role === "assistant");
    assert.ok(modelMessages.every((row) => row.message.model === "gpt-6-luna" && row.message.thinkingLevel === "low"));
    await page.getByLabel("搜索对话").fill(basename(root)); await page.screenshot({ path: join(artifacts, "phase-3-light.png") }); await page.emulateMedia({ colorScheme: "dark" }); await page.screenshot({ path: join(artifacts, "phase-3-dark.png") });
    assert.deepEqual(pageErrors, []); console.log(`真实浏览器最后一段 ${await page.getByTestId("session-cost").innerText()}；未打印私人标题、路径或口令`); await context.close();
    console.log("第 3 阶段全部验收通过。");
  } finally {
    await browser?.close(); await backend?.stop();
    for (const path of owned) { try { await stat(path); await exec("trash", [path]); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
    await exec("trash", [root]);
  }
}
void main().catch((error: Error) => { console.error(`第 3 阶段验收失败：${logText(error.message)}`); process.exitCode = 1; });
