import { memo, useMemo } from "react";
import { useChat } from "../../api/ChatProvider";
import { MarkdownContext, type MarkdownProps } from "../render/MarkdownParts";
import RichMarkdown from "../render/RichMarkdown";
export { CopyButton } from "../render/CopyButton";

export const Markdown = memo(function Markdown({ text, cwd, document, onFile }: MarkdownProps) {
  const { state } = useChat(); const project = cwd ?? state.cwd;
  const context = useMemo(() => ({ cwd: project, document, onFile }), [project, document, onFile]);
  return <MarkdownContext.Provider value={context}><div className="markdown"><RichMarkdown text={text} /></div></MarkdownContext.Provider>;
});
