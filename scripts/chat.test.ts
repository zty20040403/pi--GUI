import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { RpcClient } from "../src/api/client.js";
import { blocksOf, initialState, reducer } from "../src/api/state.js";
import { consumeToken, savedTarget, TOKEN_KEY, SESSION_KEY } from "../src/api/storage.js";
import type { Opened, WireRecord } from "../src/api/types.js";

const opened: Opened = { op: "opened", cwd: "/fixture", state: { sessionId: "s1" }, messages: [], stats: { cost: 0 }, models: [], commands: [], seq: 10 };
const assistant = { role: "assistant", timestamp: 2, content: [], stopReason: "pending" };

test("历史/流式按 contentIndex 拼接，结束用最终版本，工具结果按 id 关联", () => {
  let state = reducer(initialState, { type: "opened", value: opened });
  const event = (value: WireRecord, now = 1000) => { state = reducer(state, { type: "event", value, now }); };
  event({ type: "agent_start" });
  event({ type: "message_start", message: assistant });
  event({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "想一想" } }, 1100);
  event({ type: "message_update", assistantMessageEvent: { type: "thinking_end", contentIndex: 0, content: "最终思考" } }, 1500);
  event({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "你" } });
  event({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "好" } });
  event({ type: "message_update", assistantMessageEvent: { type: "toolcall_start", contentIndex: 2, id: "t1", toolName: "bash" } });
  event({ type: "message_update", assistantMessageEvent: { type: "toolcall_delta", contentIndex: 2, delta: '{"command":"ls"}' } });
  assert.equal(blocksOf(state.messages[0])[1].text, "你好");
  assert.equal(state.tools.t1.args.command, "ls");
  assert.equal(state.messages[0].thinkingMs, 400);
  event({ type: "tool_execution_start", toolCallId: "t1", toolName: "bash", args: { command: "ls" } });
  event({ type: "tool_execution_update", toolCallId: "t1", toolName: "bash", partialResult: { content: [{ type: "text", text: "a" }] } });
  event({ type: "tool_execution_end", toolCallId: "t1", toolName: "bash", result: { content: [{ type: "text", text: "a\nb" }] }, isError: false, durationMs: 12 });
  event({ type: "message_end", message: { ...assistant, stopReason: "toolUse", content: [{ type: "text", text: "最终回复" }, { type: "toolCall", id: "t1", name: "bash", arguments: { command: "ls" } }] } });
  assert.equal(state.messages.length, 1);
  assert.equal(blocksOf(state.messages[0])[0].text, "最终回复");
  assert.equal(state.tools.t1.status, "done");
  assert.equal(state.tools.t1.durationMs, 12);
  event({ type: "agent_end" }); assert.equal(state.busy, true);
  event({ type: "agent_settled", aborted: false }); assert.equal(state.busy, false);
  const historical = reducer(initialState, { type: "opened", value: { ...opened, messages: [state.messages[0],
    { role: "toolResult", timestamp: 3, toolCallId: "t1", toolName: "bash", isError: true, content: [{ type: "text", text: "failed" }] }] } });
  assert.equal(historical.tools.t1.status, "error");
});

test("排队、插件状态、重试失败、压缩与思考强度事件", () => {
  let state = initialState;
  const event = (value: WireRecord) => { state = reducer(state, { type: "event", value, now: 100 }); };
  event({ type: "queue_update", steering: ["插话"], followUp: ["随后" ] });
  assert.deepEqual(state.steering, ["插话"]);
  assert.deepEqual(state.followUp, ["随后"]);
  event({ type: "extension_ui_request", method: "setStatus", statusKey: "mc", statusText: "ready" });
  assert.equal(state.statuses.mc, "ready");
  event({ type: "extension_ui_request", method: "setStatus", statusKey: "mc" });
  assert.equal(state.statuses.mc, undefined);
  event({ type: "auto_retry_start", attempt: 2, maxAttempts: 3 }); assert.equal(state.retry?.attempt, 2);
  event({ type: "auto_retry_end", success: false, finalError: "network failed" }); assert.equal(state.error, "network failed");
  event({ type: "compaction_start" }); assert.equal(state.compacting, true);
  event({ type: "compaction_end" }); assert.equal(state.compacting, false);
  event({ type: "thinking_level_changed", level: "low" }); assert.equal(state.session.thinkingLevel, "low");
  event({ type: "agent_settled" }); assert.deepEqual(state.followUp, []);
});

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string) { return this.map.get(key) ?? null; }
  setItem(key: string, value: string) { this.map.set(key, value); }
}
test("口令只进 sessionStorage 并从 URL 删除，当前对话恢复", () => {
  const storage = new MemoryStorage() as unknown as Storage;
  let visible = "";
  assert.equal(consumeToken(new URL("http://127.0.0.1:5173/?token=fixture&keep=1#chat"), storage, (url) => { visible = url; }), "fixture");
  assert.equal(visible, "/?keep=1#chat"); assert.equal(storage.getItem(TOKEN_KEY), "fixture");
  assert.equal(consumeToken(new URL("http://127.0.0.1:5173/"), storage, () => {}), "fixture");
  storage.setItem(SESSION_KEY, JSON.stringify({ cwd: "/fixture", sessionPath: "/session.jsonl" }));
  assert.deepEqual(savedTarget(storage), { cwd: "/fixture", sessionPath: "/session.jsonl" });
  storage.setItem(SESSION_KEY, "invalid"); assert.equal(savedTarget(storage), undefined);
});

