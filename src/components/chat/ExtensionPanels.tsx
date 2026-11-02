import { Check, ChevronRight, Circle, ListChecks, PanelTop, Target } from "lucide-react";
import { useChat } from "../../api/ChatProvider";
import { useExtensionUi } from "../../api/ExtensionUiProvider";
import { useGoals } from "../../api/GoalProvider";
import { Markdown } from "./Markdown";
import { ErrorContent } from "../ui/ErrorContent";
export function TodoPanel() {
  const { state } = useChat(); const tasks = state.todo?.tasks.filter((task) => task.status !== "deleted") ?? [];
  if (!tasks.length) return null;
  const done = tasks.filter((task) => task.status === "completed").length; const active = tasks.find((task) => task.status === "in_progress");
  return <details className="extension-panel todo-panel" data-testid="todo-panel"><summary><ChevronRight size={12} className="chevron" aria-hidden /><ListChecks size={14} aria-hidden /><strong>任务清单</strong><span>{done} / {tasks.length} 完成{active ? ` · ${active.activeForm || active.subject}` : ""}</span></summary>
    <ul>{tasks.map((task) => <li key={task.id} data-status={task.status}>{task.status === "in_progress" ? <span className="spinner" /> : <span className={`task-check ${task.status === "completed" ? "done" : ""}`}>{task.status === "completed" ? <Check size={13} aria-label="已完成" /> : <Circle size={11} aria-label="未开始" />}</span>}<div><strong>{task.subject}</strong>{task.description && <small>{task.description}</small>}{task.blockedBy?.length ? <small>等待 {task.blockedBy.map((id) => `#${id}`).join("、")}</small> : null}</div><small>#{task.id}</small></li>)}</ul>
  </details>;
}
export function WidgetPanels({ placement }: { placement: "aboveEditor" | "belowEditor" }) {
  const { current } = useExtensionUi();
  return <>{Object.entries(current.widgets).filter(([, widget]) => widget.placement === placement && widget.lines.length).map(([key, widget]) => <details key={key} className="extension-panel widget-panel" open><summary><ChevronRight size={12} className="chevron" aria-hidden /><PanelTop size={13} aria-hidden /><strong>{key}</strong></summary><pre>{widget.lines.join("\n")}</pre></details>)}</>;
}
const statusLabel: Record<string, string> = { active: "运行中", paused: "已暂停", blocked: "受阻", complete: "已完成", pending: "待处理", in_progress: "进行中", completed: "已完成", skipped: "跳过" };
export function GoalPanel() {
  const { goals, error } = useGoals(); const { state } = useChat();
  if (!goals.length && !error) return null;
  return <details className="extension-panel goal-panel" data-testid="goal-panel"><summary><ChevronRight size={12} className="chevron" aria-hidden /><Target size={14} aria-hidden /><strong>项目目标</strong><span>{goals.length ? `${goals.length} 个记录 · 从项目目标文件读取` : "无法读取目标记录"}</span></summary>
    {error && <div className="error-text"><ErrorContent error={error} /></div>}{goals.map((goal) => <section key={goal.id}><div className="goal-progress-meta"><strong>{statusLabel[goal.status] || goal.status}{state.focusedGoalId === goal.id ? " · 当前焦点" : ""}</strong><span>{Math.floor(goal.seconds / 60)} 分钟 · {goal.tokens.toLocaleString()} tokens</span></div><Markdown text={goal.objective} />
      {goal.tasks.length > 0 && <ul>{goal.tasks.map((task) => <li key={task.id}><span className={`task-check ${["complete", "completed"].includes(task.status) ? "done" : ""}`}>{["complete", "completed"].includes(task.status) ? <Check size={13} /> : <Circle size={11} />}</span><div><strong>{task.title}</strong><small>{statusLabel[task.status] || task.status}</small></div></li>)}</ul>}</section>)}
  </details>;
}
