import { createContext, useCallback, useContext, useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { RpcClient } from "./client";
import { errorInfo, type ErrorValue } from "../../shared/errors";
import type { AttachmentRef } from "./attachments";
import { initialState, reducer, type ChatState, type EventAction } from "./state";
import { frameBatch } from "./frame-batch";
import { http, savedTarget, SESSION_KEY, savePreference } from "./storage";
import { readRecents, RECENTS_KEY, rememberProject } from "./projects";
import type { Activity, Project, RecentProject, SessionState, SessionSummary, Stats, Target, WireRecord } from "./types";

export type RecordEvent = { cwd: string; record: WireRecord; sessionPath?: string; seq?: number };
type ContextValue = {
  subscribeRecords: (listener: (event: RecordEvent) => void) => () => void;
  state: ChatState; projects: Project[]; home: string; recents: RecentProject[]; running: Record<string, boolean>;
  projectsLoading: boolean; projectsError: ErrorValue; switching: boolean; pluginsReloading: boolean; refreshProjects: () => Promise<void>;
  unavailable?: SessionSummary; showUnavailable: (session: SessionSummary) => void; closeUnavailable: () => void; relocateProject: (cwd: string, path: string) => Promise<void>;
  send: (message: string, behavior?: "steer" | "followUp", attachments?: AttachmentRef[]) => Promise<void>; stop: () => Promise<string[]>;
  changeModel: (provider: string, id: string) => Promise<void>; changeThinking: (level: string) => Promise<void>;
  open: (target: Target) => Promise<void>; openFolder: (path: string) => Promise<void>;
  renameSession: (session: SessionSummary, name: string) => Promise<void>; deleteSession: (session: SessionSummary) => Promise<void>;
  answerUi: (cwd: string, payload: WireRecord) => Promise<void>;
  reloadSession: () => Promise<void>; reconnect: () => void; clearError: () => void;
};
const Context = createContext<ContextValue | null>(null);
export function useChat() { const value = useContext(Context); if (!value) throw new Error("缺少 ChatProvider"); return value; }

export function ChatProvider({ token, children }: { token: string; children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const current = useRef(state); current.current = state;
  const [projects, setProjects] = useState<Project[]>([]);
  const [home, setHome] = useState("");
  const [recents, setRecents] = useState(() => readRecents(localStorage));
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState<ErrorValue>("");
  const [switching, setSwitching] = useState(false);
  const [pluginsReloading, setPluginsReloading] = useState(false); const pluginReload = useRef(false);
  const [unavailable, setUnavailable] = useState<SessionSummary>();
  const client = useRef<RpcClient>();
  const recordListeners = useRef(new Set<(event: RecordEvent) => void>());
  const subscribeRecords = useCallback((listener: (event: RecordEvent) => void) => {
    recordListeners.current.add(listener); return () => { recordListeners.current.delete(listener); };
  }, []);
  const refresh = useRef<() => Promise<void>>(async () => {});
  const refreshProjects = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    let active = true; let cwd = ""; let sessionPath: string | undefined; let hasMessages = false; let fallbackTarget: Target | undefined;
    let generation = 0; let requestId = 0; let activityVersion = 0;
    let listTimer: ReturnType<typeof setTimeout> | undefined;
    const updates = frameBatch<EventAction>((actions) => { if (active) dispatch({ type: "events", actions }); });
    const known: Record<string, string | undefined> = {};
    const wsUrl = new URL("/ws", window.location.href); wsUrl.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const rpc = new RpcClient(token, wsUrl.toString()); client.current = rpc;
    const persist = () => sessionStorage.setItem(SESSION_KEY, JSON.stringify({ cwd, sessionPath: hasMessages ? sessionPath : undefined }));
    const report = (error: unknown) => { if (active) dispatch({ type: "error", value: errorInfo(error) }); };
    const visit = (path: string) => setRecents((rows) => {
      const next = rememberProject(rows, path);
      try { savePreference(RECENTS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
    refreshProjects.current = async () => {
      const request = ++requestId; const version = activityVersion;
      setProjectsLoading(true);
      try {
        const response = await http<{ projects: Project[]; activity?: Activity[] }>("/api/projects", token);
        if (!active || request !== requestId) return;
        setProjects(response.projects); setProjectsError("");
        if (response.activity && version === activityVersion) {
          const next: Record<string, boolean> = {};
          for (const row of response.activity) if (row.sessionPath) { known[row.cwd] = row.sessionPath; if (row.busy) next[row.sessionPath] = true; }
          setRunning(next);
        }
      } catch (error) { if (active && request === requestId) setProjectsError(errorInfo(error)); }
      finally { if (active && request === requestId) setProjectsLoading(false); }
    };
    const scheduleList = () => {
      if (listTimer) clearTimeout(listTimer);
      listTimer = setTimeout(() => { if (active) void refreshProjects.current(); }, 50);
    };
    refresh.current = async () => {
      if (!cwd) return;
      const project = cwd; const version = generation;
      const [session, stats, levels] = await Promise.all([
        rpc.rpc<SessionState>(project, { type: "get_state" }), rpc.rpc<Stats>(project, { type: "get_session_stats" }),
        rpc.rpc<{ levels: string[] }>(project, { type: "get_available_thinking_levels" }),
      ]);
      if (!active || cwd !== project || generation !== version) return;
      sessionPath = session.sessionFile; hasMessages ||= (stats.userMessages ?? 0) > 0; persist();
      dispatch({ type: "session", value: session }); dispatch({ type: "stats", value: stats }); dispatch({ type: "levels", value: levels.levels });
    };
    const unsubscribe = rpc.subscribe((event) => {
      if (!active) return;
      if (event.kind !== "event") updates.flush();
      if (event.kind === "connection") { dispatch({ type: "connection", value: event.value }); setSwitching(event.value === "opening"); }
      if (event.kind === "error") report(event.value);
      if (event.kind === "projects_changed") scheduleList();
      if (event.kind === "opened") {
        cwd = event.value.cwd; sessionPath = event.value.state.sessionFile; generation++; activityVersion++;
        const prior = known[cwd]; known[cwd] = sessionPath;
        setRunning((rows) => { const next = { ...rows }; if (prior) delete next[prior]; if (sessionPath && event.value.state.isStreaming) next[sessionPath] = true; return next; });
        hasMessages = event.value.messages.some((message) => message.role === "user"); persist(); visit(cwd);
        if (event.value.ui) for (const listener of recordListeners.current) listener({ cwd, record: { type: "desk_ui_state", state: event.value.ui } });
        dispatch({ type: "opened", value: event.value }); void refresh.current().catch(report); scheduleList();
      }
      if (event.kind === "deleted") {
        activityVersion++;
        setRunning((rows) => { const next = { ...rows }; delete next[event.sessionPath]; return next; });
        setProjects((rows) => rows.map((project) => ({ ...project, sessions: project.sessions.filter((session) => session.path !== event.sessionPath) })));
        scheduleList();
        if (event.selected) {
          sessionStorage.removeItem(SESSION_KEY); sessionPath = undefined; hasMessages = false;
          void (async () => {
            let target = { cwd: rpc.selectedCwd ?? cwd };
            try { await http("/api/check-dir", token, { path: target.cwd }); }
            catch { if (fallbackTarget) target = fallbackTarget; }
            if (active) await rpc.open(target);
          })().catch(report);
        }
      }
      if (event.kind === "event") {
        const record = event.value;
        if (record.type === "desk_plugins_reload") { pluginReload.current = record.state !== "finished"; setPluginsReloading(pluginReload.current); }
        for (const listener of recordListeners.current) listener({ cwd: event.cwd, record, sessionPath: event.sessionPath, seq: event.seq });
        if (["agent_start", "agent_settled", "desk_process_exit"].includes(record.type)) {
          activityVersion++;
          const path = event.sessionPath ?? known[event.cwd];
          if (path) setRunning((rows) => { const next = { ...rows }; if (record.type === "agent_start") next[path] = true; else delete next[path]; return next; });
        }
        if (["agent_settled", "session_info_changed", "desk_process_exit"].includes(record.type)) scheduleList();
        if (event.cwd === cwd) {
          const action: EventAction = { type: "event", value: record, now: Date.now(), seq: event.seq };
          if (record.type === "message_update" || record.type === "tool_execution_update") updates.push(action);
          else { updates.flush(); dispatch(action); } // 结束、错误、停止等立即生效，且不能被旧 delta 覆盖。
          if (record.type === "message_end" && record.message?.role === "user") { hasMessages = true; persist(); scheduleList(); }
          if (record.type === "desk_process_exit") dispatch({ type: "session", value: { isStreaming: false, isCompacting: false } });
          if (["agent_settled", "thinking_level_changed", "session_info_changed"].includes(record.type)) void refresh.current().catch(report);
        }
      }
    });
    void (async () => {
      const workspace = await http<Target & { home?: string }>("/api/workspace", token);
      if (!active) return;
      setHome(workspace.home ?? ""); fallbackTarget = { cwd: workspace.cwd }; let target = savedTarget(sessionStorage) ?? workspace;
      // 上次打开的文件夹可能已被删掉（比如测试用的临时目录），那就回到默认项目，而不是一打开就报错。
      if (target.cwd !== workspace.cwd) {
        try { await http("/api/check-dir", token, { path: target.cwd }); }
        catch { sessionStorage.removeItem(SESSION_KEY); target = workspace; }
        if (!active) return;
      }
      cwd = target.cwd;
      rpc.connect(target); void refreshProjects.current();
    })().catch(report);
    return () => { active = false; updates.clear(); if (listTimer) clearTimeout(listTimer); unsubscribe(); rpc.dispose(); };
  }, [token]);

  async function rpc(cmd: WireRecord) {
    if (!client.current || current.current.connection !== "ready") throw new Error("请等待后台连接完成");
    return client.current.rpc(current.current.cwd, cmd);
  }
  async function send(message: string, behavior?: "steer" | "followUp", attachments: AttachmentRef[] = []) {
    if (pluginReload.current) throw new Error("插件正在等待重新加载，请先完成或取消重新加载；仍可停止回复或回答弹窗。");
    if (current.current.externalChanged) throw new Error("这个对话在别处有新消息，请先重新载入再发送。");
    dispatch({ type: "error", value: undefined }); const cwd = current.current.cwd;
    if (message.trim() === "/compact") { if (attachments.length) throw new Error("压缩上下文不需要附件，请先移除附件"); await rpc({ type: "compact" }); await refresh.current(); return; }
    const data = await rpc({ type: "prompt", message, ...(attachments.length ? { attachments } : {}), ...(current.current.busy ? { streamingBehavior: behavior ?? "steer" } : {}) });
    if (current.current.cwd !== cwd) return;
    dispatch({ type: "accepted", disposition: data?.disposition, now: Date.now() });
    if (data?.disposition === "handled") await refresh.current();
  }
  async function stop() {
    const queued = await rpc({ type: "clear_queue" }); await rpc({ type: "abort" }); await refresh.current();
    return [...(queued?.steering ?? []), ...(queued?.followUp ?? [])] as string[];
  }
  async function changeModel(provider: string, modelId: string) { await rpc({ type: "set_model", provider, modelId }); await refresh.current(); }
  async function changeThinking(level: string) { await rpc({ type: "set_thinking_level", level }); await refresh.current(); }
  async function open(target: Target) {
    if (!client.current) throw new Error("尚未连接后台");
    setSwitching(true); try { await client.current.open(target); setUnavailable(undefined); } finally { setSwitching(false); }
  }
  async function openFolder(path: string) { const target = await http<Target>("/api/check-dir", token, { path }); await open(target); }
  async function renameSession(session: SessionSummary, name: string) {
    const trimmed = name.trim(); if (!trimmed) throw new Error("请输入对话名称");
    if (!client.current) throw new Error("尚未连接后台");
    let cwd = client.current.selectedCwd!;
    if (client.current.selectedSessionPath !== session.path) {
      const opened = await client.current.open({ cwd: session.cwd, sessionPath: session.path }); cwd = opened.cwd;
    }
    await client.current.rpc(cwd, { type: "set_session_name", name: trimmed });
    setProjects((rows) => rows.map((project) => ({ ...project, sessions: project.sessions.map((row) => row.path === session.path ? { ...row, name: trimmed } : row) })));
    await refresh.current(); await refreshProjects.current();
  }
  async function deleteSession(session: SessionSummary) {
    await http("/api/sessions/delete", token, { path: session.path });
    if (unavailable?.path === session.path) setUnavailable(undefined);
    await refreshProjects.current();
  }
  async function relocateProject(cwd: string, path: string) {
    const session = unavailable?.cwd === cwd ? unavailable : projects.find((project) => project.cwd === cwd)?.sessions[0];
    const target = await http<Target>("/api/projects/relocate", token, { cwd, path });
    setRecents((rows) => { const next = rows.filter((row) => row.cwd !== cwd); try { savePreference(RECENTS_KEY, JSON.stringify(next)); } catch {} return next; });
    await refreshProjects.current(); await open({ cwd: target.cwd, sessionPath: session?.path });
  }
  return <Context.Provider value={{ subscribeRecords, state, projects, home, recents, running, projectsLoading, projectsError, switching, pluginsReloading,
    unavailable, showUnavailable: (session) => { setUnavailable(session); dispatch({ type: "error", value: undefined }); }, closeUnavailable: () => setUnavailable(undefined), relocateProject,
    refreshProjects: () => refreshProjects.current(), send, stop, changeModel, changeThinking, open, openFolder, renameSession, deleteSession,
    answerUi: async (cwd, payload) => { if (!client.current) throw new Error("尚未连接后台"); await client.current.uiResponse(cwd, payload); },
    reloadSession: async () => { await open({ cwd: current.current.cwd, sessionPath: current.current.session.sessionFile, reload: true }); },
    reconnect: () => client.current?.reconnect(), clearError: () => dispatch({ type: "error", value: undefined }) }}>{children}</Context.Provider>;
}
