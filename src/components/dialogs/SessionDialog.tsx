import { useEffect, useId, useRef, useState } from "react";
import { FolderClosed } from "lucide-react";
import { useChat } from "../../api/ChatProvider";
import { displayTitle } from "../../api/projects";
import type { SessionSummary } from "../../api/types";
import { ErrorContent } from "../ui/ErrorContent";
import { errorInfo, type ErrorValue } from "../../../shared/errors";
export type SessionDialogRequest = { kind: "folder" } | { kind: "relocate"; cwd: string } | { kind: "delete-project"; cwd: string; sessions: SessionSummary[] } | { kind: "rename" | "delete"; session: SessionSummary };

export function SessionDialog({ request, close }: { request: SessionDialogRequest; close: () => void }) {
  const { openFolder, renameSession, deleteSession, relocateProject, recents } = useChat();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [value, setValue] = useState(request.kind === "rename" ? displayTitle(request.session) : "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ErrorValue>("");
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  const deleting = request.kind === "delete" || request.kind === "delete-project";
  const remaining = useRef(request.kind === "delete-project" ? [...request.sessions] : []);
  const folder = request.kind === "folder" || request.kind === "relocate";
  const title = request.kind === "relocate" ? "重新指定文件夹" : request.kind === "folder" ? "打开文件夹" : request.kind === "rename" ? "重命名对话" : "删除对话";
  async function submit() {
    if (pending) return; setPending(true); setError("");
    try {
      if (request.kind === "folder") await openFolder(value);
      if (request.kind === "relocate") await relocateProject(request.cwd, value);
      if (request.kind === "rename") await renameSession(request.session, value);
      if (request.kind === "delete") await deleteSession(request.session);
      if (request.kind === "delete-project") {
        while (remaining.current.length) { await deleteSession(remaining.current[0]); remaining.current.shift(); }
      }
      close();
    } catch (error) { setError(errorInfo(error)); }
    finally { setPending(false); }
  }
  return <dialog ref={dialog} className="session-dialog" aria-labelledby={titleId} onCancel={(event) => { if (pending) event.preventDefault(); else close(); }}>
    <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <h2 id={titleId}>{title}</h2>
      {request.kind === "relocate" && <p className="muted">选择搬家后的文件夹。只更新 App 的位置映射，不修改原对话文件中的目录。</p>}
      {deleting ? <><p>{request.kind === "delete-project" ? `将这个项目的 ${request.sessions.length} 个对话移到废纸篓？` : `将“${displayTitle(request.session)}”移到废纸篓？`}</p><p className="muted">不会永久删除。需要恢复时可以在 macOS 废纸篓中放回。</p></>
        : <label>{folder ? "文件夹路径" : "对话名称"}<input autoFocus aria-label={folder ? "文件夹路径" : "对话名称"} maxLength={request.kind === "rename" ? 120 : 4096} value={value} disabled={pending} placeholder={folder ? "输入绝对路径，或 ~/ 开头的路径" : "输入新名称"} onChange={(event) => setValue(event.target.value)} /></label>}
      {folder && recents.length > 0 && <div className="recent-projects"><h3>最近用过</h3>{recents.slice(0, 8).map((recent) => <button key={recent.cwd} type="button" disabled={pending} title={recent.cwd} onClick={() => setValue(recent.cwd)}><FolderClosed size={13} aria-hidden /><span>{recent.cwd}</span></button>)}</div>}
      {error && <div className="error-text" role="alert"><ErrorContent error={error} /></div>}
      <div className="dialog-actions"><button type="button" disabled={pending} onClick={close}>取消</button><button className={deleting ? "danger-button" : "send-button"} disabled={pending || !deleting && !value.trim()}>{pending ? "处理中…" : deleting ? "移到废纸篓" : request.kind === "relocate" ? "指定并打开" : request.kind === "folder" ? "打开" : "保存名称"}</button></div>
    </form>
  </dialog>;
}
