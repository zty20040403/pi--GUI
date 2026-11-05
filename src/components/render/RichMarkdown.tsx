import { memo } from "react";
import ReactMarkdown from "react-markdown";
import "katex/dist/katex.min.css";
import { markdownParts, markdownUrl } from "./MarkdownParts";
import { remarkPlugins, rehypePlugins } from "./markdown-plugins";

// 正文不变就不再解析；状态、计时、别的回复不会重新处理历史 Markdown。
export default memo(function RichMarkdown({ text }: { text: string }) {
  return <ReactMarkdown skipHtml urlTransform={markdownUrl} remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={markdownParts}>{text}</ReactMarkdown>;
});
