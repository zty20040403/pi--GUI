import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { blocksOf } from "../../api/state";
import { useChat } from "../../api/ChatProvider";
import { Markdown } from "./Markdown";
import { ToolCard } from "./ToolCard";

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
    {!state.messages.some((message) => message.role === "user") && <section className="welcome"><div className="welcome-mark">π</div><h1>今天想做点什么？</h1><p>直接开始聊，pi 会在当前项目里帮你读文件、写代码和执行命令。</p><p className="muted">左侧管理对话，右侧只读预览文件；附件和操作审批将在第 5 阶段提供。</p></section>}
    {state.messages.map((message) => {
      if (message.role === "system" || message.role === "toolResult" || message.role === "custom" && !message.display) return null;
      const blocks = blocksOf(message);
      return <article key={message.key} className={`message ${message.role === "user" ? "user-message" : "assistant-message"}`} data-role={message.role} data-stop={message.stopReason}>
        <div className="message-label">{message.role === "user" ? "你" : message.role === "assistant" ? "pi" : "对话记录"}</div>
        {blocks.map((block, index) => {
          if (block.type === "text") return message.role === "user" ? <div key={index} className="user-text">{block.text}</div> : <Markdown key={index} text={block.text ?? ""} />;
          if (block.type === "thinking") return <details key={index} className="thinking"><summary>{message.thinkingMs !== undefined ? `思考了 ${(message.thinkingMs / 1000).toFixed(1)} 秒` : message.stopReason === "pending" ? "正在思考…" : "思考过程"}</summary><pre>{block.redacted ? "此模型隐藏了思考内容" : block.thinking || "（无可显示的思考内容）"}</pre></details>;
          if (block.type === "toolCall" && block.id && state.tools[block.id]) return <ToolCard key={block.id} tool={state.tools[block.id]} />;
          if (block.type === "image") return <p key={index} className="muted">[图片附件：图片显示将在第 5 阶段提供]</p>;
          return null;
        })}
        {message.role === "bashExecution" && <pre>{message.command}{"\n"}{message.output}</pre>}
        {message.summary && <details><summary>上下文摘要</summary><Markdown text={message.summary} /></details>}
        {message.stopReason === "aborted" && <p className="muted">已停止这次回复</p>}
        {message.errorMessage && message.stopReason !== "aborted" && <p className="error-text">{message.errorMessage}</p>}
      </article>;
    })}
    {Object.values(state.tools).filter((tool) => !referenced.has(tool.id)).map((tool) => <ToolCard key={tool.id} tool={tool} />)}
    {state.busy && <div className="working" role="status"><span className="spinner" />{state.compacting ? "正在压缩上下文…" : "pi 正在回复"}</div>}
  </div></div>{jump && <button className="jump-button" onClick={() => {
    stick.current = true; setJump(false); viewport.current?.scrollTo({ top: viewport.current.scrollHeight, behavior: "smooth" });
  }}>回到底部 ↓</button>}</div>;
}
