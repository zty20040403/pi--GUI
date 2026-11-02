import { EventEmitter } from "node:events";
import { realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PiProcess, sequenceOf, type RpcRecord } from "./pi-process.js";
import { HttpError } from "./http.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export type PoolOptions = {
  permissionsEnabled?: boolean;
  permissionsPath?: string;
  idleTimeoutMs?: number;
  sweepIntervalMs?: number;
  now?: () => number;
  createProcess?: (cwd: string, args: string[]) => PiProcess;
  processEnv?: NodeJS.ProcessEnv;
};
type Entry = { pi: PiProcess; lastActivity: number; busy: boolean };

export class PiPool extends EventEmitter {
  private readonly processes = new Map<string, Entry>();
  private readonly timer: NodeJS.Timeout;
  private readonly now: () => number;
  private readonly idleTimeoutMs: number;
  private closing = false;
  private restarting = false;
  private expectedExits = new WeakSet<PiProcess>();
  get idle(): boolean { return [...this.processes.values()].every(({ pi, busy }) => !busy && !pi.pendingCount && !pi.ui.pendingCount); }

  constructor(private readonly options: PoolOptions = {}) {
    super();
    this.now = options.now ?? Date.now;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 30 * 60_000;
    this.timer = setInterval(() => this.closeIdle(), options.sweepIntervalMs ?? 60_000);
    this.timer.unref();
  }

  get size(): number {
    return this.processes.size;
  }

  get activity() {
    return [...this.processes.values()].map(({ pi, busy }) => ({ cwd: pi.cwd, sessionPath: pi.sessionFile, busy }));
  }

  get uiSnapshots() { return [...this.processes.values()].map(({ pi }) => ({ cwd: pi.cwd, state: pi.uiSnapshot })); }

  async get(cwd: string, resumeId?: string): Promise<PiProcess> {
    if (!isAbsolute(cwd)) throw new Error("项目路径必须是绝对路径");
    let canonical: string;
    try { canonical = await realpath(cwd); }
    catch { throw new Error(`这个对话所在的文件夹已经不存在了（可能被删除或移动）：${cwd}。不需要的话，可以在左边对话的 ⋯ 菜单里把它删掉。`); }
    if (!(await stat(canonical)).isDirectory()) throw new Error("项目路径不是文件夹");
    const args: string[] = [];
    if (resumeId && /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/.test(resumeId)) args.push("--session-id", resumeId);
    const permissionsPath = this.options.permissionsPath ?? resolve(ROOT, "pi-extension", "desk" + "-permissions.ts");
    if (this.options.permissionsEnabled !== false && process.env.PI_DESK_LOAD_PERMISSIONS !== "0") {
      try {
        if ((await stat(permissionsPath)).isFile()) args.push("-e", permissionsPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    const mappingPath = resolve(ROOT, "pi-extension", "desk-session-map.ts");
    try { if ((await stat(mappingPath)).isFile()) args.push("-e", mappingPath); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (this.closing) throw new Error("后台正在关闭");
    if (this.restarting) throw new HttpError(409, "插件正在重新加载，请稍候");
    // 所有异步检查之后才读 Map，并立刻插入；并发 get 不会启动两个进程。
    const current = this.processes.get(canonical);
    if (current && !current.pi.exited) {
      current.lastActivity = this.now();
      return current.pi;
    }
    const pi = this.options.createProcess?.(canonical, args) ?? new PiProcess(canonical, { args, env: this.options.processEnv });
    const entry: Entry = { pi, lastActivity: this.now(), busy: false };
    this.processes.set(canonical, entry);
    pi.on("activity", () => { entry.lastActivity = this.now(); });
    pi.on("record", (record: RpcRecord) => {
      if (record.type === "agent_start") entry.busy = true;
      if (record.type === "agent_settled") entry.busy = false;
      this.emit("record", canonical, record, sequenceOf(record), pi.sessionFile, pi);
    });
    pi.on("ui_resolved", (id: string, reason: string) => this.emit("ui_resolved", canonical, id, reason));
    pi.on("ui_state", (state) => this.emit("ui_state", canonical, state));
    pi.on("stderr", (chunk: string) => this.emit("stderr", canonical, chunk));
    pi.once("exit", (reason: string) => {
      if (this.processes.get(canonical) === entry) this.processes.delete(canonical);
      this.emit("exit", canonical, reason, this.expectedExits.has(pi));
    });
    return pi;
  }

  private closeIdle() {
    if (this.restarting) return;
    for (const entry of this.processes.values()) {
      if (!entry.busy && entry.pi.pendingCount === 0 && entry.pi.ui.pendingCount === 0 && this.now() - entry.lastActivity >= this.idleTimeoutMs) {
        void entry.pi.dispose().catch(() => this.emit("stderr", entry.pi.cwd, "无法关闭空闲 pi 进程\n"));
      }
    }
  }

  async closeSession(sessionPath: string): Promise<void> {
    for (const entry of [...this.processes.values()]) {
      const pi = entry.pi;
      if (pi.exited) continue;
      const response = await pi.request({ type: "get_state" });
      if (response.success !== true) throw new HttpError(409, "无法确认活动对话，请稍后重试");
      const state = response.data as Record<string, unknown>;
      if (state.sessionFile !== sessionPath) continue;
      if (entry.busy || state.isStreaming || state.isCompacting || pi.pendingCount > 0) throw new HttpError(409, "对话还在回复或处理命令，请先停止或等待完成");
      await pi.dispose();
    }
  }

  async restartIdle(restore: (pi: PiProcess, state: Record<string, unknown>) => Promise<void>): Promise<void> {
    if (this.restarting || !this.idle) throw new HttpError(409, "项目还在回复或等待插件回答");
    this.restarting = true;
    const saved: { cwd: string; state: Record<string, unknown> }[] = [];
    try {
      for (const { pi, busy } of this.processes.values()) {
        const response = await pi.request({ type: "get_state" }); const state = response.data as Record<string, unknown> | undefined;
        if (busy || response.success !== true || !state || state.isStreaming || state.isCompacting || pi.ui.pendingCount) throw new HttpError(409, "项目还在回复、压缩或等待插件回答");
        saved.push({ cwd: pi.cwd, state });
      }
      if (!this.idle) throw new HttpError(409, "项目刚开始新的工作，请等待完成");
      await Promise.all([...this.processes.values()].map(({ pi }) => { this.expectedExits.add(pi); return pi.dispose(); }));
    } finally { this.restarting = false; }
    for (const row of saved) { const pi = await this.get(row.cwd, typeof row.state.sessionId === "string" ? row.state.sessionId : undefined); await restore(pi, row.state); }
  }

  async dispose(): Promise<void> {
    this.closing = true;
    clearInterval(this.timer);
    await Promise.all([...this.processes.values()].map(({ pi }) => pi.dispose()));
    this.processes.clear();
  }
}
