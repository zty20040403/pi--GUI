import { useEffect, useState } from "react";
import { useChat } from "./api/ChatProvider";
import { blocksOf } from "./api/state";
import { Composer } from "./components/chat/Composer";
import { Messages } from "./components/chat/Messages";

export function shortNumber(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return String(value);
}
const groupLabel = (provider: string) => provider.toLowerCase() === "cliproxy" ? "CLIProxy" : provider.toLowerCase() === "ninfer" ? "NInfer" : provider;

export default function App() {
  const { state, changeModel, changeThinking, open, reconnect } = useChat();
  const [changing, setChanging] = useState(false);
  const [path, setPath] = useState("");
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { setPath(state.cwd); }, [state.cwd]);
  const project = state.cwd.split("/").filter(Boolean).at(-1) || "项目";
  const firstUser = state.messages.find((message) => message.role === "user");
  const title = state.session.sessionName || (firstUser ? blocksOf(firstUser).filter((block) => block.type === "text").map((block) => block.text).join(" ").slice(0, 50) : "新对话");
  useEffect(() => { document.title = `${title} · pi desk`; }, [title]);
  const disabled = changing || state.busy || state.compacting || state.connection !== "ready";
  async function configure(action: () => Promise<void>) {
    setChanging(true); setError("");
    try { await action(); } catch (error) { setError((error as Error).message); } finally { setChanging(false); }
  }
  const grouped = [...new Set(state.models.map((model) => model.provider))];
  const connection = { connecting: "连接中…", opening: "打开对话…", ready: "已连接", reconnecting: "连接断开，正在自动重连…", offline: "pi 已退出" }[state.connection];
  const elapsed = state.waitingSince ? Math.max(0, Math.floor((now - state.waitingSince) / 1000)) : 0;
  const usage = state.stats.contextUsage;
  return <div className="app-shell">
    <header className="topbar"><div className="brand"><span>π</span><strong>pi desk</strong><small>聊天版</small></div>
      <div className="conversation-title"><span title={state.cwd}>{project}</span><strong title={title}>{title}</strong></div>
      <div className="model-controls"><label>模型<select aria-label="模型" disabled={disabled || !state.models.length} value={state.session.model ? JSON.stringify([state.session.model.provider, state.session.model.id]) : ""} onChange={(event) => {
        const [provider, id] = JSON.parse(event.target.value); void configure(() => changeModel(provider, id));
      }}>{!state.session.model && <option value="">选择模型</option>}{grouped.map((provider) => <optgroup key={provider} label={groupLabel(provider)}>{state.models.filter((model) => model.provider === provider).map((model) => <option key={model.id} value={JSON.stringify([provider, model.id])}>
        {model.name || model.id}{model.cost ? ` · 入 $${model.cost.input}/M · 出 $${model.cost.output}/M` : ""}
      </option>)}</optgroup>)}</select></label>
        <label>推理<select aria-label="推理强度" value={state.session.thinkingLevel ?? ""} disabled={disabled || !state.levels.length} onChange={(event) => void configure(() => changeThinking(event.target.value))}>
          {!state.levels.length && <option value="">加载中…</option>}{state.levels.map((level) => <option key={level} value={level}>{level}</option>)}
        </select></label>
      </div>
    </header>
    <div className="workspace-bar"><span className={state.connection === "ready" ? "connection-ok" : "muted"} data-testid="connection-status">● {connection}</span>
      {state.connection !== "ready" && <button className="quiet-button" onClick={reconnect}>重新连接</button>}
      <details className="workspace-picker"><summary>项目路径</summary><form onSubmit={(event) => { event.preventDefault(); void configure(() => open({ cwd: path.trim() })); }}>
        <label>项目文件夹<input aria-label="项目文件夹" value={path} onChange={(event) => setPath(event.target.value)} placeholder="输入绝对路径" /></label><button disabled={changing || state.busy || state.compacting || !path.trim()}>在此项目开始新对话</button>
      </form></details>
      <button className="quiet-button" disabled={disabled || !state.cwd} onClick={() => void configure(() => open({ cwd: state.cwd }))}>新对话</button>
    </div>
    {error && <div className="configuration-error" role="alert">{error}<button onClick={() => setError("")}>关闭</button></div>}
    {state.retry ? <div className="network-banner" role="status">网络不稳，第 {state.retry.attempt} 次重试…（最多 {state.retry.maxAttempts} 次）</div>
      : state.busy && state.waitingSince && elapsed >= 5 ? <div className="network-banner" role="status">等待模型回应 {elapsed} 秒…</div> : null}
    <Messages />
    <Composer />
    <footer className="statusbar"><span data-testid="session-cost">花费 ${(state.stats.cost ?? 0).toFixed(6)}</span>
      <span data-testid="context-usage">{usage ? `ctx ${usage.tokens === null ? "待更新" : shortNumber(usage.tokens)} / ${shortNumber(usage.contextWindow)} (${usage.percent === null ? "—" : `${usage.percent.toFixed(1)}%`})` : "ctx 尚无用量"}</span>
      <span className="plugin-statuses" title={Object.values(state.statuses).join(" · ")}>{Object.entries(state.statuses).map(([key, value]) => <span key={key}>{value}</span>)}</span>
    </footer>
  </div>;
}
