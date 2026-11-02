import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, open, readFile, realpath, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { chromium, expect, type Browser, type Page } from "@playwright/test";
import { logText } from "../server/privacy.js";
import { BASE_URL } from "../server/auth.js";
import { SESSION_KEY } from "../src/api/storage.js";
import { startBackend } from "./server-runner.js";
import { chooseModel, setThinking, expectModelReady } from "./ui-helpers.js";
const exec = promisify(execFile); const artifacts = resolve(".pi-desk/verification");
async function run(command: string, args: string[]) {
  const result = await exec(command, args, { timeout: 90000, maxBuffer: 4 * 1024 * 1024 });
  const output = args.includes("build") ? result.stdout.split("\n").filter((line) => /built in|modules transformed|index.*kB/.test(line)).join("\n") : result.stdout;
  process.stdout.write(logText(output));
}
async function viteReady() {
  for (let index = 0; index < 150; index++) { try { if ((await fetch("http://127.0.0.1:5173/")).ok) return; } catch {} await new Promise((done) => setTimeout(done, 100)); }
  throw new Error("Vite 未启动");
}
async function idle(page: Page) {
  await expect(page.getByTestId("connection-status")).toContainText("已连接", { timeout: 30000 });
  await expect(page.getByRole("button", { name: "停止", exact: true })).toHaveCount(0, { timeout: 180000 });
  await expectModelReady(page);
}
const panel = (page: Page) => page.getByRole("complementary", { name: "文件面板" });
const preview = (page: Page) => page.locator(".file-preview");
async function tree(page: Page) { await panel(page).getByRole("tab", { name: "文件", exact: true }).click(); }
async function openPreview(page: Page, name: string) {
  await tree(page); await panel(page).getByRole("treeitem", { name: `预览 ${name}`, exact: true }).click(); await expect(preview(page)).toBeVisible();
}
async function ask(page: Page, text: string) { await page.getByLabel("消息", { exact: true }).fill(text); await page.getByLabel("消息", { exact: true }).press("Enter"); }
async function folder(page: Page, cwd: string) {
  await page.getByRole("button", { name: "打开文件夹", exact: true }).click(); await page.getByLabel("文件夹路径").fill(cwd); await page.getByRole("button", { name: "打开", exact: true }).click(); await expect(page.getByRole("dialog")).toHaveCount(0); await idle(page);
}
async function main() {
  await run("npm", ["run", "typecheck"]); await run("npm", ["test"]); await run("npm", ["run", "build"]); await mkdir(artifacts, { recursive: true });
  const root = await realpath(await mkdtemp(join(tmpdir(), "pi-desk-preview-"))); const other = await realpath(await mkdtemp(join(tmpdir(), "pi-desk-other-")));
  await cp(resolve("scripts/fixtures/preview"), root, { recursive: true }); await mkdir(join(root, "Nested")); await writeFile(join(root, "Nested", "inside.txt"), "NESTED PREVIEW OK");
  await symlink(join(root, "sample.md"), join(root, "alias.md")); await writeFile(join(other, "notes.md"), "OTHER PROJECT ONLY");
  await writeFile(join(root, "long.txt"), "LARGE BEGIN\n" + "x".repeat(2 * 1024 * 1024) + "\nLARGE END");
  const huge = await open(join(root, "huge.bin"), "w"); await huge.truncate(50 * 1024 * 1024 + 1); await huge.close();
  let backend: Awaited<ReturnType<typeof startBackend>> | undefined; let browser: Browser | undefined; const sessions = new Set<string>();
  try {
    backend = await startBackend({ development: true }); await viteReady(); browser = await chromium.launch({ channel: "chrome", headless: true });
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await context.addInitScript(({ key, cwd }) => { if (window !== window.top) return; if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, JSON.stringify({ cwd })); }, { key: SESSION_KEY, cwd: root });
    const page = await context.newPage(); const pageErrors: string[] = []; const requests: string[] = []; const wire: any[] = []; let dialogs = 0;
    page.on("pageerror", (error) => pageErrors.push(error.message)); page.on("dialog", (dialog) => { dialogs++; void dialog.dismiss(); });
    page.on("request", (request) => { const url = new URL(request.url()); if (url.pathname.startsWith("/api/")) requests.push(url.pathname + url.search); });
    page.on("websocket", (socket) => socket.on("framereceived", ({ payload }) => { try { const message = JSON.parse(payload.toString()); wire.push(message); if (message.op === "opened" && [root, other].includes(message.cwd)) sessions.add(message.state.sessionFile); } catch {} }));
    await page.goto(backend.url); await idle(page); await expect(panel(page).getByRole("treeitem", { name: "预览 sample.md", exact: true })).toBeVisible();
    await page.getByLabel("搜索对话").fill(root.split("/").at(-1)!);
    assert.ok(!requests.some((request) => request.includes(encodeURIComponent(join(root, "Nested")))), "没展开目录时不得请求子目录");
    await panel(page).getByRole("treeitem", { name: "展开文件夹 Nested" }).click(); await panel(page).getByRole("treeitem", { name: "预览 inside.txt" }).click(); await expect(preview(page)).toContainText("NESTED PREVIEW OK");
    await openPreview(page, "sample.md"); await expect(preview(page).getByRole("heading", { name: "Markdown 预览验收" })).toBeVisible();
    await expect(preview(page).getByAltText("相对路径图片")).toBeVisible(); await expect.poll(() => preview(page).getByAltText("相对路径图片").evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBe(64);
    await expect(preview(page).getByAltText("Mermaid 图表")).toBeVisible({ timeout: 30000 }); await expect(preview(page).locator(".katex")).toHaveCount(2); await expect(preview(page).locator(".syntax[data-highlighted=true]")).toHaveCount(1);
    await preview(page).getByRole("button", { name: "源码", exact: true }).click(); await expect(preview(page).locator(".line-numbers")).toBeVisible(); await expect(preview(page)).toContainText("flowchart LR"); await preview(page).getByRole("button", { name: "排版", exact: true }).click();
    await expect.poll(() => preview(page).getByAltText("相对路径图片").evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBe(64);
    await expect(preview(page).getByAltText("Mermaid 图表")).toBeVisible({ timeout: 30000 });
    await page.screenshot({ path: join(artifacts, "phase-4-markdown.png") });
    await openPreview(page, "alias.md"); await expect(panel(page).getByRole("tab", { name: "sample.md", exact: true })).toHaveCount(1);
    await openPreview(page, "sample.py"); await expect(preview(page).locator(".syntax[data-highlighted=true]")).toBeVisible(); await expect(preview(page)).toContainText("CODE PREVIEW OK"); await expect(preview(page).locator("img")).toHaveCount(0);
    await preview(page).getByRole("button", { name: "复制", exact: true }).click(); assert.ok((await page.evaluate(() => navigator.clipboard.readText())).includes("CODE PREVIEW OK"));
    await openPreview(page, "sample.csv"); await expect(preview(page).getByRole("table")).toContainText("带逗号,仍在同一格"); await preview(page).getByLabel("首行作为表头").uncheck(); await expect(preview(page).getByRole("columnheader").first()).toHaveText("列 1");
    await openPreview(page, "sample.tsv"); await expect(preview(page).getByRole("table")).toContainText("TSV 合成样例");
    await openPreview(page, "sample.xlsx"); await expect(preview(page).getByRole("table")).toContainText("合成数据", { timeout: 30000 }); await expect(preview(page).getByRole("table")).toContainText("50"); await preview(page).getByRole("tab", { name: "统计", exact: true }).click(); await expect(preview(page).getByRole("table")).toContainText("工作表");
    await page.screenshot({ path: join(artifacts, "phase-4-xlsx.png") });
    await openPreview(page, "sample.docx"); await expect(preview(page).getByRole("heading", { name: "Word 预览验收" })).toBeVisible({ timeout: 30000 }); await expect(preview(page).getByRole("table")).toContainText("只读表格");
    assert.equal(await preview(page).locator(".word-preview a").getAttribute("href"), null, "DOCX javascript 链接必须被 DOMPurify 移除"); await expect(preview(page)).toContainText("排版可能和原文不同");
    await page.screenshot({ path: join(artifacts, "phase-4-docx.png") });
    for (const name of ["sample.png", "sample.svg"]) {
      await openPreview(page, name); await expect(preview(page).getByRole("img", { name })).toBeVisible(); await expect.poll(() => preview(page).getByRole("img", { name }).evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      await preview(page).getByRole("button", { name: "放大图片" }).click(); await expect(preview(page)).toContainText("125%"); await preview(page).getByRole("button", { name: "适应宽度", exact: true }).click();
    }
    await openPreview(page, "sample.pdf"); await expect(preview(page).locator("iframe")).toHaveAttribute("src", /^blob:/); await page.waitForTimeout(700); await page.screenshot({ path: join(artifacts, "phase-4-pdf.png") });
    await openPreview(page, "sample.mp3"); const audio = preview(page).locator("audio"); await expect(audio).toBeVisible(); await expect.poll(() => audio.evaluate((node) => (node as HTMLAudioElement).readyState), { timeout: 15000 }).toBeGreaterThanOrEqual(2);
    await audio.evaluate(async (node) => { const audio = node as HTMLAudioElement; audio.muted = true; await audio.play(); });
    await expect.poll(() => audio.evaluate((node) => (node as HTMLAudioElement).currentTime), { timeout: 5000 }).toBeGreaterThan(0);
    await audio.evaluate((node) => (node as HTMLAudioElement).pause());
    await openPreview(page, "sample.bin"); await expect(preview(page)).toContainText("这是二进制文件"); await expect(preview(page)).toContainText("application/octet-stream");
    await openPreview(page, "sample.pptx"); await expect(preview(page)).toContainText("装 LibreOffice 可以预览", { timeout: 15000 }); await expect(panel(page).getByRole("button", { name: "用默认软件打开", exact: true })).toBeEnabled();
    await openPreview(page, "long.txt"); await expect(preview(page)).toContainText("只显示前 1 MB"); await expect(preview(page)).toContainText("LARGE BEGIN"); assert.ok(!(await preview(page).innerText()).includes("LARGE END"));
    const beforeHuge = requests.length; await openPreview(page, "huge.bin"); await expect(preview(page)).toContainText("超过 50 MB，不读取内容"); assert.ok(!requests.slice(beforeHuge).some((request) => request.startsWith("/api/file?")), "过大文件不能请求原始内容");
    console.log("验收 1/4 通过：真实 Chrome 逐个预览 MD/代码/CSV/TSV/XLSX/DOCX/PNG/SVG/PDF/MP3/二进制及 Office 缺失提示，另验证懒树/唯一标签/源码/复制/大小上限");
    await openPreview(page, "sample.html"); const frame = page.frameLocator('iframe[title="HTML 预览 sample.html"]'); await expect(frame.getByRole("heading", { name: "HTML PREVIEW OK" })).toBeVisible();
    assert.equal(await frame.locator("body").getAttribute("data-script-ran"), null); assert.equal(dialogs, 0, "HTML/SVG 脚本默认不应弹窗");
    assert.equal(await preview(page).locator("iframe").getAttribute("sandbox"), ""); await preview(page).getByLabel("允许运行脚本").check(); await expect(frame.locator("body")).toHaveAttribute("data-script-ran", "yes"); await expect(frame.locator("body")).toHaveAttribute("data-isolated", "yes");
    assert.equal(await page.locator("body").getAttribute("data-preview-escaped"), null); assert.ok(!(await preview(page).locator("iframe").getAttribute("sandbox"))?.includes("allow-same-origin")); await preview(page).getByLabel("允许运行脚本").uncheck();
    console.log("验收 2/4 通过：含 alert(1) 的真实 HTML 默认不运行；手动开启只在隔离 iframe 执行，无法访问主页面，始终无 allow-same-origin");
    await openPreview(page, "notes.md"); const pollMarker = "POLL REFRESH OK"; await writeFile(join(root, "notes.md"), `# 自动刷新验收\n\n${pollMarker}\n`); await expect(preview(page)).toContainText(pollMarker, { timeout: 15000 });
    await page.getByLabel("搜索对话").fill(""); await folder(page, other); await expect(panel(page).getByRole("tab", { name: "sample.md", exact: true })).toHaveCount(0); await openPreview(page, "notes.md"); await expect(preview(page)).toContainText("OTHER PROJECT ONLY");
    await folder(page, root); await expect(panel(page).getByRole("tab", { name: "sample.md", exact: true })).toHaveCount(1); await panel(page).getByRole("tab", { name: "notes.md", exact: true }).click(); await expect(preview(page)).toContainText(pollMarker);
    await chooseModel(page, "cliproxy", "gpt-6-luna"); await idle(page); await setThinking(page, "low"); await idle(page);
    const marker = `AI-REFRESH-${Date.now().toString(36)}`; await ask(page, `请先读取 notes.md，再只用 edit 或 write 工具在它末尾添加一行“${marker}”。不要改其他文件，完成后回复已完成。`);
    await expect(preview(page)).toContainText(marker, { timeout: 180000 }); await idle(page); assert.ok((await readFile(join(root, "notes.md"), "utf8")).includes(marker));
    assert.ok(wire.some((message) => message.record?.type === "tool_execution_end" && ["edit", "write"].includes(message.record.toolName) && !message.record.isError));
    await tree(page); await expect(panel(page).locator(`.file-node[data-path=${JSON.stringify(join(root, "notes.md"))}]`).getByTestId("file-changed")).toBeVisible();
    await page.getByRole("button", { name: "隐藏文件面板", exact: true }).click(); await page.getByRole("button", { name: /预览工具文件 .*notes\.md/ }).first().click(); await expect(preview(page)).toContainText(marker);
    console.log("验收 3/4 通过：真实 luna/low 读取并 edit/write notes.md，已打开预览无需手动刷新就显示新行，树显示修改点，工具路径重新展开面板；独立 mtime 轮询也通过");
    const token = new URL(backend.url).searchParams.get("token")!; const headers = { Authorization: `Bearer ${token}` };
    assert.equal((await fetch(`${BASE_URL}/api/file?path=~/.ssh/id_ed25519`, { headers })).status, 403);
    assert.equal((await fetch(`${BASE_URL}/api/file?${new URLSearchParams({ cwd: root, path: join(other, "notes.md") })}`, { headers })).status, 403);
    assert.equal((await fetch(`${BASE_URL}/api/file?${new URLSearchParams({ cwd: root, path: "sample.md" })}`)).status, 401);
    console.log("验收 4/4 通过：真实文件接口拒绝 ~/.ssh/id_ed25519（403），越界 403，无口令 401");
    await ask(page, '只输出三部分 Markdown，不要工具：一个 python 代码块 print("CHAT HIGHLIGHT OK")；一个 Mermaid 代码块 flowchart LR 换行 X-->Y；一个显示公式 $$a^2+b^2=c^2$$。');
    await expect(page.locator("article[data-role=assistant]").last().locator(".syntax[data-highlighted=true]")).toBeVisible({ timeout: 180000 }); await idle(page);
    await expect(page.locator("article[data-role=assistant]").last().getByAltText("Mermaid 图表")).toBeVisible({ timeout: 30000 }); await expect(page.locator("article[data-role=assistant]").last().locator(".katex")).toHaveCount(1);
    await page.getByLabel("搜索对话").fill(root.split("/").at(-1)!); await page.screenshot({ path: join(artifacts, "phase-4-light.png") }); await page.emulateMedia({ colorScheme: "dark" }); await page.screenshot({ path: join(artifacts, "phase-4-dark.png") });
    await page.reload(); await idle(page); await expect(preview(page)).toContainText(marker); assert.deepEqual(pageErrors, []);
    const cost = await page.getByTestId("session-cost").innerText(); console.log(`真实聊天 ${cost}；聊天高亮/Mermaid/公式及刷新后文件标签恢复通过`);
    await context.close(); await backend.stop(); backend = undefined; backend = await startBackend({ production: true });
    const production = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const target = { cwd: root, sessionPath: [...sessions].at(-1) };
    await production.addInitScript(({ key, target }) => { if (window === window.top) sessionStorage.setItem(key, JSON.stringify(target)); }, { key: SESSION_KEY, target });
    const prod = await production.newPage(); await prod.goto(backend.url); await idle(prod); await openPreview(prod, "sample.xlsx"); await expect(preview(prod).getByRole("table")).toContainText("合成数据", { timeout: 30000 });
    await openPreview(prod, "sample.docx"); await expect(preview(prod).getByRole("heading", { name: "Word 预览验收" })).toBeVisible({ timeout: 30000 }); await production.close();
    console.log("生产 dist 的实际文档 worker / XLSX / DOCX 预览通过；第 4 阶段全部验收通过。");
  } finally {
    await browser?.close(); await backend?.stop();
    for (const path of sessions) { try { await stat(path); await exec("trash", [path]); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
    await exec("trash", [root, other]);
  }
}
void main().catch((error: Error) => { console.error(`第 4 阶段验收失败：${logText(error.message)}`); process.exitCode = 1; });
