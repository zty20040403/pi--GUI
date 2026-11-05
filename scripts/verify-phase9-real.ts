import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, realpath, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { chromium, expect, type Page } from "@playwright/test";
import { createDeskServer } from "../server/index.js";
import { PiPool } from "../server/pi-pool.js";
import { PiProcess } from "../server/pi-process.js";
import { pluginRunner, parsePiList } from "../server/plugin-command.js";
import { exactVersion } from "../server/plugin-catalog.js";
import { AppSettings } from "../server/settings.js";
import { logText } from "../server/privacy.js";
import { SESSION_KEY } from "../src/api/storage.js";
import { chooseModel, setThinking } from "./ui-helpers.js";
const exec = promisify(execFile); const artifacts = resolve(".pi-desk/verification"); const run = pluginRunner();
const hash = async (path: string) => createHash("sha256").update(await readFile(path)).digest("hex");
async function main() {
  await mkdir(artifacts, { recursive: true }); const root = await realpath(await mkdtemp(join(tmpdir(), "pi-desk-phase9-real-"))); const agentDir = join(root, "agent"); const project = join(root, "project"); const sessionsDir = join(root, "sessions"); const settings = new AppSettings(join(root, "app/settings.json"));
  for (const path of [agentDir, project, sessionsDir]) await mkdir(path);
  const personal = join(homedir(), ".pi/agent"); const protectedHashes = { settings: await hash(join(personal, "settings.json")), models: await hash(join(personal, "models.json")) };
  // 只读引用现有模型定义，让隔离 pi 使用已配置的 luna；不读取、输出或复制任何凭据。
  await symlink(join(personal, "models.json"), join(agentDir, "models.json"));
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ packages: [], defaultTools: [], defaultProvider: "cliproxy", defaultModel: "gpt-6-luna", defaultThinkingLevel: "low", compaction: { enabled: false }, showHardwareCursor: true, terminal: { images: "kitty" }, fixturePreference: { keep: [1, "原有设置"] } }, null, 2));
  await writeFile(join(agentDir, "web-search.json"), JSON.stringify({ provider: "exa", webSearch: { allowedProviders: ["exa"] } }));
  const pool = new PiPool({ permissionsEnabled: false, createProcess: (cwd, args) => new PiProcess(cwd, { args: ["--offline", "--session-dir", join(sessionsDir, "created"), ...args, "--model", "cliproxy/gpt-6-luna", "--thinking", "low"], env: { PI_CODING_AGENT_DIR: agentDir, PI_DESK_APP_SETTINGS_FILE: settings.path, PI_SESSIONS_DIR: sessionsDir } }) });
  const server = createDeskServer({ development: false, pool, sessionsDir, appSettings: settings, pluginOptions: { agentDir } }); const browser = await chromium.launch({ channel: "chrome", headless: true }); const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  const errors: string[] = []; const records: any[] = []; const outbound: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => { if (/^https?:/.test(request.url()) && !request.url().startsWith(`${server.auth.origin}/`)) outbound.push(new URL(request.url()).hostname); });
  page.on("websocket", (socket) => socket.on("framereceived", ({ payload }) => { try { const value = JSON.parse(payload.toString()); if (value.op === "event") records.push(value.record); } catch {} }));
  async function job() { await expect.poll(() => server.plugins.status().job?.status, { timeout: 180000 }).not.toBe("running"); const value = server.plugins.status().job; if (value?.status !== "succeeded") throw new Error(`${value?.error?.message ?? "插件操作失败"}\n${value?.output.join("\n")}`); await page.waitForTimeout(1200); }
  async function reload() { await expect(page.getByRole("button", { name: "立即重新加载", exact: true })).toBeEnabled(); await page.getByRole("button", { name: "立即重新加载", exact: true }).click(); await job(); assert.equal(server.plugins.status().needsReload, false); }
  async function install(name: string) {
    await page.getByRole("tab", { name: "发现", exact: true }).click(); await page.getByLabel("搜索 npm 插件", { exact: true }).fill(name); await page.getByLabel("搜索 npm 插件", { exact: true }).press("Enter");
    const card = page.getByTestId(`catalog-${name}`); await expect(card).toBeVisible({ timeout: 120000 });
    // npm 的发现页会随发布变化；锁定本次页面选中的确切版本，再核对确认框和真实 CLI 结果。
    const version = exactVersion(await card.locator(".plugin-card-footer code").innerText());
    await card.getByRole("button", { name: "安装", exact: true }).click(); await expect(page.getByRole("dialog")).toContainText(version, { timeout: 30000 }); await expect(page.getByRole("dialog")).toContainText("以你的权限运行代码");
    await page.getByRole("button", { name: "确认操作", exact: true }).click(); await job(); await expect(card).toContainText("已安装", { timeout: 30000 });
    assert.ok(parsePiList(await run(["list"], { agentDir })).has(`npm:${name}@${version}`)); console.log(`真实固定版本安装通过：${name}@${version}`); return version;
  }
  async function toggle(enabled: boolean) {
    await page.getByRole("tab", { name: /已安装/ }).click(); const control = page.getByRole("switch", { name: "启用 pi-web-access", exact: true }); await expect(control).toHaveAttribute("aria-checked", String(!enabled)); await control.click(); await page.getByRole("button", { name: "确认操作", exact: true }).click(); await job(); await expect(control).toHaveAttribute("aria-checked", String(enabled));
  }
  async function prompt(text: string) {
    await page.getByRole("button", { name: "返回对话", exact: true }).click(); await expect(page.getByTestId("connection-status")).toContainText("已连接", { timeout: 45000 }); await chooseModel(page, "cliproxy", "gpt-6-luna"); await setThinking(page, "low");
    const start = records.length; await page.getByLabel("消息", { exact: true }).fill(text); await page.getByLabel("消息", { exact: true }).press("Enter");
    await expect.poll(() => records.slice(start).some((record) => record.type === "agent_settled"), { timeout: 180000 }).toBe(true);
    const result = records.slice(start); const assistants = result.filter((record) => record.type === "message_end" && record.message?.role === "assistant").map((record) => record.message); assert.ok(assistants.length); for (const message of assistants) { assert.equal(message.provider, "cliproxy"); assert.equal(message.model, "gpt-6-luna"); assert.equal(message.thinkingLevel, "low"); }
    await page.getByRole("button", { name: "插件", exact: true }).click(); await expect(page.getByRole("switch", { name: "启用 pi-web-access", exact: true })).toBeVisible({ timeout: 45000 }); return result;
  }
  try {
    await server.listen(); await page.addInitScript(({ key, cwd }) => sessionStorage.setItem(key, JSON.stringify({ cwd })), { key: SESSION_KEY, cwd: project }); await page.goto(server.auth.launchUrl); await expect(page.getByTestId("connection-status")).toContainText("已连接", { timeout: 45000 }); await page.getByLabel("消息", { exact: true }).fill("真实空对话重载后保留草稿"); await page.getByRole("button", { name: "插件", exact: true }).click();
    const webVersion = await install("pi-web-access"); await reload();
    await page.getByRole("button", { name: "返回对话", exact: true }).click(); await expect(page.getByLabel("消息", { exact: true })).toHaveValue("真实空对话重载后保留草稿"); await page.getByRole("button", { name: "插件", exact: true }).click();
    await toggle(false);
    const disabled = (await server.plugins.settings.snapshot()).data; const config = disabled.packages?.find((row) => typeof row !== "string" && row.source === `npm:pi-web-access@${webVersion}`) as Record<string, unknown>; assert.ok(config); for (const key of ["extensions", "skills", "prompts", "themes"]) assert.deepEqual(config[key], []);
    const activation = await readFile(join(homedir(), ".local/share/pi-agent/current/activate"), "utf8");
    const commands = [...activation.matchAll(/run (\S*python) (\S*merge-json-settings\.py)\s*\\\n\s*\S*\/settings\.json\s*\\\n\s*'([^']+)'/g)]; assert.ok(commands.length > 0, "没有找到 setup.sh 实际使用的设置合并脚本");
    for (const [, python, script, declared] of commands) { const change = JSON.parse(declared); assert.equal(change.packages, undefined); assert.equal(change.extensions, undefined); await exec(python, [script, join(agentDir, "settings.json"), declared]); }
    assert.deepEqual((await server.plugins.settings.snapshot()).data, disabled); console.log("setup.sh 实际设置合并逻辑在隔离副本运行通过，停用状态及其他字段不变；没有执行解密/重建链接步骤。");
    await reload(); const off = await prompt("请用 web_search 搜索 Node.js 官网。如果你当前没有搜索工具，只回答：没有搜索工具。不要使用任何其他方式联网，也不要猜测搜索结果。");
    assert.ok(!off.some((row) => row.type === "tool_execution_start" && row.toolName === "web_search")); assert.ok(off.some((row) => row.type === "message_end" && row.message?.role === "assistant" && row.message.content.some((part: any) => part.type === "text" && part.text.includes("没有搜索工具"))));
    await toggle(true); await reload(); const on = await prompt("请实际调用一次 web_search，参数必须恰好为 {\"queries\":[\"Node.js official website\"],\"provider\":\"exa\",\"numResults\":2,\"includeContent\":false,\"workflow\":\"none\"}。queries 数组必须包含搜索词，不能是空数组；不要传 model 字段（Exa 不支持）。最后用一句中文说明搜到的官网；不要调用其他工具，不要假装已搜索。");
    assert.ok(on.some((row) => row.type === "tool_execution_start" && row.toolName === "web_search"), "启用后没有实际调用 web_search"); const results = on.filter((row) => row.type === "message_end" && row.message?.role === "toolResult" && row.message.toolName === "web_search"); if (!results.some((row) => !row.message.isError && JSON.stringify(row.message.content).includes("nodejs.org"))) {
      const evidence = logText(JSON.stringify({ results: results.map((row) => row.message), events: on.filter((row) => row.type.startsWith("tool_")).map((row) => ({ type: row.type, toolName: row.toolName, args: row.args, isError: row.isError, result: row.result })) }, null, 2));
      await writeFile(join(artifacts, "phase-9-search-failure.json"), evidence); throw new Error(`搜索没有返回 Node.js 官网；脱敏详情：${evidence.slice(0, 6000)}`);
    } console.log("真实 pi-web-access 停用后模型确认没有搜索工具；启用后实际联网搜索返回 Node.js 官网。");
    const smallVersion = await install("@juicesharp/rpiv-ask-user-question"); await page.getByRole("tab", { name: /已安装/ }).click();
    await page.getByRole("button", { name: "卸载 @juicesharp/rpiv-ask-user-question", exact: true }).click(); await expect(page.getByRole("dialog")).toContainText("会删除这个插件的文件"); await page.getByRole("button", { name: "确认操作", exact: true }).click(); await job(); assert.ok(!parsePiList(await run(["list"], { agentDir })).has(`npm:@juicesharp/rpiv-ask-user-question@${smallVersion}`)); console.log("真实小插件从发现页面安装、pi list 出现、卸载后消失。");
    assert.deepEqual((await server.plugins.settings.snapshot()).data.fixturePreference, { keep: [1, "原有设置"] }); assert.ok((await readdir(join(root, "app/backups"))).length >= 4); assert.deepEqual(errors, []); assert.deepEqual(outbound, []);
    for (const colorScheme of ["dark", "light"] as const) { await page.emulateMedia({ colorScheme }); await page.screenshot({ path: join(artifacts, `phase-9-real-installed-${colorScheme}.png`) }); }
    const cost = records.filter((row) => row.type === "message_end" && row.message?.role === "assistant").reduce((sum, row) => sum + (row.message.usage?.cost?.total ?? 0), 0);
    await writeFile(join(artifacts, "phase-9-real-summary.json"), JSON.stringify({ realPi: true, isolatedConfig: true, webAccess: webVersion, disabledNoSearch: true, enabledRealSearch: true, installedAndRemoved: `@juicesharp/rpiv-ask-user-question@${smallVersion}`, originalFieldsPreserved: true, setupMergeCommands: commands.length, browserExternalRequests: 0, model: "cliproxy/gpt-6-luna", thinking: "low", cost }, null, 2));
    console.log(`第 9 阶段真实验收通过，模型费用 $${cost.toFixed(6)}。`);
  } finally { await browser.close(); await server.close(); assert.equal(await hash(join(personal, "settings.json")), protectedHashes.settings, "个人 settings.json 被改动"); assert.equal(await hash(join(personal, "models.json")), protectedHashes.models, "个人 models.json 被改动"); await exec("trash", [root]); }
}
void main().catch((error: Error) => { console.error(`第 9 阶段真实验收未通过：${logText(error.message)}`); process.exitCode = 1; });
