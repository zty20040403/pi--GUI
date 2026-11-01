import type { Block, ChatMessage, Connection, Message, Model, Opened, SessionState, Stats, Tool, WireRecord, Command } from "./types";

export type ChatState = {
  cwd: string; connection: Connection; messages: ChatMessage[]; tools: Record<string, Tool>;
  activeKey?: string; session: SessionState; stats: Stats; models: Model[]; levels: string[]; commands: Command[];
  busy: boolean; compacting: boolean; waitingSince?: number; retry?: { attempt: number; maxAttempts: number };
  error?: string; notice?: string; statuses: Record<string, string>; steering: string[]; followUp: string[];
};
export const initialState: ChatState = {
  cwd: "", connection: "connecting", messages: [], tools: {}, session: {}, stats: {}, models: [], levels: [], commands: [],
  busy: false, compacting: false, statuses: {}, steering: [], followUp: [],
};
export type Action =
  | { type: "connection"; value: Connection }
  | { type: "opened"; value: Opened }
  | { type: "event"; value: WireRecord; now: number }
  | { type: "session"; value: SessionState }
  | { type: "stats"; value: Stats }
  | { type: "levels"; value: string[] }
  | { type: "error"; value?: string }
  | { type: "notice"; value?: string }
  | { type: "accepted"; disposition?: string; now: number };

export const blocksOf = (message: Message): Block[] => typeof message.content === "string"
  ? [{ type: "text", text: message.content }] : message.content ?? [];
export const messageKey = (message: Message) => `${message.role}:${message.timestamp}:${message.toolCallId ?? ""}`;
function updateTools(tools: Record<string, Tool>, message: Message): Record<string, Tool> {
  let next = tools;
  for (const block of blocksOf(message)) {
    if (block.type !== "toolCall" || !block.id) continue;
    next = { ...next, [block.id]: { ...next[block.id], id: block.id, name: block.name ?? "tool", args: block.arguments ?? {}, status: next[block.id]?.status ?? "pending" } };
  }
  if (message.role === "toolResult" && message.toolCallId) {
    const old = next[message.toolCallId];
    next = { ...next, [message.toolCallId]: { ...old, id: message.toolCallId, name: message.toolName ?? old?.name ?? "tool", args: old?.args ?? {},
      status: message.isError ? "error" : "done", result: message } };
  }
  return next;
}
function putMessage(state: ChatState, message: Message, complete: boolean, now: number): ChatState {
  const key = messageKey(message);
  const prior = state.messages.find((item) => item.key === key);
  const next: ChatMessage = { ...prior, ...message, key };
  if (complete && prior?.thinkingStarted && !prior.thinkingMs) next.thinkingMs = Math.max(0, now - prior.thinkingStarted);
  const messages = prior ? state.messages.map((item) => item.key === key ? next : item) : [...state.messages, next];
  const failed = complete && message.role === "assistant" && message.stopReason === "error";
  return { ...state, messages, tools: updateTools(state.tools, message),
    activeKey: message.role === "assistant" && !complete ? key : state.activeKey,
    error: failed ? message.errorMessage ?? "模型回复失败" : state.error };
}

