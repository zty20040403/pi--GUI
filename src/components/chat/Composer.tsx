import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, Plus, ShieldOff, Square } from "lucide-react";
import { modeFromStatus } from "../../../shared/extensions";
import { useChat } from "../../api/ChatProvider";
import { useAttachments } from "../../api/AttachmentProvider";
import { attachmentRefs, type AttachmentRef } from "../../api/attachments";
import { blocksOf } from "../../api/state";
import { AttachmentBar } from "./AttachmentBar";
import { useExtensionUi } from "../../api/ExtensionUiProvider";
import { GoalPanel, TodoPanel, WidgetPanels } from "./ExtensionPanels";
import { ModelBar } from "./ModelBar";
import { ErrorContent } from "../ui/ErrorContent";
import { errorInfo, type ErrorValue } from "../../../shared/errors";

export const PREFILL_EVENT = "pi-desk:prefill";
export function shortNumber(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return String(value);
}

export function Composer() {
  const { state, send, stop, clearError, pluginsReloading } = useChat();
  const attachments = useAttachments(); const ui = useExtensionUi(); const seenEditor = useRef("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<ErrorValue>("");
  const [configError, setConfigError] = useState<ErrorValue>("");
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
  // 欢迎页的示例问题通过事件把文字放进输入框。
  useEffect(() => {
    const prefill = (event: Event) => { const text = (event as CustomEvent<string>).detail; if (typeof text === "string") { setDraft(text); setHideCommands(true); input.current?.focus(); } };
    window.addEventListener(PREFILL_EVENT, prefill); return () => window.removeEventListener(PREFILL_EVENT, prefill);
  }, []);
  // 输入框随内容长高，最高 260px 后滚动。
  useLayoutEffect(() => {
    const element = input.current; if (!element) return;
    element.style.height = "auto"; element.style.height = `${Math.min(element.scrollHeight, 260)}px`;
  }, [draft]);
  const available = [...state.commands, ...(state.commands.some((command) => command.name === "compact") ? [] : [{ name: "compact", description: "手动压缩当前上下文", source: "client" }])];
  const commands = !hideCommands && /^\/[^\s]*$/.test(draft) ? available.filter((command) => command.name.toLowerCase().includes(draft.slice(1).toLowerCase())).slice(0, 12) : [];
  const ready = state.connection === "ready";
  const pendingAttachment = attachments.items.some((item) => item.status !== "ready");
  async function submit(behavior?: "steer" | "followUp", text = draft, refs = attachmentRefs(attachments.items)) {
    if ((!text.trim() && !refs.length) || sending || !ready || state.externalChanged) return;
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
    } catch (error) { setError(errorInfo(error)); }
    finally { setSending(false); input.current?.focus(); }
  }
  async function abort() {
    if (stopping || !ready) return;
    setStopping(true); setError("");
    try {
      const queued = await stop();
      if (queued.length) setDraft((text) => [text, ...queued].filter(Boolean).join("\n\n"));
    } catch (error) { setError(errorInfo(error)); }
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
  const permission = modeFromStatus(ui.current.statuses["desk" + "-permissions"]);
  const usage = state.stats.contextUsage;
  const canSend = ready && !pluginsReloading && !state.externalChanged && (!!draft.trim() || attachmentRefs(attachments.items).length > 0) && !sending && !pendingAttachment;
  const statuses = Object.entries(ui.current.statuses).filter(([key]) => key !== "desk" + "-permissions");
  return <section className="composer-section">
    {configError && <div className="composer-error" role="alert"><ErrorContent error={configError} /><button onClick={() => setConfigError("")}>关闭</button></div>}
    {attachments.error && <div className="error-banner" role="alert"><ErrorContent error={attachments.error} /><button onClick={attachments.clearError}>关闭提示</button></div>}
    {(error || state.error) && <div className="error-banner" role="alert"><ErrorContent error={error || state.error} /><div>
      {retryText && <button disabled={!ready || state.busy || sending || state.externalChanged} onClick={() => { clearError(); void submit(undefined, retryText, retryAttachments); }}>重试</button>}
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
      <AttachmentBar />
      <textarea ref={input} rows={1} aria-label="消息" placeholder={state.busy ? "补充要求：Enter 插话，Option+Enter 做完再做" : "给 pi 发消息，输入 / 查看命令"} value={draft} onKeyDown={onKey} onChange={(event) => {
        setDraft(event.target.value); setSelected(0); setHideCommands(false);
      }} onPaste={(event) => { const images = [...event.clipboardData.items].filter((item) => item.kind === "file" && item.type.startsWith("image/")).map((item) => item.getAsFile()).filter((file): file is File => !!file); if (images.length) { event.preventDefault(); attachments.addFiles(images); } }} />
      <input type="file" multiple hidden ref={fileInput} aria-label="选择附件文件" onChange={(event) => { attachments.addFiles([...(event.target.files ?? [])]); event.target.value = ""; }} />
      <div className="composer-toolbar">
        <div className="toolbar-left">
          <button className="icon-button" aria-label="添加附件" title="添加附件（也可以直接拖文件进窗口或粘贴截图）" disabled={!ready} onClick={() => fileInput.current?.click()}><Plus size={16} /></button>
          <ModelBar onError={setConfigError} />
        </div>
        <div className="toolbar-right">
          <span className="input-hint">{state.busy ? "Esc 停止" : "Shift+Enter 换行"}</span>
          {(state.busy || state.compacting) && <button className="stop-button round-button" aria-label={stopping ? "正在停止…" : "停止"} title="停止（Esc）" disabled={!ready || stopping} onClick={() => void abort()}><Square size={11} /></button>}
          <button className="send-button round-button" aria-label={sending ? "发送中…" : state.busy ? "插话" : "发送"} title={state.busy ? "插话（Enter）" : "发送（Enter）"} disabled={!canSend} onClick={() => void submit()}><ArrowUp size={16} strokeWidth={2.4} /></button>
        </div>
      </div>
    </div>
    <WidgetPanels placement="belowEditor" />
    {permission === "full" && <p className="safety-hint"><ShieldOff size={12} aria-hidden />完全放开：工具不再审批，请只在可信项目里使用</p>}
    <footer className="statusbar">
      <span data-testid="session-cost" title="按公开价估算，不是实际账单">${(state.stats.cost ?? 0).toFixed(state.stats.cost && state.stats.cost >= 1 ? 2 : 4)}</span>
      <span data-testid="context-usage" title="每次要发给模型的上下文大小">{usage ? `ctx ${usage.tokens === null ? "待更新" : shortNumber(usage.tokens)} / ${shortNumber(usage.contextWindow)} (${usage.percent === null ? "—" : `${usage.percent.toFixed(1)}%`})` : "ctx —"}</span>
      {statuses.length > 0 && <span className="plugin-statuses" title={statuses.map(([, value]) => value).join(" · ")}>{statuses.map(([key, value]) => <span key={key}>{value}</span>)}</span>}
    </footer>
  </section>;
}
