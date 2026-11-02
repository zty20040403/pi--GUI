import { useEffect, useId, useRef, useState } from "react";
import { useChat } from "../../api/ChatProvider";
import { useExtensionUi, type PendingDialog } from "../../api/ExtensionUiProvider";
import { plainUi } from "../../api/extension-ui-state";
function Dialog({ request, remaining }: { request: PendingDialog; remaining: number }) {
  const { answer } = useExtensionUi(); const { state } = useChat(); const element = useRef<HTMLDialogElement>(null); const titleId = useId();
  const [value, setValue] = useState(request.prefill ?? ""); const [pending, setPending] = useState(false); const [error, setError] = useState("");
  const danger = request.title?.startsWith("⚠️") ?? false; const connected = !["connecting", "reconnecting"].includes(state.connection);
  useEffect(() => {
    element.current?.showModal();
    // React autoFocus 发生在 showModal 之前；原生 dialog 会重置焦点，需要在之后明确选安全项。
    const safe = danger ? "拒绝" : request.method === "confirm" ? "否" : undefined;
    if (safe) [...(element.current?.querySelectorAll("button") ?? [])].find((button) => button.textContent === safe)?.focus();
    return () => element.current?.close();
  }, []);
  async function reply(payload: Record<string, unknown>) {
    if (pending || !connected) return; setPending(true); setError("");
    try { await answer(request, payload); } catch (error) { setError((error as Error).message); setPending(false); }
  }
  return <dialog ref={element} className={`session-dialog extension-dialog ${danger ? "danger-dialog" : ""}`} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); void reply({ cancelled: true }); }}>
    <div className="dialog-project" title={request.cwd}>项目：{request.cwd.split("/").filter(Boolean).at(-1) || request.cwd}{remaining > 0 && <span> · 后面还有 {remaining} 个提问</span>}</div>
    <h2 id={titleId}>{plainUi(request.title ?? "插件需要你的回答")}</h2>
    {request.message && <p className="extension-message">{plainUi(request.message)}</p>}
    {request.method === "select" ? <div className="extension-options">{(request.options ?? []).map((option, index) => <button key={`${index}:${option}`} type="button" autoFocus={danger ? option === "拒绝" : index === 0} disabled={pending || !connected} onClick={() => void reply({ value: option })}>{plainUi(option)}</button>)}</div>
      : request.method === "confirm" ? <div className="extension-options"><button disabled={pending || !connected} onClick={() => void reply({ confirmed: true })}>是</button><button autoFocus disabled={pending || !connected} onClick={() => void reply({ confirmed: false })}>否</button></div>
      : <form onSubmit={(event) => { event.preventDefault(); void reply({ value }); }}><label>{request.method === "editor" ? "编辑内容" : "你的回答"}{request.method === "editor" ? <textarea autoFocus aria-label="插件编辑内容" value={value} disabled={pending || !connected} onChange={(event) => setValue(event.target.value)} /> : <input autoFocus aria-label="插件输入" value={value} placeholder={request.placeholder ?? ""} disabled={pending || !connected} onChange={(event) => setValue(event.target.value)} />}</label><div className="dialog-actions"><button className="send-button" disabled={pending || !connected}>{pending ? "提交中…" : "提交"}</button></div></form>}
    {!connected && <p className="notice" role="status">连接断开，恢复后可以继续回答；不会自动允许操作。</p>}
    {error && <p className="error-text" role="alert">{error}</p>}
    <div className="dialog-actions"><button disabled={pending || !connected} onClick={() => void reply({ cancelled: true })}>取消</button></div>
  </dialog>;
}
export function ExtensionDialogs() { const { pending } = useExtensionUi(); return pending[0] ? <Dialog key={`${pending[0].cwd}:${pending[0].id}`} request={pending[0]} remaining={pending.length - 1} /> : null; }
export function ExtensionToasts() {
  const { toasts, dismiss } = useExtensionUi();
  return <div className="extension-toasts" aria-live="polite">{toasts.map((toast) => <div key={toast.id} className={`extension-toast toast-${toast.level}`} role={toast.level === "error" ? "alert" : "status"}><strong>{toast.level === "error" ? "插件错误" : toast.level === "warning" ? "插件提醒" : "插件通知"}</strong><button aria-label="关闭插件通知" onClick={() => dismiss(toast.id)}>×</button><p>{toast.message}</p><small>{toast.cwd.split("/").filter(Boolean).at(-1)}</small></div>)}</div>;
}
