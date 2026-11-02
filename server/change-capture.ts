import { randomUUID } from "node:crypto";
import { captureFile, checkedChangePath } from "./change-files.js";
import { ChangeStore, TURN_CONTENT_LIMIT } from "./change-store.js";
import type { CapturedCall, ChangeTurn } from "../shared/changes.js";

// 仅观察工具前后，不修改工具参数、结果或项目文件；并发/外部改动不会被冒充成独占归因。
export class ChangeCapture {
  private turn?: ChangeTurn;
  private order = 0;
  private writes: Promise<void> = Promise.resolve();
  constructor(private readonly store: ChangeStore, private readonly notify: (sessionId: string) => void) {}
  get current() { return this.turn; }
  start(sessionId: string, cwd: string, anchorId?: string) {
    if (this.turn) return;
    this.order = 0;
    this.turn = { version: 1, id: randomUUID(), sessionId, cwd, startedAt: Date.now(), status: "running", anchorId, calls: [], warnings: [] };
  }
  private warning(text: string) { if (this.turn && !this.turn.warnings.includes(text)) this.turn.warnings.push(text); }
  private persist() {
    const turn = this.turn; if (!turn || !turn.calls.length && !turn.warnings.length) return Promise.resolve();
    const copy = structuredClone(turn);
    const work = this.writes.then(async () => { await this.store.save(copy); this.notify(copy.sessionId); });
    this.writes = work.catch(() => {}); return work;
  }
  private limit(call: CapturedCall) {
    if (!this.turn) return;
    const size = this.turn.calls.reduce((n, row) => n + Buffer.byteLength(JSON.stringify(row.before)) + Buffer.byteLength(JSON.stringify(row.after)), 0);
    if (size <= TURN_CONTENT_LIMIT) return;
    for (const side of ["before", "after"] as const) if (call[side].kind === "text") call[side] = { kind: "omitted", reason: "budget", fingerprint: call[side].fingerprint };
    this.warning("本轮快照内容达到 12 MB，后续操作只保留变化标记。");
  }
  async before(id: string, tool: "edit" | "write", requested: unknown, anchorId?: string, parentId?: string) {
    const turn = this.turn; if (!turn || turn.calls.some((call) => call.id === id)) return;
    if (turn.calls.length >= 256) { this.warning("本轮工具操作超过 256 次，后续操作未记录。"); await this.persist(); return; }
    let path: string;
    try { path = (await checkedChangePath(turn.cwd, requested)).relative; }
    catch { this.warning("部分项目外、敏感路径或符号链接未记录；不会保存这些文件的内容。"); await this.persist(); return; }
    // 路径检查有 await；并行钩子可能在这期间已占满名额或记录同一个 id。
    if (this.turn !== turn || turn.calls.some((call) => call.id === id)) return;
    if (turn.calls.length >= 256) { this.warning("本轮工具操作超过 256 次，后续操作未记录。"); await this.persist(); return; }
    const call: CapturedCall = { id, parentId, tool, path, order: ++this.order, before: { kind: "omitted", reason: "unreadable" }, after: { kind: "omitted", reason: "unreadable" } };
    const parallel = turn.calls.filter((row) => row.path === path && row.finished === undefined);
    if (parallel.length) { call.overlap = true; for (const row of parallel) row.overlap = true; this.warning("同一文件有并行工具操作，快照表示观察到的前后状态，不能精确归因给单个工具。"); }
    turn.calls.push(call); turn.anchorId = anchorId ?? turn.anchorId;
    call.before = await captureFile(turn.cwd, path); this.limit(call); await this.persist();
  }
  async after(id: string, error: boolean, anchorId?: string) {
    const turn = this.turn; const call = turn?.calls.find((row) => row.id === id); if (!turn || !call || call.finished !== undefined) return;
    try { call.after = await captureFile(turn.cwd, call.path); }
    catch { call.after = { kind: "omitted", reason: "unreadable" }; this.warning("工具执行后路径发生变化，部分内容没有读取。"); }
    call.finished = ++this.order; call.error = error; turn.anchorId = anchorId ?? turn.anchorId;
    this.limit(call); await this.persist();
  }
  assistant(timestamp: number) { if (this.turn) this.turn.assistantTimestamp = timestamp; }
  async finish(status: "completed" | "aborted" | "interrupted", anchorId?: string) {
    if (!this.turn) return;
    if (this.turn.calls.some((call) => call.finished === undefined)) this.warning("部分工具没有完成前后快照；没有把不完整记录当成已修改文件。");
    this.turn.status = status; this.turn.endedAt = Date.now(); this.turn.anchorId = anchorId ?? this.turn.anchorId;
    try { await this.persist(); } finally { this.turn = undefined; }
  }
}
