import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { chromium, expect, type Browser, type Page, type WebSocketRoute } from "@playwright/test";
import { logText } from "../server/privacy.js";
import { SESSION_KEY, TOKEN_KEY } from "../src/api/storage.js";
import { startBackend } from "./server-runner.js";

const exec = promisify(execFile);
const ARTIFACTS = resolve(".pi-desk/verification");
async function run(command: string, args: string[]) {
  try { const result = await exec(command, args, { maxBuffer: 1024 * 1024, timeout: 60000 }); process.stdout.write(logText(result.stdout)); }
  catch { throw new Error(`${command} ${args.join(" ")} 执行失败（为避免私人内容，未打印原始错误输出）`); }
}
async function waitForVite() {
  for (let attempt = 0; attempt < 150; attempt++) {
    try { if ((await fetch("http://127.0.0.1:5173/")).ok) return; } catch {}
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error("Vite 未在 5173 启动");
}
async function setupPage(browser: Browser, target: { cwd: string; sessionPath?: string }) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: "light" });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await context.addInitScript(({ target, key }) => {
    if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, JSON.stringify(target));
    const Native = window.WebSocket;
    const testWindow = window as unknown as { deskSockets: WebSocket[] };
    testWindow.deskSockets = [];
    window.WebSocket = class extends Native { constructor(url: string | URL, protocols?: string | string[]) { super(url, protocols); testWindow.deskSockets.push(this); } };
  }, { target, key: SESSION_KEY });
  return { context, page: await context.newPage() };
}
async function idle(page: Page) {
  await expect(page.getByTestId("connection-status")).toContainText("已连接", { timeout: 30000 });
  await expect(page.getByRole("button", { name: "停止", exact: true })).toHaveCount(0, { timeout: 180000 });
  await expect(page.getByLabel("模型", { exact: true })).toBeEnabled({ timeout: 30000 });
}
async function send(page: Page, message: string) {
  await page.getByLabel("消息", { exact: true }).fill(message);
  await page.getByLabel("消息", { exact: true }).press("Enter");
}

