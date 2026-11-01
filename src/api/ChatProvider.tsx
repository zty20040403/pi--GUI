import { createContext, useContext, useEffect, useReducer, useRef, type ReactNode } from "react";
import { RpcClient } from "./client";
import { initialState, reducer, type ChatState } from "./state";
import { http, savedTarget, SESSION_KEY } from "./storage";
import type { SessionState, Stats, Target, WireRecord } from "./types";

type ContextValue = {
  state: ChatState; send: (message: string, behavior?: "steer" | "followUp") => Promise<void>;
  stop: () => Promise<string[]>; changeModel: (provider: string, id: string) => Promise<void>;
  changeThinking: (level: string) => Promise<void>; open: (target: Target) => Promise<void>;
  reconnect: () => void; clearError: () => void;
};
const Context = createContext<ContextValue | null>(null);
export function useChat() { const value = useContext(Context); if (!value) throw new Error("缺少 ChatProvider"); return value; }

export function ChatProvider({ token, children }: { token: string; children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const current = useRef(state); current.current = state;
  const client = useRef<RpcClient>();
  const refresh = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    let active = true;
    let cwd = "";
    let sessionPath: string | undefined;
    let hasMessages = false;
    const wsUrl = new URL("/ws", window.location.href); wsUrl.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const rpc = new RpcClient(token, wsUrl.toString()); client.current = rpc;
    const persist = () => sessionStorage.setItem(SESSION_KEY, JSON.stringify({ cwd, sessionPath: hasMessages ? sessionPath : undefined }));
    const report = (error: Error) => { if (active) dispatch({ type: "error", value: error.message }); };
    refresh.current = async () => {
      if (!cwd) return;
      const project = cwd;
      const [session, stats, levels] = await Promise.all([
        rpc.rpc<SessionState>(project, { type: "get_state" }), rpc.rpc<Stats>(project, { type: "get_session_stats" }),
        rpc.rpc<{ levels: string[] }>(project, { type: "get_available_thinking_levels" }),
      ]);
      if (!active || cwd !== project) return;
      sessionPath = session.sessionFile;
      hasMessages ||= (stats.userMessages ?? 0) > 0;
      persist();
      dispatch({ type: "session", value: session }); dispatch({ type: "stats", value: stats }); dispatch({ type: "levels", value: levels.levels });
    };
    const unsubscribe = rpc.subscribe((event) => {
      if (!active) return;
      if (event.kind === "connection") dispatch({ type: "connection", value: event.value });
      if (event.kind === "error") report(new Error(event.value));
      if (event.kind === "opened") {
        cwd = event.value.cwd; sessionPath = event.value.state.sessionFile;
        hasMessages = event.value.messages.some((message) => message.role === "user"); persist();
        dispatch({ type: "opened", value: event.value });
        void refresh.current().catch(report);
      }
      if (event.kind === "event" && event.cwd === rpc.selectedCwd && event.value.type === "extension_ui_request" && ["select", "confirm", "input", "editor"].includes(event.value.method)) {
        // 完整弹窗属于第 5 阶段。安全取消（包括 open 期间），避免死等。
        rpc.uiResponse(event.cwd, { type: "extension_ui_response", id: event.value.id, cancelled: true });
        dispatch({ type: "notice", value: "这个插件需要交互弹窗，第 5 阶段才提供；本次已取消，请暂时在终端使用。" });
      }
      if (event.kind === "event" && event.cwd === cwd) {
        const record = event.value;
        dispatch({ type: "event", value: record, now: Date.now() });
        if (record.type === "message_end" && record.message?.role === "user") { hasMessages = true; persist(); }
        if (record.type === "agent_settled" || record.type === "thinking_level_changed" || record.type === "session_info_changed") void refresh.current().catch(report);
      }
    });
    void (async () => {
      const target = savedTarget(sessionStorage) ?? await http<Target>("/api/workspace", token);
      if (active) { cwd = target.cwd; rpc.connect(target); }
    })().catch(report);
    return () => { active = false; unsubscribe(); rpc.dispose(); };
  }, [token]);

  async function rpc(cmd: WireRecord) {
    if (!client.current || current.current.connection !== "ready") throw new Error("请等待后台连接完成");
    return client.current.rpc(current.current.cwd, cmd);
  }
  async function send(message: string, behavior?: "steer" | "followUp") {
    dispatch({ type: "error", value: undefined });
    if (message.trim() === "/compact") {
      await rpc({ type: "compact" }); await refresh.current(); return;
    }
    const data = await rpc({ type: "prompt", message, ...(current.current.busy ? { streamingBehavior: behavior ?? "steer" } : {}) });
    dispatch({ type: "accepted", disposition: data?.disposition, now: Date.now() });
    if (data?.disposition === "handled") await refresh.current();
  }
  async function stop() {
    const queued = await rpc({ type: "clear_queue" });
    await rpc({ type: "abort" });
    await refresh.current();
    return [...(queued?.steering ?? []), ...(queued?.followUp ?? [])] as string[];
  }
  async function changeModel(provider: string, modelId: string) { await rpc({ type: "set_model", provider, modelId }); await refresh.current(); }
  async function changeThinking(level: string) { await rpc({ type: "set_thinking_level", level }); await refresh.current(); }
  async function open(target: Target) {
    if (!client.current) throw new Error("尚未连接后台");
    await client.current.open(target);
  }
  return <Context.Provider value={{ state, send, stop, changeModel, changeThinking, open,
    reconnect: () => client.current?.reconnect(), clearError: () => dispatch({ type: "error", value: undefined }) }}>{children}</Context.Provider>;
}
