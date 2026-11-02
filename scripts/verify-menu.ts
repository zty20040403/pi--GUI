import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
const code = await build({ stdin: { contents: `
  import { useState } from "react"; import { createRoot } from "react-dom/client";
  import { Popover } from "./src/components/ui/Popover"; import { Menu } from "./src/components/ui/Menu";
  function App() {
    const [one, setOne] = useState(false), [two, setTwo] = useState(false), [selected, setSelected] = useState("alpha");
    const options = [{id:"alpha",label:"Alpha",group:"Provider"},{id:"blocked",label:"Blocked",disabled:true},{id:"beta",label:"Beta",group:"Provider"}];
    return <><div style={{position:"fixed",bottom:8,right:8,display:"flex",gap:8}}>
    <Popover open={one} onOpenChange={setOne} label="第一菜单" trigger="第一" testId="one"><Menu label="选项" options={options} selected={selected} searchLabel="搜索选项" onSelect={setSelected} /><input aria-label="后续滑杆" type="range" /></Popover>
    <Popover open={two} onOpenChange={setTwo} label="第二菜单" trigger="第二" testId="two"><Menu label="权限" options={options} selected={selected} onSelect={setSelected} /></Popover>
    </div><button type="button">外部按钮</button><output data-testid="value">{selected}</output></>;
  } createRoot(document.getElementById("root")).render(<App />);`, resolveDir: resolve("."), loader: "tsx" }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic" });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 400, height: 380 } }); await page.setContent(`<style>${await readFile("src/styles.css", "utf8")}</style><div id="root"></div>`); await page.addScriptTag({ content: code.outputFiles[0].text });
  const one = page.getByRole("button", { name: "第一菜单", exact: true }); const two = page.getByRole("button", { name: "第二菜单", exact: true });
  await one.focus(); await page.keyboard.press("ArrowDown"); await expect(page.getByLabel("搜索选项")).toBeFocused();
  const panel = page.getByTestId("one-panel"); await expect(panel).toBeVisible();
  const bounds = await panel.boundingBox(); assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 400 && bounds.y >= 0 && bounds.y + bounds.height <= 380);
  await page.keyboard.type("bet"); await expect(page.getByRole("menuitemradio")).toHaveCount(1); await page.keyboard.press("Enter"); await expect(page.getByTestId("value")).toHaveText("beta");
  await page.keyboard.press("ArrowDown"); await expect(page.getByRole("menuitemradio")).toBeFocused(); await page.keyboard.press("Tab"); await expect(page.getByLabel("后续滑杆")).toBeFocused();
  await page.keyboard.press("Escape"); await expect(panel).toHaveCount(0); await expect(one).toBeFocused();
  await one.click(); await two.click(); await expect(panel).toHaveCount(0); await expect(page.getByTestId("two-panel")).toBeVisible(); await expect(page.getByRole("menuitemradio", { name: "Beta", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown"); await expect(page.getByRole("menuitemradio", { name: "Alpha", exact: true })).toBeFocused();
  await page.keyboard.type("bet"); await expect(page.getByRole("menuitemradio")).toHaveCount(1);
  await page.getByRole("button", { name: "外部按钮", exact: true }).click(); await expect(page.getByTestId("two-panel")).toHaveCount(0);
  console.log("通用弹出菜单通过：自动避边、搜索、键盘选择、跳过禁用项、Tab 到滑杆、Esc 返回、单菜单及外部关闭。");
} finally { await browser.close(); }
