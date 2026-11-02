import { lineChanges } from "./changes.js";
export type DiffLine = { text: string; old?: number; next?: number; kind: "context" | "removed" | "added"; ending: "lf" | "crlf" | "none" };
export type DiffRow = { left?: DiffLine; right?: DiffLine; context: boolean };
export function diffRows(before: string, after: string, split: boolean): DiffRow[] | undefined {
  if (before.split("\n").length + after.split("\n").length > 40000) return;
  const changes = lineChanges(before, after); if (!changes) return;
  const lines: DiffLine[] = []; let old = 1; let next = 1;
  for (const change of changes) {
    const pieces = change.value.match(/[^\n]*\n|[^\n]+$/g) ?? [];
    for (const piece of pieces) {
      const ending = piece.endsWith("\r\n") ? "crlf" : piece.endsWith("\n") ? "lf" : "none";
      const text = ending === "crlf" ? piece.slice(0, -2) : ending === "lf" ? piece.slice(0, -1) : piece;
      lines.push({ text, ending, kind: change.added ? "added" : change.removed ? "removed" : "context", ...(change.added ? {} : { old: old++ }), ...(change.removed ? {} : { next: next++ }) });
    }
  }
  if (!split) return lines.map((line) => ({ left: line, context: line.kind === "context" }));
  const rows: DiffRow[] = []; let index = 0;
  while (index < lines.length) {
    if (lines[index].kind === "context") { rows.push({ left: lines[index], right: lines[index], context: true }); index++; continue; }
    const removed: DiffLine[] = []; const added: DiffLine[] = [];
    while (index < lines.length && lines[index].kind !== "context") { const line = lines[index++]; (line.kind === "removed" ? removed : added).push(line); }
    for (let i = 0; i < Math.max(removed.length, added.length); i++) rows.push({ left: removed[i], right: added[i], context: false });
  }
  return rows;
}
export type FoldedRow = { kind: "line"; row: DiffRow; index: number } | { kind: "fold"; id: string; start: number; end: number };
export function foldRows(rows: DiffRow[], expanded: Set<string>): FoldedRow[] {
  const result: FoldedRow[] = []; let index = 0;
  while (index < rows.length) {
    if (!rows[index].context) { result.push({ kind: "line", row: rows[index], index }); index++; continue; }
    const start = index; while (index < rows.length && rows[index].context) index++;
    const end = index; const length = end - start;
    const from = start + (start === 0 ? 0 : 3); const to = end - (end === rows.length ? 0 : 3);
    const id = `${rows[start].left?.old}:${rows[start].left?.next}:${length}`;
    for (let i = start; i < end;) {
      if (length > 8 && i === from && !expanded.has(id)) { result.push({ kind: "fold", id, start: from, end: to }); i = to; }
      else { result.push({ kind: "line", row: rows[i], index: i }); i++; }
    }
  }
  return result;
}
