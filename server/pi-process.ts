import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";

// 一个项目文件夹对应一个后台 pi（RPC 模式），协议见 pi 文档 docs/rpc.md。
export type RpcRecord = { type: string; id?: string; [key: string]: unknown };

type Pending = { resolve: (record: RpcRecord) => void; reject: (error: Error) => void };

export class PiProcess extends EventEmitter {
  private readonly child: ChildProcessWithoutNullStreams;
  private buffer = "";
  private readonly pending = new Map<string, Pending>();
  private nextId = 1;
  exited = false;

  constructor(readonly cwd: string) {
    super();
    this.child = spawn(process.env.PI_BIN ?? "pi", ["--mode", "rpc"], {
      cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    // setEncoding 会正确拼接被切开的多字节字符；记录只按 LF 切分，不能用 readline。
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.onData(chunk));
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => this.emit("stderr", chunk));
    this.child.on("error", (error) => this.fail(error));
    this.child.on("exit", (code) => this.fail(new Error(`pi exited with code ${code}`)));
  }

  private fail(error: Error) {
    if (this.exited) return;
    this.exited = true;
    for (const { reject } of this.pending.values()) reject(error);
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
        record = JSON.parse(line);
      } catch {
        continue;
      }
      const waiter = record.type === "response" && record.id ? this.pending.get(record.id) : undefined;
      if (waiter) {
        this.pending.delete(record.id!);
        waiter.resolve(record);
      } else {
        this.emit("record", record);
      }
    }
  }

  request(command: Record<string, unknown>): Promise<RpcRecord> {
    if (this.exited) return Promise.reject(new Error("pi is not running"));
    const id = `desk-${this.nextId++}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(JSON.stringify({ ...command, id }) + "\n");
    });
  }

  // 用于 extension_ui_response：pi 不会为它单独回 response。
  send(record: Record<string, unknown>) {
    if (!this.exited) this.child.stdin.write(JSON.stringify(record) + "\n");
  }

  dispose() {
    this.child.stdin.end();
  }
}
