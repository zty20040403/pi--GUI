import { FolderInput, FolderX, Trash2, X } from "lucide-react";
import { useChat } from "../../api/ChatProvider";
import type { SessionDialogRequest } from "../dialogs/SessionDialog";
export function MissingProject({ onDialog }: { onDialog: (request: SessionDialogRequest) => void }) {
  const { unavailable, closeUnavailable, switching, projects } = useChat();
  if (!unavailable) return null;
  return <section className="missing-project-empty" data-testid="missing-project-empty" aria-labelledby="missing-project-title">
    <FolderX size={36} strokeWidth={1.3} aria-hidden />
    <h2 id="missing-project-title">找不到这个对话的文件夹</h2>
    <p>文件夹可能搬家了，或已经被删除。你的对话文件仍然保存着。</p>
    <code>{unavailable.cwd}</code>
    <p className="muted">重新指定只更新 App 里的位置，不修改原对话文件。终端 pi 仍使用原来的目录。</p>
    <div className="missing-project-actions">
      <button className="send-button" disabled={switching} onClick={() => onDialog({ kind: "relocate", cwd: unavailable.cwd })}><FolderInput size={14} />重新指定文件夹</button>
      <button onClick={closeUnavailable}><X size={14} />关闭</button>
      <button className="danger-link" disabled={switching} onClick={() => onDialog({ kind: "delete-project", cwd: unavailable.cwd, sessions: projects.find((project) => project.cwd === unavailable.cwd)?.sessions ?? [unavailable] })}><Trash2 size={14} />删除这些对话</button>
    </div>
  </section>;
}
