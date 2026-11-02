// App 专用快照观察器；不注册模型工具，不写入 pi 对话正文，不改任何项目文件。
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ChangeCapture } from "../server/change-capture.js";
import { ChangeStore } from "../server/change-store.js";
import { CHANGES_STATUS } from "../shared/changes.js";

export default function changes(pi: ExtensionAPI) {
  let active: ChangeCapture | undefined; let currentContext: ExtensionContext | undefined;
  const leaf = (ctx: ExtensionContext) => ctx.sessionManager.getLeafId() ?? undefined;
  const report = (sessionId: string, error?: string) => currentContext?.ui.setStatus(CHANGES_STATUS, JSON.stringify({ sessionId, turnId: active?.current?.id, revision: Date.now(), ...(error ? { error } : {}) }));
  async function safely(ctx: ExtensionContext, work: () => void | Promise<void>) {
    currentContext = ctx;
    try { await work(); }
    catch { report(ctx.sessionManager.getSessionId(), "改动快照保存失败；工具本身不受影响。请检查 App 数据目录的空间和权限。"); }
  }
  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "rpc") return;
    currentContext = ctx; active = new ChangeCapture(new ChangeStore(), (id) => report(id));
  });
  pi.on("agent_start", (_event, ctx) => {
    if (ctx.mode === "rpc") active?.start(ctx.sessionManager.getSessionId(), ctx.cwd, leaf(ctx));
  });
  pi.on("message_end", (event) => { if (event.message.role === "assistant") active?.assistant(event.message.timestamp); });
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "edit" && event.toolName !== "write") return;
    await safely(ctx, () => active?.before(event.toolCallId, event.toolName as "edit" | "write", event.input.path, leaf(ctx), event.parentToolCallId));
  });
  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName !== "edit" && event.toolName !== "write") return;
    await safely(ctx, () => active?.after(event.toolCallId, event.isError, leaf(ctx)));
  });
  pi.on("agent_settled", async (event, ctx) => safely(ctx, () => active?.finish(event.aborted ? "aborted" : "completed", leaf(ctx))));
  pi.on("session_shutdown", async (_event, ctx) => {
    await safely(ctx, () => active?.finish("interrupted", leaf(ctx))); active = undefined; currentContext = undefined;
  });
}
