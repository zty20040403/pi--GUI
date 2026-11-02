import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { chromium, expect, type Page } from "@playwright/test";
import { createDeskServer } from "../server/index.js";
import { PiPool } from "../server/pi-pool.js";
import { PiProcess } from "../server/pi-process.js";
import { AppSettings } from "../server/settings.js";
import { PluginCatalog, npmSource } from "../server/plugin-catalog.js";
import { logText } from "../server/privacy.js";
import { sourceOf } from "../server/plugin-settings.js";
import { SESSION_KEY } from "../src/api/storage.js";
const exec = promisify(execFile); const artifacts = resolve(".pi-desk/verification");
async function shots(page: Page, name: string) {
  for (const colorScheme of ["dark", "light"] as const) for (const width of [1440, 1024]) {
    await page.emulateMedia({ colorScheme }); await page.setViewportSize({ width, height: 900 }); await page.waitForTimeout(80);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const dialog = page.locator(".plugin-confirm"); if (await dialog.count()) { const bounds = await dialog.boundingBox(); assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= 900); }
    await page.screenshot({ path: join(artifacts, `phase-9-${name}-${colorScheme}-${width}.png`), animations: "disabled" });
  }
}
async function main() {
  await mkdir(artifacts, { recursive: true }); const root = await realpath(await mkdtemp(join(tmpdir(), "pi-desk-phase9-ui-"))); const agentDir = join(root, "agent"); const project = join(root, "project"); const sessionsDir = join(root, "sessions");
  for (const path of [agentDir, project, sessionsDir, join(agentDir, "extensions"), join(agentDir, "npm/node_modules/pi-fixture")]) await mkdir(path, { recursive: true });
  await writeFile(join(agentDir, "npm/node_modules/pi-fixture/package.json"), JSON.stringify({ name: "pi-fixture", version: "1.0.0", description: "为项目提供轻量的测试工具" }));
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ packages: ["npm:pi-fixture@1.0.0"], fixturePreference: { preserved: true } }));
  await writeFile(join(agentDir, "extensions", "local-helper.ts"), "export default () => {};\n");
  await symlink("/nix/store/qmkyjg4hfp5c3fjznkwarqn3sxfkdwrb-pi-1.4.0/libexec/pi/examples/extensions/dynamic-tools.ts", join(agentDir, "extensions", "setup-managed.ts"));
  let failInstall = false; let commands = 0;
  const catalog = new PluginCatalog(async (input) => {
    const url = new URL(String(input)); const name = decodeURIComponent(url.pathname.split("/")[1] ?? "");
    if (url.pathname.startsWith("/-/v1/search")) return Response.json({ objects: ["pi-fixture", "@fixture/notes"].map((name, index) => ({ package: { name, version: "2.0.0", description: index ? "把项目中的笔记整理成容易复用的上下文，保持对话简洁。" : "为 pi 添加实用工具和便捷命令。", date: "2026-10-28", publisher: { username: "fixture-author" } } })) });
    if (url.hostname === "api.npmjs.org") return Response.json({ downloads: url.pathname.endsWith("pi-fixture") ? 12500 : 2360 });
    return Response.json({ name, version: "2.0.0", description: "为 pi 添加实用工具和便捷命令。", license: "MIT", repository: { url: "https://github.com/example/pi-plugin" } });
  });
  const pool = new PiPool({ createProcess: (cwd, args) => new PiProcess(cwd, { binary: process.execPath, args: [resolve("scripts/fixtures/fake-pi.mjs"), ...args] }) });
  const server = createDeskServer({ pool, development: false, sessionsDir, appSettings: new AppSettings(join(root, "app/settings.json")), pluginOptions: { agentDir, catalog, run: async (args, options) => {
    if (args[0] === "--version") return "1.4.0";
    if (args[0] === "list") { const data = JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8")); return `User packages:\n${(data.packages ?? []).map((row: any) => { const source = sourceOf(row); return `  ${source}\n    ${join(agentDir, "npm/node_modules", npmSource(source)!.name)}\n`; }).join("")}`; }
    commands++; const parsed = npmSource(args[1])!; options.output?.("准备固定版本…"); await new Promise((done) => setTimeout(done, 300));
    if (failInstall) throw new Error("合成安装失败，请检查网络后重试");
    const location = join(agentDir, "npm/node_modules", parsed.name);
    if (args[0] === "install") { await mkdir(location, { recursive: true }); await writeFile(join(location, "package.json"), JSON.stringify({ name: parsed.name, version: parsed.version, description: "安装验收插件" })); }
    else if (await stat(location).catch(() => undefined)) await exec("trash", [location]); options.output?.("fixture command complete"); return "";
  } } });
  const browser = await chromium.launch({ channel: "chrome", headless: true }); const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" }); const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  const settled = async () => { await expect.poll(() => server.plugins.status().job?.status, { timeout: 15000 }).not.toBe("running"); await expect(page.getByRole("switch", { name: "启用 pi-fixture", exact: true })).toBeEnabled(); };
  try {
    await server.listen(); await page.addInitScript(({ key, cwd }) => sessionStorage.setItem(key, JSON.stringify({ cwd })), { key: SESSION_KEY, cwd: project });
    await page.goto(server.auth.launchUrl); await expect(page.getByTestId("connection-status")).toContainText("已连接");
    await page.getByLabel("消息", { exact: true }).fill("未发送的插件验收草稿"); await page.getByRole("button", { name: "插件", exact: true }).click();
    await expect(page.getByRole("switch", { name: "启用 pi-fixture", exact: true })).toBeVisible(); await expect(page.getByTestId("plugin-setup-managed.ts")).toContainText("setup.sh"); await shots(page, "installed");
    await page.getByRole("switch", { name: "启用 pi-fixture", exact: true }).click(); await page.getByRole("button", { name: "取消", exact: true }).click(); await expect(page.getByRole("switch", { name: "启用 pi-fixture", exact: true })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("switch", { name: "启用 pi-fixture", exact: true }).click(); await page.getByRole("button", { name: "确认操作", exact: true }).click(); await settled(); await expect(page.getByRole("switch", { name: "启用 pi-fixture", exact: true })).toHaveAttribute("aria-checked", "false"); await expect(page.getByRole("button", { name: "立即重新加载", exact: true })).toBeVisible();
    await page.getByRole("switch", { name: "启用 pi-fixture", exact: true }).click(); await page.getByRole("button", { name: "确认操作", exact: true }).click(); await settled();
    await page.getByRole("tab", { name: "发现", exact: true }).click(); await page.getByLabel("搜索 npm 插件", { exact: true }).fill("fixture"); await page.getByLabel("搜索 npm 插件", { exact: true }).press("Enter");
    await expect(page.getByTestId("catalog-@fixture/notes")).toBeVisible(); await expect(page.getByTestId("catalog-pi-fixture")).toContainText("已安装"); await shots(page, "discover");
    const install = page.getByTestId("catalog-@fixture/notes").getByRole("button", { name: "安装", exact: true });
    await install.evaluate((button) => (button as HTMLButtonElement).click()); await expect(page.locator(".plugin-error")).toContainText("手动点击"); assert.equal(commands, 0);
    await install.click(); await expect(page.getByRole("dialog")).toContainText("以你的权限运行代码"); await expect(page.getByRole("dialog")).toContainText("2.0.0"); await shots(page, "install-confirm");
    await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toHaveCount(0); assert.equal(commands, 0);
    failInstall = true; await install.click(); await page.getByRole("button", { name: "确认操作", exact: true }).click(); await expect(page.locator(".plugin-job")).toContainText("合成安装失败"); assert.equal(server.plugins.status().job?.status, "failed");
    failInstall = false; await install.click(); await page.getByRole("button", { name: "确认操作", exact: true }).click(); await expect(page.getByTestId("catalog-@fixture/notes")).toContainText("已安装", { timeout: 15000 });
    await page.getByRole("tab", { name: "更新", exact: true }).click(); await page.getByRole("button", { name: "检查更新", exact: true }).click(); await expect(page.getByTestId("catalog-pi-fixture")).toContainText("1.0.0 → 2.0.0"); await shots(page, "updates");
    await page.getByTestId("catalog-pi-fixture").getByRole("button", { name: "更新", exact: true }).click(); await page.getByRole("button", { name: "确认操作", exact: true }).click(); await expect.poll(() => server.plugins.status().job?.status).toBe("succeeded");
    await page.getByRole("tab", { name: /已安装/ }).click(); await expect(page.getByTestId("plugin-pi-fixture")).toContainText("2.0.0");
    await page.getByRole("button", { name: "卸载 @fixture/notes", exact: true }).click(); await expect(page.getByRole("dialog")).toContainText("会删除这个插件的文件"); await page.getByRole("button", { name: "确认操作", exact: true }).click(); await expect(page.getByTestId("plugin-@fixture/notes")).toHaveCount(0);
    await page.getByRole("button", { name: "立即重新加载", exact: true }).click(); await expect.poll(() => server.plugins.status().needsReload, { timeout: 15000 }).toBe(false);
    await page.getByRole("button", { name: "返回对话", exact: true }).click(); await expect(page.getByTestId("connection-status")).toContainText("已连接"); await expect(page.getByLabel("消息", { exact: true })).toHaveValue("未发送的插件验收草稿");
    assert.deepEqual((await server.plugins.settings.snapshot()).data.fixturePreference, { preserved: true }); assert.deepEqual(errors, []);
    console.log("第 9 阶段界面验收通过：已安装/发现/更新、启停/取消/安装失败与重试/更新/卸载、脚本点击拒绝、重载恢复草稿；深浅 1440/1024 共 16 张截图（此脚本的 npm/pi 为隔离替身，真实验收单独运行）。");
  } finally { await browser.close(); await server.close(); await exec("trash", [root]); }
}
void main().catch((error: Error) => { console.error(logText(error.message)); process.exitCode = 1; });
