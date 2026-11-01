import { lazy, Suspense, useState } from "react";
import { useFiles } from "../../api/FileProvider";
import { languageOf, TEXT_LIMIT, type PreviewProps } from "../../api/files";
import { Markdown } from "../chat/Markdown";
import { CopyButton } from "../render/CopyButton";
import { useResource, useBlobText } from "./resource";
import { PreviewStatus } from "./PreviewStatus";
const Highlight = lazy(() => import("../render/Highlight"));
export default function TextPreview(props: PreviewProps & { markdown?: boolean }) {
  const { openFile } = useFiles(); const { data, error } = useResource(props, true); const text = useBlobText(data); const [source, setSource] = useState(false);
  if (text === undefined) return <PreviewStatus error={error} />;
  return <div className="text-preview">
    <div className="preview-options"><span>{props.markdown ? "Markdown" : languageOf(props.file.path)}</span><div>{props.markdown && <button onClick={() => setSource((value) => !value)}>{source ? "排版" : "源码"}</button>}<CopyButton text={text} /></div></div>
    {props.file.size > TEXT_LIMIT && <p className="preview-notice">文件超过 1 MB，只显示前 1 MB（不是完整文件）。</p>}
    {props.markdown && !source ? <div className="document-content"><Markdown text={text} cwd={props.file.cwd} document={props.file.path} onFile={(path) => void openFile(props.file.cwd, path)} /></div>
      : <Suspense fallback={<pre>{text}</pre>}><Highlight code={text} language={languageOf(props.file.path)} lines /></Suspense>}
  </div>;
}