async function mockBrowserTests(browser: Browser) {
  const { context, page } = await setupPage(browser, { cwd: "/fixture" });
  const luna = { provider: "cliproxy", id: "gpt-6-luna", name: "GPT Luna", cost: { input: 0.1, output: 0.1 } };
  let model = luna;
  let busy = false;
  let messages: any[] = [];
  let current: any;
  let route: WebSocketRoute;
  let sequence = 1;
  const sent: any[] = [];
  let steering: string[] = []; let followUp: string[] = [];
  const emit = (record: object) => route.send(JSON.stringify({ op: "event", cwd: "/fixture", seq: sequence++, record }));
  const state = () => ({ model, thinkingLevel: "low", sessionId: "fixture-session", sessionFile: "/fixture-session.jsonl", isStreaming: busy });
  const result = (reqId: string, data: any) => route.send(JSON.stringify({ op: "rpc_result", reqId, response: { success: true, data } }));
  await page.route("**/api/workspace", (route) => route.fulfill({ json: { cwd: "/fixture" } }));
  await page.route("**/api/projects", (route) => route.fulfill({ json: { projects: [], activity: [] } }));
  await page.routeWebSocket(/\/ws\?/, (ws) => {
    route = ws;
    ws.onMessage((raw) => {
      const message = JSON.parse(raw.toString()); sent.push(message);
      if (message.op === "open") { emit({ type: "extension_ui_request", id: "open-dialog", method: "confirm", title: "fixture confirm" }); return; }
      if (message.op === "ui_response" && message.payload.id === "open-dialog") {
        assert.equal(message.payload.cancelled, true);
        ws.send(JSON.stringify({ op: "opened", cwd: "/fixture", state: state(), messages, stats: { cost: 0.012, contextUsage: { tokens: 9200, contextWindow: 1050000, percent: 0.9 } }, models: [luna], commands: [{ name: "plan", description: "计划模式" }], seq: sequence })); return;
      }
      if (message.op !== "rpc") return;
      const cmd = message.cmd;
      if (cmd.type === "get_state") return result(message.reqId, state());
      if (cmd.type === "get_session_stats") return result(message.reqId, { cost: 0.012, userMessages: messages.filter((item) => item.role === "user").length, contextUsage: { tokens: 9200, contextWindow: 1050000, percent: 0.9 } });
      if (cmd.type === "get_available_thinking_levels") return result(message.reqId, { levels: ["off", "low"] });
      if (cmd.type === "clear_queue") { result(message.reqId, { steering, followUp }); steering = []; followUp = []; emit({ type: "queue_update", steering, followUp }); return; }
      if (cmd.type === "abort") { busy = false; emit({ type: "agent_settled", aborted: true }); return result(message.reqId, {}); }
      if (cmd.type === "prompt") {
        if (busy) { (cmd.streamingBehavior === "followUp" ? followUp : steering).push(cmd.message); emit({ type: "queue_update", steering, followUp }); return result(message.reqId, { disposition: "queued" }); }
        busy = true;
        const user = { role: "user", timestamp: Date.now(), content: cmd.message }; messages.push(user);
        current = { role: "assistant", timestamp: Date.now() + 1, content: [], stopReason: "pending" };
        emit({ type: "agent_start" }); emit({ type: "message_end", message: user }); emit({ type: "message_start", message: current });
        return result(message.reqId, { disposition: "started" });
      }
      result(message.reqId, {});
    });
  });
  try {
    await page.goto("http://127.0.0.1:5173/?token=fixture"); await idle(page);
    assert.ok(sent.some((message) => message.op === "ui_response" && message.payload.id === "open-dialog"), "打开时需要弹窗的插件不能卡死界面");
    await expect(page.getByTestId("context-usage")).toHaveText("ctx 9.2K / 1.05M (0.9%)");
    await page.getByLabel("消息", { exact: true }).fill("第一行"); await page.getByLabel("消息", { exact: true }).press("Shift+Enter");
    await expect(page.getByLabel("消息", { exact: true })).toHaveValue("第一行\n");
    const beforeIme = sent.length;
    await page.getByLabel("消息", { exact: true }).dispatchEvent("keydown", { key: "Enter", isComposing: true });
    assert.equal(sent.length, beforeIme, "中文输入法确认不应发送");
    await page.getByLabel("消息", { exact: true }).fill("/"); await expect(page.getByRole("listbox", { name: "斜杠命令" })).toBeVisible();
    await page.getByRole("option").filter({ hasText: "/plan" }).click(); await expect(page.getByLabel("消息", { exact: true })).toHaveValue("/plan ");
    await send(page, "模拟等待"); await expect(page.getByRole("button", { name: "停止", exact: true })).toBeVisible();
    await page.clock.install(); await page.clock.fastForward(16000);
    await expect(page.getByText(/等待模型回应 \d+ 秒/)).toBeVisible();
    await send(page, "插话内容"); await expect(page.getByLabel("排队消息")).toContainText("插话内容");
    await page.getByLabel("消息", { exact: true }).fill("随后内容"); await page.getByLabel("消息", { exact: true }).press("Alt+Enter");
    await expect(page.getByLabel("排队消息")).toContainText("随后内容");
    assert.equal(sent.filter((item) => item.cmd?.type === "prompt").at(-2).cmd.streamingBehavior, "steer");
    assert.equal(sent.filter((item) => item.cmd?.type === "prompt").at(-1).cmd.streamingBehavior, "followUp");
    await page.getByLabel("消息", { exact: true }).press("Escape"); await idle(page);
    await expect(page.getByLabel("消息", { exact: true })).toHaveValue("插话内容\n\n随后内容");
    emit({ type: "extension_ui_request", method: "setStatus", id: "s1", statusKey: "mc", statusText: "mc: ready" });
    await expect(page.getByText("mc: ready", { exact: true })).toBeVisible();
    await send(page, "模拟重试");
    emit({ type: "auto_retry_start", attempt: 2, maxAttempts: 3 }); await expect(page.getByText(/网络不稳，第 2 次重试/)).toBeVisible();
    emit({ type: "auto_retry_end", success: false, finalError: "模拟网络失败" }); busy = false; emit({ type: "agent_settled", aborted: false });
    await expect(page.getByRole("alert")).toContainText("模拟网络失败"); await page.getByRole("button", { name: "重试", exact: true }).click();
    await expect(page.getByRole("button", { name: "停止", exact: true })).toBeVisible();
    const text = "## Markdown 验证\n\n| 表头 | 数字 |\n| --- | --- |\n| 示例 | 1 |\n\n```js\nconsole.log('copy fixture');\n```\n\n<script>window.deskBad=true</script>";
    current = { ...current, stopReason: "stop", content: [{ type: "thinking", thinking: "隐藏的思考" }, { type: "text", text }, { type: "toolCall", id: "failed-tool", name: "bash", arguments: { command: "fixture" } }] };
    messages.push(current); emit({ type: "message_end", message: current });
    emit({ type: "tool_execution_end", toolCallId: "failed-tool", toolName: "bash", result: { content: [{ type: "text", text: "fixture failure" }] }, isError: true });
    busy = false; emit({ type: "agent_settled", aborted: false }); await idle(page);
    await expect(page.getByRole("table")).toBeVisible(); await expect(page.locator(".thinking[open]")).toHaveCount(0);
    await expect(page.locator(".tool-error")).toBeVisible(); await expect(page.locator(".tool-error[open]")).toHaveCount(0);
    assert.equal(await page.evaluate(() => (window as any).deskBad), undefined);
    await page.locator(".code-toolbar").getByRole("button", { name: "复制", exact: true }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "console.log('copy fixture');");
    // 长历史与后续流式更新：向上翻时不强制滚动，按钮能回到底部。
    messages = Array.from({ length: 60 }, (_, index) => ({ role: "assistant", timestamp: index + 100, content: [{ type: "text", text: `历史 ${index}\n\n${"测试段落。".repeat(60)}` }], stopReason: "stop" }));
    messages.unshift({ role: "user", timestamp: 99, content: "历史测试" });
    route!.send(JSON.stringify({ op: "opened", cwd: "/fixture", state: state(), messages, stats: {}, models: [model], commands: [], seq: sequence }));
    await expect(page.locator("article[data-role=assistant]")).toHaveCount(60);
    await page.getByTestId("messages-scroll").evaluate((element) => { element.scrollTop = 0; element.dispatchEvent(new Event("scroll")); });
    emit({ type: "message_start", message: { role: "assistant", timestamp: 999, content: [], stopReason: "pending" } });
    emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "新的流式内容" } });
    await expect(page.getByRole("button", { name: "回到底部 ↓" })).toBeVisible();
    assert.equal(await page.getByTestId("messages-scroll").evaluate((element) => element.scrollTop), 0);
    await page.getByRole("button", { name: "回到底部 ↓" }).click();
    await expect.poll(() => page.getByTestId("messages-scroll").evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(80);
    await page.emulateMedia({ colorScheme: "dark" });
    const background = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--bg").trim()); assert.equal(background, "#191b19");
    await page.setViewportSize({ width: 600, height: 800 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "窄窗口不应横向溢出");
    console.log("浏览器补充测试通过：Markdown/复制、安全 HTML、折叠/失败卡片、IME、换行、插话/排队/Esc、网络等待/重试、插件状态、滚动和深浅色/窄窗口");
  } finally { await context.close(); }
}

