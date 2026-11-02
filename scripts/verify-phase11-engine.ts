import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { _electron, expect, type Page } from "@playwright/test";
import { SESSION_KEY } from "../src/api/storage.js";
import { chooseModel, expectModelReady, setThinking } from "./ui-helpers.js";
import { logText } from "../server/privacy.js";
import { macAppPath } from "./desktop-paths.js";
const exec = promisify(execFile); const artifacts = resolve(".pi-desk/verification");
async function idle(page: Page) { await expect(page.getByTestId("connection-status")).toContainText("已连接", { timeout: 40000 }); await expectModelReady(page); }
async function main() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "pi-desk-phase11-engine-"))); const profile = join(root, "profile"); const project = join(root, "project"); const settings = join(root, "settings.json"); const errors: string[] = []; const sessions = new Set<string>();
  const packaged = process.env.PI_DESK_VERIFY_PACKAGED === "1"; let app: Awaited<ReturnType<typeof _electron.launch>> | undefined;
  try {
    await mkdir(profile); await mkdir(project); await mkdir(artifacts, { recursive: true }); await writeFile(join(profile, "window.json"), JSON.stringify({ workspace: project })); await writeFile(settings, JSON.stringify({ engine: "auto" }));
    const launch = () => _electron.launch({ ...(packaged ? { executablePath: join(macAppPath, "Contents/MacOS/pi desk"), args: [`--user-data-dir=${profile}`] } : { args: [resolve("."), `--user-data-dir=${profile}`] }), env: { ...process.env, PATH: "/usr/bin:/bin", PI_DESK_APP_SETTINGS_FILE: settings }, timeout: 45000 });
    app = await launch(); let page = await app.firstWindow(); page.on("pageerror", (error) => errors.push(error.message)); await idle(page);
    await page.getByLabel("搜索对话").fill(root.split("/").at(-1)!); await chooseModel(page, "cliproxy", "gpt-6-luna"); await setThinking(page, "low");
    await page.getByLabel("消息", { exact: true }).fill("只回复 系统引擎验收通过，不调用工具。"); await page.getByLabel("消息", { exact: true }).press("Enter");
    await expect(page.locator("article[data-role=assistant]").last()).toContainText("系统引擎验收通过", { timeout: 180000 }); await expect(page.getByRole("button", { name: "停止", exact: true })).toHaveCount(0, { timeout: 30000 }); await idle(page);
    const sessionPath = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)!).sessionPath as string, SESSION_KEY); assert.ok(sessionPath); sessions.add(sessionPath);
    await page.getByLabel("消息", { exact: true }).fill("这份草稿不能丢，也不能自动发送");
    await page.getByRole("button", { name: "设置", exact: true }).click(); await expect(page.getByTestId("engine-current")).toContainText("系统 pi（1.4.0）");
    for (const colorScheme of ["dark", "light"] as const) for (const width of [1440, 1024]) {
      await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 950), width); await page.emulateMedia({ colorScheme }); await page.screenshot({ path: join(artifacts, `phase-11-engine-${packaged ? "packaged" : "dev"}-${colorScheme}-${width}.png`) });
    }
    await page.getByTestId("engine-auto").focus(); await page.keyboard.press("ArrowDown"); await expect(page.getByTestId("engine-system")).toBeFocused(); await page.keyboard.press("ArrowDown"); await expect(page.getByTestId("engine-builtin")).toBeFocused(); await page.keyboard.press("Tab"); await expect(page.getByRole("button", { name: "应用引擎", exact: true })).toBeFocused(); await page.keyboard.press("Enter"); await expect(page.getByTestId("engine-current")).toContainText("内置 pi（1.4.0）", { timeout: 45000 });
    await page.getByRole("button", { name: "关闭设置", exact: true }).click(); await idle(page);
    await expect(page.getByLabel("消息", { exact: true })).toHaveValue("这份草稿不能丢，也不能自动发送"); await expect(page.locator("article[data-role=user]")).toHaveCount(1); await expect(page.locator("article[data-role=assistant]").last()).toContainText("系统引擎验收通过");
    assert.equal(await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)!).sessionPath, SESSION_KEY), sessionPath);
    await expect(page.getByTestId("model-trigger")).toHaveAttribute("data-model", "gpt-6-luna"); await expect(page.getByTestId("model-trigger")).toHaveAttribute("data-thinking", "low");
    await page.getByLabel("消息", { exact: true }).fill("只回复 内置引擎验收通过，不调用工具。"); await page.getByLabel("消息", { exact: true }).press("Enter"); await expect(page.locator("article[data-role=assistant]").last()).toContainText("内置引擎验收通过", { timeout: 180000 }); await expect(page.getByRole("button", { name: "停止", exact: true })).toHaveCount(0, { timeout: 30000 }); await idle(page);
    await page.getByRole("button", { name: "设置", exact: true }).click(); await expect(page.getByTestId("engine-current")).toContainText("内置 pi（1.4.0）"); await page.screenshot({ path: join(artifacts, `phase-11-engine-${packaged ? "packaged" : "dev"}-builtin.png`) });
    assert.equal(JSON.parse(await readFile(settings, "utf8")).engine, "builtin"); await app.close(); app = undefined;
    app = await launch(); page = await app.firstWindow(); page.on("pageerror", (error) => errors.push(error.message)); await idle(page); await page.getByLabel("搜索对话").fill(root.split("/").at(-1)!);
    await page.locator(`[data-session-path="${sessionPath}"] .session-open`).click(); await idle(page); await expect(page.locator("article[data-role=assistant]").last()).toContainText("内置引擎验收通过");
    await page.getByRole("button", { name: "设置", exact: true }).click(); await expect(page.getByTestId("engine-current")).toContainText("内置 pi（1.4.0）");
    await page.getByTestId("engine-auto").click(); await page.getByRole("button", { name: "应用引擎", exact: true }).click(); await expect(page.getByTestId("engine-current")).toContainText("系统 pi（1.4.0）", { timeout: 45000 }); assert.deepEqual(errors, []);
    await writeFile(join(artifacts, `phase-11-engine-${packaged ? "packaged" : "dev"}-summary.json`), JSON.stringify({ packaged, systemChat: true, builtinChat: true, draftPreserved: true, modelAndThinkingPreserved: true, historyPreserved: true, reopened: true, switchBack: true, engine: "1.4.0", electron: "44.10.1", model: "cliproxy/gpt-6-luna", thinking: "low" }, null, 2));
    console.log(`${packaged ? "打包 App" : "开发 Electron"}引擎验收通过：系统与内置真实 Luna/low 聊天、切换保留草稿/历史/模型、退出重开保持选择、切回自动。`);
  } finally { await app?.close(); for (const path of sessions) { try { await stat(path); await exec("trash", [path]); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } } await exec("trash", [root]); }
}
void main().catch((error) => { console.error(`第 11 阶段引擎验收失败：${logText(String(error))}`); process.exitCode = 1; });
