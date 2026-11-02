import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { modeFromStatus } from "../../../shared/extensions";
import { useChat } from "../../api/ChatProvider";
import { useAttachments } from "../../api/AttachmentProvider";
import { attachmentRefs, type AttachmentRef } from "../../api/attachments";
import { blocksOf } from "../../api/state";
import { AttachmentBar } from "./AttachmentBar";
import { useExtensionUi } from "../../api/ExtensionUiProvider";
import { GoalPanel, TodoPanel, WidgetPanels } from "./ExtensionPanels";

export function Composer() {
  const { state, send, stop, clearError } = useChat();
  const attachments = useAttachments(); const ui = useExtensionUi(); const seenEditor = useRef("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(0);
  const [hideCommands, setHideCommands] = useState(false);
  const lastSubmitted = useRef("");
  const lastAttachments = useRef<AttachmentRef[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const draftSession = useRef(state.session.sessionId);
  const draftText = useRef(draft); draftText.current = draft;
  const drafts = useRef(new Map<string, string>());
  useEffect(() => {
    const old = draftSession.current;
    if (old === state.session.sessionId) return;
    draftSession.current = state.session.sessionId;
    if (old) { drafts.current.set(old, draftText.current); setDraft(drafts.current.get(state.session.sessionId ?? "") ?? ""); }
    setError(""); lastSubmitted.current = ""; lastAttachments.current = []; setHideCommands(false);
  }, [state.session.sessionId]);
  useEffect(() => {
    const editor = ui.current.editor; const key = `${state.cwd}:${editor?.id}`;
    if (editor && seenEditor.current !== key) { seenEditor.current = key; setDraft(editor.text); setHideCommands(false); input.current?.focus(); }
  }, [state.cwd, ui.current.editor?.id]);
  const available = [...state.commands, ...(state.commands.some((command) => command.name === "compact") ? [] : [{ name: "compact", description: "手动压缩当前上下文", source: "client" }])];
  const commands = !hideCommands && /^\/[^\s]*$/.test(draft) ? available.filter((command) => command.name.toLowerCase().includes(draft.slice(1).toLowerCase())).slice(0, 12) : [];
  const ready = state.connection === "ready";
  const pendingAttachment = attachments.items.some((item) => item.status !== "ready");
  async function submit(behavior?: "steer" | "followUp", text = draft, refs = attachmentRefs(attachments.items)) {
    if ((!text.trim() && !refs.length) || sending || !ready) return;
    if (pendingAttachment) { setError("请等附件上传完成，或移除上传失败的附件"); return; }
    const message = text.trim() ? text : "请查看这些附件。";
    setSending(true); setError(""); lastSubmitted.current = message; lastAttachments.current = refs;
    const origin = draftSession.current; const originScope = attachments.scope;
    const ids = attachments.items.filter((item) => refs.some((ref) => ref.path === item.path && ref.kind === item.kind)).map((item) => item.id);
    try {
      await send(message, behavior, refs);
      attachments.submitted(originScope, ids);
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
  const retryAttachments = lastSubmitted.current ? lastAttachments.current : [...retryText.matchAll(/^附件：(\.pi-desk\/uploads\/[^\n]+)$/gm)].map((match) => ({ kind: "upload" as const, path: match[1] }));
  return <section className="composer-section">
    {attachments.error && <div className="error-banner" role="alert"><span>{attachments.error}</span><button onClick={attachments.clearError}>关闭提示</button></div>}
    {(error || state.error) && <div className="error-banner" role="alert"><span>{error || state.error}</span><div>
      {retryText && <button disabled={!ready || state.busy || sending} onClick={() => { clearError(); void submit(undefined, retryText, retryAttachments); }}>重试</button>}
      <button onClick={() => { setError(""); clearError(); }}>关闭提示</button>
    </div></div>}
    {state.notice && <p className="notice" role="status">{state.notice}</p>}
    {(state.steering.length > 0 || state.followUp.length > 0) && <div className="queue" aria-label="排队消息">
      {state.steering.map((message, index) => <div key={`steer-${index}`}><span>插话</span>{message}</div>)}
      {state.followUp.map((message, index) => <div key={`follow-${index}`}><span>做完再做</span>{message}</div>)}
    </div>}
    <TodoPanel /><GoalPanel /><WidgetPanels placement="aboveEditor" />
    <div className="composer-box">
      {commands.length > 0 && <div className="command-menu" role="listbox" aria-label="斜杠命令">{commands.map((command, index) => <button role="option" aria-selected={index === Math.min(selected, commands.length - 1)} key={command.name} onClick={() => pick(index)}>
        <strong>/{command.name}</strong><span>{command.description || command.source}</span>
      </button>)}</div>}
      <textarea ref={input} aria-label="消息" placeholder={state.busy ? "继续输入：Enter 插话，Alt+Enter 做完再做" : "给 pi 发消息…（输入 / 查看命令）"} value={draft} onKeyDown={onKey} onChange={(event) => {
        setDraft(event.target.value); setSelected(0); setHideCommands(false);
      }} onPaste={(event) => { const images = [...event.clipboardData.items].filter((item) => item.kind === "file" && item.type.startsWith("image/")).map((item) => item.getAsFile()).filter((file): file is File => !!file); if (images.length) { event.preventDefault(); attachments.addFiles(images); } }} />
      <AttachmentBar />
      <input type="file" multiple hidden ref={fileInput} aria-label="选择附件文件" onChange={(event) => { attachments.addFiles([...(event.target.files ?? [])]); event.target.value = ""; }} />
      <div className="composer-actions"><button className="quiet-button" aria-label="添加附件" disabled={!ready} onClick={() => fileInput.current?.click()}>＋ 附件</button><span className="input-hint">{state.busy ? "Enter 插话 · Alt+Enter 排队 · Esc 停止" : "Enter 发送 · Shift+Enter 换行"}</span><div>
        {(state.busy || state.compacting) && <button className="stop-button" disabled={!ready || stopping} onClick={() => void abort()}>{stopping ? "正在停止…" : "停止"}</button>}
        <button className="send-button" disabled={!ready || (!draft.trim() && !attachmentRefs(attachments.items).length) || sending || pendingAttachment} onClick={() => void submit()}>{sending ? "发送中…" : state.busy ? "插话 ↑" : "发送 ↑"}</button>
      </div></div>
    </div>
    <WidgetPanels placement="belowEditor" />
    <p className={`safety-hint ${modeFromStatus(ui.current.statuses["desk" + "-permissions"]) === "full" ? "danger-link" : ""}`}>{modeFromStatus(ui.current.statuses["desk" + "-permissions"]) === "full" ? "完全放开：工具不再审批。" : modeFromStatus(ui.current.statuses["desk" + "-permissions"]) ? "顶部可切换权限；审批不是系统沙箱。" : "权限插件尚未加载；工具没有审批保护。"} 附件移除不会删除已上传文件。</p>
  </section>;
}