export function reducer(state: ChatState, action: Action): ChatState {
  switch (action.type) {
    case "connection": return { ...state, connection: action.value };
    case "session": return { ...state, session: { ...state.session, ...action.value }, busy: action.value.isStreaming ?? state.busy, compacting: action.value.isCompacting ?? state.compacting };
    case "stats": return { ...state, stats: action.value };
    case "levels": return { ...state, levels: action.value };
    case "error": return { ...state, error: action.value };
    case "notice": return { ...state, notice: action.value };
    case "accepted": return action.disposition === "started" ? { ...state, busy: true, error: undefined, waitingSince: state.waitingSince ?? action.now } : state;
    case "opened": {
      const value = action.value;
      let next: ChatState = { ...initialState, cwd: value.cwd, connection: "ready", session: value.state,
        models: value.models, commands: value.commands, stats: value.stats, busy: !!value.state.isStreaming,
        compacting: !!value.state.isCompacting, statuses: state.cwd === value.cwd ? state.statuses : {},
        waitingSince: value.state.isStreaming ? Date.now() : undefined };
      for (const message of value.messages) next = putMessage(next, message, message.stopReason !== "pending", message.timestamp);
      return next;
    }
    case "event": break;
  }
  const event = action.value;
  const now = action.now;
  switch (event.type) {
    case "agent_start": return { ...state, busy: true, waitingSince: now, error: undefined };
    // agent_end 后可能继续重试/压缩/队列；只有 settled 才清 busy。
    case "agent_settled": return { ...state, busy: false, compacting: false, waitingSince: undefined, retry: undefined, activeKey: undefined, steering: [], followUp: [] };
    case "turn_start": return { ...state, waitingSince: now };
    case "message_start": case "message_end":
      if (!event.message) return state;
      return putMessage(state, event.message, event.type === "message_end", now);
    case "message_update": {
      if (!state.activeKey) return state;
      const update = event.assistantMessageEvent;
      if (!update || typeof update.contentIndex !== "number") return state;
      const messages = state.messages.map((message) => {
        if (message.key !== state.activeKey) return message;
        const blocks = blocksOf(message).slice();
        const old = blocks[update.contentIndex] ?? { type: "text" };
        let block = { ...old };
        const text = update.type.startsWith("text_");
        const thinking = update.type.startsWith("thinking_");
        if (text || thinking) {
          block.type = text ? "text" : "thinking";
          const key = text ? "text" : "thinking";
          if (update.type.endsWith("_delta")) block[key] = (block[key] ?? "") + update.delta;
          if (update.type.endsWith("_end")) block[key] = update.content;
        } else if (update.type === "toolcall_start") {
          block = { type: "toolCall", id: update.id, name: update.toolName, arguments: {}, argumentText: "" };
        } else if (update.type === "toolcall_delta") {
          block.argumentText = (block.argumentText ?? "") + update.delta;
          try { block.arguments = JSON.parse(block.argumentText); } catch {}
        } else if (update.type === "toolcall_end") block = update.toolCall;
        else return message;
        blocks[update.contentIndex] = block;
        return { ...message, content: blocks, thinkingStarted: thinking ? message.thinkingStarted ?? now : message.thinkingStarted,
          thinkingMs: thinking && update.type === "thinking_end" && message.thinkingStarted ? now - message.thinkingStarted : message.thinkingMs };
      });
      const active = messages.find((item) => item.key === state.activeKey);
      return { ...state, messages, tools: active ? updateTools(state.tools, active) : state.tools, waitingSince: undefined };
    }
    case "tool_execution_start": case "tool_execution_update": case "tool_execution_end": {
      const old = state.tools[event.toolCallId];
      const tool: Tool = { ...old, id: event.toolCallId, name: event.toolName, args: event.args ?? old?.args ?? {},
        status: event.type === "tool_execution_end" ? event.isError ? "error" : "done" : "running",
        result: event.result ?? event.partialResult ?? old?.result, durationMs: event.durationMs ?? old?.durationMs };
      return { ...state, tools: { ...state.tools, [tool.id]: tool }, waitingSince: undefined };
    }
    case "queue_update": return { ...state, steering: event.steering ?? [], followUp: event.followUp ?? [] };
    case "session_info_changed": return { ...state, session: { ...state.session, sessionName: event.name } };
    case "thinking_level_changed": return { ...state, session: { ...state.session, thinkingLevel: event.level } };
    case "compaction_start": return { ...state, compacting: true };
    case "compaction_end": return { ...state, compacting: false, error: event.errorMessage ?? state.error };
    case "auto_retry_start": return { ...state, retry: { attempt: event.attempt, maxAttempts: event.maxAttempts }, waitingSince: now };
    case "auto_retry_end": return { ...state, retry: undefined, error: event.success ? undefined : event.finalError ?? "重试失败" };
    case "extension_error": return { ...state, notice: `插件报错：${event.error ?? "未知错误"}` };
    case "extension_ui_request":
      if (event.method === "setStatus") {
        const statuses = { ...state.statuses };
        if (event.statusText === undefined) delete statuses[event.statusKey]; else statuses[event.statusKey] = event.statusText;
        return { ...state, statuses };
      }
      if (event.method === "notify") return { ...state, notice: event.message };
      return state;
    default: return state;
  }
}
