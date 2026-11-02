import { createContext, useCallback, useContext, useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { useChat } from "./ChatProvider";
import { savePreference } from "./storage";
import { fileInfo, type FileInfo } from "./files";
import { emptyFileProject, fileReducer, readFileTabs, type FileProject } from "./file-state";
import type { WireRecord } from "./types";
import { errorInfo, type ErrorValue } from "../../shared/errors";
type ContextValue = { project: FileProject; shown: boolean; width: number; error: ErrorValue; toggle: () => void; hide: () => void; setWidth: (value: number) => void;
  showChanges: () => void; clearError: () => void; openFile: (cwd: string, path: string) => Promise<void>; select: (path: string) => void; close: (path: string) => void;
  refresh: (file: FileInfo, force?: boolean) => Promise<void>; refreshTree: () => void };
const Context = createContext<ContextValue | null>(null);
export function useFiles() { const context = useContext(Context); if (!context) throw new Error("缺少 FileProvider"); return context; }
export function FileProvider({ children }: { children: ReactNode }) {
  const { state: chat, home, subscribeRecords } = useChat();
  const [state, dispatch] = useReducer(fileReducer, undefined, () => readFileTabs(sessionStorage));
  const [layout, setLayout] = useState(() => { try { const value = JSON.parse(localStorage.getItem("pi-desk.file-layout") ?? "{}"); return { shown: !matchMedia("(max-width:1100px)").matches && value.shown !== false, width: Math.max(280, Math.min(720, Number(value.width) || 430)) }; } catch { return { shown: !matchMedia("(max-width:1100px)").matches, width: 430 }; } });
  const [error, setError] = useState<ErrorValue>("");
  const seen = useRef(new Set<string>());
  const current = useRef({ state, chat }); current.current = { state, chat };
  const refresh = useCallback(async (file: FileInfo, force = true) => {
    try { const latest = await fileInfo(file.cwd, file.path); dispatch({ type: "refresh", file: latest, force }); setError(""); }
    catch (error) { setError(errorInfo(error)); }
  }, []);
  useEffect(() => { try { sessionStorage.setItem("pi-desk.file-tabs", JSON.stringify(state)); } catch {} }, [state]);
  useEffect(() => { try { savePreference("pi-desk.file-layout", JSON.stringify(layout)); } catch {} }, [layout]);
  useEffect(() => {
    const query = matchMedia("(max-width:1100px)"); const change = () => { if (query.matches) setLayout((value) => ({ ...value, shown: false })); };
    query.addEventListener("change", change); return () => query.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    const calls = new Map<string, WireRecord>();
    const mark = async (cwd: string, path: string) => {
      try { const file = await fileInfo(cwd, path); dispatch({ type: "refresh", file, changed: true }); }
      catch {} // 项目外/敏感路径不能靠工具事件绕过检查，也不自动打开。
    };
    return subscribeRecords(({ cwd, record, sessionPath }) => {
      const key = `${cwd}:${record.toolCallId}`;
      if (record.type === "tool_execution_start") calls.set(key, { name: record.toolName, args: record.args });
      if (record.type === "tool_execution_end") {
        const call = calls.get(key); calls.delete(key);
        const identity = `${cwd}:${sessionPath}:${record.toolCallId}`;
        if (call && ["edit", "write"].includes(call.name) && typeof call.args?.path === "string" && !record.isError && !seen.current.has(identity)) {
          seen.current.add(identity); void mark(cwd, call.args.path);
        }
      }
    });
  }, [subscribeRecords]);
  useEffect(() => {
    // 打开旧对话时也标出它已完成的修改；只读工具不标记。
    for (const tool of Object.values(chat.tools)) {
      const identity = `${chat.cwd}:${chat.session.sessionFile}:${tool.id}`;
      if (tool.status !== "done" || !["edit", "write"].includes(tool.name) || typeof tool.args.path !== "string" || seen.current.has(identity)) continue;
      seen.current.add(identity);
      void fileInfo(chat.cwd, tool.args.path).then((file) => dispatch({ type: "refresh", file, changed: true }), () => {});
    }
  }, [chat.tools, chat.cwd, chat.session.sessionFile]);
  const project = state[chat.cwd] ?? emptyFileProject();
  const active = project.tabs.find((file) => file.path === project.active);
  useEffect(() => {
    if (!layout.shown || !active) return;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const file = current.current.state[active.cwd]?.tabs.find((file) => file.path === active.path);
      if (file) void refresh(file, false);
    }, 2500);
    return () => clearInterval(timer);
  }, [layout.shown, active?.cwd, active?.path, refresh]);
  async function openFile(cwd: string, path: string) {
    setError("");
    try { const file = await fileInfo(cwd, path === "~" ? home : path.startsWith("~/") ? `${home}/${path.slice(2)}` : path); dispatch({ type: "open", file }); setLayout((value) => ({ ...value, shown: true })); }
    catch (error) { setError(errorInfo(error)); setLayout((value) => ({ ...value, shown: true })); }
  }
  return <Context.Provider value={{ project, shown: layout.shown, width: layout.width, error, openFile, refresh,
    showChanges: () => { dispatch({ type: "select", cwd: chat.cwd, path: "changes" }); setLayout((value) => ({ ...value, shown: true, width: project.active === "changes" ? value.width : Math.max(value.width, 640) })); },
    toggle: () => setLayout((value) => ({ ...value, shown: !value.shown })), hide: () => setLayout((value) => ({ ...value, shown: false })),
    setWidth: (width) => setLayout((value) => ({ ...value, width: Math.max(280, Math.min(720, width)) })), clearError: () => setError(""),
    select: (path) => dispatch({ type: "select", cwd: chat.cwd, path }), close: (path) => dispatch({ type: "close", cwd: chat.cwd, path }),
    refreshTree: () => dispatch({ type: "tree", cwd: chat.cwd }) }}>{children}</Context.Provider>;
}
