import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { chromium, expect, type Page, type WebSocketRoute } from "@playwright/test";
import { startBackend } from "./server-runner.js";
import { SESSION_KEY } from "../src/api/storage.js";
import { logText } from "../server/privacy.js";
const artifacts = resolve(".pi-desk/verification");
async function shots(page: Page, name: string) {
  for (const colorScheme of ["dark", "light"] as const) for (const width of [1440, 1024]) {
    await page.emulateMedia({ colorScheme }); await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
    const panel = await page.locator(".desk-popover, .permission-confirm").boundingBox(); assert.ok(panel && panel.x >= 0 && panel.x + panel.width <= width && panel.y >= 0 && panel.y + panel.height <= 900);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: join(artifacts, `phase-8-${name}-${colorScheme}-${width}.png`), animations: "disabled" });
  }
}
async function main() {
  await mkdir(artifacts, { recursive: true }); const backend = await startBackend({ production: true }); const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" }); const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  const models = [
    { provider: "cliproxy", id: "gpt-6-luna", name: "Luna", reasoning: true, cost: { input: 0.1, output: 0.4 } },
    { provider: "cliproxy", id: "gpt-6-sol-fixture", name: "Sol", reasoning: true, cost: { input: 2, output: 10 } },
    { provider: "ninfer", id: "limited-fixture", name: "Limited", reasoning: true, cost: { input: 0.2, output: 0.8 } },
    { provider: "ninfer", id: "no-reasoning-fixture", name: "No reasoning", reasoning: false },
  ];
  let model = models[1], thinking = "high", permission = "auto", sequence = 1, route: WebSocketRoute;
  let busy = false, failNext = false; const received: any[] = [];
  const levels = () => model.id === "limited-fixture" ? ["low", "high"] : model.reasoning ? ["off", "minimal", "low", "medium", "high", "xhigh"] : ["off"];
  const snapshot = () => ({ model, thinkingLevel: thinking, sessionId: "menu-fixture", isStreaming: busy });
  const emit = (record: object) => route.send(JSON.stringify({ op: "event", cwd: "/fixture", seq: sequence++, record }));
  const ui = () => ({ seq: sequence++, dialogs: [], statuses: { ["desk" + "-permissions"]: `权限：${permission === "full" ? "完全放开" : permission === "read-only" ? "只读" : "自动"}` }, widgets: {} });
  await page.addInitScript((key) => sessionStorage.setItem(key, JSON.stringify({ cwd: "/fixture" })), SESSION_KEY);
  for (const [path, json] of Object.entries({ workspace: { cwd: "/fixture" }, projects: { projects: [] }, "tree**": { entries: [] }, "goals**": { goals: [] }, "changes?**": { turns: [], git: false } })) await page.route(`**/api/${path}`, (route) => route.fulfill({ json }));
  await page.routeWebSocket(/\/ws\?/, (ws) => {
    route = ws;
    ws.onMessage(async (raw) => {
      const message = JSON.parse(raw.toString()); received.push(message);
      const result = (data: unknown) => ws.send(JSON.stringify({ op: "rpc_result", reqId: message.reqId, response: { success: true, data } }));
      if (message.op === "open") { ws.send(JSON.stringify({ op: "opened", cwd: "/fixture", state: snapshot(), messages: [], stats: {}, models, commands: [], seq: sequence, ui: ui() })); return; }
      if (message.op !== "rpc") return;
      const cmd = message.cmd;
      if (cmd.type === "get_state") return result(snapshot());
      if (cmd.type === "get_available_thinking_levels") return result({ levels: levels() });
      if (["set_model", "set_thinking_level"].includes(cmd.type)) {
        await new Promise((done) => setTimeout(done, 80));
        if (failNext) { failNext = false; ws.send(JSON.stringify({ op: "rpc_result", reqId: message.reqId, response: { success: false, error: "合成设置失败，请重试" } })); return; }
        if (cmd.type === "set_model") { model = models.find((item) => item.provider === cmd.provider && item.id === cmd.modelId)!; thinking = levels().includes(thinking) ? thinking : levels()[0]; }
        else { assert.ok(levels().includes(cmd.level)); thinking = cmd.level; }
      }
      if (cmd.type === "prompt") { assert.match(cmd.message, /^\/permissions (auto|read-only|full)$/); permission = cmd.message.split(" ")[1]; ws.send(JSON.stringify({ op: "ui_state", cwd: "/fixture", state: ui() })); return result({ disposition: "handled" }); }
      result({});
    });
  });
  const trigger = page.getByTestId("model-trigger"); const panel = page.getByTestId("model-trigger-panel"); const permissionTrigger = page.getByTestId("permission-trigger"); const slider = page.getByRole("slider", { name: "推理强度", exact: true });
  const settled = async () => { await expect(trigger).toHaveAttribute("data-pending", "false"); };
  try {
    await page.goto(backend.url); await expect(trigger).toBeEnabled();
    // 全链仅使用键盘（focus 是建立测试起点，不用鼠标选菜单）。
    await trigger.focus(); await page.keyboard.press("Enter"); await expect(page.getByLabel("搜索模型", { exact: true })).toBeFocused(); await page.keyboard.type("luna"); await expect(page.getByRole("menuitemradio")).toHaveCount(1);
    await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter"); await expect(trigger).toHaveAttribute("data-model", "gpt-6-luna"); await settled(); await expect(slider).toBeFocused();
    await page.keyboard.press("Home"); await settled(); await expect(slider).toBeFocused(); await page.keyboard.press("ArrowRight"); await settled(); await expect(slider).toBeFocused(); await page.keyboard.press("ArrowRight"); await settled();
    await expect(trigger).toHaveAttribute("data-thinking", "low"); await page.keyboard.press("Escape"); await expect(panel).toHaveCount(0); await expect(trigger).toBeFocused();
    await trigger.click(); await expect(page.getByRole("group", { name: "CLIProxy", exact: true })).toBeVisible(); await expect(page.getByRole("group", { name: "NInfer", exact: true })).toBeVisible(); await expect(panel).toContainText("入 $2 · 出 $10"); await shots(page, "models");
    // 鼠标拖动只在松手时提交，不为每个像素发送 RPC。
    const beforeDrag = received.filter((row) => row.cmd?.type === "set_thinking_level").length; const box = await slider.boundingBox(); assert.ok(box);
    await page.mouse.move(box.x + box.width * .4, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width - 8, box.y + box.height / 2, { steps: 8 });
    assert.equal(received.filter((row) => row.cmd?.type === "set_thinking_level").length, beforeDrag); await page.mouse.up(); await expect(trigger).toHaveAttribute("data-thinking", "xhigh"); await settled(); assert.equal(received.filter((row) => row.cmd?.type === "set_thinking_level").length, beforeDrag + 1);
    await page.getByTestId("model-option-ninfer-limited-fixture").click(); await expect(trigger).toHaveAttribute("data-model", "limited-fixture"); await settled(); await expect(slider).toHaveAttribute("data-levels", "low,high"); await expect(page.locator(".thinking-ticks button")).toHaveCount(2);
    await page.getByTestId("model-option-ninfer-no-reasoning-fixture").click(); await expect(trigger).toHaveAttribute("data-model", "no-reasoning-fixture"); await settled(); await expect(slider).toBeDisabled(); await expect(panel).toContainText("这个模型不支持调节推理强度"); await shots(page, "no-reasoning");
    failNext = true; await page.getByTestId("model-option-cliproxy-gpt-6-luna").click(); await expect(page.locator(".composer-error")).toContainText("合成设置失败"); await settled(); await expect(trigger).toHaveAttribute("data-model", "no-reasoning-fixture");
    await page.getByTestId("model-option-cliproxy-gpt-6-luna").click(); await expect(trigger).toHaveAttribute("data-model", "gpt-6-luna"); await settled();
    await page.getByLabel("搜索模型", { exact: true }).fill("nothing-matches"); await expect(panel).toContainText("没有找到匹配项"); await page.getByRole("button", { name: "清除模型搜索", exact: true }).click();
    await permissionTrigger.click(); await expect(panel).toHaveCount(0); await shots(page, "permissions"); await page.getByTestId("permission-option-read-only").click(); await expect(permissionTrigger).toHaveAttribute("data-mode", "read-only"); await settled(); await expect(permissionTrigger).toBeFocused();
    await permissionTrigger.click(); await page.getByTestId("permission-option-full").click(); const confirm = page.getByRole("dialog", { name: "允许完全放开权限？", exact: true }); await expect(confirm).toBeVisible(); await expect(confirm.getByRole("button", { name: "取消", exact: true })).toBeFocused(); await shots(page, "permission-confirm");
    const beforeCancel = received.length; await page.keyboard.press("Escape"); await expect(confirm).toHaveCount(0); await expect(permissionTrigger).toHaveAttribute("data-mode", "read-only"); assert.ok(!received.slice(beforeCancel).some((row) => row.cmd?.message === "/permissions full"));
    await permissionTrigger.click(); await page.getByTestId("permission-option-full").click(); await confirm.getByRole("button", { name: "确认完全放开", exact: true }).click(); await expect(permissionTrigger).toHaveAttribute("data-mode", "full"); await settled(); await expect(page.locator(".safety-hint")).toBeVisible();
    await trigger.click(); busy = true; emit({ type: "agent_start" }); await expect(trigger).toBeDisabled(); await expect(panel).toHaveCount(0); busy = false; emit({ type: "agent_settled" }); await expect(trigger).toBeEnabled();
    await page.emulateMedia({ reducedMotion: "reduce" }); await trigger.click(); assert.equal(await panel.evaluate((node) => getComputedStyle(node).animationName), "none"); await page.getByLabel("搜索对话", { exact: true }).click(); await expect(panel).toHaveCount(0);
    assert.deepEqual(errors, []); console.log("第 8 阶段界面验收通过：纯键盘模型/搜索/推理/关闭；拖动只提交一次；RPC 档位变化/禁用/失败回退；权限取消不生效、确认生效；深浅 1440/1024 截图及减少动效。");
  } finally { await browser.close(); await backend.stop(); }
}
void main().catch((error: Error) => { console.error(logText(error.message)); process.exitCode = 1; });
