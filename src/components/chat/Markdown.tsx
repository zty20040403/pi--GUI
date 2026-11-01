import { lazy, Suspense } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useChat } from "../../api/ChatProvider";
import { markdownParts, markdownUrl, type MarkdownProps } from "../render/MarkdownParts";
export { CopyButton } from "../render/CopyButton";
const RichMarkdown = lazy(() => import("../render/RichMarkdown"));
export function Markdown(props: MarkdownProps) {
  const { state } = useChat(); const config = { ...props, cwd: props.cwd ?? state.cwd };
  return <div className="markdown"><Suspense fallback={<ReactMarkdown skipHtml urlTransform={markdownUrl} remarkPlugins={[remarkGfm]} components={markdownParts(config, false)}>{props.text}</ReactMarkdown>}><RichMarkdown {...config} /></Suspense></div>;
}
