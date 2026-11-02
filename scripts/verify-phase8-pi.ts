import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { chromium, expect } from "@playwright/test";
import { startBackend } from "./server-runner.js";
import { chooseModel, setThinking, setPermission, openModelMenu } from "./ui-helpers.js";
import { SESSION_KEY } from "../src/api/storage.js";
import { logText } from "../server/privacy.js";
const exec = promisify(execFile);
async function main() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "pi-desk-menus-"))); const cwd = join(root, "workspace");
  for (const directory of [cwd, join(root, "agent"), join(root, "sessions")]) await mkdir(directory);
  // 仅选择模型和设置档位/权限，不发任何模型请求；不改用户的 models/settings。
  const backend = await startBackend({ production: true, entry: "scripts/phase7-errors-server.ts", env: { PI_DESK_TEST_ROOT: root, PI_DESK_WORKSPACE: cwd, PI_DESK_TEST_PERMISSIONS: "1", PI_DESK_TEST_FAILURE_ENDPOINT: "http://127.0.0.1:1/v1" } });
  const browser = await chromium.launch({ channel: "chrome", headless: true }); const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" }); const wire: any[] = []; const errors: string[] = [];
  await page.addInitScript(({ key, cwd }) => sessionStorage.setItem(key, JSON.stringify({ cwd })), { key: SESSION_KEY, cwd });
  page.on("pageerror", (error) => errors.push(error.message)); page.on("websocket", (socket) => socket.on("framereceived", ({ payload }) => { wire.push(JSON.parse(payload.toString())); }));
  const currentLevels = () => wire.filter((row) => row.response?.command === "get_available_thinking_levels").at(-1)?.response.data.levels as string[];
  try {
    await page.goto(backend.url); await chooseModel(page, "cliproxy", "gpt-6-luna"); await setThinking(page, "low"); await openModelMenu(page);
    const reasoningLevels = currentLevels(); assert.ok(reasoningLevels.includes("low") && reasoningLevels.length > 1);
    await expect(page.getByRole("slider")).toHaveAttribute("data-levels", reasoningLevels.join(",")); await expect(page.locator(".thinking-ticks button")).toHaveCount(reasoningLevels.length); await page.keyboard.press("Escape");
    await chooseModel(page, "cliproxy", "no-reasoning-fixture"); await openModelMenu(page); assert.deepEqual(currentLevels(), ["off"]); await expect(page.getByRole("slider")).toBeDisabled(); await expect(page.locator(".thinking-ticks button")).toHaveCount(1); await expect(page.getByTestId("model-trigger-panel")).toContainText("这个模型不支持调节推理强度"); await page.keyboard.press("Escape");
    await chooseModel(page, "cliproxy", "gpt-6-luna"); await setThinking(page, "low");
    await setPermission(page, "read-only"); await setPermission(page, "auto"); await setPermission(page, "full"); await expect(page.locator(".safety-hint")).toBeVisible(); await setPermission(page, "auto");
    assert.ok(wire.some((row) => row.response?.command === "set_model" && row.response.success)); assert.ok(wire.some((row) => row.response?.command === "set_thinking_level" && row.response.success)); assert.deepEqual(errors, []);
    await writeFile(resolve(".pi-desk/verification/phase-8-pi-summary.json"), JSON.stringify({ realPi: true, isolatedSyntheticModels: true, paidModelRequests: 0, reasoningLevels, nonReasoningLevels: ["off"], restoredLevel: "low", permissionModes: ["read-only", "auto", "full", "auto"], pageErrors: 0 }, null, 2));
    console.log("第 8 阶段真实 pi 验收通过：隔离模型目录、真实 get_available_thinking_levels 多档→仅 off→恢复；自绘菜单实际切模型、low 档与三档权限，无模型调用。");
  } finally { await browser.close(); await backend.stop(); await exec("trash", [root]); }
}
void main().catch((error: Error) => { console.error(logText(error.message)); process.exitCode = 1; });
