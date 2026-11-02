import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium, expect, type Browser, type Page } from "@playwright/test";
import { phase10Fixture, changePrompt } from "./verify-phase10-capture.js";
import { SESSION_KEY } from "../src/api/storage.js";
import { logText } from "../server/privacy.js";
const artifacts = resolve(".pi-desk/verification");
async function shots(page: Page, name: string, panel: boolean) {
  for (const colorScheme of ["dark", "light"] as const) for (const width of [1440, 1024]) {
    await page.emulateMedia({ colorScheme }); await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
    if (panel && !await page.getByTestId("review-panel").isVisible()) await page.getByRole("button", { name: "展开文件面板", exact: true }).click();
    if (!panel && await page.getByRole("button", { name: "收起文件面板", exact: true }).isVisible()) await page.getByRole("button", { name: "收起文件面板", exact: true }).click();
    if (panel) { await expect(page.getByTestId("review-panel").getByTestId("diff-view")).toBeVisible(); const box = await page.locator(".file-panel").boundingBox(); assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1); }
    else if (name === "tool") await page.locator('details[data-tool="edit"][open]').first().evaluate((element) => element.scrollIntoView({ block: "center" }));
    else await page.getByTestId("turn-changes").last().scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: join(artifacts, `phase-10-${name}-${colorScheme}-${width}.png`), animations: "disabled" });
  }
}
async function main() {
  await mkdir(artifacts, { recursive: true }); const f = await phase10Fixture(); let desk = f.create(); let browser: Browser | undefined; const errors: string[] = [];
  const launch = async (sessionPath?: string) => {
    browser = await chromium.launch({ channel: "chrome", headless: true }); const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" }); page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(({ key, target }) => { if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, JSON.stringify(target)); }, { key: SESSION_KEY, target: { cwd: f.cwd, sessionPath } });
    await page.goto(desk.auth.launchUrl); await expect(page.getByTestId("connection-status")).toHaveAttribute("data-state", "ready", { timeout: 60000 }); return page;
  };
  try {
    await desk.listen(); let page = await launch();
    await expect(page.getByTestId("model-trigger")).toHaveAttribute("data-model", "gpt-6-luna"); await expect(page.getByTestId("model-trigger")).toHaveAttribute("data-thinking", "low");
    const input = page.getByLabel("消息", { exact: true }); await input.fill(changePrompt); await input.press("Enter");
    const card = page.getByTestId("turn-changes"); await expect(card).toHaveCount(1, { timeout: 180000 }); await expect(card).toContainText("改动了 3 个文件");
    await expect(card.locator("header .change-added")).toHaveText("+4"); await expect(card.locator("header .change-removed")).toHaveText("−2");
    await shots(page, "card", false); await page.setViewportSize({ width: 1440, height: 900 });
    await card.locator('[data-change-path="src/math.ts"]').click(); const panel = page.getByTestId("review-panel");
    await expect(panel.locator(".diff-row.removed")).toContainText("export const answer = 1;"); await expect(panel.locator(".diff-row.added")).toContainText("export const answer = 42;");
    await expect(panel.getByTestId("diff-view")).toHaveAttribute("data-highlighted", "true");
    const fold = panel.getByRole("button", { name: "展开 87 行未改动内容", exact: true }); await expect(fold).toBeVisible(); await fold.click(); await expect(panel.locator('[data-old-line="1"]')).toContainText("unchanged line 1"); await panel.getByRole("button", { name: "收起未改动内容", exact: true }).click();
    await shots(page, "unified", true); await page.setViewportSize({ width: 1440, height: 900 });
    await panel.getByRole("button", { name: "并排视图", exact: true }).click(); await expect(panel.locator(".diff-half.removed")).toContainText("export const answer = 1;"); await expect(panel.locator(".diff-half.added")).toContainText("export const answer = 42;"); await shots(page, "split", true);
    // 工具卡片用同一个 diff，直接表示这一工具，而非整轮或当前磁盘。
    await page.getByRole("button", { name: "收起文件面板", exact: true }).click(); const edit = page.locator('details[data-tool="edit"]').filter({ has: page.locator('button.tool-path', { hasText: "src/math.ts" }) }).first(); await edit.locator(":scope > summary").press("Enter"); await expect(edit).toHaveAttribute("open", ""); await expect(edit.getByTestId("diff-view")).toBeVisible(); await expect(edit.locator(".diff-row.added")).toContainText("answer = 42"); await shots(page, "tool", false); await edit.locator(":scope > summary").press("Enter");
    // 再做一轮，验证范围真的不同，并保留旧轮的不可变快照。
    await page.setViewportSize({ width: 1440, height: 900 }); await input.fill("只用 edit 将 src/math.ts 的 export const answer = 42; 改为 export const answer = 43;，其他内容不要改。完成后简短回复。"); await input.press("Enter"); await expect(card).toHaveCount(2, { timeout: 180000 }); await expect(card.last()).toContainText("改动了 1 个文件");
    await card.first().locator('[data-change-path="src/math.ts"]').click(); await expect(panel.locator(".diff-half.added")).toContainText("answer = 42");
    await panel.getByTestId("change-scope-session").click(); await expect(panel.locator(".review-file-list button")).toHaveCount(3); await panel.locator('[data-review-path="src/math.ts"]').click(); await expect(panel.locator(".diff-half.added")).toContainText("answer = 43");
    // 普通外部写入只在 Git 范围出现，不能混进 App 捕获的历史。
    await writeFile(join(f.cwd, "notes.md"), "# Notes\n\nStatus: external\n"); await writeFile(join(f.cwd, "literal.html"), "<script>globalThis.diffShouldNotRun = true</script>\n");
    await panel.getByTestId("change-scope-git").click(); await expect(panel.locator(".review-file-list button")).toHaveCount(4); await panel.locator('[data-review-path="literal.html"]').click(); await expect(panel.getByTestId("diff-view")).toContainText("<script>globalThis.diffShouldNotRun = true</script>"); assert.equal(await page.evaluate(() => (globalThis as any).diffShouldNotRun), undefined);
    await panel.locator('[data-review-path="notes.md"]').click(); await expect(panel.getByTestId("diff-view")).toContainText("Status: external"); await panel.getByTestId("change-scope-session").click(); await panel.locator('[data-review-path="notes.md"]').click(); await expect(panel.getByTestId("diff-view")).toContainText("Status: ready");
    await page.reload(); await expect(page.getByTestId("connection-status")).toHaveAttribute("data-state", "ready"); await expect(card).toHaveCount(2); await expect(panel).toBeVisible(); await expect(panel.getByTestId("change-scope-session")).toHaveAttribute("aria-pressed", "true");
    const projects = await (await fetch(`${desk.auth.origin}/api/projects`, { headers: { Authorization: `Bearer ${desk.auth.token}` } })).json(); const sessionPath = projects.projects.find((project: any) => project.cwd === f.cwd).sessions[0].path;
    await browser!.close(); browser = undefined; await desk.close(); desk = f.create(); await desk.listen(); page = await launch(sessionPath);
    await expect(page.getByTestId("turn-changes")).toHaveCount(2); await expect(page.getByTestId("turn-changes").first()).toContainText("改动了 3 个文件");
    assert.equal(await readFile(join(f.cwd, "src/math.ts"), "utf8"), f.before.replace("answer = 1", "answer = 43")); assert.deepEqual(errors, []);
    await writeFile(join(artifacts, "phase-10-summary.json"), JSON.stringify({ realPi: true, provider: "cliproxy", model: "gpt-6-luna", thinking: "low", firstTurn: { files: 3, added: 4, removed: 2 }, secondTurn: { files: 1 }, scopes: ["turn", "session", "git"], folded: 87, unified: true, split: true, highlighted: true, toolDiff: true, externalOnlyInGit: true, literalCodeNotExecuted: true, pageReload: true, backendAndBrowserRestart: true, pageErrors: errors.length, screenshots: 16 }, null, 2));
    console.log("第 10 阶段真实界面验收通过：两轮真实修改、正确行数、三个范围、统一/并排/语法高亮/折叠、工具 diff、外部改动隔离、刷新和重开恢复，16 张深浅 1440/1024 截图。");
  } finally { await browser?.close(); await desk.close(); await f.cleanup(); }
}
void main().catch((error: Error) => { console.error(logText(error.message)); process.exitCode = 1; });
