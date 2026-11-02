// 改编自 pi-gui (MIT) apps/desktop/src/features/conversation/turn-changes-card.tsx，见 docs/licenses/pi-gui-MIT.txt。
import { useRef, useState } from "react";
import { ArrowUpRight, ChevronDown, FileDiff } from "lucide-react";
import type { FileChangeSummary, TurnSummary } from "../../../shared/changes";
import { useChanges } from "../../api/ChangesProvider";
import { fileIcon } from "../right/fileIcon";
export function LineStats({ added, removed, reason }: Pick<FileChangeSummary, "added" | "removed" | "reason">) {
  return <span className="change-stats">{added !== undefined && removed !== undefined ? <><span className="change-added">+{added}</span><span className="change-removed">−{removed}</span></> : <span className="change-omitted" title={reason}>未计行数</span>}</span>;
}
export function FilePath({ path }: { path: string }) {
  const slash = path.lastIndexOf("/"); return <span className="change-path">{slash >= 0 && <span className="change-directory">{path.slice(0, slash + 1)}</span>}{path.slice(slash + 1)}</span>;
}
export function TurnChangesCard({ turn }: { turn: TurnSummary }) {
  const { openTurn } = useChanges(); const [expanded, setExpanded] = useState(false); const list = useRef<HTMLUListElement>(null);
  const files = expanded ? turn.files : turn.files.slice(0, 5); const total = turn.files.reduce((sum, file) => ({ added: sum.added + (file.added ?? 0), removed: sum.removed + (file.removed ?? 0) }), { added: 0, removed: 0 });
  return <section className="turn-changes" data-testid="turn-changes" data-turn-id={turn.id} aria-label="本轮改动">
    <header><FileDiff size={16} aria-hidden /><strong>{turn.files.length ? `改动了 ${turn.files.length} 个文件` : "本轮改动未完整记录"}</strong>{turn.files.length > 0 && <LineStats {...total} />}<button className="quiet-button" onClick={() => openTurn(turn.id, turn.files[0]?.path)}>查看全部改动<ArrowUpRight size={13} aria-hidden /></button></header>
    <ul ref={list}>{files.map((file) => { const Icon = fileIcon(file.path); return <li key={file.path}><button title={file.path} onClick={() => openTurn(turn.id, file.path)} data-change-path={file.path}><Icon size={14} aria-hidden /><FilePath path={file.path} /><LineStats {...file} /></button></li>; })}</ul>
    {!expanded && turn.files.length > 5 && <button className="quiet-button change-more" onClick={() => { setExpanded(true); requestAnimationFrame(() => list.current?.querySelectorAll("button")[5]?.focus()); }}><ChevronDown size={13} />再显示 {turn.files.length - 5} 个文件</button>}
    {(turn.status !== "completed" || turn.warnings.length > 0 || turn.files.some((file) => file.added === undefined || file.overlap || file.gap)) && <p className="change-card-note">{turn.status === "aborted" ? "回复已停止，以下是已捕获的改动。" : turn.status === "interrupted" ? "记录曾中断，以下是已捕获的改动。" : "仅包含已捕获的 edit / write；部分变化未计行数或无法独占归因。"}</p>}
  </section>;
}
