import { Component, lazy, Suspense, useState, type ReactNode } from "react";
import { FileDiff, FolderSearch, FolderTree, RotateCw, SquareArrowOutUpRight, X } from "lucide-react";
import { useFiles } from "../../api/FileProvider";
import { fileSize, previewKind, systemOpen, type FileInfo, type PreviewProps } from "../../api/files";
import { fileIcon } from "./fileIcon";
import { ErrorContent } from "../ui/ErrorContent";
import { errorInfo, type ErrorValue } from "../../../shared/errors";
const ChangesPanel = lazy(() => import("../changes/ChangesPanel"));
const FileTree = lazy(() => import("./FileTree"));
const TextPreview = lazy(() => import("./TextPreview"));
const ImagePreview = lazy(() => import("./ImagePreview"));
const PdfPreview = lazy(() => import("./PdfPreview"));
const HtmlPreview = lazy(() => import("./HtmlPreview"));
const CsvPreview = lazy(() => import("./CsvPreview"));
const XlsxPreview = lazy(() => import("./XlsxPreview"));
const DocxPreview = lazy(() => import("./DocxPreview"));
const MediaPreview = lazy(() => import("./MediaPreview"));
class PreviewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p className="preview-notice error-text">预览组件未能载入，请刷新页面或用默认软件打开。</p> : this.props.children; }
}
function Preview(props: PreviewProps) {
  const kind = previewKind(props.file);
  switch (kind) {
    case "markdown": return <TextPreview {...props} markdown />;
    case "code": return <TextPreview {...props} />;
    case "image": return <ImagePreview {...props} />;
    case "pdf": return <PdfPreview {...props} />;
    case "html": return <HtmlPreview {...props} />;
    case "csv": return <CsvPreview {...props} />;
    case "xlsx": return <XlsxPreview {...props} />;
    case "docx": return <DocxPreview {...props} />;
    case "media": return <MediaPreview {...props} />;
    case "office": return <PdfPreview {...props} office />;
    case "binary": case "large": return <div className="file-summary"><h3>{props.file.name}</h3><p>{kind === "large" ? "文件超过 50 MB，不读取内容，请用默认软件打开。" : "这是二进制文件，不直接展示内容。请用默认软件打开或在 Finder 中查看。"}</p><dl><dt>大小</dt><dd>{fileSize(props.file.size)}</dd><dt>类型</dt><dd>{props.file.mime}</dd></dl></div>;
  }
}
export function FilePanel() {
  const { project, shown, hide, showChanges, error, clearError, select, close, refresh } = useFiles();
  const [action, setAction] = useState(false); const [actionError, setActionError] = useState<ErrorValue>("");
  const selected = project.tabs.find((file) => file.path === project.active); const changes = project.active === "changes";
  async function openSystem(file: FileInfo, reveal: boolean) {
    setAction(true); setActionError(""); try { await systemOpen(file, reveal); } catch (error) { setActionError(errorInfo(error)); } finally { setAction(false); }
  }
  return <aside className={`file-panel ${changes ? "changes-active" : ""}`} hidden={!shown} aria-label="文件面板">
    {shown && <><div className="file-panel-heading">
      <div className="file-tabs" role="tablist" aria-label="文件标签">
        <button id="file-tree-tab" role="tab" aria-selected={!selected && !changes} onClick={() => select("tree")}><FolderTree size={14} aria-hidden />文件</button>
        <button id="changes-tab" role="tab" aria-selected={changes} onClick={showChanges}><FileDiff size={14} aria-hidden />改动</button>
        {project.tabs.map((file) => { const Icon = fileIcon(file.name); return <div className={`file-tab ${project.active === file.path ? "selected" : ""}`} key={file.path}>
          <button role="tab" aria-selected={project.active === file.path} title={file.path} data-file-path={file.path} onClick={() => select(file.path)}><Icon size={13} aria-hidden />{file.name}</button>
          <button className="icon-button small" aria-label={`关闭预览 ${file.name}`} title="关闭" onClick={() => close(file.path)}><X size={12} /></button>
        </div>; })}
      </div>
      <button className="icon-button" aria-label="收起文件面板" title="收起文件面板" onClick={hide}><X size={15} /></button>
    </div>
      {(error || actionError) && <div className="file-panel-error" role="alert"><ErrorContent error={error || actionError} /><button className="quiet-button" onClick={() => { clearError(); setActionError(""); }}>关闭</button></div>}
      <div className="file-body">{changes && <div className="changes-panel-body" role="tabpanel" aria-labelledby="changes-tab"><PreviewBoundary><Suspense fallback={<p className="tree-empty">正在载入改动面板…</p>}><ChangesPanel /></Suspense></PreviewBoundary></div>}<div className="tree-panel" hidden={!!selected || changes} role="tabpanel" aria-labelledby="file-tree-tab"><Suspense fallback={<p className="tree-empty">正在载入文件树…</p>}><FileTree /></Suspense></div>
        {selected && <div className="file-view" key={selected.path}>
          <div className="file-meta"><span title={selected.path}>&lrm;{selected.path}</span><div className="file-actions">
            <button className="icon-button" aria-label="用默认软件打开" title="用默认软件打开" disabled={action} onClick={() => void openSystem(selected, false)}><SquareArrowOutUpRight size={14} /></button>
            <button className="icon-button" aria-label="在 Finder 中显示" title="在 Finder 中显示" disabled={action} onClick={() => void openSystem(selected, true)}><FolderSearch size={14} /></button>
            <button className="icon-button" aria-label="刷新" title="刷新" onClick={() => void refresh(selected)}><RotateCw size={14} /></button>
          </div></div>
          <div className="file-preview" role="tabpanel" aria-label={`预览 ${selected.name}`} data-preview-kind={previewKind(selected)}><PreviewBoundary key={`${selected.path}:${project.versions[selected.path] ?? 0}`}><Suspense fallback={<p className="tree-empty">正在载入预览…</p>}><Preview file={selected} version={project.versions[selected.path] ?? 0} /></Suspense></PreviewBoundary></div>
          <div className="file-info">{fileSize(selected.size)} · 修改于 {new Date(selected.mtime).toLocaleTimeString()} · 只读预览</div>
        </div>}
      </div></>}
  </aside>;
}
