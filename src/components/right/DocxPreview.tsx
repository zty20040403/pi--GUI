import { useEffect, useState } from "react";
import DOMPurify from "dompurify";
import type { PreviewProps } from "../../api/files";
import { parseDocument } from "./document";
import { useResource } from "./resource";
import { PreviewStatus } from "./PreviewStatus";
export default function DocxPreview(props: PreviewProps) {
  const { data, error } = useResource(props); const [html, setHtml] = useState<string>(); const [failure, setFailure] = useState("");
  useEffect(() => {
    const abort = new AbortController(); setHtml(undefined); setFailure("");
    if (data) void data.arrayBuffer().then((buffer) => parseDocument<string>("docx", buffer, abort.signal)).then((value) => {
      if (!abort.signal.aborted) setHtml(DOMPurify.sanitize(value, { USE_PROFILES: { html: true }, FORBID_TAGS: ["style", "iframe", "object", "embed", "form", "input"], FORBID_ATTR: ["style"] }));
    }, (error: Error) => { if (!abort.signal.aborted) setFailure(error.message); });
    return () => abort.abort();
  }, [data]);
  if (html === undefined) return <PreviewStatus error={error || failure} />;
  return <div><p className="preview-notice">Word 只读预览，排版可能和原文不同。外部文件访问已禁用。</p><div className="document-content markdown word-preview" onClick={(event) => {
    const anchor = (event.target as HTMLElement).closest("a");
    if (anchor?.href && /^(https?:|mailto:)/i.test(anchor.href)) { event.preventDefault(); window.open(anchor.href, "_blank", "noopener,noreferrer"); }
  }} dangerouslySetInnerHTML={{ __html: html }} /></div>;
}
