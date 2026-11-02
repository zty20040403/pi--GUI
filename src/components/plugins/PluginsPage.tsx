// 页面资源行的名称/说明/开关布局参考 pi-gui (MIT) apps/desktop/src/features/extensions/extensions-view.tsx。
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { ArrowLeft, ArrowUpRight, Check, Download, Package, Puzzle, RefreshCw, Search, ShieldCheck, Trash2, X } from "lucide-react";
import "./plugins.css";
import { pluginApi } from "../../api/plugins";
import { desktopBridge } from "../../api/desktop";
import { ErrorContent } from "../ui/ErrorContent";
import { errorInfo, type ErrorValue } from "../../../shared/errors";
import type { CatalogPlugin, InstalledPlugin, PluginAction, PluginConfirmation, PluginSnapshot, PluginUpdate } from "../../../shared/plugins";
const SOURCE = { npm: "npm 包", git: "Git 包", local: "本地扩展", builtin: "pi 内置" };
const when = (value?: string) => value ? new Date(value).toLocaleDateString("zh-CN") : "日期未提供";
function Github({ url }: { url?: string }) {
  const [error, setError] = useState(false);
  if (!url) return null;
  if (error) return <span role="alert">无法打开系统浏览器，请稍后重试</span>;
  return <a className="plugin-github" href={url} target="_blank" rel="noopener noreferrer" onClick={(event) => { const desktop = desktopBridge(); if (desktop) { event.preventDefault(); if (event.isTrusted) void desktop.openExternal(url).catch(() => setError(true)); } }}>GitHub<ArrowUpRight size={13} aria-hidden /></a>;
}
function Confirmation({ value, close, confirm, working }: { value: PluginConfirmation; close: () => void; confirm: (event: MouseEvent<HTMLButtonElement>) => void; working: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); return () => ref.current?.close(); }, []);
  return <dialog ref={ref} className="session-dialog plugin-confirm" aria-labelledby="plugin-confirm-title" onCancel={(event) => { if (working) event.preventDefault(); else close(); }}>
    <div className="plugin-confirm-icon"><ShieldCheck size={16} aria-hidden /></div><h2 id="plugin-confirm-title">{value.title}</h2><p>{value.detail}</p>
    <p className="muted">App 和终端共用这份配置。正在运行的对话不会立即替换插件；操作完成后可以选择重新加载。</p>
    <div className="dialog-actions"><button type="button" autoFocus disabled={working} onClick={close}>取消</button><button type="button" className="btn-primary" disabled={working} onClick={confirm}>{working ? "正在提交…" : "确认操作"}</button></div>
  </dialog>;
}
export function PluginsPage({ close }: { close: () => void }) {
  const closeRef = useRef(close); closeRef.current = close;
  useEffect(() => {
    document.getElementById("plugin-tab-installed")?.focus({ preventScroll: true });
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.isComposing && !document.querySelector("dialog[open]")) { event.preventDefault(); event.stopPropagation(); closeRef.current(); } };
    document.addEventListener("keydown", escape, true); return () => document.removeEventListener("keydown", escape, true);
  }, []);
  const [tab, setTab] = useState<"installed" | "discover" | "updates">("installed");
  const [snapshot, setSnapshot] = useState<PluginSnapshot>(); const [loading, setLoading] = useState(true); const [working, setWorking] = useState(false);
  const [error, setError] = useState<ErrorValue>(""); const [query, setQuery] = useState(""); const [installedQuery, setInstalledQuery] = useState("");
  const [catalog, setCatalog] = useState<CatalogPlugin[]>([]); const [updates, setUpdates] = useState<PluginUpdate[]>([]); const [unavailable, setUnavailable] = useState<string[]>([]);
  const [searching, setSearching] = useState(false); const [searched, setSearched] = useState(false); const [updateChecked, setUpdateChecked] = useState(false);
  const [confirm, setConfirm] = useState<PluginConfirmation>(); const live = useRef(true); const request = useRef(0); const focus = useRef<HTMLElement | null>(null);
  async function refresh(force = false) {
    setLoading(true); try { const value = await pluginApi.list(force); if (live.current) setSnapshot(value); } catch (error) { if (live.current) setError(errorInfo(error)); } finally { if (live.current) setLoading(false); }
  }
  useEffect(() => {
    live.current = true; void refresh(); let timer: ReturnType<typeof setTimeout>; let prior = "";
    const poll = async () => {
      try { const next = await pluginApi.status(); if (!live.current) return; setSnapshot((current) => current ? { ...current, ...next } : current);
        const key = `${next.job?.id}:${next.job?.status}`; if (key !== prior && next.job && next.job.status !== "running") { void refresh(); setUpdateChecked(false); } prior = key;
      } catch (error) { if (live.current) setError(errorInfo(error)); }
      if (live.current) timer = setTimeout(poll, 1000);
    };
    timer = setTimeout(poll, 1000); return () => { live.current = false; clearTimeout(timer); };
  }, []);
  const busy = working || snapshot?.job?.status === "running";
  const installed = snapshot?.items ?? []; const matching = installed.filter((item) => `${item.name} ${item.description} ${SOURCE[item.kind]}`.toLowerCase().includes(installedQuery.trim().toLowerCase()));
  async function search() {
    const generation = ++request.current; setSearching(true); setError("");
    try { const result = await pluginApi.search(query.trim()); if (live.current && generation === request.current) { setCatalog(result.items); setSearched(true); } } catch (error) { if (live.current) setError(errorInfo(error)); } finally { if (live.current && generation === request.current) setSearching(false); }
  }
  async function checkUpdates() {
    setSearching(true); setError(""); try { const result = await pluginApi.updates(); if (live.current) { setUpdates(result.items); setUnavailable(result.unavailable); setUpdateChecked(true); } } catch (error) { if (live.current) setError(errorInfo(error)); } finally { if (live.current) setSearching(false); }
  }
  async function prepare(action: PluginAction, event: MouseEvent<HTMLButtonElement>) {
    if (busy) return; focus.current = event.currentTarget; setWorking(true); setError("");
    try { const next = await pluginApi.prepare(action, event); if (live.current) setConfirm(next); } catch (error) { if (live.current) setError(errorInfo(error)); } finally { if (live.current) setWorking(false); }
  }
  function closeConfirm() { setConfirm(undefined); requestAnimationFrame(() => focus.current?.isConnected && focus.current.focus({ preventScroll: true })); }
  async function execute(event: MouseEvent<HTMLButtonElement>) {
    if (!confirm || working) return; setWorking(true); setError("");
    try { const job = await pluginApi.confirm(confirm.ticket, event); if (live.current) { setSnapshot((value) => value ? { ...value, job } : value); closeConfirm(); } } catch (error) { if (live.current) { setError(errorInfo(error)); closeConfirm(); } } finally { if (live.current) setWorking(false); }
  }
  async function reload(event: MouseEvent<HTMLButtonElement>, cancel = false) {
    setWorking(true); setError(""); try { if (cancel) await pluginApi.cancelReload(event); else { const job = await pluginApi.reload(event); if (live.current) setSnapshot((value) => value ? { ...value, job, reload: "waiting" } : value); } } catch (error) { if (live.current) setError(errorInfo(error)); } finally { if (live.current) setWorking(false); }
  }
  function installedRow(item: InstalledPlugin) {
    return <article key={item.id} className="plugin-row" data-testid={`plugin-${item.name}`}>
      <div className="plugin-avatar"><Puzzle size={16} aria-hidden /></div><div className="plugin-info"><div className="plugin-title"><h3>{item.name}</h3>{item.version && <code>{item.version}</code>}<span className="plugin-badge">{SOURCE[item.kind]}</span>{!item.enabled && <span className="plugin-badge">已停用</span>}{!item.installed && <span className="plugin-badge">未找到文件</span>}</div>
        <p>{item.description}</p><div className="plugin-meta">{item.reason && <span>{item.reason}</span>}<Github url={item.github} /></div>
      </div><div className="plugin-actions"><button className="plugin-switch" type="button" role="switch" aria-label={`启用 ${item.name}`} aria-checked={item.enabled} disabled={busy || !item.canToggle} onClick={(event) => void prepare({ kind: "toggle", id: item.id, enabled: !item.enabled }, event)}><span /></button>
        {item.canRemove && <button className="icon-button danger-link" type="button" aria-label={`卸载 ${item.name}`} title="卸载这个插件" disabled={busy} onClick={(event) => void prepare({ kind: "remove", id: item.id }, event)}><Trash2 size={14} /></button>}{!item.canRemove && <span className="plugin-action-spacer" aria-hidden />}
      </div>
    </article>;
  }
  function catalogCard(item: CatalogPlugin, update?: PluginUpdate) {
    const exists = installed.find((row) => row.kind === "npm" && row.name === item.name);
    return <article key={item.name} className="plugin-card" data-testid={`catalog-${item.name}`}><div className="plugin-card-heading"><div className="plugin-avatar"><Package size={16} aria-hidden /></div><div className="plugin-info"><h3>{item.name}</h3><span className="plugin-author">{item.author || "作者未提供"}</span></div><span className="plugin-badge">{item.license || "许可未提供"}</span></div>
      <p>{item.description}</p><div className="plugin-meta"><span><Download size={13} />{item.downloads === undefined ? "下载量未获取" : `${item.downloads.toLocaleString("zh-CN")} / 周`}</span><span>{when(item.published)}</span></div>
      <div className="plugin-card-footer"><div>{update ? <span className="plugin-version-change">{update.current} → {item.version}</span> : <code>{item.version}</code>}<Github url={item.github} /></div>
        <button type="button" className={exists && !update ? "quiet-button" : "btn-primary"} disabled={busy || !!exists && !update} onClick={(event) => void prepare(update ? { kind: "update", id: update.id, version: item.version } : { kind: "install", name: item.name, version: item.version }, event)}>{update ? "更新" : exists ? <><Check size={13} />{exists.enabled ? "已安装" : "已停用"}</> : <><Download size={13} />安装</>}</button>
      </div>
    </article>;
  }
  return <section className="plugins-page" aria-label="插件管理" data-testid="plugins-page">
    <header className="plugins-heading"><div><button className="quiet-button" type="button" onClick={close}><ArrowLeft size={14} />返回对话</button><h1><Puzzle size={16} />插件</h1><p>给 pi 添加工具和工作流。这里管理的设置也用于终端。</p></div><button className="icon-button" type="button" aria-label="关闭插件页面" onClick={close}><X size={16} /></button></header>
    <div className="plugins-tabs" role="tablist" aria-label="插件分类">{([["installed", "已安装"], ["discover", "发现"], ["updates", "更新"]] as const).map(([value, title], index) => <button type="button" role="tab" id={`plugin-tab-${value}`} aria-controls="plugin-tabpanel" aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} key={value} onClick={() => setTab(value)} onKeyDown={(event) => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); const next = event.key === "Home" ? 0 : event.key === "End" ? 2 : (index + (event.key === "ArrowRight" ? 1 : 2)) % 3; const value = (["installed", "discover", "updates"] as const)[next]; setTab(value); document.getElementById(`plugin-tab-${value}`)?.focus(); } }}>{title}{value === "installed" && <span>{installed.length}</span>}{value === "updates" && updateChecked && updates.length > 0 && <span>{updates.length}</span>}</button>)}</div>
    <div className="plugins-scroll">
      {error && <div className="plugin-error" role="alert"><ErrorContent error={error} /><button className="icon-button" aria-label="关闭插件错误" onClick={() => setError("")}><X size={14} /></button></div>}
      {snapshot?.warning && <p className="plugin-warning">{snapshot.warning}</p>}
      {(snapshot?.needsReload || snapshot?.reload !== undefined && snapshot.reload !== "idle") && <div className="plugin-reload" role="status"><div><strong>{snapshot.reload === "loading" ? "正在重新加载…" : snapshot.reload === "waiting" ? "等待所有项目空闲" : "重新加载后生效"}</strong><p>不会中断正在回复的对话；插件的问题需先回答。终端 pi 请自行执行 /reload。</p></div>{snapshot.reload === "waiting" ? <button type="button" disabled={working} onClick={(event) => void reload(event, true)}>取消等待</button> : <button type="button" disabled={busy} onClick={(event) => void reload(event)}><RefreshCw size={14} />立即重新加载</button>}</div>}
      {snapshot?.job && <details className="plugin-job" open={snapshot.job.status === "running" || snapshot.job.status === "failed"}><summary><span className={snapshot.job.status === "running" ? "spinner" : undefined} />{snapshot.job.title}<span>{snapshot.job.status === "running" ? "进行中" : snapshot.job.status === "failed" ? "未完成" : "已完成"}</span></summary>{snapshot.job.error && <ErrorContent error={snapshot.job.error} />}<pre aria-live="polite">{snapshot.job.output.join("\n") || "正在准备…"}</pre></details>}
      <div role="tabpanel" id="plugin-tabpanel" aria-labelledby={`plugin-tab-${tab}`}>
        {tab === "installed" && <><div className="plugins-toolbar"><label className="plugin-search"><Search size={14} aria-hidden /><input aria-label="搜索已安装插件" placeholder="搜索已安装插件" value={installedQuery} onChange={(event) => setInstalledQuery(event.target.value)} /></label><button type="button" className="quiet-button" disabled={loading || busy} onClick={() => void refresh(true)}><RefreshCw size={14} className={loading ? "spin" : undefined} />刷新</button></div>
          <p className="plugin-section-note">全局插件 · 本地 / 内置扩展只能启停，不删除文件。项目 .pi 中的覆盖配置仍以 pi 为准。</p>
          {loading && !snapshot ? <p className="plugin-empty" role="status">正在读取 pi 插件…</p> : matching.length ? <div className="plugin-list">{matching.map(installedRow)}</div> : <p className="plugin-empty">没有匹配的插件</p>}
        </>}
        {tab === "discover" && <><form className="plugins-toolbar" onSubmit={(event) => { event.preventDefault(); void search(); }}><label className="plugin-search"><Search size={14} aria-hidden /><input aria-label="搜索 npm 插件" placeholder="搜索 npm 上的 pi 插件" value={query} maxLength={100} onChange={(event) => setQuery(event.target.value)} /></label><button type="submit" disabled={searching}>{searching ? "搜索中…" : "搜索"}</button></form><p className="plugin-section-note">来自 npm 的 pi-package · 按每周下载量排序 · 安装前请确认来源和许可</p>
          {!searched ? <div className="plugin-empty"><Package size={16} /><h2>发现新的能力</h2><p>输入插件名或关键词搜索。不会自动下载或安装任何插件。</p></div> : <div className="plugin-catalog">{catalog.map((item) => catalogCard(item))}{!catalog.length && <p className="plugin-empty">没有找到匹配的插件，换个关键词试试。</p>}</div>}
        </>}
        {tab === "updates" && <><div className="plugins-toolbar"><p>只在你确认后更新，始终固定版本。</p><button type="button" disabled={searching || busy} onClick={() => void checkUpdates()}><RefreshCw size={14} className={searching ? "spin" : undefined} />{searching ? "检查中…" : "检查更新"}</button></div>{unavailable.length > 0 && <p className="plugin-warning">这些插件暂未查到版本：{unavailable.join("、")}</p>}
          {updateChecked && updates.length ? <div className="plugin-catalog">{updates.map((item) => catalogCard(item.next, item))}</div> : <div className="plugin-empty"><Check size={16} /><h2>{updateChecked ? "没有可用更新" : "检查插件新版本"}</h2><p>本地和内置扩展由原安装方式更新，不在这里更改。</p></div>}
        </>}
      </div>
    </div>
    {confirm && <Confirmation value={confirm} close={closeConfirm} confirm={(event) => void execute(event)} working={working} />}
  </section>;
}
