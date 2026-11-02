import { ChangeStore } from "./change-store.js";
import { checkedChangePath } from "./change-files.js";
import { gitReview, isGitProject } from "./change-git.js";
import { FileService } from "./files.js";
import { HttpError } from "./http.js";
import type { PiProcess } from "./pi-process.js";
import { CHANGES_STATUS, mergeFiles, turnFiles, type ChangeIndex, type ChangeReview, type ChangeTurn, type TurnSummary } from "../shared/changes.js";
import { activeBranch } from "./extension-state.js";

export class ChangeService {
  constructor(private readonly store: ChangeStore, private readonly files: FileService, private readonly processFor: (cwd: string) => Promise<PiProcess>, private readonly busyFor: (cwd: string) => boolean = () => false) {}
  private async context(cwd: unknown, sessionId: unknown) {
    const { root } = await this.files.resolvePath(cwd, ".", true);
    if (typeof sessionId !== "string") throw new HttpError(400, "缺少对话标识");
    const pi = await this.processFor(root); const response = await pi.request({ type: "get_state" });
    if (response.success !== true || (response.data as any)?.sessionId !== sessionId) throw new HttpError(409, "当前对话已经切换，请刷新改动面板");
    const entries = await pi.request({ type: "get_entries" });
    if (entries.success !== true) throw new HttpError(500, "无法确认当前对话分支，未展示其他分支的改动");
    const data = entries.data as any; const branch = activeBranch(data?.entries, data?.leafId); const ids = new Set(branch.map((entry) => entry.id));
    const stillCurrent = await pi.request({ type: "get_state" });
    if ((stillCurrent.data as any)?.sessionId !== sessionId) throw new HttpError(409, "当前对话已经切换，请刷新改动面板");
    let activeTurnId: string | undefined;
    try { const status = JSON.parse(pi.uiSnapshot?.statuses?.[CHANGES_STATUS] ?? "{}"); if (status.sessionId === sessionId && typeof status.turnId === "string") activeTurnId = status.turnId; } catch {}
    return { root, pi, ids, sessionId, activeTurnId, busy: this.busyFor(root) || !!(stillCurrent.data as any)?.isStreaming || !!(stillCurrent.data as any)?.isCompacting };
  }
  private onBranch(turn: Pick<ChangeTurn, "anchorId">, ids: Set<string>) { return !!turn.anchorId && ids.has(turn.anchorId); }
  async index(cwd: unknown, sessionId: unknown): Promise<ChangeIndex> {
    const context = await this.context(cwd, sessionId); const turns: TurnSummary[] = [];
    for (const row of await this.store.summaries(context.sessionId)) {
      if (!this.onBranch(row, context.ids)) continue;
      const files = [];
      for (const file of row.files) { try { await checkedChangePath(context.root, file.path); files.push(file); } catch {} }
      const tools = [];
      for (const tool of row.tools) { try { await checkedChangePath(context.root, tool.path); tools.push(tool); } catch {} }
      turns.push({ ...row, status: row.status === "running" && (!context.busy || context.activeTurnId !== row.id) ? "interrupted" : row.status, files, tools });
    }
    return { turns, git: await isGitProject(context.root) };
  }
  async review(cwd: unknown, sessionId: unknown, scope: unknown, turnId?: unknown, toolId?: unknown): Promise<ChangeReview> {
    const context = await this.context(cwd, sessionId);
    if (scope === "git") return gitReview(context.root);
    if (!["turn", "session"].includes(String(scope))) throw new HttpError(400, "改动范围不正确");
    let turns: ChangeTurn[];
    if (scope === "turn") {
      if (typeof turnId !== "string") throw new HttpError(400, "请选择具体轮次");
      const row = await this.store.read(context.sessionId, turnId);
      if (!row || !this.onBranch(row, context.ids)) throw new HttpError(404, "这一轮没有可用的改动快照，或不属于当前分支");
      turns = [row];
    } else {
      // 先按分支选择，再读取正文；其他分支的大文件不会拖慢当前分支。
      const ids = (await this.store.summaries(context.sessionId)).filter((row) => this.onBranch(row, context.ids)).map((row) => row.id);
      turns = []; let bytes = 0;
      for (const id of ids) { const row = await this.store.read(context.sessionId, id); if (!row) continue; bytes += Buffer.byteLength(JSON.stringify(row)); if (bytes > 32 * 1024 * 1024) throw new HttpError(413, "这个对话的快照过多，请切到本轮逐轮查看"); turns.push(row); }
    }
    if (toolId !== undefined && (scope !== "turn" || typeof toolId !== "string" || toolId.length > 2048)) throw new HttpError(400, "工具改动标识不正确");
    const warnings = [...new Set(turns.flatMap((row) => row.warnings))];
    const candidates = toolId !== undefined ? turns[0].calls.filter((call) => call.id === toolId && call.finished !== undefined) : mergeFiles(turns.flatMap(turnFiles));
    if (toolId !== undefined && !candidates.length) throw new HttpError(404, "这次工具操作没有完整快照");
    const files = [];
    for (const file of candidates) {
      try { await checkedChangePath(context.root, file.path); files.push({ path: file.path, before: file.before, after: file.after, overlap: file.overlap, gap: file.gap }); }
      catch { if (!warnings.includes("部分路径目前不允许展示，内容已隐藏。")) warnings.push("部分路径目前不允许展示，内容已隐藏。"); }
    }
    if (files.some((file) => file.gap)) warnings.push("部分捕获之间内容不连续（可能有外部或 bash 修改）；比较表示首个快照到最后快照，不是独占归因。");
    return { label: toolId !== undefined ? "这次工具改动" : scope === "turn" ? "本轮改动" : "当前分支已记录的全部改动", files, warnings };
  }
}
