import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { markdownParts, markdownUrl, type MarkdownProps } from "./MarkdownParts";
export default function RichMarkdown(props: MarkdownProps) {
  return <ReactMarkdown skipHtml urlTransform={markdownUrl} remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, { trust: false, maxSize: 20, maxExpand: 1000, throwOnError: false }]]} components={markdownParts(props, true)}>{props.text}</ReactMarkdown>;
}
