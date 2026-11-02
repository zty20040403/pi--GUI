import { useEffect, useRef, useState } from "react";
import { useAttachments } from "../../api/AttachmentProvider";
import { PATH_DRAG_TYPE, treeDrag } from "../../api/attachments";
import { useChat } from "../../api/ChatProvider";
export function FileDrop() {
  const attachments = useAttachments(); const { state } = useChat(); const current = useRef({ attachments, cwd: state.cwd }); current.current = { attachments, cwd: state.cwd };
  const [kind, setKind] = useState<"file" | "path">();
  useEffect(() => {
    let entered = 0;
    const type = (event: DragEvent) => event.dataTransfer?.types.includes(PATH_DRAG_TYPE) ? "path" : event.dataTransfer?.types.includes("Files") ? "file" : undefined;
    const enter = (event: DragEvent) => { const value = type(event); if (!value) return; event.preventDefault(); entered++; setKind(value); };
    const leave = (event: DragEvent) => { if (!type(event)) return; entered = Math.max(0, entered - 1); if (!entered) setKind(undefined); };
    const over = (event: DragEvent) => { if (!type(event)) return; event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"; };
    const clear = () => { entered = 0; setKind(undefined); };
    const drop = (event: DragEvent) => {
      const value = type(event); clear(); if (!value || !event.dataTransfer) return; event.preventDefault();
      const { attachments, cwd } = current.current;
      if (value === "path") {
        const file = treeDrag(event.dataTransfer.getData(PATH_DRAG_TYPE), cwd);
        if (file) attachments.addPath(file.cwd, file.path, file.name); else attachments.reportError("这个文件不属于当前项目，请先切换项目");
      } else {
        if ([...event.dataTransfer.items].some((item) => item.webkitGetAsEntry?.()?.isDirectory)) attachments.reportError("暂不支持拖入文件夹，请拖入具体文件");
        else attachments.addFiles([...event.dataTransfer.files]);
      }
    };
    window.addEventListener("dragenter", enter); window.addEventListener("dragleave", leave); window.addEventListener("dragover", over); window.addEventListener("drop", drop); window.addEventListener("dragend", clear); window.addEventListener("blur", clear);
    return () => { window.removeEventListener("dragenter", enter); window.removeEventListener("dragleave", leave); window.removeEventListener("dragover", over); window.removeEventListener("drop", drop); window.removeEventListener("dragend", clear); window.removeEventListener("blur", clear); };
  }, []);
  return kind ? <div className="file-drop-overlay" role="status"><div><span>{kind === "path" ? "@" : "↓"}</span><strong>{kind === "path" ? "松手插入文件路径" : "松手添加到对话"}</strong><p>{kind === "path" ? "直接引用项目文件，不重复上传" : "每个文件最多 50 MB · 添加后写下问题再发送"}</p></div></div> : null;
}
