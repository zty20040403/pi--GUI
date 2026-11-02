import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { ExtensionUi } from "./extension-ui.js";
import { delimiter } from "node:path";

// 一个项目文件夹对应一个后台 pi（RPC 模式），协议见 pi 文档 docs/rpc.md。
export type RpcRecord = { type: string; id?: string; [key: string]: unknown };
export const RPC_SEQUENCE = Symbol("desk sequence");
export const sequenceOf = (record: RpcRecord): number => (record as RpcRecord & { [RPC_SEQUENCE]?: number })[RPC_SEQUENCE] ?? 0;
export type PiProcessOptions = { binary?: string; args?: string[]; requestTimeoutMs?: number; env?: NodeJS.ProcessEnv };
type Pending = { resolve: (record: RpcRecord) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };
// npm/tsx 会把开发 SDK 的同名 pi 放到 PATH 最前面；发动机必须仍用用户安装的 pi。
export function piEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...env, ...(env.PATH ? { PATH: env.PATH.split(delimiter).filter((path) => !/(?:^|[\\/])node_modules[\\/]\.bin[\\/]?$/.test(path)).join(delimiter) } : {}) };
}

export class PiProcess extends EventEmitter {
  readonly ui = new ExtensionUi((id, reason) => this.emit("ui_resolved", id, reason));
  get uiSnapshot() { return this.ui.snapshot(this.sequence); }
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly closed: Promise<void>;
  private readonly requestTimeoutMs: number;
  private buffer = "";
  private readonly pending = new Map<string, Pending>();
  private nextId = 1;
  private sequence = 0;
  private writes: Promise<void> = Promise.resolve();
  private disposal?: Promise<void>;
  exited = false;
  sessionFile?: string;

  constructor(readonly cwd: string, options: PiProcessOptions = {}) {
    super();
    this.requestTimeoutMs = options.requestTimeoutMs ?? 120_000;
    this.child = spawn(options.binary ?? process.env.PI_BIN ?? "pi", [...(options.args ?? []), "--mode", "rpc"], {
      cwd,
      env: piEnvironment({ ...process.env, ...options.env }),
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.closed = new Promise((resolve) => this.child.once("close", () => resolve()));
    // setEncoding 正确拼接多字节字符；只按 LF 切分，不能用 readline。
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.onData(chunk));
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => this.emit("stderr", chunk));
    this.child.stdin.on("error", (error) => this.fail(error));
    this.child.on("error", (error) => this.fail(error));
    this.child.on("close", (code, signal) => this.fail(new Error(`pi exited (${signal ?? code ?? "unknown"})`)));
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  private fail(error: Error) {
    if (this.exited) return;
    this.exited = true;
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.pending.clear();
    this.ui.dispose();
    this.emit("exit", error.message);
  }

  private onData(chunk: string) {
    this.buffer += chunk;
    let newline: number;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      let line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (!line.trim()) continue;
      let record: RpcRecord;
      try {
        const parsed: unknown = JSON.parse(line);
        if (!parsed || typeof parsed !== "object" || typeof (parsed as RpcRecord).type !== "string") continue;
        record = parsed as RpcRecord;
      } catch {
        this.emit("stderr", "pi emitted an invalid JSONL record (content omitted)\n");
        continue;
      }
      (record as RpcRecord & { [RPC_SEQUENCE]?: number })[RPC_SEQUENCE] = ++this.sequence;
      if (record.type === "response" && record.success === true) {
        const data = record.data as Record<string, unknown> | undefined;
        if (record.command === "get_state") this.sessionFile = typeof data?.sessionFile === "string" ? data.sessionFile : undefined;
        if (["new_session", "switch_session"].includes(String(record.command)) && data?.cancelled !== true) this.sessionFile = undefined;
      }
      this.ui.record(record);
      this.emit("activity");
      const waiter = record.type === "response" && record.id ? this.pending.get(record.id) : undefined;
      if (waiter) {
        this.pending.delete(record.id!);
        clearTimeout(waiter.timer);
        waiter.resolve(record);
      } else {
        this.emit("record", record);
      }
    }
  }

  request(command: Record<string, unknown>): Promise<RpcRecord> {
    if (this.exited || this.disposal) return Promise.reject(new Error("pi is not running"));
    const changing = ["new_session", "switch_session"].includes(String(command.type));
    if (changing && this.ui.pendingCount) return Promise.reject(new Error("插件正在等你回答，请先处理弹窗"));
    const previous = changing ? this.uiSnapshot : undefined;
    if (changing) { this.ui.reset(); this.emit("ui_state", this.uiSnapshot); }
    if (command.type === "prompt") this.ui.clearEditor();
    const id = `desk-${this.nextId++}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`pi command timed out: ${String(command.type)}`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve: (response) => {
        if (previous && (response.success !== true || (response.data as Record<string, unknown> | undefined)?.cancelled === true)) { this.ui.restore(previous); this.emit("ui_state", this.uiSnapshot); }
        resolve(response);
      }, reject, timer });
      void this.send({ ...command, id }).catch((error: Error) => {
        const waiter = this.pending.get(id);
        if (!waiter) return;
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  // extension_ui_response 没有单独的 response；等 write 回调再写下一条，遵守背压。
  send(record: Record<string, unknown>): Promise<void> {
    if (this.exited || this.disposal) return Promise.reject(new Error("pi is not running"));
    this.emit("activity");
    const line = JSON.stringify(record) + "\n";
    const write = this.writes.then(() => new Promise<void>((resolve, reject) => {
      if (this.exited) return reject(new Error("pi is not running"));
      this.child.stdin.write(line, (error) => error ? reject(error) : resolve());
    }));
    this.writes = write.catch(() => {});
    return write;
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.disposal = (async () => {
      if (!this.exited) {
        // stdin EOF 是 pi 的正常关闭方式；卡住时再升级到信号。
        const terminate = setTimeout(() => this.child.kill("SIGTERM"), 5_000);
        const kill = setTimeout(() => this.child.kill("SIGKILL"), 10_000);
        try {
          await this.writes;
          this.child.stdin.end();
          await this.closed;
        } finally {
          clearTimeout(terminate);
          clearTimeout(kill);
        }
      } else {
        await this.closed;
      }
    })();
    return this.disposal;
  }
}
