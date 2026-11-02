import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useChat } from "./ChatProvider";
import { errorInfo, type ErrorValue } from "../../shared/errors";
import { MAX_ATTACHMENTS, MAX_UPLOAD, attachmentScope, shortPath, uploadFile, type Attachment } from "./attachments";
const STORAGE = "pi-desk.attachments";
type Groups = Record<string, Attachment[]>;
function restored(): Groups {
  try {
    const value = JSON.parse(sessionStorage.getItem(STORAGE) ?? "{}"); const groups: Groups = {};
    for (const [scope, items] of Object.entries(value)) if (Array.isArray(items)) groups[scope] = items.filter((item) => item && item.status === "ready" && ["upload", "path"].includes(item.kind) && typeof item.path === "string" && typeof item.cwd === "string" && typeof item.id === "string" && typeof item.name === "string" && Number.isFinite(item.size) && item.size <= MAX_UPLOAD).slice(0, MAX_ATTACHMENTS).map(({ preview: _preview, ...item }) => item);
    return groups;
  } catch { return {}; }
}
type ContextValue = { items: Attachment[]; error: ErrorValue; addFiles: (files: File[]) => void; addPath: (cwd: string, path: string, name: string) => void;
  remove: (id: string) => void; submitted: (scope: string, ids: string[]) => void; clearError: () => void; reportError: (error: string) => void; scope: string };
const Context = createContext<ContextValue | null>(null);
export function useAttachments() { const value = useContext(Context); if (!value) throw new Error("缺少 AttachmentProvider"); return value; }
export function AttachmentProvider({ children }: { children: ReactNode }) {
  const { state: chat } = useChat(); const selected = useRef(chat); selected.current = chat;
  const [groups, setGroups] = useState(restored); const current = useRef(groups); current.current = groups;
  const [errors, setErrors] = useState<Record<string, ErrorValue>>({});
  const controllers = useRef(new Map<string, AbortController>()); const urls = useRef(new Map<string, string>());
  const active = useRef(true); const scope = attachmentScope(chat.cwd, chat.session.sessionId);
  const change = useCallback((fn: (value: Groups) => Groups) => { const next = fn(current.current); current.current = next; setGroups(next); }, []);
  useEffect(() => { try { sessionStorage.setItem(STORAGE, JSON.stringify(Object.fromEntries(Object.entries(groups).map(([key, rows]) => [key, rows.filter((row) => row.status === "ready").map(({ preview: _preview, ...row }) => row)])))); } catch {} }, [groups]);
  useEffect(() => { active.current = true; return () => { active.current = false; for (const abort of controllers.current.values()) abort.abort(); for (const url of urls.current.values()) URL.revokeObjectURL(url); }; }, []);
  const addFiles = useCallback((files: File[]) => {
    const target = selected.current; const origin = attachmentScope(target.cwd, target.session.sessionId);
    const report = (text: string) => setErrors((rows) => ({ ...rows, [origin]: text }));
    if (target.connection !== "ready") { report("请等项目连接完成后再添加文件"); return; }
    report("");
    for (const file of files) {
      if (file.size > MAX_UPLOAD) { report(`${file.name} 超过 50 MB，未添加`); continue; }
      const existing = current.current[origin] ?? [];
      if (existing.length >= MAX_ATTACHMENTS) { report("每次最多 12 个附件，请先移除一些文件"); break; }
      if (existing.reduce((size, row) => size + row.size, 0) + file.size > 100 * 1024 * 1024) { report("本次附件合计不能超过 100 MB，请分开发送"); continue; }
      const id = crypto.randomUUID(); const abort = new AbortController(); controllers.current.set(id, abort);
      const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
      if (preview) urls.current.set(id, preview);
      const row: Attachment = { id, cwd: target.cwd, name: file.name || "clipboard.png", size: file.size, kind: "upload", status: "uploading", preview, image: !!preview };
      change((rows) => ({ ...rows, [origin]: [...(rows[origin] ?? []), row] }));
      void uploadFile(target.cwd, file, abort.signal).then((result) => {
        if (!active.current || abort.signal.aborted) return;
        change((rows) => ({ ...rows, [origin]: (rows[origin] ?? []).map((item) => item.id === id ? { ...item, ...result, status: "ready" } : item) }));
      }, (error: Error) => {
        if (!active.current || abort.signal.aborted) return;
        const info = errorInfo(error); setErrors((rows) => ({ ...rows, [origin]: info }));
        change((rows) => ({ ...rows, [origin]: (rows[origin] ?? []).map((item) => item.id === id ? { ...item, status: "error", error: info.message } : item) }));
      }).finally(() => { controllers.current.delete(id); });
    }
  }, [change]);
  const addPath = useCallback((cwd: string, path: string, name: string) => {
    const target = selected.current; const origin = attachmentScope(target.cwd, target.session.sessionId);
    const report = (text: string) => setErrors((rows) => ({ ...rows, [origin]: text }));
    if (target.connection !== "ready" || target.cwd !== cwd) { report("只能引用当前项目的文件，请先切换项目"); return; }
    const rows = current.current[origin] ?? [];
    if (rows.some((item) => item.kind === "path" && item.path === path)) return;
    if (rows.length >= MAX_ATTACHMENTS) { report("每次最多 12 个附件，请先移除一些文件"); return; }
    change((groups) => ({ ...groups, [origin]: [...rows, { id: crypto.randomUUID(), kind: "path", path, name: shortPath(cwd, path) || name, cwd, size: 0, status: "ready" }] })); report("");
  }, [change]);
  function release(id: string) { controllers.current.get(id)?.abort(); controllers.current.delete(id); const url = urls.current.get(id); if (url) URL.revokeObjectURL(url); urls.current.delete(id); }
  function submitted(origin: string, ids: string[]) { for (const id of ids) release(id); change((rows) => ({ ...rows, [origin]: (rows[origin] ?? []).filter((item) => !ids.includes(item.id)) })); }
  return <Context.Provider value={{ items: groups[scope] ?? [], scope, error: errors[scope] ?? "", addFiles, addPath, submitted,
    remove: (id) => submitted(scope, [id]), clearError: () => setErrors((rows) => ({ ...rows, [scope]: "" })), reportError: (error) => setErrors((rows) => ({ ...rows, [scope]: error })) }}>{children}</Context.Provider>;
}
