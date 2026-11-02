import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { promisify } from "node:util";
import { emptyUi, todoSnapshot } from "../shared/extensions.js";
import { ExtensionUi } from "../server/extension-ui.js";
import { extensionState } from "../server/extension-state.js";
import { FileService } from "../server/files.js";
import { leadingObject, projectGoals } from "../server/goals.js";
import { createDeskServer } from "../server/index.js";
import { PiPool } from "../server/pi-pool.js";
import { PiProcess } from "../server/pi-process.js";
import { applyUi } from "../src/api/extension-ui-state.js";
import { initialState, reducer } from "../src/api/state.js";
import { RpcClient } from "../src/api/client.js";
import { DeskClient } from "./ws-client.js";
const exec = promisify(execFile); const fake = resolve("scripts/fixtures/fake-pi.mjs");
async function temp() { return realpath(await mkdtemp(join(tmpdir(), "pi-gui-extensions-"))); }
const snapshot = (status = "pending") => ({ tasks: [{ id: 1, subject: "fixture task", status }], nextId: 2 });

test("插件 UI 缓存完整方法、队列与四种回答校验；无效/重复回答不交给 pi", () => {
  const ui = new ExtensionUi(() => {});
  const requests = [
    { id: "s", method: "select", title: "fixture", options: ["允许", "拒绝"] }, { id: "c", method: "confirm" }, { id: "i", method: "input" }, { id: "e", method: "editor", prefill: "one\ntwo" },
    { id: "status", method: "setStatus", statusKey: "fixture", statusText: "ready" }, { id: "widget", method: "setWidget", widgetKey: "fixture", widgetLines: ["one", "two"], widgetPlacement: "belowEditor" },
    { id: "title", method: "setTitle", title: "fixture title" }, { id: "editor", method: "set_editor_text", text: "fixture text" },
  ];
  for (const request of requests) ui.record({ type: "extension_ui_request", ...request });
  const state = ui.snapshot(20); assert.equal(state.dialogs.length, 4); assert.equal(state.statuses.fixture, "ready"); assert.equal(state.widgets.fixture.placement, "belowEditor"); assert.equal(state.title, "fixture title"); assert.equal(state.editor?.text, "fixture text");
  assert.throws(() => ui.claim({ id: "s", value: "unlisted" }), /选项/); assert.throws(() => ui.claim({ id: "c", confirmed: "yes" }), /类型/); assert.equal(ui.pendingCount, 4);
  assert.deepEqual(ui.claim({ id: "s", value: "允许", command: "must-not-run" }), { type: "extension_ui_response", id: "s", value: "允许" });
  assert.deepEqual(ui.claim({ id: "c", confirmed: false }), { type: "extension_ui_response", id: "c", confirmed: false });
  assert.deepEqual(ui.claim({ id: "i", value: "" }), { type: "extension_ui_response", id: "i", value: "" });
  assert.deepEqual(ui.claim({ id: "e", cancelled: true }), { type: "extension_ui_response", id: "e", cancelled: true });
  assert.throws(() => ui.claim({ id: "s", value: "允许" }), /已经回答/);
  ui.record({ type: "extension_ui_request", id: "clear", method: "setStatus", statusKey: "fixture" }); ui.record({ type: "extension_ui_request", id: "clear2", method: "setWidget", widgetKey: "fixture" });
  assert.equal(ui.snapshot(30).statuses.fixture, undefined); assert.equal(ui.snapshot(30).widgets.fixture, undefined);
  ui.clearEditor(); assert.equal(ui.snapshot(30).editor, undefined); ui.reset(); assert.equal(ui.snapshot(30).title, undefined); ui.dispose();
});

test("超时/结束工具/取消清理等待，缓存不把过期提问留给刷新后的页面", async () => {
  const ended: string[] = []; const ui = new ExtensionUi((id) => ended.push(id));
  try {
    ui.record({ type: "extension_ui_request", id: "timeout", method: "confirm", timeout: 10 }); await delay(30); assert.equal(ui.pendingCount, 0); assert.deepEqual(ended, ["timeout"]);
    ui.record({ type: "tool_execution_start", toolCallId: "tool", toolName: "fixture" }); ui.record({ type: "extension_ui_request", id: "tool-dialog", method: "input" });
    ui.record({ type: "tool_execution_end", toolCallId: "tool", toolName: "fixture" }); assert.equal(ui.pendingCount, 0); assert.ok(ended.includes("tool-dialog"));
    ui.record({ type: "extension_ui_request", id: "cancel", method: "editor" }); ui.clearDialogs(); assert.equal(ui.pendingCount, 0);
  } finally { ui.dispose(); }
});

