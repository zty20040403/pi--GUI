import { Component, lazy, Suspense, useState, type ReactNode } from "react";
import { useFiles } from "../../api/FileProvider";
import { fileSize, previewKind, systemOpen, type FileInfo, type PreviewProps } from "../../api/files";
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
  const { project, shown, hide, error, clearError, select, close, refresh } = useFiles();
  const [action, setAction] = useState(false); const [actionError, setActionError] = useState("");
  const selected = project.tabs.find((file) => file.path === project.active);
  async function openSystem(file: FileInfo, reveal: boolean) {
    setAction(true); setActionError(""); try { await systemOpen(file, reveal); } catch (error) { setActionError((error as Error).message); } finally { setAction(false); }
  }
  return <aside className="file-panel" hidden={!shown} aria-label="文件面板">
    {shown && <><div className="file-panel-heading"><strong>文件与预览</strong><button className="quiet-button" aria-label="收起文件面板" onClick={hide}>×</button></div>
      <div className="file-tabs" role="tablist" aria-label="文件标签"><button id="file-tree-tab" role="tab" aria-selected={!selected} onClick={() => select("tree")}>文件</button>{project.tabs.map((file) => <div className={`file-tab ${project.active === file.path ? "selected" : ""}`} key={file.path}>
        <button role="tab" aria-selected={project.active === file.path} title={file.path} data-file-path={file.path} onClick={() => select(file.path)}>{file.name}</button><button className="quiet-button" aria-label={`关闭预览 ${file.name}`} onClick={() => close(file.path)}>×</button>
      </div>)}</div>
      {(error || actionError) && <div className="file-panel-error" role="alert">{error || actionError}<button className="quiet-button" onClick={() => { clearError(); setActionError(""); }}>关闭</button></div>}
      <div className="file-body"><div className="tree-panel" hidden={!!selected} role="tabpanel" aria-labelledby="file-tree-tab"><Suspense fallback={<p className="preview-notice">正在载入文件树…</p>}><FileTree /></Suspense></div>
        {selected && <div className="file-view" key={selected.path}><div className="file-meta"><span title={selected.path}>{selected.path}</span><div className="file-actions"><button disabled={action} onClick={() => void openSystem(selected, false)}>用默认软件打开</button><button disabled={action} onClick={() => void openSystem(selected, true)}>在 Finder 中显示</button><button onClick={() => void refresh(selected)}>刷新</button></div></div>
          <div className="file-preview" role="tabpanel" aria-label={`预览 ${selected.name}`} data-preview-kind={previewKind(selected)}><PreviewBoundary key={`${selected.path}:${project.versions[selected.path] ?? 0}`}><Suspense fallback={<p className="preview-notice">正在载入预览组件…</p>}><Preview file={selected} version={project.versions[selected.path] ?? 0} /></Suspense></PreviewBoundary></div>
          <div className="file-info">{fileSize(selected.size)} · 修改时间 {new Date(selected.mtime).toLocaleTimeString()} · 只读</div>
        </div>}
      </div></>}
  </aside>;
}
