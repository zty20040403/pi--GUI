import { useEffect, useState, type CSSProperties } from "react";
import { FolderClosed, PanelLeft, PanelRight, Pause, RotateCw, TriangleAlert, X } from "lucide-react";
import { useChat } from "./api/ChatProvider";
import { desktopBridge } from "./api/desktop";
import { useExtensionUi } from "./api/ExtensionUiProvider";
import { useGoals } from "./api/GoalProvider";
import { ExtensionDialogs, ExtensionToasts } from "./components/dialogs/ExtensionDialogs";
import { blocksOf } from "./api/state";
import { useFiles } from "./api/FileProvider";
import { FilePanel } from "./components/right/FilePanel";
import { Composer } from "./components/chat/Composer";
import { FileDrop } from "./components/chat/FileDrop";
import { Messages } from "./components/chat/Messages";
import { MissingProject } from "./components/chat/MissingProject";
import { ErrorContent } from "./components/ui/ErrorContent";
import { SettingsDialog } from "./components/dialogs/SettingsDialog";
import { errorInfo, type ErrorValue } from "../shared/errors";
import { SessionSidebar } from "./components/sidebar/SessionSidebar";
import { SessionDialog, type SessionDialogRequest } from "./components/dialogs/SessionDialog";

export default function App() {
  const { state, projects, switching, open, reconnect, reloadSession, unavailable, relocateProject } = useChat();
  const files = useFiles(); const ui = useExtensionUi(); const goals = useGoals();
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState<ErrorValue>("");
  const [dialog, setDialog] = useState<SessionDialogRequest>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [layout, setLayout] = useState(() => {
    try { const saved = JSON.parse(localStorage.getItem("pi-desk.layout") ?? "{}"); return { open: saved.open !== false, width: Math.max(220, Math.min(460, Number(saved.width) || 264)) }; }
    catch { return { open: true, width: 264 }; }
  });
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { try { localStorage.setItem("pi-desk.layout", JSON.stringify(layout)); } catch {} }, [layout]);
  const viewCwd = unavailable?.cwd ?? state.cwd;
  const project = viewCwd.split("/").filter(Boolean).at(-1) || "项目";
  const firstUser = state.messages.find((message) => message.role === "user");
  const title = unavailable ? unavailable.name || unavailable.title : state.session.sessionName || (firstUser ? blocksOf(firstUser).filter((block) => block.type === "text").map((block) => block.text).join(" ").slice(0, 50) : "新对话");
  const selected = state.session.sessionFile ? projects.flatMap((project) => project.sessions).find((session) => session.path === state.session.sessionFile)
    ?? { cwd: state.cwd, path: state.session.sessionFile, id: state.session.sessionId ?? "new", title, name: state.session.sessionName, mtime: 0, virtual: true } : undefined;
  useEffect(() => {
    const base = ui.current.title || `${title} · pi desk`; document.title = base;
    if (!ui.pending.length) return;
    let waiting = false; const alert = `⏳ 等待回答 · ${ui.pending[0].cwd.split("/").filter(Boolean).at(-1)} · pi desk`;
    const timer = setInterval(() => { waiting = !waiting; document.title = waiting ? alert : base; }, 700);
    return () => { clearInterval(timer); document.title = base; };
  }, [title, ui.current.title, ui.pending[0]?.id]);
  const disabled = changing || switching || state.busy || state.compacting || state.connection !== "ready";
  async function configure(action: () => Promise<void>) {
    setChanging(true); setError("");
    try { await action(); } catch (error) { setError(errorInfo(error)); } finally { setChanging(false); }
  }
  function requestDialog(request: SessionDialogRequest) {
    const desktop = desktopBridge();
    if ((request.kind === "folder" || request.kind === "relocate") && desktop) void configure(async () => {
      const directory = await desktop.pickDirectory(); if (!directory) return;
      if (request.kind === "relocate") await relocateProject(request.cwd, directory.cwd); else await open({ cwd: directory.cwd });
    });
    else setDialog(request);
  }
  const connection = { connecting: "连接中…", opening: "打开对话…", ready: "已连接", reconnecting: "连接断开，正在重连…", offline: "pi 已退出" }[state.connection];
  const elapsed = state.waitingSince ? Math.max(0, Math.floor((now - state.waitingSince) / 1000)) : 0;
  const closeSidebar = () => setLayout((value) => ({ ...value, open: false }));
  const toggleSidebar = () => { if (matchMedia("(max-width:1100px)").matches) files.hide(); setLayout((value) => ({ ...value, open: !value.open })); };
  return <div className="desk-layout" style={{ "--sidebar-width": `${layout.width}px`, "--file-width": `${files.width}px` } as CSSProperties}>
    <SessionSidebar hidden={!layout.open} onDialog={requestDialog} onClose={closeSidebar} onSettings={() => setSettingsOpen(true)} />
    {layout.open && <><button className="sidebar-backdrop" aria-label="关闭对话列表遮罩" onClick={closeSidebar} /><div className="sidebar-resizer" role="separator" aria-label="调整对话列表宽度" aria-orientation="vertical" aria-valuemin={220} aria-valuemax={460} aria-valuenow={layout.width} tabIndex={0}
      onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) setLayout((value) => ({ ...value, width: Math.max(220, Math.min(460, event.clientX)) }));
      }} onKeyDown={(event) => { if (["ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); setLayout((value) => ({ ...value, width: Math.max(220, Math.min(460, value.width + (event.key === "ArrowRight" ? 10 : -10))) })); } }} /></>}
    <main className="app-shell">
      <header className="topbar">
        {!layout.open && <button className="icon-button" aria-label="展开对话列表" title="展开对话列表" onClick={toggleSidebar}><PanelLeft size={16} /></button>}
        <div className="conversation-title">
          <span className="title-project" title={viewCwd}><FolderClosed size={14} aria-hidden />{project}</span>
          <span className="title-sep" aria-hidden>/</span>
          <button className="conversation-name" title="点击改名" aria-label="重命名当前对话" disabled={disabled || !selected || !!unavailable} onClick={() => selected && setDialog({ kind: "rename", session: selected })}>{title}</button>
          <span className="workspace-path sr-only">{viewCwd}</span>
        </div>
        <div className="topbar-actions">
          <span className="connection" data-state={state.connection} data-testid="connection-status" title={connection}><span className="connection-dot" aria-hidden /><span className="connection-text">{connection}</span></span>
          {state.connection !== "ready" && <button className="quiet-button" onClick={reconnect}><RotateCw size={13} />重新连接</button>}
          {!unavailable && goals.goals.length > 0 && <button className="quiet-button goal-button" aria-label="暂停目标" title="与 /goal-pause 相同：运行中第一次停止当前轮，再按一次暂停目标" disabled={goals.pausing || state.connection !== "ready" || !state.commands.some((command) => command.name === "goal-pause")} onClick={() => void configure(goals.pause)}><Pause size={13} />{goals.pausing ? "正在暂停…" : "暂停目标"}</button>}
          <button className={`icon-button ${files.shown ? "is-on" : ""}`} aria-label={files.shown ? "隐藏文件面板" : "展开文件面板"} title={files.shown ? "隐藏文件面板" : "文件与预览"} disabled={!!unavailable} onClick={() => { if (matchMedia("(max-width:900px)").matches) closeSidebar(); files.toggle(); }}><PanelRight size={16} /></button>
        </div>
      </header>
      {!unavailable && state.externalChanged && <div className="banner sync-banner" role="alert" data-testid="external-change-banner"><TriangleAlert size={16} aria-hidden /><div><strong>这个对话在别处（比如终端）有新消息。</strong><span>重新载入后才能继续发送。{state.busy || state.compacting ? "请先停止当前回复。" : "输入框里的草稿会保留。"}</span></div><button className="quiet-button" disabled={disabled} onClick={() => void configure(reloadSession)}><RotateCw size={14} />重新载入</button></div>}
      {error && <div className="banner configuration-error" role="alert"><ErrorContent error={error} /><button aria-label="关闭错误提示" onClick={() => setError("")}><X size={13} /></button></div>}
      {state.retry ? <div className="banner network-banner" role="status"><span className="spinner" />网络不稳，第 {state.retry.attempt} 次重试…（最多 {state.retry.maxAttempts} 次）</div>
        : state.busy && state.waitingSince && elapsed >= 5 ? <div className="banner network-banner" role="status">等待模型回应 {elapsed} 秒…</div> : null}
      {unavailable && <MissingProject onDialog={requestDialog} />}
      <div className="chat-content" hidden={!!unavailable}><Messages /><Composer /></div>
    </main>
    {files.shown && !unavailable && <><button className="file-backdrop" aria-label="关闭文件面板遮罩" onClick={files.hide} /><div className="file-resizer" role="separator" aria-label="调整文件面板宽度" aria-orientation="vertical" aria-valuemin={280} aria-valuemax={720} aria-valuenow={files.width} tabIndex={0}
      onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) files.setWidth(window.innerWidth - event.clientX); }}
      onKeyDown={(event) => { if (["ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); files.setWidth(files.width + (event.key === "ArrowLeft" ? 10 : -10)); } }} /></>}
    {!unavailable && <><FilePanel /><FileDrop /></>}
    {dialog && <SessionDialog key={dialog.kind === "folder" ? "folder" : dialog.kind === "relocate" || dialog.kind === "delete-project" ? `${dialog.kind}:${dialog.cwd}` : `${dialog.kind}:${dialog.session.path}`} request={dialog} close={() => setDialog(undefined)} />}
    {settingsOpen && <SettingsDialog close={() => setSettingsOpen(false)} />}
    <ExtensionDialogs /><ExtensionToasts />
  </div>;
}
