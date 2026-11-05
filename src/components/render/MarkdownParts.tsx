import { Children, createContext, isValidElement, lazy, Suspense, useContext, useEffect, useState, type ReactNode } from "react";
import type { Components } from "react-markdown";
import { defaultUrlTransform } from "react-markdown";
import { fileBlob, fileInfo, localPath } from "../../api/files";
import { CopyButton } from "./CopyButton";
const Highlight = lazy(() => import("./Highlight"));
const Mermaid = lazy(() => import("./Mermaid"));
export type MarkdownProps = { text: string; cwd?: string; document?: string; onFile?: (path: string) => void };
export const MarkdownContext = createContext<Omit<MarkdownProps, "text">>({});
function plainText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (isValidElement<{ children?: ReactNode }>(node)) return plainText(node.props.children);
  return Children.toArray(node).map(plainText).join("");
}
function LocalImage({ src, alt, cwd, document }: { src: string; alt?: string; cwd?: string; document?: string }) {
  const external = /^(https?:|data:image\/)/i.test(src);
  const [url, setUrl] = useState(""); const [error, setError] = useState(false);
  useEffect(() => {
    if (external) return;
    const abort = new AbortController(); let active = true; let object = ""; setUrl(""); setError(false);
    void (async () => {
      if (!cwd || !src) throw new Error("missing path");
      const info = await fileInfo(cwd, localPath(cwd, document, src), abort.signal);
      if (!info.mime.startsWith("image/") || info.tooLarge) throw new Error("not an image");
      const blob = await fileBlob(info, abort.signal);
      if (active) { object = URL.createObjectURL(blob); setUrl(object); }
    })().catch(() => { if (active && !abort.signal.aborted) setError(true); });
    return () => { active = false; abort.abort(); if (object) URL.revokeObjectURL(object); };
  }, [src, cwd, document, external]);
  if (error) return <span className="muted">[图片无法载入：{alt || "文件不在项目内或不是图片"}]</span>;
  return external || url ? <img src={external ? src : url} alt={alt ?? ""} referrerPolicy="no-referrer" loading="lazy" /> : <span className="muted">正在载入图片…</span>;
}
export function markdownUrl(url: string) { return /^(data:image\/|file:\/\/\/)/i.test(url) ? url : defaultUrlTransform(url); }
// 类型身份必须固定：不能在每次 render 中定义函数组件，否则 React 会卸载图片/高亮/图表。
const MarkdownLink: Components["a"] = ({ children, href }) => {
  const props = useContext(MarkdownContext);
  return <a href={href} target="_blank" rel="noopener noreferrer" onClick={(event) => {
    if (href && props.cwd && props.onFile && !/^(https?:|mailto:|#)/i.test(href)) {
      event.preventDefault(); try { props.onFile(localPath(props.cwd, props.document, href)); } catch {}
    }
  }}>{children}</a>;
};
const MarkdownImage: Components["img"] = ({ src, alt }) => {
  const props = useContext(MarkdownContext);
  return <LocalImage src={src ?? ""} alt={alt} cwd={props.cwd} document={props.document} />;
};
const MarkdownCode: Components["pre"] = ({ children }) => {
  const child = Children.toArray(children).find(isValidElement);
  const language = child && isValidElement<{ className?: string }>(child) ? child.props.className?.replace("language-", "") ?? "text" : "text";
  const code = plainText(children).replace(/\n$/, "");
  return <div className="code-block"><div className="code-toolbar"><span>{language}</span><CopyButton text={code} /></div>
    <Suspense fallback={<pre><code>{code}</code></pre>}>{language === "mermaid" ? <Mermaid code={code} /> : <Highlight code={code} language={language} />}</Suspense>
  </div>;
};
export const markdownParts: Components = { a: MarkdownLink, img: MarkdownImage, pre: MarkdownCode };
