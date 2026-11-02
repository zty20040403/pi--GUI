import { useEffect, useState } from "react";
import { Check, Cpu, LoaderCircle } from "lucide-react";
import { http, TOKEN_KEY } from "../../api/storage";
import { useChat } from "../../api/ChatProvider";
import type { EngineMode, EngineStatus } from "../../../shared/engine";
import { errorInfo, type ErrorValue } from "../../../shared/errors";
import { ErrorContent } from "../ui/ErrorContent";
const choices: { mode: EngineMode; title: string; description: string }[] = [
  { mode: "auto", title: "自动", description: "优先使用系统 pi；没有时使用内置引擎。" },
  { mode: "system", title: "系统 pi", description: "与终端使用同一套安装，跟随系统 pi 更新。" },
  { mode: "builtin", title: "内置 pi", description: "使用 App 附带的固定版本，无需安装 Node。" },
];
export function EngineSettings({ pending, setPending }: { pending: boolean; setPending: (value: boolean) => void }) {
  const chat = useChat(); const [status, setStatus] = useState<EngineStatus>(); const [choice, setChoice] = useState<EngineMode>("auto"); const [error, setError] = useState<ErrorValue>("");
  useEffect(() => { let active = true; void http<EngineStatus>("/api/engine", sessionStorage.getItem(TOKEN_KEY) ?? "").then((value) => { if (active) { setStatus(value); setChoice(value.mode); } }).catch((error) => { if (active) setError(errorInfo(error)); }); return () => { active = false; }; }, []);
  async function apply(event: { isTrusted: boolean }) {
    if (!event.isTrusted) return; setPending(true); setError("");
    try { const value = await http<EngineStatus>("/api/engine", sessionStorage.getItem(TOKEN_KEY) ?? "", { mode: choice }, { "X-Pi-Desk-Action": "user-confirmed" }); setStatus(value); setChoice(value.mode); }
    catch (error) { setError(errorInfo(error)); try { setStatus(await http<EngineStatus>("/api/engine", sessionStorage.getItem(TOKEN_KEY) ?? "")); } catch {} }
    finally { setPending(false); }
  }
  const busy = chat.pluginsReloading || chat.state.busy || Object.values(chat.running).some(Boolean);
  return <section className="engine-settings" aria-labelledby="engine-settings-heading">
    <h3 id="engine-settings-heading"><Cpu size={14} aria-hidden />pi 引擎</h3>
    <div className="engine-current" role="status" data-testid="engine-current">{pending ? "正在切换并恢复对话…" : !status ? "正在检测引擎…" : status.active ? `当前使用：${status.active.kind === "system" ? "系统" : "内置"} pi（${status.active.version}）` : "所选引擎不可用，请选择可用引擎。"}</div>
    <div className="engine-options" role="radiogroup" aria-label="pi 引擎选择">{choices.map(({ mode, title, description }) => {
      const available = mode === "auto" ? status?.system.available || status?.builtin.available : status?.[mode].available;
      return <button key={mode} type="button" role="radio" aria-checked={choice === mode} data-testid={`engine-${mode}`} disabled={pending || !available} tabIndex={choice === mode ? 0 : -1} onClick={() => setChoice(mode)} onKeyDown={(event) => {
          if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
          event.preventDefault(); const buttons = [...event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
          const next = buttons[(buttons.indexOf(event.currentTarget) + (["ArrowDown", "ArrowRight"].includes(event.key) ? 1 : -1) + buttons.length) % buttons.length]; next?.focus(); next?.click();
        }} className={choice === mode ? "selected" : ""}>
        <span className="engine-option-check">{choice === mode && <Check size={14} aria-hidden />}</span><span><strong>{title}{mode !== "auto" && status?.[mode].version && <small>{status[mode].version}</small>}</strong><span>{mode !== "auto" && !available ? status?.[mode].reason ?? "正在检测…" : description}</span></span>
      </button>;
    })}</div>
    <p className="muted">两种引擎共用 pi 的模型、插件和对话配置。切换会重启空闲项目，保留历史和草稿，不会自动发送。插件安装仍需要系统 npm。</p>
    {error && <div role="alert" className="error-text"><ErrorContent error={error} /></div>}
    <div className="engine-actions">{busy && <span className="muted">请先等待所有项目回复或重新加载结束。</span>}<button className="quiet-button" disabled={!status || choice === status.mode || pending || busy} onClick={(event) => void apply(event)}>{pending && <LoaderCircle size={13} className="spin" />}应用引擎</button></div>
  </section>;
}
