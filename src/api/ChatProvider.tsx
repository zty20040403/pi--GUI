import { createContext, useContext, useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { RpcClient } from "./client";
import { initialState, reducer, type ChatState } from "./state";
import { http, savedTarget, SESSION_KEY } from "./storage";
import { readRecents, RECENTS_KEY, rememberProject } from "./projects";
import type { Activity, Project, RecentProject, SessionState, SessionSummary, Stats, Target, WireRecord } from "./types";

type ContextValue = {
  state: ChatState; projects: Project[]; home: string; recents: RecentProject[]; running: Record<string, boolean>;
  projectsLoading: boolean; projectsError: string; switching: boolean; refreshProjects: () => Promise<void>;
  send: (message: string, behavior?: "steer" | "followUp") => Promise<void>; stop: () => Promise<string[]>;
  changeModel: (provider: string, id: string) => Promise<void>; changeThinking: (level: string) => Promise<void>;
  open: (target: Target) => Promise<void>; openFolder: (path: string) => Promise<void>;
  renameSession: (session: SessionSummary, name: string) => Promise<void>; deleteSession: (session: SessionSummary) => Promise<void>;
  reconnect: () => void; clearError: () => void;
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
  const [projectsError, setProjectsError] = useState("");
  const [switching, setSwitching] = useState(false);
  const client = useRef<RpcClient>();
  const refresh = useRef<() => Promise<void>>(async () => {});
  const refreshProjects = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    let active = true; let cwd = ""; let sessionPath: string | undefined; let hasMessages = false;
    let generation = 0; let requestId = 0; let activityVersion = 0;
    let listTimer: ReturnType<typeof setTimeout> | undefined;
    const known: Record<string, string | undefined> = {};
    const wsUrl = new URL("/ws", window.location.href); wsUrl.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const rpc = new RpcClient(token, wsUrl.toString()); client.current = rpc;
    const persist = () => sessionStorage.setItem(SESSION_KEY, JSON.stringify({ cwd, sessionPath: hasMessages ? sessionPath : undefined }));
    const report = (error: Error) => { if (active) dispatch({ type: "error", value: error.message }); };
    const visit = (path: string) => setRecents((rows) => {
      const next = rememberProject(rows, path);
      try { localStorage.setItem(RECENTS_KEY, JSON.stringify(next)); } catch {}
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
      } catch (error) { if (active && request === requestId) setProjectsError((error as Error).message); }
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
      if (event.kind === "connection") { dispatch({ type: "connection", value: event.value }); setSwitching(event.value === "opening"); }
      if (event.kind === "error") report(new Error(event.value));
      if (event.kind === "opened") {
        cwd = event.value.cwd; sessionPath = event.value.state.sessionFile; generation++; activityVersion++;
        const prior = known[cwd]; known[cwd] = sessionPath;
        setRunning((rows) => { const next = { ...rows }; if (prior) delete next[prior]; if (sessionPath && event.value.state.isStreaming) next[sessionPath] = true; return next; });
        hasMessages = event.value.messages.some((message) => message.role === "user"); persist(); visit(cwd);
        dispatch({ type: "opened", value: event.value }); void refresh.current().catch(report); scheduleList();
      }
      if (event.kind === "deleted") {
        activityVersion++;
        setRunning((rows) => { const next = { ...rows }; delete next[event.sessionPath]; return next; });
        setProjects((rows) => rows.map((project) => ({ ...project, sessions: project.sessions.filter((session) => session.path !== event.sessionPath) })));
        scheduleList();
        if (event.selected) {
          sessionStorage.removeItem(SESSION_KEY); sessionPath = undefined; hasMessages = false;
          void rpc.open({ cwd: rpc.selectedCwd ?? cwd }).catch(report);
        }
      }
      if (event.kind === "event") {
        const record = event.value;
        if (["agent_start", "agent_settled", "desk_process_exit"].includes(record.type)) {
          activityVersion++;
          const path = event.sessionPath ?? known[event.cwd];
          if (path) setRunning((rows) => { const next = { ...rows }; if (record.type === "agent_start") next[path] = true; else delete next[path]; return next; });
        }
        if (["agent_settled", "session_info_changed", "desk_process_exit"].includes(record.type)) scheduleList();
        if (event.cwd === rpc.selectedCwd && record.type === "extension_ui_request" && ["select", "confirm", "input", "editor"].includes(record.method)) {
          rpc.uiResponse(event.cwd, { type: "extension_ui_response", id: record.id, cancelled: true });
          dispatch({ type: "notice", value: "这个插件需要交互弹窗，第 5 阶段才提供；本次已取消，请暂时在终端使用。" });
        }
        if (event.cwd === cwd) {
          dispatch({ type: "event", value: record, now: Date.now() });
          if (record.type === "message_end" && record.message?.role === "user") { hasMessages = true; persist(); scheduleList(); }
          if (record.type === "desk_process_exit") dispatch({ type: "session", value: { isStreaming: false, isCompacting: false } });
          if (["agent_settled", "thinking_level_changed", "session_info_changed"].includes(record.type)) void refresh.current().catch(report);
        }
      }
    });
    void (async () => {
      const workspace = await http<Target & { home?: string }>("/api/workspace", token);
      if (!active) return;
      setHome(workspace.home ?? ""); const target = savedTarget(sessionStorage) ?? workspace; cwd = target.cwd;
      rpc.connect(target); void refreshProjects.current();
    })().catch(report);
    return () => { active = false; if (listTimer) clearTimeout(listTimer); unsubscribe(); rpc.dispose(); };
  }, [token]);

  async function rpc(cmd: WireRecord) {
    if (!client.current || current.current.connection !== "ready") throw new Error("请等待后台连接完成");
    return client.current.rpc(current.current.cwd, cmd);
  }
  async function send(message: string, behavior?: "steer" | "followUp") {
    dispatch({ type: "error", value: undefined }); const cwd = current.current.cwd;
    if (message.trim() === "/compact") { await rpc({ type: "compact" }); await refresh.current(); return; }
    const data = await rpc({ type: "prompt", message, ...(current.current.busy ? { streamingBehavior: behavior ?? "steer" } : {}) });
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
    setSwitching(true); try { await client.current.open(target); } finally { setSwitching(false); }
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
    await http("/api/sessions/delete", token, { path: session.path }); await refreshProjects.current();
  }
  return <Context.Provider value={{ state, projects, home, recents, running, projectsLoading, projectsError, switching,
    refreshProjects: () => refreshProjects.current(), send, stop, changeModel, changeThinking, open, openFolder, renameSession, deleteSession,
    reconnect: () => client.current?.reconnect(), clearError: () => dispatch({ type: "error", value: undefined }) }}>{children}</Context.Provider>;
}
