import type { Tool, WireRecord } from "../../api/types";
import { useChat } from "../../api/ChatProvider";
import { useFiles } from "../../api/FileProvider";
import { Markdown } from "./Markdown";
import { MessageImage } from "./MessageImage";

export function truncateOutput(text: string, limit = 12000): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, 7000)}\n\n… 中间 ${text.length - 10000} 个字符已省略（仅显示头尾）…\n\n${text.slice(-3000)}`;
}
const pretty = (value: unknown) => JSON.stringify(value, null, 2) ?? "";
function resultText(result?: WireRecord): string {
  if (!result) return "等待工具输出…";
  if (Array.isArray(result.content)) return result.content.map((part: WireRecord) => part.type === "text" ? part.text : part.type === "image" ? "[图片结果]" : pretty(part)).join("\n");
  return typeof result.output === "string" ? result.output : pretty(result);
}
function summary(tool: Tool) {
  const args = tool.args;
  if (tool.name === "bash") return args.command ?? "执行命令";
  if (["read", "edit", "write"].includes(tool.name)) return args.path ?? "文件操作";
  if (tool.name === "web_search") return args.query ?? args.queries?.join("；") ?? "搜索";
  if (tool.name === "fetch_content") return args.url ?? args.urls?.join("；") ?? "获取网页";
  return pretty(args);
}
export function ToolCard({ tool }: { tool: Tool }) {
  const { state } = useChat(); const { openFile } = useFiles();
  const path = ["read", "edit", "write"].includes(tool.name) && typeof tool.args.path === "string" ? tool.args.path : undefined;
  const labels = { pending: "待执行", running: "执行中", done: "完成", error: "失败" };
  const plan = tool.name === "plan_mode_complete" ? tool.args.plan ?? tool.result?.details?.plan : undefined;
  return <>{typeof plan === "string" && <section className="plan-card" data-testid="plan-card"><h3>实施计划</h3><Markdown text={plan} /></section>}<details className={`tool-card ${tool.status === "error" ? "tool-error" : ""}`} data-tool={tool.name}>
    <summary><span className={`tool-dot ${tool.status}`} /><strong>{tool.name}</strong>{path ? <button className="tool-summary tool-path" title="点击在右侧预览文件" aria-label={`预览工具文件 ${path}`} onClick={(event) => { event.preventDefault(); event.stopPropagation(); void openFile(state.cwd, path); }}>{path}</button> : <span className="tool-summary">{String(summary(tool)).slice(0, 240)}</span>}<span className="tool-state">{labels[tool.status]}</span></summary>
    <div className="tool-detail">
      <div className="detail-label">{tool.name === "bash" ? "命令" : "参数"}</div>
      <pre>{truncateOutput(tool.name === "bash" ? String(tool.args.command ?? "") : pretty(tool.args))}</pre>
      {tool.name === "edit" && Array.isArray(tool.args.edits) && <div className="patch-preview"><div className="detail-label">替换片段</div>{tool.args.edits.map((edit: WireRecord, index: number) => <div key={index}>
        <pre className="removed">{String(edit.oldText ?? "").split("\n").map((line) => `− ${line}`).join("\n")}</pre>
        <pre className="added">{String(edit.newText ?? "").split("\n").map((line) => `+ ${line}`).join("\n")}</pre>
      </div>)}</div>}
      {tool.name === "write" && typeof tool.args.content === "string" && <pre className="added">{truncateOutput(tool.args.content)}</pre>}
      {tool.name === "ask_user_question" && Array.isArray(tool.args.questions) && <div className="question-preview">{tool.args.questions.map((question: WireRecord, index: number) => <section key={index}><strong>{question.question}</strong><ul>{question.options?.map((option: WireRecord, index: number) => <li key={index}>{option.label}{option.description ? ` · ${option.description}` : ""}</li>)}</ul></section>)}<small>请在插件弹窗里选择或输入回答。</small></div>}
      <div className="detail-label">输出{tool.durationMs !== undefined ? ` · ${tool.durationMs} ms` : ""}</div>
      <pre data-testid="tool-output">{truncateOutput(resultText(tool.result))}</pre>
      {Array.isArray(tool.result?.content) && tool.result.content.filter((part: WireRecord) => part.type === "image").map((part: WireRecord, index: number) => <MessageImage key={index} data={part.data} mime={part.mimeType} />)}
    </div>
  </details></>;
}
