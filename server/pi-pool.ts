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
};
type Entry = { pi: PiProcess; lastActivity: number; busy: boolean };

export class PiPool extends EventEmitter {
  private readonly processes = new Map<string, Entry>();
  private readonly timer: NodeJS.Timeout;
  private readonly now: () => number;
  private readonly idleTimeoutMs: number;
  private closing = false;

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

  async get(cwd: string): Promise<PiProcess> {
    if (!isAbsolute(cwd)) throw new Error("项目路径必须是绝对路径");
    const canonical = await realpath(cwd);
    if (!(await stat(canonical)).isDirectory()) throw new Error("项目路径不是文件夹");
    const args: string[] = [];
    const permissionsPath = this.options.permissionsPath ?? resolve(ROOT, "pi-extension", "desk" + "-permissions.ts");
    if (this.options.permissionsEnabled !== false && process.env.PI_DESK_LOAD_PERMISSIONS !== "0") {
      try {
        if ((await stat(permissionsPath)).isFile()) args.push("-e", permissionsPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    if (this.closing) throw new Error("后台正在关闭");
    // 所有异步检查之后才读 Map，并立刻插入；并发 get 不会启动两个进程。
    const current = this.processes.get(canonical);
    if (current && !current.pi.exited) {
      current.lastActivity = this.now();
      return current.pi;
    }
    const pi = this.options.createProcess?.(canonical, args) ?? new PiProcess(canonical, { args });
    const entry: Entry = { pi, lastActivity: this.now(), busy: false };
    this.processes.set(canonical, entry);
    pi.on("activity", () => { entry.lastActivity = this.now(); });
    pi.on("record", (record: RpcRecord) => {
      if (record.type === "agent_start") entry.busy = true;
      if (record.type === "agent_settled") entry.busy = false;
      this.emit("record", canonical, record, sequenceOf(record), pi.sessionFile);
    });
    pi.on("stderr", (chunk: string) => this.emit("stderr", canonical, chunk));
    pi.once("exit", (reason: string) => {
      if (this.processes.get(canonical) === entry) this.processes.delete(canonical);
      this.emit("exit", canonical, reason);
    });
    return pi;
  }

  private closeIdle() {
    for (const entry of this.processes.values()) {
      if (!entry.busy && entry.pi.pendingCount === 0 && this.now() - entry.lastActivity >= this.idleTimeoutMs) {
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

  async dispose(): Promise<void> {
    this.closing = true;
    clearInterval(this.timer);
    await Promise.all([...this.processes.values()].map(({ pi }) => pi.dispose()));
    this.processes.clear();
  }
}
