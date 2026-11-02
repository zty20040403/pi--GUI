import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Columns2, FileDiff, History, List, RotateCw } from "lucide-react";
import { summarizeFile, type ChangeReview, type ChangeScope } from "../../../shared/changes";
import { errorInfo, type ErrorValue } from "../../../shared/errors";
import { useChanges } from "../../api/ChangesProvider";
import { useChat } from "../../api/ChatProvider";
import { useFiles } from "../../api/FileProvider";
import { changeReview } from "../../api/changes";
import { DiffView } from "./DiffView";
import { FilePath, LineStats } from "./TurnChangesCard";
import { fileIcon } from "../right/fileIcon";
import { ErrorContent } from "../ui/ErrorContent";
import { Menu } from "../ui/Menu";
import { Popover } from "../ui/Popover";
export default function ChangesPanel() {
  const { index, error: indexError, loading: indexLoading, revision, selection, select, refresh } = useChanges(); const { state } = useChat(); const files = useFiles();
  const [data, setData] = useState<{ key: string; value: ChangeReview }>(); const [error, setError] = useState<ErrorValue>(""); const [loading, setLoading] = useState(false); const [menu, setMenu] = useState(false);
  const turnId = selection.turnId ?? index.turns.at(-1)?.id;
  const key = `${state.cwd}:${state.session.sessionId}:${selection.scope}:${turnId ?? ""}`;
  const review = data?.key === key ? data.value : undefined;
  useEffect(() => {
    const controller = new AbortController(); setData(undefined); setError("");
    if (!state.session.sessionId || state.connection !== "ready" || selection.scope === "turn" && !turnId) { setLoading(false); return; }
    setLoading(true);
    void changeReview(state.cwd, state.session.sessionId, selection.scope, turnId, undefined, controller.signal).then((value) => { if (!controller.signal.aborted) setData({ key, value }); }, (error) => { if (!controller.signal.aborted) setError(errorInfo(error)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [key, revision, state.connection]);
  const summaries = useMemo(() => review?.files.map(summarizeFile) ?? [], [review]);
  const selected = selection.path ? review?.files.find((file) => file.path === selection.path) : review?.files[0];
  const summary = summaries.find((file) => file.path === selected?.path);
  function scope(value: ChangeScope) { select({ scope: value, path: undefined }); }
  const scopes: { id: ChangeScope; name: string }[] = [{ id: "turn", name: "本轮" }, { id: "session", name: "这个对话全部" }, ...(index.git ? [{ id: "git" as const, name: "未提交（git）" }] : [])];
  return <section className="review-panel" aria-label="改动审阅" data-testid="review-panel">
    <div className="review-toolbar"><div className="review-scopes" role="group" aria-label="改动范围">{scopes.map((value) => <button aria-pressed={selection.scope === value.id} key={value.id} onClick={() => scope(value.id)} data-testid={`change-scope-${value.id}`}>{value.name}</button>)}</div><button className="icon-button" aria-label="刷新改动" title="刷新改动" onClick={refresh} disabled={loading || indexLoading}><RotateCw size={14} /></button></div>
    <div className="review-controls">
      {selection.scope === "turn" ? <Popover label="选择改动轮次" testId="change-turn-menu" open={menu} onOpenChange={setMenu} disabled={!index.turns.length} trigger={<><History size={13} />{turnId ? index.turns.some((turn) => turn.id === turnId) ? `第 ${index.turns.findIndex((turn) => turn.id === turnId) + 1} 轮` : "未找到轮次" : "暂无轮次"}<ChevronDown size={12} /></>}>
        <Menu label="改动轮次" selected={turnId} options={index.turns.map((turn, i) => ({ id: turn.id, label: `第 ${i + 1} 轮 · ${new Date(turn.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`, description: turn.status === "completed" ? `${turn.files.length} 个文件` : `${turn.files.length} 个文件 · ${turn.status === "running" ? "进行中" : "未完整结束"}` })).reverse()} onSelect={(turnId) => { select({ turnId, path: undefined }); setMenu(false); }} />
      </Popover> : <span className="review-count">{summaries.length} 个文件</span>}
      <div className="review-view-toggle" role="group" aria-label="差异视图"><button aria-label="统一视图" title="统一视图" aria-pressed={!selection.split} onClick={() => select({ split: false })}><List size={14} /><span>统一</span></button><button aria-label="并排视图" title="并排视图" aria-pressed={selection.split} onClick={() => { select({ split: true }); files.setWidth(Math.max(files.width, 720)); }}><Columns2 size={14} /><span>并排</span></button></div>
    </div>
    <p className="review-coverage">{selection.scope === "git" ? "HEAD → 当前文件；包括未跟踪文件。只读，不暂存。" : "只包含 App 捕获的 edit / write；不包含普通 bash 或终端改动。"}</p>
    {(indexError || error) && <div className="review-error" role="alert"><ErrorContent error={indexError || error} /><button className="quiet-button" onClick={refresh}>重试</button></div>}
    {!!review?.warnings.length && <details className="review-warning-summary"><summary>有 {review.warnings.length} 条记录范围说明</summary><div className="review-warnings">{review.warnings.map((warning) => <p className="review-warning" key={warning}>{warning}</p>)}</div></details>}
    {loading || indexLoading ? <div className="review-empty" role="status"><span className="spinner" />正在读取改动…</div> : !review?.files.length ? <div className="review-empty"><FileDiff size={24} /><strong>{error || indexError ? "暂时无法显示改动" : "这个范围没有已记录的改动"}</strong><p>{selection.scope === "git" ? "文件保存后可点右上角刷新。" : "新回复使用 edit / write 后会出现在这里。旧对话没有快照时，不会拿当前文件冒充历史。"}</p></div> : <div className="review-workspace">
      <nav className="review-file-list" aria-label="改动文件列表">{summaries.map((file) => { const Icon = fileIcon(file.path); return <button key={file.path} aria-current={selected?.path === file.path ? "true" : undefined} title={file.path} data-review-path={file.path} onClick={() => select({ path: file.path })}><Icon size={14} /><FilePath path={file.path} /><LineStats {...file} /></button>; })}</nav>
      <div className="review-document">{selected && summary ? <><header className="review-file-heading"><FilePath path={selected.path} /><div><span className="change-kind">{{ added: "新建", deleted: "删除", modified: "修改" }[summary.kind]}</span><LineStats {...summary} /></div></header>{selected.overlap && <p className="review-warning">有并行操作，不能把所有变化归因于一个工具。</p>}<DiffView file={selected} split={selection.split} /></> : <p className="diff-notice">选中的文件已不在这个范围内，请在左边选择文件。</p>}</div>
    </div>}
  </section>;
}