class FakeSocket {
  readyState = 0;
  onopen?: () => void; onclose?: () => void; onmessage?: (event: { data: string }) => void; onerror?: () => void;
  sent: WireRecord[] = [];
  send(text: string) { this.sent.push(JSON.parse(text)); }
  close() { this.readyState = 3; this.onclose?.(); }
  start() { this.readyState = 1; this.onopen?.(); }
  receive(record: WireRecord) { this.onmessage?.({ data: JSON.stringify(record) }); }
}
test("RPC 关联、打开快照避免重放重复 delta、断线重连当前对话但不重复 prompt", async () => {
  const sockets: FakeSocket[] = [];
  const client = new RpcClient("fixture", "ws://127.0.0.1:4317/ws", () => {
    const socket = new FakeSocket(); sockets.push(socket); return socket as unknown as WebSocket;
  }, 5);
  const events: any[] = [];
  client.subscribe((event) => events.push(event));
  try {
    client.connect({ cwd: "/fixture" }); sockets[0].start();
    sockets[0].receive({ op: "event", cwd: "/fixture", seq: 3, record: { type: "extension_ui_request", id: "dialog", method: "confirm" } });
    assert.ok(events.some((event) => event.kind === "event" && event.value.id === "dialog"), "open 期间的弹窗请求不能被快照缓冲卡住");
    sockets[0].receive({ op: "event", cwd: "/fixture", seq: 5, record: { type: "message_start", message: assistant } });
    sockets[0].receive({ op: "event", cwd: "/fixture", seq: 6, record: { type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "already in snapshot" } } });
    sockets[0].receive({ ...opened, state: { sessionFile: "/session.jsonl" }, messages: [{ ...assistant, content: [{ type: "text", text: "already in snapshot" }] }] });
    assert.equal(events.filter((event) => event.kind === "event" && event.value.type.startsWith("message_")).length, 0);
    const first = client.rpc("/fixture", { type: "get_state" }); const second = client.rpc("/fixture", { type: "get_messages" });
    const a = sockets[0].sent[1].reqId; const b = sockets[0].sent[2].reqId;
    sockets[0].receive({ op: "rpc_result", reqId: b, response: { success: true, data: "second" } });
    sockets[0].receive({ op: "rpc_result", reqId: a, response: { success: true, data: "first" } });
    assert.deepEqual(await Promise.all([first, second]), ["first", "second"]);
    const failedOpen = client.open({ cwd: "/missing" });
    sockets[0].receive({ op: "error", message: "项目不存在" });
    await assert.rejects(failedOpen, /项目不存在/);
    assert.equal(client.selectedCwd, "/fixture", "打开失败后保留原对话");
    const pending = client.rpc("/fixture", { type: "prompt", message: "do not resend" });
    sockets[0].close(); await assert.rejects(pending, /不会自动重发/);
    await delay(20); sockets[1].start();
    assert.deepEqual(sockets[1].sent, [{ op: "open", cwd: "/fixture", sessionPath: "/session.jsonl" }]);
    sockets[1].receive(opened);
    assert.ok(events.some((event) => event.kind === "connection" && event.value === "reconnecting"));
  } finally { client.dispose(); }
});
