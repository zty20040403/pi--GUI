import { useEffect, useState } from "react";
import { ChevronRight, Folder, FolderOpen, RefreshCw, SquareArrowOutUpRight } from "lucide-react";
import { useChat } from "../../api/ChatProvider";
import { PATH_DRAG_TYPE, shortPath } from "../../api/attachments";
import { useFiles } from "../../api/FileProvider";
import { fileTree, type TreeEntry, type TreeResult } from "../../api/files";
import { fileIcon } from "./fileIcon";
import { ErrorContent } from "../ui/ErrorContent";
import { errorInfo, type ErrorValue } from "../../../shared/errors";
function Directory({ cwd, dir, depth }: { cwd: string; dir: string; depth: number }) {
  const { project } = useFiles(); const [data, setData] = useState<TreeResult>(); const [error, setError] = useState<ErrorValue>("");
  useEffect(() => {
    const abort = new AbortController(); setError("");
    void fileTree(cwd, dir, abort.signal).then(setData, (error: Error) => { if (!abort.signal.aborted) setError(errorInfo(error)); });
    return () => abort.abort();
  }, [cwd, dir, project.treeVersion]);
  if (error) return <div className="preview-notice error-text" role="alert"><ErrorContent error={error} /></div>;
  if (!data) return <p className="tree-empty" style={{ paddingLeft: 14 + depth * 14 }}>正在读取…</p>;
  return <ul role="group" className="tree-group">{data.entries.map((entry) => <Entry key={`${entry.name}:${entry.path}`} cwd={cwd} entry={entry} depth={depth} />)}
    {!data.entries.length && <li className="tree-empty" style={{ paddingLeft: 14 + depth * 14 }}>空文件夹</li>}{data.truncated && <li className="tree-empty">目录超过 5000 项，只显示前 5000 项。</li>}
  </ul>;
}
function Entry({ cwd, entry, depth }: { cwd: string; entry: TreeEntry; depth: number }) {
  const { openFile, project } = useFiles(); const [expanded, setExpanded] = useState(false); const directory = entry.kind === "directory";
  const Icon = directory ? expanded ? FolderOpen : Folder : fileIcon(entry.name);
  return <li role="none"><button role="treeitem" aria-expanded={directory ? expanded : undefined} aria-label={directory ? `${expanded ? "收起" : "展开"}文件夹 ${entry.name}` : `预览 ${entry.name}`} className="file-node" data-path={entry.path} style={{ paddingLeft: 8 + depth * 14 }} title={entry.path}
    draggable={!directory} onDragStart={(event) => { if (directory) return; event.dataTransfer.effectAllowed = "copy"; event.dataTransfer.setData(PATH_DRAG_TYPE, JSON.stringify({ cwd, path: entry.path, name: entry.name })); event.dataTransfer.setData("text/plain", `@${shortPath(cwd, entry.path)}`); }}
    onClick={() => directory ? setExpanded((value) => !value) : void openFile(cwd, entry.path)}>
    <span className="file-node-icon">{directory && <ChevronRight size={12} aria-hidden />}</span><Icon size={14} className="file-type" aria-hidden /><span className="file-label">{entry.name}</span>{entry.symlink && <SquareArrowOutUpRight size={11} aria-label="链接" />}{project.changed[entry.path] && <span className="file-changed-dot" data-testid="file-changed" title="AI 修改过这个文件" />}</button>
    {directory && expanded && (depth < 60 ? <Directory cwd={cwd} dir={entry.path} depth={depth + 1} /> : <p className="tree-empty">目录过深，请用 Finder 打开。</p>)}
  </li>;
}
export default function FileTree() {
  const { state } = useChat(); const { refreshTree } = useFiles();
  return <div className="file-tree"><div className="tree-heading"><span title={state.cwd}>{state.cwd.split("/").at(-1) || "项目"}</span><button className="icon-button small" aria-label="刷新文件树" title="刷新文件树" onClick={refreshTree}><RefreshCw size={12} /></button></div>
    {state.cwd ? <div role="tree" aria-label="项目文件树"><Directory key={state.cwd} cwd={state.cwd} dir={state.cwd} depth={0} /></div> : <p className="tree-empty">连接项目后显示文件。</p>}
    <p className="tree-footnote">已隐藏 git、依赖、上传目录和敏感配置。点文件只预览，不会修改；可以拖到输入框里提问。</p>
  </div>;
}