test("前端 UI 顺序号防旧状态覆盖快照，选项保持原值、Widget 位置/清除、标题和编辑文字", () => {
  let state = applyUi(emptyUi(), { type: "extension_ui_request", id: "s", method: "setStatus", statusKey: "fixture", statusText: "\x1b[31mnew\x1b[0m" }, 20);
  state = applyUi(state, { type: "extension_ui_request", id: "old", method: "setStatus", statusKey: "fixture", statusText: "old" }, 19); assert.equal(state.statuses.fixture, "new");
  const option = "\x1b[31m原始选项\x1b[0m"; state = applyUi(state, { type: "extension_ui_request", id: "dialog", method: "select", options: [option] }, 21);
  state = applyUi(state, { type: "extension_ui_request", id: "dialog", method: "select", options: [option] }, 22); assert.equal(state.dialogs.length, 1); assert.equal(state.dialogs[0].options?.[0], option);
  state = applyUi(state, { type: "extension_ui_request", id: "w", method: "setWidget", widgetKey: "fixture", widgetLines: ["line"], widgetPlacement: "belowEditor" }, 23); assert.equal(state.widgets.fixture.placement, "belowEditor");
  state = applyUi(state, { type: "extension_ui_request", id: "t", method: "setTitle", title: "title" }, 24); assert.equal(state.title, "title");
  state = applyUi(state, { type: "extension_ui_request", id: "e", method: "set_editor_text", text: "line1\nline2" }, 25); assert.equal(state.editor?.text, "line1\nline2");
});

test("任务清单从当前分支权威 custom 状态恢复，包括嵌套 todo；坏快照跳过、旧事件不能倒退", () => {
  const entries = [
    { id: "a", parentId: null, type: "custom", customType: "rpiv-todo-state", data: snapshot() },
    { id: "b", parentId: "a", type: "custom", customType: "rpiv-todo-state", data: snapshot("completed") },
    { id: "c", parentId: "b", type: "message", message: { role: "toolResult", toolName: "todo", details: snapshot() } },
    { id: "d", parentId: "c", type: "custom", customType: "pi-goal-focus", data: { version: 1, focusedGoalId: "goal-fixture" } },
    { id: "bad", parentId: "d", type: "custom", customType: "rpiv-todo-state", data: { ...snapshot(), tasks: ["truncated"] } },
    { id: "abandoned", parentId: "a", type: "custom", customType: "rpiv-todo-state", data: snapshot("in_progress") },
  ];
  const restored = extensionState(entries, "bad"); assert.equal(restored.todo?.tasks[0].status, "completed"); assert.equal(restored.focusedGoalId, "goal-fixture");
  assert.equal(extensionState(entries, "abandoned").todo?.tasks[0].status, "in_progress");
  assert.equal(todoSnapshot({ ...snapshot(), tasks: [{ ...snapshot().tasks[0], activeForm: 123 }] }), undefined);
  const opened = { op: "opened" as const, cwd: "/fixture", state: {}, messages: [], stats: {}, models: [], commands: [], extensions: { ...restored, seq: 100 } };
  let state = reducer(initialState, { type: "opened", value: opened });
  state = reducer(state, { type: "event", now: 1, seq: 99, value: { type: "tool_execution_end", toolName: "todo", toolCallId: "old", result: { details: snapshot() } } }); assert.equal(state.todo?.tasks[0].status, "completed");
  state = reducer(state, { type: "event", now: 2, seq: 101, value: { type: "tool_execution_end", toolName: "todo", toolCallId: "new", result: { details: snapshot("in_progress") } } }); assert.equal(state.todo?.tasks[0].status, "in_progress");
});

test("项目目标只读解析 JSON+Markdown，字符串花括号/转义正确；只发公开进度字段且拒绝越界链接", async () => {
  const root = await temp(); const external = join(root, "outside"); const project = join(root, "project"); await mkdir(external); await mkdir(join(project, ".pi", "goals"), { recursive: true });
  const goal = { id: "fixture", objective: 'test { brace } and "quote"', status: "active", scheduler: { owner: "must-not-send" }, usage: { tokensUsed: 15, activeSeconds: 30 }, taskList: { tasks: [{ id: "t1", title: "task", status: "completed" }] } };
  try {
    const text = `${JSON.stringify(goal, null, 2)}\n\n# Goal Prompt\nfixture`; assert.equal(leadingObject(text)?.objective, goal.objective); assert.equal(leadingObject("{broken}"), undefined);
    await writeFile(join(project, ".pi", "goals", "active_goal_fixture.md"), text); await writeFile(join(project, ".pi", "goals", "active_goal_bad.md"), "not a goal");
    const files = new FileService(join(root, "fake-home")); await assert.rejects(projectGoals(files, project), /先打开/); files.register(project);
    const goals = await projectGoals(files, project); assert.equal(goals.length, 1); assert.equal(goals[0].tasks[0].title, "task"); assert.equal(JSON.stringify(goals).includes("must-not-send"), false);
    const linked = join(root, "linked"); await mkdir(join(linked, ".pi"), { recursive: true }); await symlink(external, join(linked, ".pi", "goals")); files.register(linked); await assert.rejects(projectGoals(files, linked), /项目外/);
  } finally { await exec("trash", [root]); }
});

