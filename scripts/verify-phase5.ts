import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { chromium, expect, type Browser, type Page } from "@playwright/test";
import { logText } from "../server/privacy.js";
import { SESSION_KEY } from "../src/api/storage.js";
import { startBackend } from "./server-runner.js";
import { verifyPermissions } from "./verify-permissions.js";
const exec = promisify(execFile); const artifacts = resolve(".pi-desk/verification");
const input = (page: Page) => page.getByLabel("消息", { exact: true });
const dialog = (page: Page) => page.locator("dialog.extension-dialog");
async function idle(page: Page) {
  await expect(page.getByTestId("connection-status")).toContainText("已连接", { timeout: 30000 });
  await expect(page.getByRole("button", { name: "停止", exact: true })).toHaveCount(0, { timeout: 180000 });
  await expect(page.getByLabel("模型", { exact: true })).toBeEnabled({ timeout: 30000 });
  await expect(page.locator(".send-button").filter({ hasText: "发送中" })).toHaveCount(0, { timeout: 30000 });
}
async function send(page: Page, text: string) { await input(page).fill(/^\/\S+$/.test(text) ? `${text} ` : text); await input(page).press("Enter"); }
async function waitReply(page: Page, match: string | RegExp) { await expect(page.locator("article[data-role=assistant]").last()).toContainText(match, { timeout: 180000 }); await idle(page); }
async function readyAttachment(page: Page) { await expect(page.getByTestId("attachment")).toHaveCount(1, { timeout: 30000 }); await expect(page.getByTestId("attachment")).not.toContainText("正在上传", { timeout: 30000 }); }
async function droppedFile(page: Page, bytes: Buffer, name: string, type: string) {
  await page.evaluate(({ data, name, type }) => {
    const raw = atob(data); const bytes = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const transfer = new DataTransfer(); transfer.items.add(new File([bytes], name, { type })); (window as any).fixtureDrop = transfer;
    document.querySelector('textarea[aria-label="消息"]')!.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, { data: bytes.toString("base64"), name, type });
  await expect(page.getByText("松手添加到对话", { exact: true })).toBeVisible();
  await page.evaluate(() => { const transfer = (window as any).fixtureDrop; document.querySelector('textarea[aria-label="消息"]')!.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer })); delete (window as any).fixtureDrop; });
  await readyAttachment(page); await expect(page.locator(".file-drop-overlay")).toHaveCount(0);
}
async function main() {
  await mkdir(artifacts, { recursive: true }); const permissions = await verifyPermissions();
  const root = await realpath(await mkdtemp(join(tmpdir(), "pi-desk-phase5-"))); const project = join(root, "project"); const outside = join(root, "outside"); await mkdir(join(project, "src"), { recursive: true }); await mkdir(outside);
  await exec("git", ["init", "-q", project]); await cp(resolve("src/App.tsx"), join(project, "src/App.tsx")); await writeFile(join(project, "README.txt"), "PHASE FIVE THREE STEP FIXTURE");
  await writeFile(join(outside, "danger-marker.txt"), "DO NOT DELETE THIS FIXTURE");
  let backend: Awaited<ReturnType<typeof startBackend>> | undefined; let browser: Browser | undefined;
  const sessions = new Set<string>(); const costs = new Map<string, number>(); const wire: any[] = []; const pageErrors: string[] = []; const approvals: string[] = [];
  const matchesPath = (record: any, path: string) => record?.type === "tool_execution_start" && record.toolName === "read" && typeof record.args?.path === "string" && resolve(project, record.args.path) === path;
  try {
    backend = await startBackend({ production: true, entry: "scripts/phase5-server.ts" }); browser = await chromium.launch({ channel: "chrome", headless: true });
    const context = await browser.newContext({ viewport: { width: 1700, height: 1050 }, colorScheme: "light" }); await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await context.addInitScript(({ key, cwd }) => { if (window === window.top && !sessionStorage.getItem(key)) sessionStorage.setItem(key, JSON.stringify({ cwd })); }, { key: SESSION_KEY, cwd: project });
    const page = await context.newPage(); page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("websocket", (socket) => socket.on("framereceived", ({ payload }) => { try { const message = JSON.parse(payload.toString()); wire.push(message); if (message.cwd === project) { if (message.op === "opened" && message.state.sessionFile) sessions.add(message.state.sessionFile); if (message.sessionPath) sessions.add(message.sessionPath); } } catch {} }));
    await page.goto(backend.url); await idle(page); await page.getByLabel("模型", { exact: true }).selectOption(JSON.stringify(["cliproxy", "gpt-6-luna"])); await idle(page); await page.getByLabel("推理强度").selectOption("low"); await idle(page);
    await expect(page.getByLabel("权限模式")).toHaveValue("auto");
    const rememberCost = async () => { const id = wire.filter((message) => message.op === "opened" && message.cwd === project).at(-1)?.state.sessionId; const text = await page.getByTestId("session-cost").innerText(); if (id) costs.set(id, Number(text.match(/\$([\d.]+)/)?.[1] ?? 0)); };
    const fresh = async () => {
      await idle(page); await rememberCost(); await page.getByRole("button", { name: "新对话", exact: true }).click(); await idle(page);
      // pi 的新 AgentSession 恢复用户默认模型，验收必须逐个重设，不能只设第一次。
      await page.getByLabel("模型", { exact: true }).selectOption(JSON.stringify(["cliproxy", "gpt-6-luna"])); await idle(page);
      await page.getByLabel("推理强度").selectOption("low"); await idle(page);
    };
    // 只在测试临时目录里批准必要操作；绝不自动允许危险标题或任意未知命令。
    const approveFixture = async () => {
      // 点击批准后，后台确认前弹窗仍在 DOM 中，但按钮已禁用。
      // 原脚本把这个已回答的请求当成新审批，误报（或重复点击）。一次读取同一弹窗的状态。
      const snapshot = await dialog(page).evaluate((element) => {
        const allow = [...element.querySelectorAll("button")].find((button) => button.textContent === "允许这一次");
        return { ready: !!allow && !allow.disabled, text: (element as HTMLElement).innerText, title: element.querySelector("h2")?.innerText ?? "" };
      });
      if (!snapshot.ready) return;
      const { text, title } = snapshot;
      assert.ok(!text.includes("⚠️"), "不能自动允许危险操作");
      const prefix = "需要你的允许：执行命令\n";
      const command = title.startsWith(prefix) ? title.slice(prefix.length).trim() : "";
      const planProbe = /^(?:pwd;\s*)?(?:ls -ld \.;\s*)?if \[ -(?:e|f) (?:\.\/)?hello\.sh \]; then (?:ls -ld?|cat) (?:\.\/)?hello\.sh;\s*(?:else (?:printf|echo) '[^']*';\s*)?fi$/.test(command);
      assert.ok(text.includes(project) || planProbe || /^chmod\s+\+x\s+(?:\.\/)?hello\.sh$/.test(command) || text.includes(".pi-desk/uploads/"), `只允许当前合成项目的操作；待审请求：${logText(text)}`);
      approvals.push(text.split("\n").slice(0, 3).join(" ")); await dialog(page).getByRole("button", { name: "允许这一次", exact: true }).click();
    };
    const waitWithFixtureApprovals = async (check: () => Promise<boolean>) => {
      const deadline = Date.now() + 180000;
      while (Date.now() < deadline) { if (await check()) return; if (await dialog(page).count()) await approveFixture(); await page.waitForTimeout(100); }
      throw new Error("等待合成项目操作完成超时");
    };
    // 1: 实际 PNG 屏幕截图，以标准 File/DataTransfer 拖放走完整上传 + images 模型输入。
    const picture = await context.newPage(); await picture.setContent('<body style="margin:0;background:#fff;font:30px sans-serif"><div style="padding:30px"><strong>PI DESK</strong><div style="display:flex;gap:40px;margin-top:30px"><div style="width:90px;height:90px;background:#f22;border-radius:50%"></div><div style="width:120px;height:90px;background:#1674e8"></div></div><p>red circle + blue rectangle</p></div></body>');
    await picture.setViewportSize({ width: 450, height: 300 }); const screenshot = await picture.screenshot({ path: join(artifacts, "phase-5-synthetic-screenshot.png") }); await picture.close();
    await droppedFile(page, screenshot, "截图 fixture.png", "image/png"); const imagePath = (await page.getByTestId("attachment").getAttribute("data-path"))!;
    assert.deepEqual(await readFile(join(project, imagePath)), screenshot); await expect(page.getByAltText("附件预览 截图 fixture.png")).toBeVisible();
    await send(page, "图里有什么？请描述颜色和形状，也读出大标题。不用任何工具，直接看图片。"); await waitReply(page, /红|red/i); await expect(page.locator("article[data-role=assistant]").last()).toContainText(/蓝|blue/i); await expect(page.getByAltText("发送给 pi 的图片附件")).toBeVisible();
    assert.ok(wire.some((message) => message.record?.type === "message_end" && message.record.message?.role === "user" && message.record.message.content?.some((part: any) => part.type === "image"))); await expect(page.getByTestId("attachment")).toHaveCount(0);
    assert.equal((await exec("git", ["-c", "core.quotepath=false", "check-ignore", imagePath], { cwd: project })).stdout.trim(), imagePath);
    console.log("验收 1/7 通过：Chrome 实际拖放截图文件，上传字节不变，真实 luna/low 描述红圆/蓝矩形，用户历史含 image 块，附件不进 Git");
    // 粘贴图片与移除：使用真正浏览器剪贴板 + Mac 的 Meta+V。
    await page.evaluate(async (data) => { const raw = atob(data); const bytes = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i); await navigator.clipboard.write([new ClipboardItem({ "image/png": new Blob([bytes], { type: "image/png" }) })]); }, screenshot.toString("base64"));
    await input(page).focus(); await input(page).press("Meta+V"); await readyAttachment(page); const pasted = (await page.getByTestId("attachment").getAttribute("data-path"))!;
    await page.getByRole("button", { name: /移除附件/ }).click(); await expect(page.getByTestId("attachment")).toHaveCount(0); await stat(join(project, pasted));
    // 2: PDF 路径提供给真正 read 工具，模型从合成 PDF 的明文正文总结。
    await fresh(); const pdf = await readFile(resolve("scripts/fixtures/preview/sample.pdf")); await droppedFile(page, pdf, "summary fixture.pdf", "application/pdf"); const pdfPath = (await page.getByTestId("attachment").getAttribute("data-path"))!; const pdfStart = wire.length;
    await send(page, "总结一下这个 PDF。必须先用 read 工具读取保存的附件路径；它是合成样例，不必执行外部程序，告诉我正文里的英文。"); await waitReply(page, "PDF PREVIEW OK");
    assert.ok(wire.slice(pdfStart).some((message) => matchesPath(message.record, join(project, pdfPath)))); console.log("验收 2/7 通过：拖放 PDF 后，真实 read 读取 .pi-desk/uploads 下保存文件，luna 总结出 PDF PREVIEW OK");
    // 3: 真正 HTML5 文件树拖动，不上传，只添加 @ 路径卡片。
    await fresh(); const uploadCount = (await readdir(join(project, ".pi-desk/uploads"))).length; const panel = page.getByRole("complementary", { name: "文件面板" });
    await panel.getByRole("treeitem", { name: "展开文件夹 src", exact: true }).click(); await panel.getByRole("treeitem", { name: "预览 App.tsx", exact: true }).dragTo(input(page)); await readyAttachment(page);
    await expect(page.getByTestId("attachment")).toContainText("@src/App.tsx"); assert.equal((await readdir(join(project, ".pi-desk/uploads"))).length, uploadCount); const referenceStart = wire.length;
    await send(page, "这个文件做什么？请先用 read 读取引用的文件，然后用两句话说明。"); await waitReply(page, /聊天|界面|React|组件/); assert.ok(wire.slice(referenceStart).some((message) => matchesPath(message.record, join(project, "src/App.tsx"))));
    console.log("验收 3/7 通过：文件树实际拖动 src/App.tsx 产生路径标签，没有新增上传，真实 read 读取该文件并解释用途");
    // 4: 已安装的选择题插件本身，不是 UI 测试替身。
    await fresh(); const questionStart = wire.length; await send(page, "用 ask_user_question 工具问我用 Python 还是 Bash，只问这一题，选项只有这两个。收到选择后只回复‘已选择：所选语言’。");
    await expect(dialog(page)).toBeVisible({ timeout: 180000 }); await expect(dialog(page)).toContainText(/Python/); await dialog(page).locator(".extension-options button").filter({ hasText: "Python" }).first().click(); await waitReply(page, /已选择.*Python/);
    assert.ok(wire.slice(questionStart).some((message) => message.record?.type === "tool_execution_end" && message.record.toolName === "ask_user_question" && !message.record.isError));
    console.log("验收 4/7 通过：真正 ask_user_question 插件发选择卡片，点 Python 后模型收到并回复已选择 Python");
    // 完整插件 UI 子协议：四种弹窗、待答刷新、同时排队、提示颜色、状态/上下 widget/标题/编辑文字。
    await send(page, "/desk-test-select"); await expect(dialog(page)).toContainText("选择验收"); const requestId = wire.filter((message) => message.record?.type === "extension_ui_request" && message.record.title === "选择验收").at(-1)?.record.id;
    await page.reload(); await expect(dialog(page)).toContainText("选择验收", { timeout: 30000 }); assert.ok(wire.some((message) => message.op === "ui_states" && message.states?.some((row: any) => row.state.dialogs.some((item: any) => item.id === requestId))));
    await dialog(page).getByRole("button", { name: "选项 B", exact: true }).click(); await idle(page); await expect(page.getByText("SELECT:选项 B", { exact: true })).toBeVisible();
    await send(page, "/desk-test-confirm"); await expect(dialog(page)).toContainText("确认验收"); await dialog(page).getByRole("button", { name: "否", exact: true }).click(); await idle(page); await expect(page.getByText("CONFIRM:false", { exact: true })).toBeVisible();
    await send(page, "/desk-test-input"); await expect(page.getByLabel("插件输入")).toBeVisible(); await page.getByLabel("插件输入").fill("ONE LINE FIXTURE"); await dialog(page).getByRole("button", { name: "提交", exact: true }).click(); await idle(page); await expect(page.getByText("INPUT:ONE LINE FIXTURE", { exact: true })).toBeVisible();
    await send(page, "/desk-test-editor"); await expect(page.getByLabel("插件编辑内容")).toHaveValue("原有第一行\n原有第二行"); await page.getByLabel("插件编辑内容").fill("EDITED LINE ONE\nEDITED LINE TWO"); await dialog(page).getByRole("button", { name: "提交", exact: true }).click(); await idle(page); await expect(page.getByText("EDITOR:EDITED LINE ONE\nEDITED LINE TWO", { exact: true })).toBeVisible();
    await send(page, "/desk-test-queue"); await expect(dialog(page)).toContainText("排队问题一"); await expect(dialog(page)).toContainText("后面还有 1 个提问"); await page.getByLabel("插件输入").fill("QUEUED FIXTURE"); await dialog(page).getByRole("button", { name: "提交", exact: true }).click(); await expect(dialog(page)).toContainText("排队问题二"); await dialog(page).getByRole("button", { name: "否", exact: true }).click(); await idle(page); await expect(page.getByText("QUEUE:QUEUED FIXTURE:false", { exact: true })).toBeVisible();
    await send(page, "/desk-test-select"); await expect(dialog(page)).toContainText("选择验收"); await dialog(page).getByRole("button", { name: "取消", exact: true }).click(); await idle(page); await expect(page.getByText("SELECT:CANCELLED", { exact: true })).toBeVisible();
    await send(page, "/desk-test-widgets"); await expect(input(page)).toHaveValue("FIXTURE PREFILL"); await expect(page.locator(".statusbar")).toContainText("FIXTURE STATUS"); await expect(page.getByText("ABOVE EDITOR FIXTURE", { exact: false })).toBeVisible(); await expect(page.getByText("BELOW EDITOR FIXTURE", { exact: true })).toBeVisible();
    await expect(page.locator(".toast-warning")).toContainText("FIXTURE WARNING"); await expect(page.locator(".toast-error")).toContainText("FIXTURE ERROR"); assert.equal(await page.title(), "FIXTURE WINDOW TITLE"); await idle(page); await page.screenshot({ path: join(artifacts, "phase-5-widgets.png") });
    await expect(page.locator(".extension-toast")).toHaveCount(0, { timeout: 12000 }); await send(page, "/desk-test-clear"); await idle(page); await expect(page.locator(".widget-panel")).toHaveCount(0); await expect(page.locator(".statusbar")).not.toContainText("FIXTURE STATUS");
    console.log("补充 UI 验收通过：select/confirm/input/editor、待答刷新、两个同时排队、取消、notify 颜色与自动消失、上下 Widget/清除、状态、标题及预填文字；Cmd+V 图片与移除也通过");
    // 5: 真实计划插件菜单 -> Implement here -> AI 创建 hello.sh。
    await fresh(); const planStart = wire.length; await send(page, "/plan 写一个 hello.sh，放当前项目，内容只需要运行时输出 hello。只创建文件，不要执行，不要 chmod。");
    const planDeadline = Date.now() + 180000; let implement = false;
    while (Date.now() < planDeadline && !implement) {
      if (await dialog(page).count()) {
        const option = dialog(page).getByRole("button", { name: /Implement here/i });
        if (await option.count()) { implement = true; await page.screenshot({ path: join(artifacts, "phase-5-plan-menu.png") }); await option.first().click(); }
        else if (await dialog(page).getByRole("button", { name: /Start planning/i }).count()) await dialog(page).getByRole("button", { name: /Start planning/i }).first().click();
        else if ((await dialog(page).innerText()).includes("需要你的允许")) await approveFixture();
        else throw new Error(`计划出现非预期菜单：${(await dialog(page).innerText()).slice(0, 400)}`);
      }
      await page.waitForTimeout(100);
    }
    assert.ok(implement, "必须真的出现并选择 Implement here"); await waitWithFixtureApprovals(async () => { try { return (await readFile(join(project, "hello.sh"), "utf8")).includes("hello"); } catch { return false; } }); await idle(page);
    await expect(page.getByTestId("plan-card")).toBeVisible(); assert.ok(wire.slice(planStart).some((message) => message.record?.type === "tool_execution_end" && message.record.toolName === "plan_mode_complete"));
    console.log("验收 5/7 通过：真实 /plan 生成 Markdown 计划并弹菜单，选 Implement here 后真实 hello.sh 被创建");
    // 6: 三个真实步骤与 todo 快照，DOM 显示完整打勾清单，刷新保持。
    await fresh(); const todoStart = wire.length; const progress: number[] = [];
    await page.evaluate(() => { (window as any).todoProgress = []; new MutationObserver(() => { const count = document.querySelectorAll('.todo-panel li[data-status="completed"]').length; (window as any).todoProgress.push(count); }).observe(document.querySelector(".composer-section")!, { childList: true, subtree: true, attributes: true }); });
    await send(page, "做一个严格的三步验收任务。必须用 todo 创建正好3项，每步开始设 in_progress，结束设 completed，不能只口头说明。步骤1用 read 读取 README.txt；步骤2用 write 创建 step-two.txt 内容 BEFORE FIXTURE；步骤3用 edit 把它改为 AFTER FIXTURE。不要用 bash、不要创建目标。每个任务标题写‘步骤1读取’、‘步骤2创建’、‘步骤3替换’。全部完成只回复三步完成。");
    await waitReply(page, "三步完成"); await expect(page.getByTestId("todo-panel")).toContainText("3 / 3 完成"); await page.getByTestId("todo-panel").locator("summary").click(); await expect(page.locator('.todo-panel li[data-status="completed"]')).toHaveCount(3); assert.equal(await readFile(join(project, "step-two.txt"), "utf8"), "AFTER FIXTURE");
    for (const message of wire.slice(todoStart)) if (message.record?.type === "tool_execution_end" && message.record.toolName === "todo") progress.push(message.record.result?.details?.tasks?.filter((task: any) => task.status === "completed").length ?? -1);
    assert.ok([0, 1, 2, 3].every((value) => progress.includes(value)), "必须观察到真实 todo 的逐步完成状态"); await page.reload(); await idle(page); await expect(page.getByTestId("todo-panel")).toContainText("3 / 3 完成"); await page.getByTestId("todo-panel").locator("summary").click(); await expect(page.locator('.todo-panel li[data-status="completed"]')).toHaveCount(3);
    console.log("验收 6/7 通过：真实 read/write/edit 三步完成，todo 从 0→1→2→3 完成并打勾，刷新后从当前分支恢复");
    // 7: 真正模型在页面里触发权限，所有危险操作只拒绝，实际放行只改合成临时文件。
    await fresh(); await page.getByLabel("权限模式").selectOption("read-only"); await idle(page); const roStart = wire.length;
    await send(page, "请只尝试一次 write 工具创建 readonly-blocked.txt，内容 READONLY TEST。如果权限拒绝，就停止并回复被只读拒绝；不要尝试替代办法。"); await waitReply(page, /只读|拒绝/); await assert.rejects(stat(join(project, "readonly-blocked.txt")), { code: "ENOENT" }); assert.ok(wire.slice(roStart).some((message) => message.record?.type === "tool_execution_end" && message.record.toolName === "write" && message.record.isError));
    await page.getByLabel("权限模式").selectOption("auto"); await idle(page); await send(page, "请只用 write 工具创建 ../outside/browser-outside.txt，内容 OUTSIDE APPROVED。等待我批准，不用别的工具。"); await expect(dialog(page)).toContainText("修改项目外的文件", { timeout: 180000 }); await dialog(page).getByRole("button", { name: "允许这一次", exact: true }).click(); await waitWithFixtureApprovals(async () => { try { return (await readFile(join(outside, "browser-outside.txt"), "utf8")) === "OUTSIDE APPROVED"; } catch { return false; } }); await idle(page);
    await send(page, "这是一个拒绝操作验收。请只尝试一次 bash 命令 rm -rf ../outside。审批时我会拒绝；收到拒绝后不要再尝试任何工具，只回复用户已拒绝。不要自己执行替代办法。"); await expect(dialog(page)).toContainText("⚠️ 危险操作", { timeout: 180000 }); await expect(dialog(page)).toHaveClass(/danger-dialog/); assert.equal(await page.evaluate(() => document.activeElement?.textContent), "拒绝"); await page.screenshot({ path: join(artifacts, "phase-5-danger-refusal.png") }); await dialog(page).getByRole("button", { name: "拒绝", exact: true }).click(); await waitReply(page, "用户已拒绝"); assert.equal(await readFile(join(outside, "danger-marker.txt"), "utf8"), "DO NOT DELETE THIS FIXTURE");
    await page.getByLabel("权限模式").selectOption("full"); await idle(page); await send(page, "只用 write 工具创建 full-allowed.txt 内容 FULL FIXTURE，完成回复完全放开验证完成。不要执行其他操作。"); await waitReply(page, "完全放开验证完成"); assert.equal(await readFile(join(project, "full-allowed.txt"), "utf8"), "FULL FIXTURE"); await expect(dialog(page)).toHaveCount(0);
    console.log(`验收 7/7 通过：页面只读实际拒绝 write，自动对项目外 write 弹窗并批准，危险 rm 标红且拒绝后文件完好，完全放开实际 write 不审批；另真实 pi SDK 工具流水线 ${permissions.cases} 条逐格通过`);
    // 项目目标备用面板：只读读取暂停的合成记录，不创建或驱动真正目标。
    await mkdir(join(project, ".pi/goals"), { recursive: true }); await writeFile(join(project, ".pi/goals/active_goal_fixture.md"), JSON.stringify({ version: 3, id: "paused-fixture", objective: "GOAL PANEL FIXTURE", status: "paused", autoContinue: false, usage: { tokensUsed: 10, activeSeconds: 30 }, taskList: { tasks: [{ id: "one", title: "GOAL TASK FIXTURE", status: "completed" }] } }) + "\n\n# Goal Prompt\nfixture");
    await expect(page.getByTestId("goal-panel")).toBeVisible({ timeout: 10000 }); await page.getByTestId("goal-panel").locator("summary").click(); await expect(page.getByTestId("goal-panel")).toContainText("GOAL PANEL FIXTURE"); await expect(page.getByRole("button", { name: "暂停目标", exact: true })).toBeVisible();
    await rememberCost(); await page.getByLabel("搜索对话").fill(root.split("/").at(-1)!); await page.screenshot({ path: join(artifacts, "phase-5-light.png") }); await page.emulateMedia({ colorScheme: "dark" }); await page.screenshot({ path: join(artifacts, "phase-5-dark.png") });
    const replies = wire.filter((message) => message.record?.type === "message_end" && message.record.message?.role === "assistant").map((message) => message.record.message);
    assert.ok(replies.length > 0);
    for (const reply of replies) { assert.equal(reply.provider, "cliproxy"); assert.equal(reply.model, "gpt-6-luna", "每条付费回复都必须是 Luna"); assert.equal(reply.thinkingLevel, "low", "每条付费回复都必须是 low"); }
    assert.deepEqual(pageErrors, []); const target = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)!), SESSION_KEY); const cost = [...costs.values()].reduce((sum, value) => sum + value, 0);
    await context.close(); await backend.stop(); backend = undefined; backend = await startBackend({ production: true });
    const production = await browser.newContext({ viewport: { width: 1700, height: 1050 } }); await production.addInitScript(({ key, target }) => { if (window === window.top) sessionStorage.setItem(key, JSON.stringify(target)); }, { key: SESSION_KEY, target });
    const prod = await production.newPage(); await prod.goto(backend.url); await idle(prod); await expect(prod.locator("article[data-role=assistant]").last()).toContainText("完全放开验证完成"); await expect(prod.getByLabel("权限模式")).toHaveValue("auto"); await production.close();
    await writeFile(join(artifacts, "phase-5-summary.json"), JSON.stringify({ passed: 7, permissionCases: permissions.cases, chatCost: cost, fixtureApprovals: approvals.length, clipboard: true, uiMethods: true, production: true }, null, 2));
    console.log(`第 5 阶段全部 7 项实际验收通过；真实聊天合计 $${cost.toFixed(6)}；正常生产后台恢复历史且权限重启默认自动，不加载测试命令。`);
  } finally { await browser?.close(); await backend?.stop(); for (const path of sessions) { if (!isAbsolute(path)) continue; try { await stat(path); await exec("trash", [path]); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } } await exec("trash", [root]); }
}
void main().catch((error: Error) => { console.error(`第 5 阶段验收失败：${logText(error.message)}`); process.exitCode = 1; });
