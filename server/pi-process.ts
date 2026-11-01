import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";

// 一个项目文件夹对应一个后台 pi（RPC 模式），协议见 pi 文档 docs/rpc.md。
export type RpcRecord = { type: string; id?: string; [key: string]: unknown };
export type PiProcessOptions = { binary?: string; args?: string[]; requestTimeoutMs?: number };
type Pending = { resolve: (record: RpcRecord) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

export class PiProcess extends EventEmitter {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly closed: Promise<void>;
  private readonly requestTimeoutMs: number;
  private buffer = "";
  private readonly pending = new Map<string, Pending>();
  private nextId = 1;
  private writes: Promise<void> = Promise.resolve();
  private disposal?: Promise<void>;
  exited = false;

  constructor(readonly cwd: string, options: PiProcessOptions = {}) {
    super();
    this.requestTimeoutMs = options.requestTimeoutMs ?? 120_000;
    this.child = spawn(options.binary ?? process.env.PI_BIN ?? "pi", [...(options.args ?? []), "--mode", "rpc"], {
      cwd,
      env: process.env,
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
    const id = `desk-${this.nextId++}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`pi command timed out: ${String(command.type)}`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
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
