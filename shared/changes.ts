import { diffLines, type Change } from "diff";

export const CHANGES_STATUS = "__desk_changes";
export const CHANGE_FILE_LIMIT = 1024 * 1024;
export type FileSnapshot =
  | { kind: "missing" }
  | { kind: "text"; text: string; fingerprint: string }
  | { kind: "omitted"; reason: "large" | "binary" | "unreadable" | "budget"; fingerprint?: string };
export type ChangedFile = { path: string; before: FileSnapshot; after: FileSnapshot; overlap?: boolean; gap?: boolean };
export type FileChangeSummary = { path: string; kind: "added" | "deleted" | "modified"; added?: number; removed?: number; reason?: string; overlap?: boolean; gap?: boolean };
export type CapturedCall = ChangedFile & { id: string; parentId?: string; tool: "edit" | "write"; order: number; finished?: number; error?: boolean };
export type ChangeTurn = {
  version: 1; id: string; sessionId: string; cwd: string; startedAt: number; endedAt?: number;
  status: "running" | "completed" | "aborted" | "interrupted"; anchorId?: string; assistantTimestamp?: number;
  calls: CapturedCall[]; warnings: string[];
};
export type TurnSummary = Omit<ChangeTurn, "calls" | "cwd"> & { files: FileChangeSummary[]; tools: { id: string; path: string; parentId?: string }[] };
export type ChangeScope = "turn" | "session" | "git";
export type ChangeIndex = { turns: TurnSummary[]; git: boolean; truncated?: boolean };
export type ChangeReview = { files: ChangedFile[]; warnings: string[]; label: string };
export function snapshotText(value: FileSnapshot): string | undefined { return value.kind === "text" ? value.text : value.kind === "missing" ? "" : undefined; }
export function sameSnapshot(a: FileSnapshot, b: FileSnapshot): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "missing") return true;
  return "fingerprint" in b && !!a.fingerprint && a.fingerprint === b.fingerprint;
}
export function lineChanges(before: string, after: string): Change[] | undefined {
  // diff 的最坏情况也有上限；超限不能伪造为 +0/-0。
  return diffLines(before, after, { timeout: 60, maxEditLength: 12000 });
}
const REASONS = { large: "超过 1 MB，未保存内容", binary: "二进制或非 UTF-8 文件", unreadable: "快照不可读或文件同时变化", budget: "本轮内容达到保存上限" };
export function summarizeFile(file: ChangedFile): FileChangeSummary {
  const before = snapshotText(file.before); const after = snapshotText(file.after);
  const changes = before !== undefined && after !== undefined ? lineChanges(before, after) : undefined;
  const omitted = file.before.kind === "omitted" ? file.before : file.after.kind === "omitted" ? file.after : undefined;
  return { path: file.path, kind: file.before.kind === "missing" ? "added" : file.after.kind === "missing" ? "deleted" : "modified",
    ...(changes ? { added: changes.reduce((n, c) => n + (c.added ? c.count ?? 0 : 0), 0), removed: changes.reduce((n, c) => n + (c.removed ? c.count ?? 0 : 0), 0) } : { reason: omitted ? REASONS[omitted.reason] : "差异过大，未计算行数" }),
    ...(file.overlap ? { overlap: true } : {}), ...(file.gap ? { gap: true } : {}) };
}
export function mergeFiles(files: ChangedFile[]): ChangedFile[] {
  const grouped = new Map<string, ChangedFile>();
  for (const file of files) {
    const previous = grouped.get(file.path);
    grouped.set(file.path, previous ? { path: file.path, before: previous.before, after: file.after, overlap: previous.overlap || file.overlap, gap: previous.gap || file.gap || !sameSnapshot(previous.after, file.before) } : { ...file });
  }
  return [...grouped.values()].filter((file) => !sameSnapshot(file.before, file.after)).sort((a, b) => a.path.localeCompare(b.path));
}
export function turnFiles(turn: ChangeTurn): ChangedFile[] {
  const groups = new Map<string, CapturedCall[]>();
  for (const call of turn.calls) if (call.finished !== undefined) { const rows = groups.get(call.path) ?? []; rows.push(call); groups.set(call.path, rows); }
  const files = [...groups].map(([path, calls]) => {
    const first = calls.reduce((a, b) => a.order < b.order ? a : b); const last = calls.reduce((a, b) => a.finished! > b.finished! ? a : b);
    const ordered = [...calls].sort((a, b) => a.order - b.order);
    return { path, before: first.before, after: last.after, overlap: calls.some((call) => call.overlap), gap: ordered.some((call, index) => index > 0 && !sameSnapshot(ordered[index - 1].after, call.before)) };
  });
  return files.filter((file) => !sameSnapshot(file.before, file.after)).sort((a, b) => a.path.localeCompare(b.path));
}
export function summarizeTurn(turn: ChangeTurn): TurnSummary {
  const { calls, cwd: _cwd, ...metadata } = turn;
  return { ...metadata, files: turnFiles(turn).map(summarizeFile), tools: calls.filter((call) => call.finished !== undefined).map(({ id, path, parentId }) => ({ id, path, ...(parentId ? { parentId } : {}) })) };
}
