import { emptyUi, type UiRequest, type UiSnapshot } from "../shared/extensions.js";
import { HttpError } from "./http.js";
import type { RpcRecord } from "./pi-process.js";
const DIALOGS = new Set(["select", "confirm", "input", "editor"]);
export class ExtensionUi {
  private state = emptyUi();
  private readonly pending = new Map<string, { request: UiRequest; timer?: NodeJS.Timeout; owner?: string }>();
  private readonly tools = new Set<string>();
  constructor(private readonly resolved: (id: string, reason: string) => void) {}
  get pendingCount() { return this.pending.size; }
  snapshot(seq: number): UiSnapshot { return { ...this.state, seq, dialogs: [...this.pending.values()].map(({ request }) => ({ ...request })), statuses: { ...this.state.statuses }, widgets: { ...this.state.widgets } }; }
  restore(value: UiSnapshot) { this.state = { ...value, dialogs: [] }; }
  reset() { for (const id of this.pending.keys()) this.finish(id, "session"); this.state = emptyUi(); this.tools.clear(); }
  dispose() { for (const item of this.pending.values()) clearTimeout(item.timer); this.pending.clear(); }
  clearDialogs(reason = "abort") { for (const id of this.pending.keys()) this.finish(id, reason); }
  private finish(id: string, reason: string) { const item = this.pending.get(id); if (!item) return; clearTimeout(item.timer); this.pending.delete(id); this.resolved(id, reason); }
  record(record: RpcRecord) {
    if (record.type === "tool_execution_start" && typeof record.toolCallId === "string") this.tools.add(record.toolCallId);
    if (record.type === "tool_execution_end" && typeof record.toolCallId === "string") {
      for (const [id, item] of this.pending) if (item.owner === record.toolCallId) this.finish(id, "tool_finished"); this.tools.delete(record.toolCallId);
    }
    if (record.type !== "extension_ui_request" || typeof record.method !== "string" || typeof record.id !== "string") return;
    const request = record as UiRequest;
    if (DIALOGS.has(request.method)) {
      if (this.pending.has(request.id)) return;
      request.requestedAt = Date.now();
      const item: { request: UiRequest; timer?: NodeJS.Timeout; owner?: string } = { request, owner: this.tools.size === 1 ? [...this.tools][0] : undefined };
      if (typeof request.timeout === "number" && request.timeout > 0) { item.timer = setTimeout(() => this.finish(request.id, "timeout"), Math.min(request.timeout, 2147483647)); item.timer.unref(); }
      this.pending.set(request.id, item); return;
    }
    switch (request.method) {
      case "setStatus":
        if (typeof request.statusKey !== "string") break;
        if (typeof request.statusText === "string") this.state.statuses[request.statusKey] = request.statusText; else delete this.state.statuses[request.statusKey]; break;
      case "setWidget":
        if (typeof request.widgetKey !== "string") break;
        if (Array.isArray(request.widgetLines) && request.widgetLines.every((line) => typeof line === "string")) this.state.widgets[request.widgetKey] = { lines: request.widgetLines, placement: request.widgetPlacement === "belowEditor" ? "belowEditor" : "aboveEditor" };
        else delete this.state.widgets[request.widgetKey]; break;
      case "setTitle": if (typeof request.title === "string") this.state.title = request.title; break;
      case "set_editor_text": if (typeof request.text === "string") this.state.editor = { id: request.id, text: request.text }; break;
    }
  }
  clearEditor() { this.state.editor = undefined; }
  claim(payload: Record<string, unknown>) {
    const id = String(payload.id); const item = this.pending.get(id);
    if (!item) throw new HttpError(409, "这个弹窗已经回答或过期，请查看当前对话");
    const method = item.request.method; let response: Record<string, unknown>;
    if (payload.cancelled === true) response = { type: "extension_ui_response", id, cancelled: true };
    else if (method === "confirm" && typeof payload.confirmed === "boolean") response = { type: "extension_ui_response", id, confirmed: payload.confirmed };
    else if (["input", "editor", "select"].includes(method) && typeof payload.value === "string" && (method !== "select" || item.request.options?.includes(payload.value))) response = { type: "extension_ui_response", id, value: payload.value };
    else throw new HttpError(400, "弹窗回答与题目类型或选项不符");
    clearTimeout(item.timer); this.pending.delete(id); return response;
  }
}
