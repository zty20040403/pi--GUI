import { Children, isValidElement, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function CopyButton({ text }: { text: string }) {
  const [status, setStatus] = useState("复制");
  return <button className="quiet-button" type="button" onClick={() => {
    void navigator.clipboard.writeText(text).then(() => setStatus("已复制"), () => setStatus("复制失败"));
    setTimeout(() => setStatus("复制"), 2000);
  }}>{status}</button>;
}
function plainText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (isValidElement<{ children?: ReactNode }>(node)) return plainText(node.props.children);
  return Children.toArray(node).map(plainText).join("");
}
export function Markdown({ text }: { text: string }) {
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
    pre: ({ children }) => {
      const code = Children.toArray(children).find(isValidElement);
      const language = code && isValidElement<{ className?: string }>(code) ? code.props.className?.replace("language-", "") : "";
      return <div className="code-block"><div className="code-toolbar"><span>{language || "代码"}</span><CopyButton text={plainText(children).replace(/\n$/, "")} /></div><pre>{children}</pre></div>;
    },
  }}>{text}</ReactMarkdown></div>;
}
