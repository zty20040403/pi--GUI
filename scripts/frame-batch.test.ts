import assert from "node:assert/strict";
import { test } from "node:test";
import { frameBatch } from "../src/api/frame-batch.js";
import { blocksOf, initialState, reducer, type EventAction } from "../src/api/state.js";

const event = (value: EventAction["value"], now = 1000): EventAction => ({ type: "event", value, now });
test("流式更新按帧合并，保持顺序；flush 在最终消息前提交，clear 丢弃已关闭窗口的更新", () => {
  let callback: (() => void) | undefined; let scheduled = 0; let cancelled = 0;
  const batches: number[][] = [];
  const queue = frameBatch<number>((items) => batches.push(items), (flush) => { callback = flush; scheduled++; return () => { callback = undefined; cancelled++; }; }, 4);
  queue.push(1); queue.push(2); queue.push(3); assert.equal(scheduled, 1); assert.deepEqual(batches, []);
  callback!(); assert.deepEqual(batches, [[1, 2, 3]]); assert.equal(cancelled, 1);
  queue.push(4); queue.flush(); assert.deepEqual(batches, [[1, 2, 3], [4]]); assert.equal(callback, undefined);
  queue.push(5); queue.clear(); queue.flush(); assert.equal(batches.length, 2);
  for (let i = 0; i < 4; i++) queue.push(i); assert.equal(callback, undefined); assert.deepEqual(batches.at(-1), [0, 1, 2, 3]);
});

test("批量 reducer 与逐条事件完全一致：思考、文字、工具、结束、停止及历史引用", () => {
  const history = { role: "assistant", timestamp: 1, stopReason: "stop", content: "保持不变" };
  let base = reducer(initialState, event({ type: "message_end", message: history }));
  const actions: EventAction[] = [
    event({ type: "agent_start" }), event({ type: "message_start", message: { role: "assistant", timestamp: 2, stopReason: "pending", content: [] } }),
    event({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "思考" } }),
    event({ type: "message_update", assistantMessageEvent: { type: "thinking_end", contentIndex: 0, content: "最终思考" } }, 1100),
    ...["你", "好", "\\(", "x_i", "\\)"].map((delta) => event({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta } })),
    event({ type: "message_update", assistantMessageEvent: { type: "toolcall_start", contentIndex: 2, id: "tool-1", toolName: "read" } }),
    event({ type: "message_update", assistantMessageEvent: { type: "toolcall_delta", contentIndex: 2, delta: '{"path":"example.ts"}' } }),
    event({ type: "tool_execution_start", toolName: "read", toolCallId: "tool-1" }),
    event({ type: "tool_execution_update", toolName: "read", toolCallId: "tool-1", partialResult: { content: "中间结果" } }),
    event({ type: "tool_execution_end", toolName: "read", toolCallId: "tool-1", result: { content: "最终结果" } }),
  ];
  const batched = reducer(base, { type: "events", actions }); const serial = actions.reduce(reducer, base);
  assert.deepEqual(batched, serial); assert.equal(batched.messages[0], base.messages[0]); assert.equal(blocksOf(batched.messages[1])[1].text, "你好\\(x_i\\)");
  const end = event({ type: "message_end", message: { role: "assistant", timestamp: 2, content: "最终权威正文", stopReason: "stop" } });
  assert.equal(blocksOf(reducer(batched, end).messages[1])[0].text, "最终权威正文");
  assert.equal(reducer(batched, event({ type: "agent_settled", aborted: true })).busy, false);
  const next = reducer(batched, event({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "补充" } }));
  assert.equal(next.tools, batched.tools, "普通文字不能重建已有工具状态");
});

test("后台窗口没有动画帧时使用定时后备，提交后取消两个调度", async () => {
  const frame = globalThis.requestAnimationFrame; const cancel = globalThis.cancelAnimationFrame;
  let cancelled = 0;
  globalThis.requestAnimationFrame = () => 7; globalThis.cancelAnimationFrame = (id) => { assert.equal(id, 7); cancelled++; };
  try {
    const result = await new Promise<number[]>((resolve) => { const queue = frameBatch<number>(resolve); queue.push(1); queue.push(2); });
    assert.deepEqual(result, [1, 2]); assert.equal(cancelled, 1);
  } finally { globalThis.requestAnimationFrame = frame; globalThis.cancelAnimationFrame = cancel; }
});
