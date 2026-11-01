import { useState } from "react";
import { useChat } from "../../api/ChatProvider";
import { blocksOf } from "../../api/state";
import { displayTitle, filterProjects, projectGroups } from "../../api/projects";
import type { SessionDialogRequest } from "../dialogs/SessionDialog";

export function SessionSidebar({ hidden, onDialog, onClose }: { hidden: boolean; onDialog: (request: SessionDialogRequest) => void; onClose: () => void }) {
  const { state, projects, recents, running, home, switching, open, projectsLoading, projectsError, refreshProjects } = useChat();
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [folded, setFolded] = useState<string[]>(() => { try { const value = JSON.parse(localStorage.getItem("pi-desk.groups") ?? "[]"); return Array.isArray(value) ? value.filter((path) => typeof path === "string") : []; } catch { return []; } });
  const first = state.messages.find((message) => message.role === "user");
  const current = state.session.sessionFile ? { cwd: state.cwd, sessionPath: state.session.sessionFile, id: state.session.sessionId ?? "new",
    title: first ? blocksOf(first).filter((block) => block.type === "text").map((block) => block.text).join(" ").slice(0, 80) : "新对话", name: state.session.sessionName } : undefined;
  const groups = filterProjects(projectGroups(projects, recents, current), query);
  async function choose(cwd: string, sessionPath?: string) {
    setError(""); try { await open({ cwd, sessionPath }); } catch (error) { setError((error as Error).message); }
  }
  const isRunning = (path: string) => !!running[path] || path === state.session.sessionFile && state.busy;
  function fold(cwd: string) {
    setFolded((rows) => { const next = rows.includes(cwd) ? rows.filter((path) => path !== cwd) : [...rows, cwd]; try { localStorage.setItem("pi-desk.groups", JSON.stringify(next)); } catch {} return next; });
  }
  return <aside className="session-sidebar" hidden={hidden} aria-label="项目和对话列表">
    <div className="sidebar-heading"><strong>对话</strong><div><button className="quiet-button" aria-label="刷新对话列表" onClick={() => void refreshProjects()} disabled={projectsLoading}>↻</button><button className="quiet-button sidebar-mobile-close" aria-label="收起对话列表" onClick={onClose}>×</button></div></div>
    <div className="sidebar-actions"><button disabled={!state.cwd || switching || state.busy || state.compacting} onClick={() => void choose(state.cwd)}>＋ 新对话</button><button disabled={switching} onClick={() => onDialog({ kind: "folder" })}>打开文件夹</button></div>
    <input className="session-search" aria-label="搜索对话" placeholder="搜索名字、第一句或项目…" value={query} onChange={(event) => setQuery(event.target.value)} />
    {(projectsError || error) && <div className="sidebar-error" role="alert">{projectsError || error}<button className="quiet-button" onClick={() => { setError(""); void refreshProjects(); }}>重试</button></div>}
    <div className="sidebar-list" aria-busy={projectsLoading}>
      {groups.length === 0 && <p className="sidebar-empty">{projectsLoading ? "正在读取对话…" : query ? "没有匹配的对话" : "还没有已保存的对话"}</p>}
      {groups.map((project) => {
        const expanded = !!query.trim() || !folded.includes(project.cwd);
        const working = project.sessions.some((session) => isRunning(session.path));
        const isHome = project.cwd.replace(/\/$/, "") === home.replace(/\/$/, "") && !!home;
        const name = isHome ? "家目录" : project.cwd.split("/").filter(Boolean).at(-1) || "/";
        return <section className="project-group" key={project.cwd} data-cwd={project.cwd}>
          <div className="project-heading"><button className="project-toggle" aria-label={`折叠项目 ${name}`} aria-expanded={expanded} disabled={!!query.trim()} title={project.cwd} onClick={() => fold(project.cwd)}><span>{expanded ? "⌄" : "›"}</span><strong>{name}</strong>{working && <span className="spinner" />}</button><button className="quiet-button" aria-label={`在项目 ${name} 新建对话`} disabled={switching || working} onClick={() => void choose(project.cwd)}>＋</button></div>
          {isHome && <p className="home-hint" data-testid="home-memory-hint">在这里没有长期记忆</p>}
          {expanded && <div className="project-sessions"><div className="saved-count">{project.sessions.filter((session) => !session.virtual).length} 个已保存对话</div>
            {project.sessions.map((session) => {
              const title = displayTitle(session); const busy = isRunning(session.path); const active = state.session.sessionFile === session.path;
              return <div key={session.path} className={`session-row ${active ? "selected" : ""}`} data-testid="session-row" data-session-path={session.path} data-persisted={!session.virtual}>
                <button className="session-open" aria-label={`打开对话 ${title}`} aria-current={active ? "page" : undefined} title={`${title}\n${session.path}`} disabled={switching || working && !busy} onClick={() => void choose(project.cwd, session.path)}>
                  <span className="session-name">{title}</span>{busy ? <span className="spinner" data-testid="session-running" aria-label="正在回复" /> : session.virtual ? <small>未保存</small> : null}
                </button>
                <details className="session-menu"><summary aria-label={`对话操作 ${title}`}>⋯</summary><div>
                  <button disabled={switching || working} onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); onDialog({ kind: "rename", session }); }}>改名</button>
                  <button className="danger-link" disabled={switching || busy || !!session.virtual} onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); onDialog({ kind: "delete", session }); }}>删除</button>
                </div></details>
              </div>;
            })}
            {project.sessions.length === 0 && <p className="sidebar-empty">发送第一条消息后会保存到这里</p>}
          </div>}
        </section>;
      })}
    </div>
    <div className="sidebar-footer">{projectsLoading ? "正在刷新…" : "对话与终端 pi 共用"}</div>
  </aside>;
}
