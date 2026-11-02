import type { ExtensionSessionState, UiSnapshot } from "../../shared/extensions";
// 使用本机 pi 1.4 的 RPC 记录；未知扩展字段保留，但不依赖整个 pi 包。
export type WireRecord = Record<string, any>;
export type Model = {
  id: string; name?: string; provider: string; reasoning?: boolean; contextWindow?: number;
  cost?: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
};
export type Block = {
  type: string; text?: string; thinking?: string; redacted?: boolean;
  id?: string; name?: string; arguments?: WireRecord; argumentText?: string;
  data?: string; mimeType?: string;
};
export type Message = {
  role: string; timestamp: number; content?: string | Block[]; stopReason?: string;
  toolCallId?: string; toolName?: string; isError?: boolean; display?: boolean;
  errorMessage?: string; errorMessageDetails?: string; model?: string; provider?: string; thinkingLevel?: string;
  command?: string; output?: string; summary?: string; details?: WireRecord;
};
export type ChatMessage = Message & { key: string; thinkingStarted?: number; thinkingMs?: number };
export type Tool = {
  id: string; name: string; args: WireRecord; status: "pending" | "running" | "done" | "error";
  result?: WireRecord; durationMs?: number;
};
export type SessionState = {
  model?: Model; thinkingLevel?: string; sessionFile?: string; sessionId?: string; sessionName?: string;
  isStreaming?: boolean; isCompacting?: boolean; messageCount?: number;
};
export type Stats = {
  cost?: number; sessionFile?: string; userMessages?: number; tokens?: { total: number };
  contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
};
export type Command = { name: string; description?: string; source?: string };
export type Opened = {
  op: "opened"; cwd: string; state: SessionState; messages: Message[]; stats: Stats; models: Model[]; commands: Command[]; seq?: number; ui?: UiSnapshot; extensions?: ExtensionSessionState; sync?: { sessionPath: string; externalChanged: boolean };
};
export type SessionSummary = { path: string; id: string; cwd: string; originalCwd?: string; title: string; name?: string; mtime: number; virtual?: boolean };
export type Project = { cwd: string; sessions: SessionSummary[]; missing?: true };
export type Activity = { cwd: string; sessionPath?: string; busy: boolean };
export type RecentProject = { cwd: string; openedAt: number };
export type Target = { cwd: string; sessionPath?: string; reload?: boolean };
export type Connection = "connecting" | "opening" | "ready" | "reconnecting" | "offline";
