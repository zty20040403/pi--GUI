import { EventEmitter } from "node:events";
import { WebSocket } from "ws";

export type DeskMessage = { op: string; [key: string]: any };
type Waiter = { predicate: (message: DeskMessage) => boolean; resolve: (message: DeskMessage) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

export class DeskClient extends EventEmitter {
  readonly socket: WebSocket;
  readonly ready: Promise<void>;
  private readonly inbox: DeskMessage[] = [];
  private readonly waiters = new Set<Waiter>();
  private nextId = 1;

  constructor(launchUrl: string) {
    super();
    const launch = new URL(launchUrl);
    if (launch.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(launch.hostname) || !launch.port || launch.username || launch.password || !/^[a-f0-9]{64}$/.test(launch.searchParams.get("token") ?? "")) {
      throw new Error("请提供后台打印的本机带口令网址");
    }
    const url = new URL("/ws", launch);
    url.protocol = "ws:";
    url.searchParams.set("token", launch.searchParams.get("token")!);
    this.socket = new WebSocket(url, { origin: launch.origin, handshakeTimeout: 10_000 });
    this.ready = new Promise((resolve, reject) => {
      this.socket.once("open", resolve);
      this.socket.once("error", reject);
    });
    this.socket.on("error", () => this.rejectWaiters(new Error("WebSocket 连接失败")));
    this.socket.on("close", () => this.rejectWaiters(new Error("WebSocket 已断开")));
    this.socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as DeskMessage;
      this.emit("record", message);
      const waiter = [...this.waiters].find(({ predicate }) => predicate(message));
      if (waiter) {
        this.waiters.delete(waiter);
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      } else {
        this.inbox.push(message);
      }
    });
  }

  private rejectWaiters(error: Error) {
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.waiters.clear();
  }

  waitFor(predicate: (message: DeskMessage) => boolean, timeoutMs = 120_000): Promise<DeskMessage> {
    const index = this.inbox.findIndex(predicate);
    if (index >= 0) return Promise.resolve(this.inbox.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { predicate, resolve, reject, timer: setTimeout(() => {
        this.waiters.delete(waiter);
        reject(new Error("等待后台记录超时"));
      }, timeoutMs) };
      this.waiters.add(waiter);
    });
  }

  send(message: object) {
    this.socket.send(JSON.stringify(message));
  }

  async open(cwd: string, sessionPath?: string): Promise<DeskMessage> {
    this.send({ op: "open", cwd, sessionPath });
    const reply = await this.waitFor((message) => message.op === "opened" || message.op === "error");
    if (reply.op === "error") throw new Error(reply.message);
    return reply;
  }

  async rpc(cwd: string, cmd: object): Promise<any> {
    const reqId = `smoke-${this.nextId++}`;
    this.send({ op: "rpc", cwd, reqId, cmd });
    const reply = await this.waitFor((message) => message.reqId === reqId);
    if (reply.op === "error") throw new Error(reply.message);
    if (reply.response.success !== true) throw new Error(reply.response.error ?? "pi 命令失败");
    return reply.response.data;
  }

  close() {
    this.socket.terminate();
    this.rejectWaiters(new Error("测试客户端已关闭"));
  }
}
