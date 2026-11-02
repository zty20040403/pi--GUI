import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ChevronsUpDown } from "lucide-react";
import { snapshotText, summarizeFile, type ChangedFile } from "../../../shared/changes";
import { diffRows, foldRows, type DiffLine } from "../../../shared/diff-view";
import { languageOf } from "../../api/files";
type Token = { content: string; htmlStyle?: Record<string, string | number> };
export function DiffView({ file, split = false, compact = false }: { file: ChangedFile; split?: boolean; compact?: boolean }) {
  const before = snapshotText(file.before); const after = snapshotText(file.after);
  const [expanded, setExpanded] = useState(new Set<string>()); const [limit, setLimit] = useState(800);
  const [tokens, setTokens] = useState<{ before: Token[][]; after: Token[][] }>();
  const rows = useMemo(() => before !== undefined && after !== undefined ? diffRows(before, after, split) : undefined, [before, after, split]);
  const visible = useMemo(() => rows ? foldRows(rows, expanded) : [], [rows, expanded]);
  useEffect(() => { setExpanded(new Set()); setLimit(800); }, [before, after, file.path]);
  useEffect(() => {
    let active = true; setTokens(undefined);
    if (before !== undefined && after !== undefined && before.length + after.length <= 200000) void import("../render/Highlight").then(async ({ highlightTokens }) => {
      const language = languageOf(file.path); const [left, right] = await Promise.all([highlightTokens(before, language), highlightTokens(after, language)]);
      if (active) setTokens({ before: left, after: right });
    }).catch(() => {});
    return () => { active = false; };
  }, [before, after, file.path]);
  if (before === undefined || after === undefined) return <p className="diff-notice">{summarizeFile(file).reason}。这次记录没有完整正文，不能生成 diff。</p>;
  if (before === after) return <p className="diff-notice">{file.before.kind === "missing" ? "已新建空文件。" : file.after.kind === "missing" ? "已删除空文件。" : "文件内容没有变化。"}</p>;
  if (!rows) return <p className="diff-notice">差异过于复杂，已保留快照，但暂不逐行显示，避免窗口卡顿。</p>;
  function code(line: DiffLine, side: "before" | "after") {
    const number = side === "before" ? line.old : line.next;
    const parts = number ? tokens?.[side][number - 1] : undefined;
    return <span className="diff-code">{parts ? parts.map((token, i) => <span key={i} className="diff-token" style={token.htmlStyle as CSSProperties}>{token.content}</span>) : line.text || " "}
      {line.ending === "none" && <span className="diff-ending"> ⤶ 无末尾换行</span>}{line.ending === "crlf" && line.kind !== "context" && <span className="diff-ending"> CRLF</span>}</span>;
  }
  function side(line: DiffLine | undefined, right: boolean) {
    return <div className={`diff-half ${line?.kind ?? "blank"}`}><span className="diff-number" aria-hidden>{right ? line?.next : line?.old}</span><span className="diff-sign" aria-hidden>{line?.kind === "added" ? "+" : line?.kind === "removed" ? "−" : " "}</span>{line && code(line, right ? "after" : "before")}</div>;
  }
  return <div className={`diff-view ${split ? "split" : "unified"} ${compact ? "compact" : ""}`} data-testid="diff-view" data-highlighted={!!tokens}>
    {split && <div className="diff-split-labels"><span>修改前</span><span>修改后</span></div>}
    {expanded.size > 0 && <button className="diff-fold" onClick={() => setExpanded(new Set())}>收起未改动内容</button>}
    <div className="diff-scroll" tabIndex={0} role="region" aria-label={`${file.path} ${split ? "并排" : "统一"}差异`}>
      <div className="diff-lines">{visible.slice(0, limit).map((item) => item.kind === "fold" ? <button key={item.id} className="diff-fold" onClick={() => setExpanded((value) => new Set([...value, item.id]))}><ChevronsUpDown size={13} aria-hidden />展开 {item.end - item.start} 行未改动内容</button>
        : split ? <div className="diff-row" key={item.index}>{side(item.row.left, false)}{side(item.row.right, true)}</div>
          : <div className={`diff-row ${item.row.left!.kind}`} data-old-line={item.row.left?.old} data-new-line={item.row.left?.next} key={item.index}><span className="diff-number" aria-hidden>{item.row.left?.old}</span><span className="diff-number" aria-hidden>{item.row.left?.next}</span><span className="diff-sign" aria-hidden>{item.row.left!.kind === "added" ? "+" : item.row.left!.kind === "removed" ? "−" : " "}</span>{code(item.row.left!, item.row.left!.kind === "removed" ? "before" : "after")}</div>)}</div>
    </div>
    {visible.length > limit && <button className="diff-fold" onClick={() => setLimit((value) => value + 800)}>继续显示 {Math.min(800, visible.length - limit)} 行（还有 {visible.length - limit} 行）</button>}
    {before.length + after.length > 200000 && <p className="diff-notice">内容较长，使用纯文本 diff；未省略改动，可继续展开。</p>}
  </div>;
}
