import { useState, type ReactNode } from "react";
import { Brain, ChevronDown, Cpu, ShieldAlert, ShieldCheck, ShieldOff } from "lucide-react";
import { modeFromStatus, PERMISSION_LABELS, type PermissionMode } from "../../../shared/extensions";
import { useChat } from "../../api/ChatProvider";
import { useExtensionUi } from "../../api/ExtensionUiProvider";

const groupLabel = (provider: string) => provider.toLowerCase() === "cliproxy" ? "CLIProxy" : provider.toLowerCase() === "ninfer" ? "NInfer" : provider;
const LEVEL_LABELS: Record<string, string> = { off: "关", minimal: "最少", low: "低", medium: "中", high: "高", xhigh: "很高", max: "最高" };

// 外观是胶囊，交互仍是原生 select（透明铺满），键盘、读屏和自动化测试都照常可用。
function Pill({ icon, label, title, tone, children }: { icon: ReactNode; label: string; title: string; tone?: "danger" | "muted"; children: ReactNode }) {
  return <label className="pill" title={title} data-tone={tone}>{icon}<span className="pill-label">{label}</span><ChevronDown size={12} className="pill-chevron" aria-hidden />{children}</label>;
}

import { errorInfo, type ErrorValue } from "../../../shared/errors";
export function ModelBar({ onError }: { onError: (message: ErrorValue) => void }) {
  const { state, switching, changeModel, changeThinking, send } = useChat();
  const ui = useExtensionUi();
  const [changing, setChanging] = useState(false);
  const permission = modeFromStatus(ui.current.statuses["desk" + "-permissions"]);
  const disabled = changing || switching || state.busy || state.compacting || state.connection !== "ready";
  async function configure(action: () => Promise<void>) {
    setChanging(true); onError("");
    try { await action(); } catch (error) { onError(errorInfo(error)); } finally { setChanging(false); }
  }
  const model = state.session.model;
  const current = model ? state.models.find((item) => item.provider === model.provider && item.id === model.id) : undefined;
  const providers = [...new Set(state.models.map((item) => item.provider))];
  const level = state.session.thinkingLevel;
  const PermissionIcon = permission === "full" ? ShieldOff : permission === "read-only" ? ShieldCheck : ShieldAlert;
  return <>
    <Pill icon={<Cpu size={13} aria-hidden />} label={model ? model.id : "选择模型"} tone={model ? undefined : "muted"}
      title={current?.cost ? `${current.name || current.id} · 输入 $${current.cost.input}/M · 输出 $${current.cost.output}/M` : "选择模型"}>
      <select aria-label="模型" disabled={disabled || !state.models.length} value={model ? JSON.stringify([model.provider, model.id]) : ""} onChange={(event) => {
        const [provider, id] = JSON.parse(event.target.value); void configure(() => changeModel(provider, id));
      }}>
        {!model && <option value="">选择模型</option>}
        {providers.map((provider) => <optgroup key={provider} label={groupLabel(provider)}>{state.models.filter((item) => item.provider === provider).map((item) => <option key={item.id} value={JSON.stringify([provider, item.id])}>
          {item.id}{item.cost ? `   入 $${item.cost.input} · 出 $${item.cost.output} /M` : ""}
        </option>)}</optgroup>)}
      </select>
    </Pill>
    <Pill icon={<Brain size={13} aria-hidden />} label={level ? `推理 ${LEVEL_LABELS[level] ?? level}` : "推理"} title="推理强度：越高想得越久、越贵" tone={level ? undefined : "muted"}>
      <select aria-label="推理强度" value={level ?? ""} disabled={disabled || !state.levels.length} onChange={(event) => void configure(() => changeThinking(event.target.value))}>
        {!state.levels.length && <option value="">加载中…</option>}
        {state.levels.map((value) => <option key={value} value={value}>{LEVEL_LABELS[value] ? `${LEVEL_LABELS[value]}（${value}）` : value}</option>)}
      </select>
    </Pill>
    <Pill icon={<PermissionIcon size={13} aria-hidden />} label={permission ? PERMISSION_LABELS[permission] : "权限"} tone={permission === "full" ? "danger" : permission ? undefined : "muted"}
      title={permission === "full" ? "完全放开：工具不再审批" : permission ? "工具权限；审批不是系统沙箱" : "权限插件尚未加载，工具没有审批保护"}>
      <select aria-label="权限模式" className="permission-select" data-mode={permission} value={permission ?? ""} disabled={changing || switching || state.connection !== "ready" || !permission}
        onChange={(event) => void configure(() => send(`/permissions ${event.target.value}`))}>
        {!permission && <option value="">{state.connection === "ready" ? "插件未加载" : "加载中…"}</option>}
        {(Object.keys(PERMISSION_LABELS) as PermissionMode[]).map((mode) => <option key={mode} value={mode}>{PERMISSION_LABELS[mode]}{mode === "full" ? "（不审批）" : mode === "auto" ? "（危险操作先问我）" : "（只看不改）"}</option>)}
      </select>
    </Pill>
  </>;
}
