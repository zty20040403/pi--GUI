import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, Bug, ChevronRight, CircleAlert, FileSearch, FolderClosed, Lightbulb, ListTree, NotebookPen } from "lucide-react";
import { blocksOf } from "../../api/state";
import { useChat } from "../../api/ChatProvider";
import { Markdown } from "./Markdown";
import { ToolCard } from "./ToolCard";
import { MessageImage } from "./MessageImage";
import { PREFILL_EVENT } from "./Composer";
import { ErrorContent } from "../ui/ErrorContent";

const SUGGESTIONS = [
  { icon: ListTree, text: "介绍一下这个项目的结构和主要文件" },
  { icon: Bug, text: "检查代码里有没有明显的 bug" },
  { icon: NotebookPen, text: "帮我写一份 README，说明怎么运行" },
  { icon: FileSearch, text: "最近改了哪些文件？总结一下改动" },
];

function Welcome({ cwd }: { cwd: string }) {
  const project = cwd.split("/").filter(Boolean).at(-1);
  return <section className="welcome">
    <div className="welcome-mark" aria-hidden>π</div>
    <h1>今天想做点什么？</h1>
    <p>pi 会在当前项目里帮你读文件、写代码、执行命令。</p>
    {project && <p className="welcome-project" title={cwd}><FolderClosed size={13} aria-hidden /><span>{project}</span></p>}
    <div className="suggestions">{SUGGESTIONS.map(({ icon: Icon, text }) => <button key={text} onClick={() => window.dispatchEvent(new CustomEvent(PREFILL_EVENT, { detail: text }))}><Icon size={15} aria-hidden />{text}</button>)}</div>
    <p className="welcome-tip"><Lightbulb size={12} aria-hidden style={{ verticalAlign: -2, marginRight: 4 }} />可以直接把截图、PDF 拖进窗口，或从右侧文件树拖文件进来提问</p>
  </section>;
}

export function Messages() {
  const { state } = useChat();
  const viewport = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [jump, setJump] = useState(false);
  const sessionId = useRef(state.session.sessionId);
  useLayoutEffect(() => {
    if (sessionId.current !== state.session.sessionId) { stick.current = true; setJump(false); sessionId.current = state.session.sessionId; }
    if (stick.current && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [state.messages, state.tools, state.session.sessionId]);
  useEffect(() => {
    const inner = viewport.current?.querySelector(".messages-inner"); if (!inner) return;
    const observer = new ResizeObserver(() => { if (stick.current && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight; });
    observer.observe(inner); return () => observer.disconnect();
  }, []);
  const referenced = new Set(state.messages.flatMap((message) => blocksOf(message).filter((block) => block.type === "toolCall").map((block) => block.id)));
  return <div className="messages-shell"><div className="messages-scroll" ref={viewport} data-testid="messages-scroll" onScroll={() => {
    const element = viewport.current!;
    stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    setJump(!stick.current);
  }}><div className="messages-inner">
    {!state.messages.some((message) => message.role === "user") && <Welcome cwd={state.cwd} />}
    {state.messages.map((message) => {
      if (message.role === "system" || message.role === "toolResult" || message.role === "custom" && !message.display) return null;
      const blocks = blocksOf(message);
      return <article key={message.key} className={`message ${message.role === "user" ? "user-message" : "assistant-message"}`} data-role={message.role} data-stop={message.stopReason}>
        <div className="message-label">{message.role === "user" ? "你" : message.role === "assistant" ? "pi" : "对话记录"}</div>
        {blocks.map((block, index) => {
          if (block.type === "text") return message.role === "user" ? <div key={index} className="user-text">{block.text}</div> : <Markdown key={index} text={block.text ?? ""} />;
          if (block.type === "thinking") {
            const thinking = message.stopReason === "pending" && message.thinkingMs === undefined;
            return <details key={index} className="thinking"><summary><ChevronRight size={12} className="chevron" aria-hidden /><span className={thinking ? "shimmer" : undefined}>{message.thinkingMs !== undefined ? `思考了 ${(message.thinkingMs / 1000).toFixed(1)} 秒` : thinking ? "正在思考…" : "思考过程"}</span></summary>
              <pre>{block.redacted ? "此模型隐藏了思考内容" : block.thinking || "（无可显示的思考内容）"}</pre></details>;
          }
          if (block.type === "toolCall" && block.id && state.tools[block.id]) return <ToolCard key={block.id} tool={state.tools[block.id]} />;
          if (block.type === "image") return <MessageImage key={index} data={block.data} mime={block.mimeType} />;
          return null;
        })}
        {message.role === "bashExecution" && <pre>{message.command}{"\n"}{message.output}</pre>}
        {message.summary && <details className="thinking"><summary><ChevronRight size={12} className="chevron" aria-hidden />上下文摘要</summary><Markdown text={message.summary} /></details>}
        {message.stopReason === "aborted" && <p className="message-aborted">已停止这次回复</p>}
        {message.errorMessage && message.stopReason !== "aborted" && <div className="message-error"><CircleAlert size={14} aria-hidden style={{ marginTop: 2 }} /><ErrorContent error={{ message: message.errorMessage, details: message.errorMessageDetails }} /></div>}
      </article>;
    })}
    {Object.values(state.tools).filter((tool) => !referenced.has(tool.id)).map((tool) => <ToolCard key={tool.id} tool={tool} />)}
    {state.busy && <div className="working" role="status"><span className="shimmer">{state.compacting ? "正在压缩上下文…" : "pi 正在处理…"}</span></div>}
  </div></div>{jump && <button className="jump-button" aria-label="回到底部 ↓" onClick={() => {
    stick.current = true; setJump(false); viewport.current?.scrollTo({ top: viewport.current.scrollHeight, behavior: "smooth" });
  }}><ArrowDown size={13} />回到底部</button>}</div>;
}
