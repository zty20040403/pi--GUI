import { useEffect, useState } from "react";
import { ChevronRight, Ellipsis, FolderClosed, FolderInput, FolderPlus, FolderX, House, PanelLeft, Pencil, Plus, RefreshCw, Search, Settings, SquarePen, Trash2 } from "lucide-react";
import { useChat } from "../../api/ChatProvider";
import { blocksOf } from "../../api/state";
import { displayTitle, filterProjects, projectGroups } from "../../api/projects";
import type { SessionDialogRequest } from "../dialogs/SessionDialog";
import { ErrorContent } from "../ui/ErrorContent";
import { errorInfo, type ErrorValue } from "../../../shared/errors";

function relativeTime(mtime: number, now: number) {
  if (!mtime) return "";
  const minutes = Math.floor((now - mtime) / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天`;
  const date = new Date(mtime);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function SessionSidebar({ hidden, onDialog, onClose, onSettings }: { hidden: boolean; onDialog: (request: SessionDialogRequest) => void; onClose: () => void; onSettings: () => void }) {
  const { state, projects, recents, running, home, switching, open, projectsLoading, projectsError, refreshProjects, unavailable, showUnavailable } = useChat();
  const [query, setQuery] = useState("");
  const [error, setError] = useState<ErrorValue>("");
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  const [folded, setFolded] = useState<string[]>(() => { try { const value = JSON.parse(localStorage.getItem("pi-desk.groups") ?? "[]"); return Array.isArray(value) ? value.filter((path) => typeof path === "string") : []; } catch { return []; } });
  const first = state.messages.find((message) => message.role === "user");
  const current = state.session.sessionFile ? { cwd: state.cwd, sessionPath: state.session.sessionFile, id: state.session.sessionId ?? "new",
    title: first ? blocksOf(first).filter((block) => block.type === "text").map((block) => block.text).join(" ").slice(0, 80) : "新对话", name: state.session.sessionName } : undefined;
  const groups = filterProjects(projectGroups(projects, recents, current), query);
  async function choose(cwd: string, sessionPath?: string) {
    setError(""); try { await open({ cwd, sessionPath }); } catch (error) { setError(errorInfo(error)); }
  }
  const isRunning = (path: string) => !!running[path] || path === state.session.sessionFile && state.busy;
  function fold(cwd: string) {
    setFolded((rows) => { const next = rows.includes(cwd) ? rows.filter((path) => path !== cwd) : [...rows, cwd]; try { localStorage.setItem("pi-desk.groups", JSON.stringify(next)); } catch {} return next; });
  }
  const closeMenu = (element: HTMLElement) => element.closest("details")?.removeAttribute("open");
  return <aside className="session-sidebar" hidden={hidden} aria-label="项目和对话列表">
    <div className="sidebar-heading">
      <div className="brand"><span className="brand-mark" aria-hidden>π</span><span>pi desk</span></div>
      <div>
        <button className="icon-button" aria-label="刷新对话列表" title="刷新对话列表" onClick={() => void refreshProjects()} disabled={projectsLoading}><RefreshCw size={14} className={projectsLoading ? "spin" : undefined} /></button>
        <button className="icon-button" aria-label="收起对话列表" title="收起对话列表" onClick={onClose}><PanelLeft size={16} /></button>
      </div>
    </div>
    <div className="sidebar-actions">
      <button className="sidebar-new" disabled={!state.cwd || switching || state.busy || state.compacting} onClick={() => void choose(state.cwd)}><SquarePen size={15} />新对话</button>
      <button className="icon-button" aria-label="打开文件夹" title="打开文件夹作为项目" disabled={switching} onClick={() => onDialog({ kind: "folder" })}><FolderPlus size={16} /></button>
    </div>
    <label className="search-field"><Search size={13} aria-hidden /><input className="session-search" aria-label="搜索对话" placeholder="搜索对话" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    {(projectsError || error) && <div className="sidebar-error" role="alert"><ErrorContent error={projectsError || error} /><button className="quiet-button" onClick={() => { setError(""); void refreshProjects(); }}>重试</button></div>}
    <div className="sidebar-list" aria-busy={projectsLoading}>
      {groups.length === 0 && <p className="sidebar-empty">{projectsLoading ? "正在读取对话…" : query ? "没有匹配的对话" : "还没有已保存的对话"}</p>}
      {groups.length > 0 && <div className="sidebar-section-label">项目</div>}
      {groups.map((project) => {
        const expanded = !!query.trim() || !folded.includes(project.cwd);
        const working = project.sessions.some((session) => isRunning(session.path));
        const isHome = project.cwd.replace(/\/$/, "") === home.replace(/\/$/, "") && !!home;
        const name = isHome ? "家目录" : project.cwd.split("/").filter(Boolean).at(-1) || "/";
        const Icon = isHome ? House : project.missing ? FolderX : FolderClosed;
        return <section className={`project-group ${project.missing ? "missing" : ""}`} key={project.cwd} data-cwd={project.cwd}>
          <div className="project-heading">
            <button className="project-toggle" aria-label={`折叠项目 ${name}`} aria-expanded={expanded} disabled={!!query.trim()} title={project.cwd} onClick={() => fold(project.cwd)}>
              <ChevronRight size={12} className="chevron" aria-hidden /><Icon size={14} aria-hidden /><strong>{name}</strong>{working && <span className="spinner" />}
            </button>
            <button className="icon-button small" aria-label={`在项目 ${name} 新建对话`} title="在这个项目新建对话" disabled={switching || working || !!project.missing} onClick={() => void choose(project.cwd)}><Plus size={13} /></button>
          </div>
          {expanded && <>
            {project.missing && <button className="quiet-button relocate-project" onClick={() => onDialog({ kind: "relocate", cwd: project.cwd })}><FolderInput size={13} />重新指定文件夹</button>}
            {isHome && <p className="home-hint" data-testid="home-memory-hint">在这里没有长期记忆</p>}
            {project.missing && <p className="home-hint missing-hint" title={project.cwd}>文件夹已不存在，可以重新指定位置</p>}
            <div className="project-sessions">
              {project.sessions.map((session) => {
                const title = displayTitle(session); const busy = isRunning(session.path); const active = (unavailable?.path ?? state.session.sessionFile) === session.path;
                return <div key={session.path} className={`session-row ${active ? "selected" : ""}`} data-testid="session-row" data-session-path={session.path} data-persisted={!session.virtual}>
                  <button className="session-open" aria-label={`打开对话 ${title}`} aria-current={active ? "page" : undefined} title={title} disabled={switching || working && !busy} onClick={() => project.missing ? showUnavailable(session) : void choose(project.cwd, session.path)}>
                    <span className="session-name">{title}</span>
                    {busy ? <span className="spinner" data-testid="session-running" aria-label="正在回复" /> : session.virtual ? <small>未保存</small> : <span className="session-time">{relativeTime(session.mtime, now)}</span>}
                  </button>
                  <details className="session-menu"><summary aria-label={`对话操作 ${title}`}><Ellipsis size={15} /></summary><div>
                    <button disabled={switching || working || !!project.missing} onClick={(event) => { closeMenu(event.currentTarget); onDialog({ kind: "rename", session }); }}><Pencil size={13} />改名</button>
                    <button className="danger-link" disabled={switching || busy || !!session.virtual} onClick={(event) => { closeMenu(event.currentTarget); onDialog({ kind: "delete", session }); }}><Trash2 size={13} />删除</button>
                  </div></details>
                </div>;
              })}
              {project.sessions.length === 0 && <p className="sidebar-empty">发送第一条消息后会保存到这里</p>}
            </div>
          </>}
        </section>;
      })}
    </div>
    <div className="sidebar-footer"><span>{projectsLoading ? "正在刷新…" : "对话与终端里的 pi 共用"}</span><button className="icon-button" aria-label="设置" title="设置 · 已隐藏的提醒" onClick={onSettings}><Settings size={15} /></button></div>
  </aside>;
}
