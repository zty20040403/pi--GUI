import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, expect, type WebSocketRoute } from "@playwright/test";
import { startBackend } from "./server-runner.js";

const artifacts = resolve(".pi-desk/verification");
const baseline = process.argv.includes("--baseline");
const source = String.raw`# 数学与流式显示

行内公式：\(E = mc^2\)，以及 $a^2+b^2=c^2$。

\[
\int_0^1 x^2\,dx = \frac{1}{3}
\]

$$
\sum_{i=1}^n i = \frac{n(n+1)}{2}
$$

矩阵：\(\begin{pmatrix}a & b \\ c & d\end{pmatrix}\)。

[稳定的链接](https://example.invalid/docs)

` + '```typescript\nconst unchanged = 42;\nconsole.log(unchanged);\n```\n\n```mermaid\nflowchart LR\n  A[公式] --> B[增量显示]\n```\n\n![本地测试图片](./fixture.png)\n\n' + String.raw`代码里的公式不解析：\`\(x_i\)\``.replaceAll("\\`", "`");

async function main() {
  await mkdir(artifacts, { recursive: true });
  const backend = await startBackend({ production: true, env: { PI_DESK_PORT: "0" } });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = await context.newPage(); let socket: WebSocketRoute; let seq = 1; let imageRequests = 0;
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  const history = [{ role: "user", timestamp: 1, content: "请显示数学公式与代码示例。" }, { role: "assistant", timestamp: 2, content: source, stopReason: "stop" }];
  const model = { id: "gpt-6-luna", provider: "cliproxy", name: "GPT Luna", cost: { input: 0.1, output: 0.1 } };
  const state = { sessionId: "render-fixture", sessionFile: "/fixture-session.jsonl", thinkingLevel: "low", model, isStreaming: false };
  const emit = (record: object) => socket.send(JSON.stringify({ op: "event", cwd: "/fixture", seq: seq++, record }));
  await context.addInitScript(() => { localStorage.setItem("pi-desk.file-layout", JSON.stringify({ shown: false })); });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/workspace") return route.fulfill({ json: { cwd: "/fixture", home: "/fixture" } });
    if (path === "/api/file-info") return route.fulfill({ json: { cwd: "/fixture", path: "/fixture/fixture.png", name: "fixture.png", mime: "image/png", size: 68, mtime: 1, kind: "image", tooLarge: false } });
    if (path === "/api/file") { imageRequests++; return route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNOkAAAAASUVORK5CYII=", "base64") }); }
    return route.fulfill({ json: { projects: [], activity: [], turns: [], git: false, goals: [], hidden: [], entries: [], truncated: false } });
  });
  await page.routeWebSocket(/\/ws\?/, (ws) => {
    socket = ws;
    ws.onMessage((raw) => {
      const message = JSON.parse(raw.toString());
      if (message.op === "open") return ws.send(JSON.stringify({ op: "opened", cwd: "/fixture", state, messages: history, stats: {}, models: [model], commands: [], seq: seq++ }));
      if (message.op === "rpc") ws.send(JSON.stringify({ op: "rpc_result", reqId: message.reqId, response: { success: true, data: message.cmd.type === "get_state" ? state : message.cmd.type === "get_available_thinking_levels" ? { levels: ["off", "low"] } : {} } }));
    });
  });
  try {
    await page.goto(backend.url);
    await expect(page.getByTestId("connection-status")).toHaveText("已连接");
    const first = page.locator('article[data-role="assistant"]').first();
    await expect(first.locator(".syntax[data-highlighted=true]")).toHaveCount(1, { timeout: 30000 });
    await expect(first.getByAltText("Mermaid 图表")).toBeVisible({ timeout: 30000 });
    await expect(first.getByAltText("本地测试图片")).toBeVisible({ timeout: 10000 });
    const formulas = await first.locator(".katex").count();
    await page.evaluate(() => {
      const article = document.querySelector('article[data-role="assistant"]')!;
      const nodes = [...article.querySelectorAll(".syntax pre, .syntax .line, .mermaid-diagram img, a, img[alt='本地测试图片'], .katex")];
      const probe = { nodes, removed: 0, mutations: 0, firstLine: null as Element | null, codePre: null as Element | null, codeReplaced: 0, lostColor: 0 };
      (window as any).renderProbe = probe;
      new MutationObserver((records) => {
        probe.mutations += records.filter((record) => !(record.target instanceof Element ? record.target : record.target.parentElement)?.closest(".code-toolbar button")).length;
        probe.removed = nodes.filter((node) => !node.isConnected).length;
      }).observe(article, { subtree: true, childList: true, characterData: true, attributes: true });
    });
    await first.locator(".code-toolbar button").first().click();
    await first.getByRole("link", { name: "稳定的链接" }).focus();
    emit({ type: "agent_start" });
    emit({ type: "message_start", message: { role: "assistant", timestamp: 3, content: [], stopReason: "pending" } });
    let streamed = '```typescript\nconst stableLine = 42;\n';
    emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: streamed } });
    await expect(page.locator('article[data-role="assistant"]')).toHaveCount(2);
    const current = page.locator('article[data-role="assistant"]').nth(1);
    await expect(current.locator(".syntax[data-highlighted=true]")).toHaveCount(1);
    if (!baseline) await expect(first.locator(".code-toolbar button").first()).toContainText("已复制");
    await page.evaluate(() => {
      const article = [...document.querySelectorAll('article[data-role="assistant"]')].at(-1)!;
      const p = (window as any).renderProbe;
      p.codePre = article.querySelector(".syntax pre"); p.firstLine = article.querySelector(".syntax .line");
      if (!p.codePre || !p.firstLine) throw new Error("流式探针必须绑定真实代码块及首行节点");
      new MutationObserver(() => {
        if (!p.codePre.isConnected || p.firstLine && !p.firstLine.isConnected) p.codeReplaced++;
        if (article.querySelector('.syntax[data-highlighted="false"]')) p.lostColor++;
      }).observe(article, { subtree: true, childList: true, characterData: true, attributes: true });
    });
    for (let i = 0; i < 40; i++) {
      const delta = `console.log(${i});\n`; streamed += delta;
      emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta } });
      await delay(35);
    }
    const tail = '\n```\n\n' + String.raw`流式公式：\(\frac{x^2}{2}\)，更新完成。`;
    for (const delta of tail) {
      streamed += delta; emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta } }); await delay(12);
    }
    emit({ type: "message_end", message: { role: "assistant", timestamp: 3, content: streamed, stopReason: "stop" } }); emit({ type: "agent_settled" });
    await expect(current).toContainText("更新完成"); await delay(1400);
    const probe = await page.evaluate(() => { const p = (window as any).renderProbe; return { removed: p.removed, mutations: p.mutations, codeReplaced: p.codeReplaced, lostColor: p.lostColor }; });
    const result = { baseline, formulas, expectedFormulas: 5, streamedFormulas: await current.locator(".katex").count(), imageRequests, ...probe, errors };
    console.log(JSON.stringify(result));
    if (baseline) { await writeFile(join(artifacts, "rendering-baseline-summary.json"), JSON.stringify(result, null, 2) + "\n"); return; }
    assert.equal(formulas, 5); assert.equal(result.streamedFormulas, 1); assert.equal(probe.removed, 0, "旧内容的节点不能被卸载重建");
    // 观察器只排除了复制按钮自身的计时文案，正文必须没有任何变化。
    assert.equal(probe.mutations, 0, "无关流式和计时更新不能改动历史 DOM"); assert.equal(probe.codeReplaced, 0, "增量代码保留 pre 和已有行"); assert.equal(probe.lostColor, 0, "增量代码不能先清掉高亮"); assert.equal(imageRequests, 1, "本地图片只读取一次"); assert.deepEqual(errors, []);
    await expect(first.getByRole("link", { name: "稳定的链接" })).toBeFocused();
    emit({ type: "agent_start" }); emit({ type: "message_start", message: { role: "assistant", timestamp: 4, content: [], stopReason: "pending" } });
    for (let i = 0; i < 600; i++) emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "x" } });
    emit({ type: "message_end", message: { role: "assistant", timestamp: 4, content: "最终版本：" + "x".repeat(600), stopReason: "stop" } }); emit({ type: "agent_settled" });
    await expect(page.locator('article[data-role="assistant"]').last().locator(".markdown")).toHaveText("最终版本：" + "x".repeat(600));
    emit({ type: "agent_start" }); emit({ type: "message_start", message: { role: "assistant", timestamp: 5, content: [], stopReason: "pending" } });
    let graph = '```mermaid\nflowchart LR\nA-->B';
    emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: graph } });
    const diagram = page.locator('article[data-role="assistant"]').last().getByAltText("Mermaid 图表"); await expect(diagram).toBeAttached({ timeout: 30000 });
    const oldSrc = await diagram.getAttribute("src"); await diagram.evaluate((node) => { (window as any).renderDiagram = node; });
    graph += '\nB-->'; emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: '\nB-->' } });
    await delay(400); assert.ok(await page.evaluate(() => (window as any).renderDiagram.isConnected)); assert.equal(await diagram.getAttribute("src"), oldSrc);
    graph += 'C\n```'; emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: 'C\n```' } });
    await expect.poll(() => diagram.getAttribute("src"), { timeout: 30000 }).not.toBe(oldSrc); assert.ok(await page.evaluate(() => (window as any).renderDiagram.isConnected));
    assert.ok(await diagram.evaluate((node) => (node as HTMLImageElement).naturalWidth > 0));
    emit({ type: "message_end", message: { role: "assistant", timestamp: 5, content: graph, stopReason: "stop" } }); emit({ type: "agent_settled" });
    const largeCode = "x\n".repeat(10001) + "末行未截断";
    emit({ type: "message_start", message: { role: "assistant", timestamp: 6, content: [], stopReason: "pending" } });
    emit({ type: "message_end", message: { role: "assistant", timestamp: 6, content: "```text\n" + largeCode + "\n```", stopReason: "stop" } });
    const large = page.locator('article[data-role="assistant"]').last().locator(".syntax");
    await expect(large).toHaveAttribute("data-highlighted", "false"); assert.equal(await large.locator("pre").textContent(), largeCode);
    assert.equal(await large.locator(".line").count(), 0, "超长代码应直接显示文本，不能产生数万个行节点");
    await page.getByTestId("messages-scroll").evaluate((node) => { node.scrollTop = 0; node.dispatchEvent(new Event("scroll")); });
    for (const colorScheme of ["dark", "light"] as const) for (const width of [1440, 1024]) {
      await page.emulateMedia({ colorScheme }); await page.setViewportSize({ width, height: 1100 }); await delay(500);
      await page.screenshot({ path: join(artifacts, `rendering-math-${colorScheme}-${width}.png`), animations: "disabled" });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    const before = await page.getByTestId("messages-scroll").evaluate((node) => node.scrollTop);
    emit({ type: "message_start", message: { role: "assistant", timestamp: 7, content: [], stopReason: "pending" } });
    emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "\n\n后续更新不抢走滚动位置。" } });
    await delay(300); assert.equal(await page.getByTestId("messages-scroll").evaluate((node) => node.scrollTop), before);
    assert.deepEqual(errors, [], "完整验收过程不应出现页面异常");
    await writeFile(join(artifacts, "rendering-fixed-summary.json"), JSON.stringify({ ...result, burstOrdered: true, diagramRetained: true, copyStateRetained: true, focusRetained: true, scrollRetained: true, largeCodePlainText: true }, null, 2) + "\n");
    console.log("公式、DOM 稳定性、代码增量着色、本地图片与滚动保护验收通过。");
  } finally { await context.close(); await browser.close(); await backend.stop(); }
}
await main();
