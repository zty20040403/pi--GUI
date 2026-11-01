import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, realpath, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { logText } from "../server/privacy.js";
import { startBackend } from "./server-runner.js";
import { DeskClient } from "./ws-client.js";

const exec = promisify(execFile);
async function trashIfPresent(path: string) {
  try { await stat(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  await exec("trash", [path]);
}

async function main() {
  const suppliedUrl = process.env.PI_DESK_URL ?? process.argv[2];
  const backend = suppliedUrl ? undefined : await startBackend();
  let client: DeskClient | undefined;
  let cwd: string | undefined;
  let sessionPath: string | undefined;
  try {
    cwd = await realpath(await mkdtemp(join(tmpdir(), "pi-desk-smoke-")));
    client = new DeskClient(suppliedUrl ?? backend!.url);
    await client.ready;
    const opened = await client.open(cwd);
    cwd = opened.cwd;
    sessionPath = opened.state.sessionFile;
    assert.ok(Array.isArray(opened.messages));
    assert.ok(Array.isArray(opened.models));
    assert.ok(Array.isArray(opened.commands));
    assert.ok(opened.models.some((model: { provider: string; id: string }) => model.provider === "cliproxy" && model.id === "gpt-6-luna"), "找不到测试模型 cliproxy/gpt-6-luna");
    await client.rpc(cwd!, { type: "set_model", provider: "cliproxy", modelId: "gpt-6-luna" });
    await client.rpc(cwd!, { type: "set_thinking_level", level: "low" });
    const state = await client.rpc(cwd!, { type: "get_state" });
    assert.equal(state.model.provider, "cliproxy");
    assert.equal(state.model.id, "gpt-6-luna");
    assert.equal(state.thinkingLevel, "low");

    const blocks = new Map<number, string>();
    let finalText = "";
    let failure = "";
    let deltas = 0;
    client.on("record", (message) => {
      if (message.op !== "event" || message.cwd !== cwd) return;
      const record = message.record;
      if (record.type === "message_start" && record.message?.role === "assistant") blocks.clear();
      const event = record.assistantMessageEvent;
      if (record.type === "message_update" && event?.type === "text_delta") {
        deltas++;
        blocks.set(event.contentIndex, (blocks.get(event.contentIndex) ?? "") + event.delta);
      }
      if (record.type === "message_end" && record.message?.role === "assistant") {
        if (["error", "aborted"].includes(record.message.stopReason)) failure = logText(record.message.errorMessage ?? record.message.stopReason);
        finalText = record.message.content.filter((part: { type: string }) => part.type === "text").map((part: { text: string }) => part.text).join("");
      }
    });
    // 必须先订阅：prompt 的 response 只表示接收成功，不表示 AI 已完成。
    const settled = client.waitFor((message) => message.op === "event" && message.cwd === cwd && message.record.type === "agent_settled", 180_000);
    // 防止 prompt 本身失败后，未 await 的 settled 变成未处理的 rejection。
    void settled.catch(() => {});
    await client.rpc(cwd!, { type: "prompt", message: "只回复 ok" });
    const event = await settled;
    assert.equal(event.record.aborted, false);
    assert.equal(failure, "", failure);
    const streamed = [...blocks.entries()].sort(([a], [b]) => a - b).map(([, text]) => text).join("");
    assert.ok(deltas > 0, "未收到 text_delta 流式记录");
    assert.equal(streamed, finalText, "流式拼接内容与最终消息不一致");
    assert.equal(streamed.trim(), "ok", "模型没有按要求只回复 ok");
    const stats = await client.rpc(cwd!, { type: "get_session_stats" });
    assert.ok(typeof stats.cost === "number" && Number.isFinite(stats.cost) && stats.cost >= 0);
    assert.ok(stats.tokens.total > 0, "未记录 token 使用量");
    sessionPath = stats.sessionFile;
    assert.ok(sessionPath, "未保存对话");
    // 实际切离再打开，验证 switch_session、get_messages 和正常保存，不额外调用模型。
    await client.rpc(cwd!, { type: "new_session" });
    const reopened = await client.open(cwd!, sessionPath);
    assert.equal(reopened.state.sessionId, stats.sessionId);
    assert.ok(reopened.messages.some((message: { role: string }) => message.role === "assistant"));
    console.log(`回复：${streamed.trim()}`);
    console.log(`花费：$${stats.cost.toFixed(6)}（${stats.tokens.total} tokens）`);
    console.log("通过：真实 pi、gpt-6-luna / low、流式事件、agent_settled、保存并重新打开对话");
  } finally {
    client?.close();
    await backend?.stop();
    // 只清理本脚本新建的测试资源；对话也移到 macOS 废纸篓，绝不直接删除。
    if (sessionPath) await trashIfPresent(sessionPath);
    if (cwd) await trashIfPresent(cwd);
  }
}

void main().catch((error: Error) => {
  console.error(`smoke 失败：${logText(error.message)}`);
  process.exitCode = 1;
});