async function answer(client: DeskClient, cwd: string, payload: object, reqId: string) {
  client.send({ op: "ui_response", cwd, payload, reqId }); const response = await client.waitFor((message) => message.reqId === reqId, 5000);
  if (response.op === "error") throw new Error(response.message); return response;
}
test("真实 WS 待回答状态跨刷新/空对话恢复，多个项目不丢提问；答案校验、确认广播和停止取消", async () => {
  const root = await temp(); const other = join(root, "other"); await mkdir(other);
  const pool = new PiPool({ permissionsEnabled: false, createProcess: (cwd) => new PiProcess(cwd, { binary: process.execPath, args: [fake] }) }); const desk = createDeskServer({ pool }); const clients: DeskClient[] = [];
  try {
    await desk.listen(); const a = new DeskClient(desk.auth.launchUrl); clients.push(a); await a.ready; const first = await a.open(root);
    await a.rpc(root, { type: "ui_batch", requests: [{ id: "s", method: "select", options: ["one", "two"] }, { id: "e", method: "editor", prefill: "line1\nline2" }, { id: "st", method: "setStatus", statusKey: "fixture", statusText: "ready" }] });
    const b = new DeskClient(desk.auth.launchUrl); clients.push(b); await b.ready; const states = await b.waitFor((message) => message.op === "ui_states", 5000); assert.equal(states.states.find((row: any) => row.cwd === root).state.dialogs.length, 2);
    const reopened = await b.open(root); assert.equal(reopened.state.sessionId, first.state.sessionId, "尚未发消息的待回答对话也必须恢复，而不是误建新对话"); assert.equal(reopened.ui.statuses.fixture, "ready"); assert.equal(reopened.ui.dialogs[1].prefill, "line1\nline2");
    await assert.rejects(answer(b, root, { type: "extension_ui_response", id: "s", value: "bad" }, "bad"), /选项/);
    await answer(a, root, { type: "extension_ui_response", id: "s", value: "one" }, "a1"); assert.equal((await b.waitFor((message) => message.op === "ui_resolved" && message.id === "s", 5000)).reason, "answered");
    await assert.rejects(answer(b, root, { type: "extension_ui_response", id: "s", value: "two" }, "duplicate"), /已经回答/);
    await b.open(other); await b.rpc(other, { type: "ui_request", request: { id: "other-dialog", method: "confirm", title: "other" } });
    const c = new DeskClient(desk.auth.launchUrl); clients.push(c); await c.ready; const all = await c.waitFor((message) => message.op === "ui_states", 5000); assert.equal(all.states.filter((row: any) => row.state.dialogs.length).length, 2);
    await answer(c, other, { type: "extension_ui_response", id: "other-dialog", confirmed: false }, "c1");
    await a.rpc(root, { type: "abort" }); assert.equal((await b.waitFor((message) => message.op === "ui_resolved" && message.id === "e", 5000)).reason, "abort"); assert.equal((await pool.get(root)).ui.pendingCount, 0);
    await a.open(root); assert.equal((await pool.get(root)).uiSnapshot.statuses.fixture, undefined, "新对话不继承旧插件状态");
  } finally { for (const client of clients) client.close(); await desk.close(); await exec("trash", [root]); }
});

class Socket {
  readyState = 0; onopen?: () => void; onclose?: () => void; onmessage?: (event: { data: string }) => void; sent: any[] = [];
  send(text: string) { this.sent.push(JSON.parse(text)); } close() { this.readyState = 3; this.onclose?.(); } start() { this.readyState = 1; this.onopen?.(); } receive(value: object) { this.onmessage?.({ data: JSON.stringify(value) }); }
}
test("前端 UI 回答带请求关联并等后台确认，打开期间也能回答，不自动重发", async () => {
  const socket = new Socket(); const client = new RpcClient("fixture", "ws://127.0.0.1:4317/ws", () => socket as unknown as WebSocket); const records: any[] = []; client.subscribe((event) => records.push(event));
  try {
    client.connect({ cwd: "/fixture" }); socket.start(); socket.receive({ op: "ui_states", states: [] }); assert.ok(records.some((event) => event.value?.type === "desk_ui_states"));
    const response = client.uiResponse("/fixture", { type: "extension_ui_response", id: "question", cancelled: true }); const sent = socket.sent.at(-1); assert.equal(sent.op, "ui_response"); assert.equal(typeof sent.reqId, "string");
    socket.receive({ op: "rpc_result", reqId: sent.reqId, response: { success: true, data: {} } }); await response;
  } finally { client.dispose(); }
});
