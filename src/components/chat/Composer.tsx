import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useChat } from "../../api/ChatProvider";
import { blocksOf } from "../../api/state";

export function Composer() {
  const { state, send, stop, clearError } = useChat();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(0);
  const [hideCommands, setHideCommands] = useState(false);
  const lastSubmitted = useRef("");
  const input = useRef<HTMLTextAreaElement>(null);
  const draftSession = useRef(state.session.sessionId);
  const draftText = useRef(draft); draftText.current = draft;
  const drafts = useRef(new Map<string, string>());
  useEffect(() => {
    const old = draftSession.current;
    if (old === state.session.sessionId) return;
    draftSession.current = state.session.sessionId;
    if (old) { drafts.current.set(old, draftText.current); setDraft(drafts.current.get(state.session.sessionId ?? "") ?? ""); }
    setError(""); lastSubmitted.current = ""; setHideCommands(false);
  }, [state.session.sessionId]);
  const available = [...state.commands, ...(state.commands.some((command) => command.name === "compact") ? [] : [{ name: "compact", description: "手动压缩当前上下文", source: "client" }])];
  const commands = !hideCommands && /^\/[^\s]*$/.test(draft) ? available.filter((command) => command.name.toLowerCase().includes(draft.slice(1).toLowerCase())).slice(0, 12) : [];
  const ready = state.connection === "ready";
  async function submit(behavior?: "steer" | "followUp", text = draft) {
    if (!text.trim() || sending || !ready) return;
    setSending(true); setError(""); lastSubmitted.current = text;
    const origin = draftSession.current;
    try {
      await send(text, behavior);
      if (origin) drafts.current.delete(origin);
      if (draftSession.current === origin) setDraft((current) => current === text ? "" : current);
      setHideCommands(false);
    } catch (error) { setError((error as Error).message); }
    finally { setSending(false); input.current?.focus(); }
  }
  async function abort() {
    if (stopping || !ready) return;
    setStopping(true); setError("");
    try {
      const queued = await stop();
      if (queued.length) setDraft((text) => [text, ...queued].filter(Boolean).join("\n\n"));
    } catch (error) { setError((error as Error).message); }
    finally { setStopping(false); input.current?.focus(); }
  }
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && !event.isComposing && !document.querySelector("dialog[open]") && (state.busy || state.compacting)) {
        event.preventDefault(); void abort();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  function pick(index: number) { setDraft(`/${commands[index].name} `); setHideCommands(true); input.current?.focus(); }
  function onKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (commands.length && ["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault(); setSelected((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + commands.length) % commands.length); return;
    }
    if (event.key === "Escape") { setHideCommands(true); return; }
    if (commands.length && (event.key === "Tab" || event.key === "Enter") && !event.altKey && !event.shiftKey) {
      event.preventDefault(); pick(Math.min(selected, commands.length - 1)); return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault(); void submit(state.busy && event.altKey ? "followUp" : undefined);
    }
  }
  const historicalPrompt = [...state.messages].reverse().find((message) => message.role === "user");
  const retryText = lastSubmitted.current || (historicalPrompt ? blocksOf(historicalPrompt).filter((block) => block.type === "text").map((block) => block.text).join("\n") : "");
  return <section className="composer-section">
    {(error || state.error) && <div className="error-banner" role="alert"><span>{error || state.error}</span><div>
      {retryText && <button disabled={!ready || state.busy || sending} onClick={() => { clearError(); void submit(undefined, retryText); }}>重试</button>}
      <button onClick={() => { setError(""); clearError(); }}>关闭提示</button>
    </div></div>}
    {state.notice && <p className="notice" role="status">{state.notice}</p>}
    {(state.steering.length > 0 || state.followUp.length > 0) && <div className="queue" aria-label="排队消息">
      {state.steering.map((message, index) => <div key={`steer-${index}`}><span>插话</span>{message}</div>)}
      {state.followUp.map((message, index) => <div key={`follow-${index}`}><span>做完再做</span>{message}</div>)}
    </div>}
    <div className="composer-box">
      {commands.length > 0 && <div className="command-menu" role="listbox" aria-label="斜杠命令">{commands.map((command, index) => <button role="option" aria-selected={index === Math.min(selected, commands.length - 1)} key={command.name} onClick={() => pick(index)}>
        <strong>/{command.name}</strong><span>{command.description || command.source}</span>
      </button>)}</div>}
      <textarea ref={input} aria-label="消息" placeholder={state.busy ? "继续输入：Enter 插话，Alt+Enter 做完再做" : "给 pi 发消息…（输入 / 查看命令）"} value={draft} onKeyDown={onKey} onChange={(event) => {
        setDraft(event.target.value); setSelected(0); setHideCommands(false);
      }} />
      <div className="composer-actions"><span className="input-hint">{state.busy ? "Enter 插话 · Alt+Enter 排队 · Esc 停止" : "Enter 发送 · Shift+Enter 换行"}</span><div>
        {(state.busy || state.compacting) && <button className="stop-button" disabled={!ready || stopping} onClick={() => void abort()}>{stopping ? "正在停止…" : "停止"}</button>}
        <button className="send-button" disabled={!ready || !draft.trim() || sending} onClick={() => void submit()}>{sending ? "发送中…" : state.busy ? "插话 ↑" : "发送 ↑"}</button>
      </div></div>
    </div>
    <p className="safety-hint">操作审批将在第 5 阶段提供。现在 pi 可以直接执行工具，请只在可信项目里使用。</p>
  </section>;
}