async function main() {
  await run("npm", ["run", "typecheck"]); await run("npm", ["test"]); await run("npm", ["run", "build"]);
  await mkdir(ARTIFACTS, { recursive: true });
  const cwd = await realpath(await mkdtemp(join(tmpdir(), "pi-desk-browser-")));
  await writeFile(join(cwd, "alpha.txt"), "browser fixture\n"); await writeFile(join(cwd, "README.txt"), "只用于聊天页验收\n");
  let backend: Awaited<ReturnType<typeof startBackend>> | undefined;
  let browser: Browser | undefined;
  let sessionPath: string | undefined;
  try {
    backend = await startBackend({ development: true }); await waitForVite();
    browser = await chromium.launch({ channel: "chrome", headless: true });
    await mockBrowserTests(browser);
    const { context, page } = await setupPage(browser, { cwd });
    const wire: any[] = []; const commands: any[] = [];
    page.on("websocket", (socket) => {
      socket.on("framereceived", ({ payload }) => { try { const message = JSON.parse(payload.toString()); wire.push(message); if (message.op === "opened") sessionPath = message.state.sessionFile; } catch {} });
      socket.on("framesent", ({ payload }) => { try { commands.push(JSON.parse(payload.toString())); } catch {} });
    });
    const pageErrors: string[] = []; page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(backend.url); await idle(page);
    assert.equal(new URL(page.url()).searchParams.has("token"), false);
    assert.ok(await page.evaluate((key) => !!sessionStorage.getItem(key), TOKEN_KEY));
    const modelSelect = page.getByLabel("模型", { exact: true }); const thinking = page.getByLabel("推理强度", { exact: true });
    const luna = JSON.stringify(["cliproxy", "gpt-6-luna"]);
    await modelSelect.selectOption(luna); await idle(page); await thinking.selectOption("low"); await idle(page);
    const marker = `pi-desk-e2e-${Date.now().toString(36)}`;
    await page.evaluate(() => {
      (window as any).deskSamples = [];
      new MutationObserver(() => {
        if (!document.querySelector(".stop-button")) return;
        const text = [...document.querySelectorAll("article[data-role=assistant] .markdown")].map((element) => element.textContent).join("");
        if (text.includes("浏览器验收")) (window as any).deskSamples.push(text.length);
      }).observe(document.querySelector(".messages-inner")!, { subtree: true, childList: true, characterData: true });
    });
    await send(page, `${marker}：只用 Markdown 输出 80 行有序列表，第 N 行写“浏览器验收第N行”，不要工具。`);
    await expect(page.locator("article[data-role=assistant]").last()).toContainText("浏览器验收第80行", { timeout: 180000 }); await idle(page);
    const samples = await page.evaluate(() => [...new Set((window as any).deskSamples)]);
    assert.ok(samples.length > 1, "必须实际观察到不同长度的中间 DOM，不能只看到最终回复");
    assert.ok(wire.filter((message) => message.record?.assistantMessageEvent?.type === "text_delta").length > 1);
    console.log("验收 1/6 通过：npm run dev + 真实 Chrome + gpt-6-luna/low，观察到流式中间 DOM 和多个 text_delta");
    await send(page, "列出当前目录的文件。请使用 bash 工具执行 ls，只读取，不修改。");
    await expect(page.locator("details[data-tool=bash]")).toHaveCount(1, { timeout: 180000 }); await idle(page);
    const card = page.locator("details[data-tool=bash]"); assert.equal(await card.getAttribute("open"), null);
    await card.locator("summary").click(); await expect(card.getByTestId("tool-output")).toContainText("alpha.txt"); await expect(card.getByTestId("tool-output")).toContainText("README.txt");
    console.log("验收 2/6 通过：真实 bash 工具卡片默认折叠，展开显示临时目录 ls 的输出");
    const beforeStop = wire.length;
    await send(page, "只输出 300 行有序列表，第 N 行写‘停止功能验收第N行’。不要解释，不调用工具。");
    await expect(page.getByRole("button", { name: "停止", exact: true })).toBeVisible();
    await expect.poll(() => wire.slice(beforeStop).some((message) => message.record?.assistantMessageEvent?.type === "text_delta"), { timeout: 180000, intervals: [10, 20, 50] }).toBeTruthy();
    await page.getByRole("button", { name: "停止", exact: true }).click(); await idle(page);
    await expect(page.locator("article[data-stop=aborted] .error-text")).toHaveCount(0);
    assert.ok(commands.some((message) => message.cmd?.type === "abort"));
    assert.ok(wire.slice(beforeStop).some((message) => message.record?.type === "agent_settled" && message.record.aborted === true));
    console.log("验收 3/6 通过：真实回复过程中点击停止，发送 clear_queue + abort 并收到 aborted agent_settled");
    const alternative = await modelSelect.locator("option").evaluateAll((options, luna) => options.map((option) => (option as HTMLOptionElement).value).find((value) => value && value !== luna), luna);
    assert.ok(alternative, "验收环境需有一个可切换模型");
    await modelSelect.selectOption(alternative!); await idle(page);
    await modelSelect.selectOption(luna); await idle(page); await thinking.selectOption("off"); await idle(page); await thinking.selectOption("low"); await idle(page);
    // 遵循 AGENTS.md，其他模型只切换不发付费请求；实际聊天始终用 luna/low。
    await send(page, "只回复 模型切换验证通过，不要工具。");
    await expect(page.locator("article[data-role=assistant]").last()).toContainText("模型切换验证通过", { timeout: 180000 }); await idle(page);
    const finalAssistant = wire.filter((message) => message.record?.type === "message_end" && message.record.message?.role === "assistant").at(-1).record.message;
    assert.equal(finalAssistant.model, "gpt-6-luna"); assert.equal(finalAssistant.provider, "cliproxy"); assert.equal(finalAssistant.thinkingLevel, "low");
    console.log("验收 4/6 通过：实际切换模型/推理后再发消息，最终 assistant 元数据为 cliproxy/gpt-6-luna、low（未给其他模型发付费请求）");
    const saved = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)!), SESSION_KEY); sessionPath = saved.sessionPath; assert.ok(sessionPath);
    const sessionId = wire.filter((message) => message.op === "opened").at(-1).state.sessionId;
    const count = await page.locator("article[data-role=user]").count();
    await page.reload(); await idle(page);
    await expect(page.locator("article[data-role=user]")).toHaveCount(count);
    await expect(page.locator("article[data-role=assistant]").last()).toContainText("模型切换验证通过");
    assert.equal(wire.filter((message) => message.op === "opened").at(-1).state.sessionId, sessionId);
    const opens = wire.filter((message) => message.op === "opened").length;
    await page.evaluate(() => (window as any).deskSockets.find((socket: WebSocket) => socket.readyState === 1 && new URL(socket.url).pathname === "/ws").close());
    await expect.poll(() => wire.filter((message) => message.op === "opened").length, { timeout: 30000 }).toBeGreaterThan(opens); await idle(page);
    assert.equal(wire.filter((message) => message.op === "opened").at(-1).state.sessionId, sessionId);
    await expect(page.locator("article[data-role=user]")).toHaveCount(count);
    console.log("验收 5/6 通过：刷新和实际关闭 WS 后自动重连，sessionId 不变、历史不丢、不重复用户消息");
    await run("python3", ["scripts/check-resume.py", cwd, marker]); console.log("验收 6/6 通过：实际在伪终端运行 pi -r，选择器显示浏览器创建的同一对话");
    const lines = (await readFile(sessionPath!, "utf8")).split("\n").flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
    assert.ok(lines.some((entry) => entry.type === "model_change" && entry.modelId === "gpt-6-luna"));
    assert.ok(lines.some((entry) => entry.type === "thinking_level_change" && entry.thinkingLevel === "low"));
    const cost = await page.getByTestId("session-cost").innerText(); console.log(`真实浏览器 ${cost}`);
    assert.deepEqual(pageErrors, []);
    await page.screenshot({ path: join(ARTIFACTS, "phase-2-light.png") });
    await page.emulateMedia({ colorScheme: "dark" }); await page.screenshot({ path: join(ARTIFACTS, "phase-2-dark.png") });
    await context.close(); await backend.stop(); backend = undefined;
    backend = await startBackend({ production: true });
    const production = await setupPage(browser, { cwd, sessionPath }); await production.page.goto(backend.url); await idle(production.page);
    await expect(production.page.locator("article[data-role=assistant]").last()).toContainText("模型切换验证通过"); await production.context.close();
    console.log("生产构建浏览器验证通过：dist 静态页面在 4317 恢复同一历史，无额外模型调用");
    console.log("第 2 阶段全部验收通过；截图在忽略提交的 .pi-desk/verification/ 下。");
  } finally {
    await browser?.close(); await backend?.stop();
    if (sessionPath) { try { await stat(sessionPath); await exec("trash", [sessionPath]); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
    await exec("trash", [cwd]);
  }
}
void main().catch((error: Error) => { console.error(`第 2 阶段验收失败：${logText(error.message)}`); process.exitCode = 1; });
