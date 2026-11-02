import { useEffect, useState } from "react";
import { AtSign, File as FileIcon, FileText, X } from "lucide-react";
import { useAttachments } from "../../api/AttachmentProvider";
import { type Attachment } from "../../api/attachments";
import { useFiles } from "../../api/FileProvider";
import { fileBlob, fileInfo, fileSize } from "../../api/files";
function Thumbnail({ item }: { item: Attachment }) {
  const [url, setUrl] = useState(item.preview); const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false); if (item.preview) { setUrl(item.preview); return; }
    if (!item.image || !item.path) return;
    const abort = new AbortController(); let object: string | undefined;
    void fileInfo(item.cwd, item.path, abort.signal).then((file) => fileBlob(file, abort.signal)).then((blob) => {
      if (abort.signal.aborted) return; object = URL.createObjectURL(blob); setUrl(object);
    }, () => { if (!abort.signal.aborted) setFailed(true); });
    return () => { abort.abort(); if (object) URL.revokeObjectURL(object); };
  }, [item.cwd, item.path, item.preview, item.image]);
  return url && !failed ? <img src={url} alt={`附件预览 ${item.name}`} onError={() => setFailed(true)} /> : <span className="attachment-icon">{item.kind === "path" ? <AtSign size={16} /> : item.name.toLowerCase().endsWith(".pdf") ? <FileText size={16} /> : <FileIcon size={16} />}</span>;
}
export function AttachmentBar() {
  const { items, remove } = useAttachments(); const { openFile } = useFiles();
  if (!items.length) return null;
  return <div className="attachment-bar" aria-label="待发送附件">{items.map((item) => <div key={item.id} className={`attachment-card ${item.status === "error" ? "attachment-error" : ""}`} data-testid="attachment" data-path={item.path}>
    <button className="attachment-body" disabled={!item.path} title={item.path || "上传中"} onClick={() => item.path && void openFile(item.cwd, item.path)}><Thumbnail item={item} /><span><strong>{item.kind === "path" ? `@${item.name}` : item.name}</strong>
      <small>{item.status === "uploading" ? "正在上传…" : item.status === "error" ? item.error : item.kind === "path" ? "直接引用 · 不上传" : `${fileSize(item.size)} · ${item.image ? "直接看图" : "文件附件"}`}</small></span></button>
    <button className="attachment-remove" aria-label={`移除附件 ${item.name}`} title="只从这次消息移除；已上传文件仍保留" onClick={() => remove(item.id)}><X size={11} /></button>
  </div>)}</div>;
}
