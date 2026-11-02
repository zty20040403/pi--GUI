import { expect, type Page } from "@playwright/test";
import type { PermissionMode } from "../shared/extensions.js";
export async function expectModelReady(page: Page) {
  const trigger = page.getByTestId("model-trigger");
  await expect(trigger).toBeEnabled({ timeout: 30000 }); await expect(trigger).toHaveAttribute("data-pending", "false", { timeout: 30000 });
}
export async function openModelMenu(page: Page) {
  await expectModelReady(page); const trigger = page.getByTestId("model-trigger");
  if (await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
  await expect(page.getByTestId("model-trigger-panel")).toBeVisible();
}
export async function chooseModel(page: Page, provider: string, id: string) {
  await openModelMenu(page); await page.getByLabel("搜索模型", { exact: true }).fill(id);
  await page.getByTestId(`model-option-${provider}-${id}`).click(); const trigger = page.getByTestId("model-trigger");
  await expect(trigger).toHaveAttribute("data-provider", provider, { timeout: 30000 }); await expect(trigger).toHaveAttribute("data-model", id, { timeout: 30000 }); await expectModelReady(page);
  await page.keyboard.press("Escape"); await expect(page.getByTestId("model-trigger-panel")).toHaveCount(0);
}
export async function setThinking(page: Page, level: string) {
  await openModelMenu(page); const slider = page.getByRole("slider", { name: "推理强度", exact: true });
  const levels = (await slider.getAttribute("data-levels"))?.split(",") ?? []; if (!levels.includes(level)) throw new Error(`当前模型不支持推理档位 ${level}；支持：${levels.join(", ")}`);
  if (await page.getByTestId("model-trigger").getAttribute("data-thinking") !== level) await page.getByTestId(`thinking-level-${level}`).click();
  await expect(page.getByTestId("model-trigger")).toHaveAttribute("data-thinking", level, { timeout: 30000 }); await expectModelReady(page); await page.keyboard.press("Escape");
}
export async function setPermission(page: Page, mode: PermissionMode) {
  const trigger = page.getByTestId("permission-trigger"); await expect(trigger).toBeEnabled({ timeout: 30000 }); await expect(trigger).toHaveAttribute("data-pending", "false");
  if (await trigger.getAttribute("data-mode") === mode) return;
  await trigger.click(); await page.getByTestId(`permission-option-${mode}`).click();
  if (mode === "full") await page.getByRole("dialog", { name: "允许完全放开权限？", exact: true }).getByRole("button", { name: "确认完全放开", exact: true }).click();
  await expect(trigger).toHaveAttribute("data-mode", mode, { timeout: 30000 }); await expect(trigger).toHaveAttribute("data-pending", "false");
}
