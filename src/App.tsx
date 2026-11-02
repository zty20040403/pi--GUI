import { useEffect, useState, type CSSProperties } from "react";
import { modeFromStatus, PERMISSION_LABELS, type PermissionMode } from "../shared/extensions";
import { useChat } from "./api/ChatProvider";
import { useExtensionUi } from "./api/ExtensionUiProvider";
import { useGoals } from "./api/GoalProvider";
import { ExtensionDialogs, ExtensionToasts } from "./components/dialogs/ExtensionDialogs";
import { blocksOf } from "./api/state";
import { useFiles } from "./api/FileProvider";
import { FilePanel } from "./components/right/FilePanel";
import { Composer } from "./components/chat/Composer";
import { FileDrop } from "./components/chat/FileDrop";
import { Messages } from "./components/chat/Messages";
import { SessionSidebar } from "./components/sidebar/SessionSidebar";
import { SessionDialog, type SessionDialogRequest } from "./components/dialogs/SessionDialog";

export function shortNumber(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return String(value);
}
const groupLabel = (provider: string) => provider.toLowerCase() === "cliproxy" ? "CLIProxy" : provider.toLowerCase() === "ninfer" ? "NInfer" : provider;

export default function App() {
  const { state, projects, switching, changeModel, changeThinking, open, reconnect, send } = useChat();
  const files = useFiles(); const ui = useExtensionUi(); const goals = useGoals();
  const permission = modeFromStatus(ui.current.statuses["desk" + "-permissions"]);
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<SessionDialogRequest>();
  const [layout, setLayout] = useState(() => {
    try { const saved = JSON.parse(localStorage.getItem("pi-desk.layout") ?? "{}"); return { open: saved.open !== false, width: Math.max(220, Math.min(460, Number(saved.width) || 280)) }; }
    catch { return { open: true, width: 280 }; }
  });
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { try { localStorage.setItem("pi-desk.layout", JSON.stringify(layout)); } catch {} }, [layout]);
  const project = state.cwd.split("/").filter(Boolean).at(-1) || "项目";
  const firstUser = state.messages.find((message) => message.role === "user");
  const title = state.session.sessionName || (firstUser ? blocksOf(firstUser).filter((block) => block.type === "text").map((block) => block.text).join(" ").slice(0, 50) : "新对话");
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
    try { await action(); } catch (error) { setError((error as Error).message); } finally { setChanging(false); }
  }
  const grouped = [...new Set(state.models.map((model) => model.provider))];
  const connection = { connecting: "连接中…", opening: "打开对话…", ready: "已连接", reconnecting: "连接断开，正在自动重连…", offline: "pi 已退出" }[state.connection];
  const elapsed = state.waitingSince ? Math.max(0, Math.floor((now - state.waitingSince) / 1000)) : 0;
  const usage = state.stats.contextUsage;
  const closeSidebar = () => setLayout((value) => ({ ...value, open: false }));
  return <div className="desk-layout" style={{ "--sidebar-width": `${layout.width}px`, "--file-width": `${files.width}px` } as CSSProperties}>
    <SessionSidebar hidden={!layout.open} onDialog={setDialog} onClose={closeSidebar} />
    {layout.open && <><button className="sidebar-backdrop" aria-label="关闭对话列表遮罩" onClick={closeSidebar} /><div className="sidebar-resizer" role="separator" aria-label="调整对话列表宽度" aria-orientation="vertical" aria-valuemin={220} aria-valuemax={460} aria-valuenow={layout.width} tabIndex={0}
      onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) setLayout((value) => ({ ...value, width: Math.max(220, Math.min(460, event.clientX)) }));
      }} onKeyDown={(event) => { if (["ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); setLayout((value) => ({ ...value, width: Math.max(220, Math.min(460, value.width + (event.key === "ArrowRight" ? 10 : -10))) })); } }} /></>}
    <main className="app-shell">
      <header className="topbar"><button className="quiet-button" aria-label={layout.open ? "收起对话列表" : "展开对话列表"} onClick={() => { if (matchMedia("(max-width:1100px)").matches) files.hide(); setLayout((value) => ({ ...value, open: !value.open })); }}>☰</button><div className="brand"><span>π</span><strong>pi desk</strong></div>
        <div className="conversation-title"><span title={state.cwd}>{project}</span><button className="conversation-name" title="点击改名" aria-label="重命名当前对话" disabled={disabled || !selected} onClick={() => selected && setDialog({ kind: "rename", session: selected })}>{title}</button></div>
        <div className="model-controls"><label>模型<select aria-label="模型" disabled={disabled || !state.models.length} value={state.session.model ? JSON.stringify([state.session.model.provider, state.session.model.id]) : ""} onChange={(event) => {
          const [provider, id] = JSON.parse(event.target.value); void configure(() => changeModel(provider, id));
        }}>{!state.session.model && <option value="">选择模型</option>}{grouped.map((provider) => <optgroup key={provider} label={groupLabel(provider)}>{state.models.filter((model) => model.provider === provider).map((model) => <option key={model.id} value={JSON.stringify([provider, model.id])}>
          {model.name || model.id}{model.cost ? ` · 入 $${model.cost.input}/M · 出 $${model.cost.output}/M` : ""}
        </option>)}</optgroup>)}</select></label><label>推理<select aria-label="推理强度" value={state.session.thinkingLevel ?? ""} disabled={disabled || !state.levels.length} onChange={(event) => void configure(() => changeThinking(event.target.value))}>
          {!state.levels.length && <option value="">加载中…</option>}{state.levels.map((level) => <option key={level} value={level}>{level}</option>)}
        </select></label><label>权限<select aria-label="权限模式" className="permission-select" data-mode={permission} value={permission ?? ""} disabled={changing || switching || state.connection !== "ready" || !permission} onChange={(event) => void configure(() => send(`/permissions ${event.target.value}`))}>
          {!permission && <option value="">{state.connection === "ready" ? "插件未加载" : "加载中…"}</option>}{(Object.keys(PERMISSION_LABELS) as PermissionMode[]).map((mode) => <option key={mode} value={mode}>{PERMISSION_LABELS[mode]}{mode === "full" ? "（不审批）" : ""}</option>)}
        </select></label></div>{goals.goals.length > 0 && <button className="quiet-button" aria-label="暂停目标" title="与 /goal-pause 相同：运行中首次停止当前轮，再按一次暂停目标" disabled={goals.pausing || state.connection !== "ready" || !state.commands.some((command) => command.name === "goal-pause")} onClick={() => void configure(goals.pause)}>{goals.pausing ? "正在暂停…" : "暂停目标 ⏸"}</button>}<button className="quiet-button" aria-label={files.shown ? "隐藏文件面板" : "展开文件面板"} onClick={() => { if (matchMedia("(max-width:900px)").matches) closeSidebar(); files.toggle(); }}>文件 ▤</button>
      </header>
      <div className="workspace-bar"><span className={state.connection === "ready" ? "connection-ok" : "muted"} data-testid="connection-status">● {connection}</span>
        {state.connection !== "ready" && <button className="quiet-button" onClick={reconnect}>重新连接</button>}
        <span className="workspace-path" title={state.cwd}>{state.cwd}</span><button className="quiet-button" disabled={disabled || !state.cwd} onClick={() => void configure(() => open({ cwd: state.cwd }))}>新对话</button>
      </div>
      {error && <div className="configuration-error" role="alert">{error}<button onClick={() => setError("")}>关闭</button></div>}
      {state.retry ? <div className="network-banner" role="status">网络不稳，第 {state.retry.attempt} 次重试…（最多 {state.retry.maxAttempts} 次）</div>
        : state.busy && state.waitingSince && elapsed >= 5 ? <div className="network-banner" role="status">等待模型回应 {elapsed} 秒…</div> : null}
      <Messages /><Composer />
      <footer className="statusbar"><span data-testid="session-cost">花费 ${(state.stats.cost ?? 0).toFixed(6)}</span><span data-testid="context-usage">{usage ? `ctx ${usage.tokens === null ? "待更新" : shortNumber(usage.tokens)} / ${shortNumber(usage.contextWindow)} (${usage.percent === null ? "—" : `${usage.percent.toFixed(1)}%`})` : "ctx 尚无用量"}</span>
        <span className="plugin-statuses" title={Object.values(ui.current.statuses).join(" · ")}>{Object.entries(ui.current.statuses).map(([key, value]) => <span key={key}>{value}</span>)}</span>
      </footer>
    </main>
    {files.shown && <><button className="file-backdrop" aria-label="关闭文件面板遮罩" onClick={files.hide} /><div className="file-resizer" role="separator" aria-label="调整文件面板宽度" aria-orientation="vertical" aria-valuemin={280} aria-valuemax={720} aria-valuenow={files.width} tabIndex={0}
      onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) files.setWidth(window.innerWidth - event.clientX); }}
      onKeyDown={(event) => { if (["ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); files.setWidth(files.width + (event.key === "ArrowLeft" ? 10 : -10)); } }} /></>}
    <FilePanel /><FileDrop />
    {dialog && <SessionDialog key={dialog.kind === "folder" ? "folder" : `${dialog.kind}:${dialog.session.path}`} request={dialog} close={() => setDialog(undefined)} />}
    <ExtensionDialogs /><ExtensionToasts />
  </div>;
}
