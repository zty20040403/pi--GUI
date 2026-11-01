import type { Tool, WireRecord } from "../../api/types";

export function truncateOutput(text: string, limit = 12000): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, 7000)}\n\n… 中间 ${text.length - 10000} 个字符已省略（仅显示头尾）…\n\n${text.slice(-3000)}`;
}
const pretty = (value: unknown) => JSON.stringify(value, null, 2) ?? "";
function resultText(result?: WireRecord): string {
  if (!result) return "等待工具输出…";
  if (Array.isArray(result.content)) return result.content.map((part: WireRecord) => part.type === "text" ? part.text : part.type === "image" ? "[图片结果：附件预览在后续阶段提供]" : pretty(part)).join("\n");
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
  const labels = { pending: "待执行", running: "执行中", done: "完成", error: "失败" };
  return <details className={`tool-card ${tool.status === "error" ? "tool-error" : ""}`} data-tool={tool.name}>
    <summary><span className={`tool-dot ${tool.status}`} /><strong>{tool.name}</strong><span className="tool-summary">{String(summary(tool)).slice(0, 240)}</span><span className="tool-state">{labels[tool.status]}</span></summary>
    <div className="tool-detail">
      <div className="detail-label">{tool.name === "bash" ? "命令" : "参数"}</div>
      <pre>{truncateOutput(tool.name === "bash" ? String(tool.args.command ?? "") : pretty(tool.args))}</pre>
      {tool.name === "edit" && Array.isArray(tool.args.edits) && <div className="patch-preview"><div className="detail-label">替换片段</div>{tool.args.edits.map((edit: WireRecord, index: number) => <div key={index}>
        <pre className="removed">{String(edit.oldText ?? "").split("\n").map((line) => `− ${line}`).join("\n")}</pre>
        <pre className="added">{String(edit.newText ?? "").split("\n").map((line) => `+ ${line}`).join("\n")}</pre>
      </div>)}</div>}
      {tool.name === "write" && typeof tool.args.content === "string" && <pre className="added">{truncateOutput(tool.args.content)}</pre>}
      <div className="detail-label">输出{tool.durationMs !== undefined ? ` · ${tool.durationMs} ms` : ""}</div>
      <pre data-testid="tool-output">{truncateOutput(resultText(tool.result))}</pre>
    </div>
  </details>;
}
