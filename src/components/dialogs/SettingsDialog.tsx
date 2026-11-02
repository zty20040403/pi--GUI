import { useEffect, useRef, useState } from "react";
import { BellOff, RotateCw, Settings, X } from "lucide-react";
import { useExtensionUi } from "../../api/ExtensionUiProvider";
import { ErrorContent } from "../ui/ErrorContent";
import { errorInfo, type ErrorValue } from "../../../shared/errors";
export function SettingsDialog({ close }: { close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null); const ui = useExtensionUi(); const [loading, setLoading] = useState(true); const [pending, setPending] = useState<string>(); const [error, setError] = useState<ErrorValue>("");
  useEffect(() => {
    dialog.current?.showModal(); let active = true;
    void ui.loadPreferences().catch((error) => { if (active) setError(errorInfo(error)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; dialog.current?.close(); };
  }, []);
  async function restore(id: string) { setPending(id); setError(""); try { await ui.restore(id); } catch (error) { setError(errorInfo(error)); } finally { setPending(undefined); } }
  return <dialog ref={dialog} className="session-dialog settings-dialog" aria-labelledby="app-settings-title" onCancel={(event) => { if (pending) event.preventDefault(); else close(); }}>
    <header><h2 id="app-settings-title"><Settings size={16} aria-hidden />设置</h2><button className="icon-button" aria-label="关闭设置" disabled={!!pending} onClick={close}><X size={16} /></button></header>
    <h3><BellOff size={14} aria-hidden />已隐藏的提醒</h3>
    <p className="muted">这里只隐藏插件通知，不影响审批弹窗、工具执行或聊天错误。恢复后，下一次同类通知会正常显示。</p>
    {error && <div role="alert" className="error-text"><ErrorContent error={error} /></div>}
    {loading ? <p className="settings-empty" role="status">正在读取设置…</p> : !ui.hidden.length ? <p className="settings-empty">没有隐藏任何提醒</p> : <ul className="hidden-notices">{ui.hidden.map((notice) => <li key={notice.id} data-testid="hidden-notice"><div><strong>{notice.plugin}{notice.builtin && <span>默认隐藏</span>}</strong><p>{notice.pattern}</p></div><button className="quiet-button" disabled={!!pending} aria-label={`恢复 ${notice.plugin} 的提醒`} onClick={() => void restore(notice.id)}><RotateCw size={13} />{pending === notice.id ? "恢复中…" : "恢复"}</button></li>)}</ul>}
    <footer>仅保存到 pi desk 的设置，不改 pi 的插件配置。</footer>
  </dialog>;
}
