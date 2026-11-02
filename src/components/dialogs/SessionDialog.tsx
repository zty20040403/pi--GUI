import { useEffect, useId, useRef, useState } from "react";
import { FolderClosed } from "lucide-react";
import { useChat } from "../../api/ChatProvider";
import { displayTitle } from "../../api/projects";
import type { SessionSummary } from "../../api/types";
export type SessionDialogRequest = { kind: "folder" } | { kind: "rename" | "delete"; session: SessionSummary };

export function SessionDialog({ request, close }: { request: SessionDialogRequest; close: () => void }) {
  const { openFolder, renameSession, deleteSession, recents } = useChat();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [value, setValue] = useState(request.kind === "rename" ? displayTitle(request.session) : "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  const title = request.kind === "folder" ? "打开文件夹" : request.kind === "rename" ? "重命名对话" : "删除对话";
  async function submit() {
    if (pending) return; setPending(true); setError("");
    try {
      if (request.kind === "folder") await openFolder(value);
      if (request.kind === "rename") await renameSession(request.session, value);
      if (request.kind === "delete") await deleteSession(request.session);
      close();
    } catch (error) { setError((error as Error).message); }
    finally { setPending(false); }
  }
  return <dialog ref={dialog} className="session-dialog" aria-labelledby={titleId} onCancel={(event) => { if (pending) event.preventDefault(); else close(); }}>
    <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <h2 id={titleId}>{title}</h2>
      {request.kind === "delete" ? <><p>将“{displayTitle(request.session)}”移到废纸篓？</p><p className="muted">不会永久删除。需要恢复时可以在 macOS 废纸篓中放回。</p></>
        : <label>{request.kind === "folder" ? "文件夹路径" : "对话名称"}<input autoFocus aria-label={request.kind === "folder" ? "文件夹路径" : "对话名称"} maxLength={request.kind === "rename" ? 120 : 4096} value={value} disabled={pending} placeholder={request.kind === "folder" ? "输入绝对路径，或 ~/ 开头的路径" : "输入新名称"} onChange={(event) => setValue(event.target.value)} /></label>}
      {request.kind === "folder" && recents.length > 0 && <div className="recent-projects"><h3>最近用过</h3>{recents.slice(0, 8).map((recent) => <button key={recent.cwd} type="button" disabled={pending} title={recent.cwd} onClick={() => setValue(recent.cwd)}><FolderClosed size={13} aria-hidden /><span>{recent.cwd}</span></button>)}</div>}
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" disabled={pending} onClick={close}>取消</button><button className={request.kind === "delete" ? "danger-button" : "send-button"} disabled={pending || request.kind !== "delete" && !value.trim()}>{pending ? "处理中…" : request.kind === "delete" ? "移到废纸篓" : request.kind === "folder" ? "打开" : "保存名称"}</button></div>
    </form>
  </dialog>;
}
