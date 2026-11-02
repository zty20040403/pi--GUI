// 模型搜索与分组结构改编自 pi-gui (MIT) apps/desktop/src/features/conversation/model-selector.tsx。
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Cpu, ShieldAlert, ShieldCheck, ShieldOff } from "lucide-react";
import { modeFromStatus, PERMISSION_LABELS, type PermissionMode } from "../../../shared/extensions";
import { errorInfo, type ErrorValue } from "../../../shared/errors";
import { useChat } from "../../api/ChatProvider";
import { useExtensionUi } from "../../api/ExtensionUiProvider";
import { Popover } from "../ui/Popover";
import { Menu, type MenuOption } from "../ui/Menu";
import { ThinkingSlider, LEVEL_LABELS } from "./ThinkingSlider";
const groupLabel = (provider: string) => provider.toLowerCase() === "cliproxy" ? "CLIProxy" : provider.toLowerCase() === "ninfer" ? "NInfer" : provider;
const modelKey = (provider: string, id: string) => JSON.stringify([provider, id]);
const permissionDescriptions: Record<PermissionMode, string> = { "read-only": "只看不改，不能执行会改东西的命令", auto: "项目里随便改，危险操作先问我", full: "不再审批，请只在可信项目里使用" };
function FullAccessConfirmation({ confirm, close }: { confirm: () => void; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  return <dialog ref={dialog} className="session-dialog permission-confirm" aria-labelledby="full-access-title" onCancel={close}>
    <h2 id="full-access-title"><ShieldOff size={16} />允许完全放开权限？</h2><p>之后工具可以修改文件、运行命令，不再逐次询问你。只有在信任当前项目和插件时才启用。</p><p className="muted">这不会解除文件预览的范围限制。你可以随时切回“自动”或“只读”。</p>
    <div className="dialog-actions"><button type="button" autoFocus onClick={close}>取消</button><button type="button" className="danger-button" onClick={confirm}>确认完全放开</button></div>
  </dialog>;
}
export function ModelBar({ onError }: { onError: (message: ErrorValue) => void }) {
  const { state, switching, unavailable, pluginsReloading, changeModel, changeThinking, send } = useChat(); const ui = useExtensionUi();
  const [panel, setPanel] = useState<"model" | "permission">(); const [changing, setChanging] = useState(false); const changingRef = useRef(false);
  const [confirmFull, setConfirmFull] = useState<string>(); const bar = useRef<HTMLDivElement>(null); const scope = `${state.cwd}:${state.session.sessionId}`;
  const permission = modeFromStatus(ui.current.statuses["desk" + "-permissions"]);
  const locked = pluginsReloading || switching || state.busy || state.compacting || state.connection !== "ready" || state.externalChanged || !!unavailable;
  const permissionLocked = pluginsReloading || switching || state.connection !== "ready" || !permission || state.externalChanged || !!unavailable;
  useEffect(() => { setPanel(undefined); setConfirmFull(undefined); }, [scope, unavailable]);
  function returnPermissionFocus() { requestAnimationFrame(() => bar.current?.querySelector<HTMLButtonElement>('[data-testid="permission-trigger"]')?.focus({ preventScroll: true })); }
  async function configure(action: () => Promise<void>) {
    if (changingRef.current) return;
    changingRef.current = true; setChanging(true); onError(""); const focused = document.activeElement as HTMLElement | null;
    try { await action(); } catch (error) { onError(errorInfo(error)); } finally {
      changingRef.current = false; setChanging(false);
      requestAnimationFrame(() => { if (focused?.isConnected && (document.activeElement === document.body || document.activeElement === focused)) focused.focus({ preventScroll: true }); });
    }
  }
  const model = state.session.model; const level = state.session.thinkingLevel;
  const current = model ? state.models.find((item) => item.provider === model.provider && item.id === model.id) : undefined;
  const options: MenuOption[] = state.models.map((item) => ({ id: modelKey(item.provider, item.id), label: item.id, keywords: item.name, group: groupLabel(item.provider), meta: item.cost ? `入 $${item.cost.input} · 出 $${item.cost.output}` : undefined, testId: `model-option-${item.provider}-${item.id}`, data: { "data-provider": item.provider, "data-model": item.id } }));
  if (model && !current) options.unshift({ id: modelKey(model.provider, model.id), label: model.id, group: groupLabel(model.provider), disabled: true, reason: "不在当前可用列表中，请重新选择" });
  const PermissionIcon = permission === "full" ? ShieldOff : permission === "read-only" ? ShieldCheck : ShieldAlert;
  async function selectModel(value: string) {
    if (locked || changingRef.current) return;
    const [provider, id] = JSON.parse(value); if (model?.provider !== provider || model?.id !== id) await configure(() => changeModel(provider, id));
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[data-testid="model-trigger-panel"] .thinking-slider:not(:disabled)')?.focus({ preventScroll: true }));
  }
  function selectPermission(value: string) {
    if (permissionLocked || changingRef.current) return;
    setPanel(undefined);
    if (value === "full" && permission !== "full") { setConfirmFull(scope); return; }
    returnPermissionFocus(); if (value !== permission) void configure(() => send(`/permissions ${value}`));
  }
  return <div ref={bar} className="model-bar">
    <Popover open={panel === "model"} onOpenChange={(open) => setPanel(open ? "model" : undefined)} label="模型与推理" testId="model-trigger" disabled={locked} tone={model ? undefined : "muted"}
      attributes={{ "data-provider": model?.provider, "data-model": model?.id, "data-thinking": level, "data-pending": String(changing) }}
      title={current?.cost ? `${current.name || current.id} · 输入 $${current.cost.input}/M · 输出 $${current.cost.output}/M` : "选择模型和推理强度"}
      trigger={<><Cpu size={14} aria-hidden /><span className="pill-label">{model?.id ?? "选择模型"}{level ? ` · ${LEVEL_LABELS[level] ?? level}` : ""}</span><ChevronDown size={13} className="pill-chevron" aria-hidden /></>}>
      <Menu label="模型列表" searchLabel="搜索模型" options={options} selected={model ? modelKey(model.provider, model.id) : undefined} disabled={changing} onSelect={(value) => void selectModel(value)} />
      <ThinkingSlider key={model ? modelKey(model.provider, model.id) : "empty"} levels={state.levels} level={level} reasoning={model?.reasoning} disabled={locked || changing} onChange={(value) => configure(() => changeThinking(value))} />
      <div className="menu-footer-note">价格 / 百万 token · 可用性以实际请求为准</div>
    </Popover>
    <Popover open={panel === "permission"} onOpenChange={(open) => setPanel(open ? "permission" : undefined)} label="权限模式" testId="permission-trigger" disabled={permissionLocked} tone={permission === "full" ? "danger" : permission ? undefined : "muted"}
      attributes={{ "data-mode": permission, "data-pending": String(changing) }} title={permission ? "工具权限；审批不是系统沙箱" : "权限插件尚未加载，工具没有审批保护"}
      trigger={<><PermissionIcon size={14} aria-hidden /><span className="pill-label">{permission ? PERMISSION_LABELS[permission] : "权限未加载"}</span><ChevronDown size={13} className="pill-chevron" aria-hidden /></>}>
      <Menu label="权限选项" selected={permission} disabled={changing} onSelect={selectPermission} options={(Object.keys(PERMISSION_LABELS) as PermissionMode[]).map((mode) => ({ id: mode, label: PERMISSION_LABELS[mode], description: permissionDescriptions[mode], danger: mode === "full", meta: mode === "auto" ? "推荐" : undefined, testId: `permission-option-${mode}` }))} />
      <div className="menu-footer-note">审批不是操作系统沙箱</div>
    </Popover>
    {confirmFull === scope && <FullAccessConfirmation close={() => { setConfirmFull(undefined); returnPermissionFocus(); }} confirm={() => { setConfirmFull(undefined); returnPermissionFocus(); if (!permissionLocked && confirmFull === scope) void configure(() => send("/permissions full")); }} />}
  </div>;
}
