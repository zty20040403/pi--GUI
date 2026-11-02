import type { Connection, Opened, Target, WireRecord } from "./types";

type ClientEvent = { kind: "connection"; value: Connection } | { kind: "opened"; value: Opened }
  | { kind: "event"; cwd: string; value: WireRecord; sessionPath?: string; seq?: number }
  | { kind: "deleted"; cwd: string; sessionPath: string; selected: boolean } | { kind: "error"; value: string };
type Pending = { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
export class RpcClient {
  private socket?: WebSocket;
  private readonly listeners = new Set<(event: ClientEvent) => void>();
  private readonly pending = new Map<string, Pending>();
  private nextId = 1;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private retries = 0;
  private stopped = false;
  private target?: Target;
  private lastOpened?: Target;
  private opening?: Pending;
  private buffering = false;
  private buffered: { cwd: string; record: WireRecord; seq: number; sessionPath?: string }[] = [];

  constructor(private readonly token: string, private readonly endpoint: string,
    private readonly makeSocket = (url: string) => new WebSocket(url), private readonly reconnectMs = 500) {}

  get selectedCwd() { return this.target?.cwd; }
  get selectedSessionPath() { return this.target?.sessionPath; }
  subscribe(listener: (event: ClientEvent) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  private emit(event: ClientEvent) { for (const listener of this.listeners) listener(event); }
  connect(target: Target) {
    this.target = target;
    this.stopped = false;
    this.createConnection();
  }
  private createConnection() {
    if (this.stopped) return;
    this.emit({ kind: "connection", value: this.retries ? "reconnecting" : "connecting" });
    const url = new URL(this.endpoint);
    url.searchParams.set("token", this.token);
    const socket = this.makeSocket(url.toString());
    this.socket = socket;
    socket.onopen = () => {
      if (socket !== this.socket || this.stopped) return;
      this.retries = 0;
      if (this.target) this.sendOpen();
    };
    socket.onmessage = (event) => {
      if (socket !== this.socket) return;
      let message: WireRecord;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.op === "opened") {
        this.target = { cwd: message.cwd, sessionPath: message.state.sessionFile };
        this.lastOpened = this.target;
        this.emit({ kind: "opened", value: message as Opened });
        this.buffering = false;
        const represented = new Set((message.messages as WireRecord[]).map((item) => `${item.role}:${item.timestamp}:${item.toolCallId ?? ""}`));
        let active = "";
        for (const item of this.buffered) {
          if (item.cwd !== this.target.cwd) continue;
          const record = item.record;
          if (record.message) active = `${record.message.role}:${record.message.timestamp}:${record.message.toolCallId ?? ""}`;
          // 快照之前、且已在历史中的消息不重放，避免把相同 delta 拼两遍。
          const pastMessage = record.type.startsWith("message_") && represented.has(active) && item.seq <= (message.seq ?? 0);
          if (!pastMessage) this.emit({ kind: "event", cwd: item.cwd, value: record, sessionPath: item.sessionPath, seq: item.seq });
        }
        this.buffered = [];
        this.emit({ kind: "connection", value: "ready" });
        this.resolveOpen(message);
      } else if (["ui_states", "ui_state", "ui_resolved"].includes(message.op)) {
        this.emit({ kind: "event", cwd: message.cwd ?? "", value: { ...message, type: `desk_${message.op}` } });
      } else if (message.op === "rpc_result" || message.op === "error" && message.reqId) {
        const waiter = this.pending.get(message.reqId);
        if (!waiter) return;
        clearTimeout(waiter.timer); this.pending.delete(message.reqId);
        if (message.op === "error" || message.response.success !== true) waiter.reject(new Error(message.message ?? message.response.error ?? "命令失败"));
        else waiter.resolve(message.response.data);
      } else if (message.op === "event") {
        const dialog = message.record?.type === "extension_ui_request" && ["select", "confirm", "input", "editor"].includes(message.record.method);
        // open 自身也可能等待插件提问；对话交互不能等 opened 后再交给界面。
        if (this.buffering && message.cwd === this.target?.cwd && !dialog) this.buffered.push({ cwd: message.cwd, record: message.record, seq: message.seq ?? 0, sessionPath: message.sessionPath });
        else this.emit({ kind: "event", cwd: message.cwd, value: message.record, sessionPath: message.sessionPath, seq: message.seq });
      } else if (message.op === "session_deleted") {
        const selected = this.target?.sessionPath === message.sessionPath;
        if (selected) {
          this.target = { cwd: this.target!.cwd };
          this.lastOpened = this.target;
        }
        this.emit({ kind: "deleted", cwd: message.cwd, sessionPath: message.sessionPath, selected });
      } else if (message.op === "error") {
        this.buffering = false; this.buffered = [];
        this.resolveOpen(undefined, new Error(message.message));
        if (this.lastOpened) this.target = this.lastOpened;
        this.emit({ kind: "connection", value: this.lastOpened ? "ready" : "offline" });
        this.emit({ kind: "error", value: message.message });
      } else if (message.op === "exit") {
        this.emit({ kind: "event", cwd: message.cwd, value: { type: "desk_process_exit" } });
        if (message.cwd === this.target?.cwd) {
          this.emit({ kind: "error", value: `pi 进程已退出：${message.reason}。点击重新连接以恢复对话。` });
          this.emit({ kind: "connection", value: "offline" });
        }
      }
    };
    socket.onerror = () => {}; // close 统一处理，绝不打印带口令的连接地址。
    socket.onclose = () => {
      if (socket !== this.socket || this.stopped) return;
      this.rejectPending(new Error("连接已断开，未确认的命令不会自动重发"));
      this.buffering = false; this.buffered = [];
      this.emit({ kind: "connection", value: "reconnecting" });
      const delay = Math.min(10_000, this.reconnectMs * 2 ** this.retries++);
      if (this.retries === 3) this.emit({ kind: "error", value: "多次连接失败。请确认后台仍在运行；如果重启过，请用本次打印的完整带口令网址重新打开。" });
      this.reconnectTimer = setTimeout(() => this.createConnection(), delay);
    };
  }
  private sendOpen() {
    if (!this.target) return;
    this.buffering = true;
    this.buffered = [];
    this.emit({ kind: "connection", value: "opening" });
    this.send({ op: "open", ...this.target });
  }
  open(target: Target): Promise<Opened> {
    if (this.opening) return Promise.reject(new Error("另一个对话正在打开"));
    this.target = target;
    return new Promise((resolve, reject) => {
      this.opening = { resolve, reject, timer: setTimeout(() => this.resolveOpen(undefined, new Error("打开对话超时")), 120_000) };
      try { this.sendOpen(); } catch (error) { this.resolveOpen(undefined, error as Error); }
    });
  }
  private resolveOpen(value?: any, error?: Error) {
    if (!this.opening) return;
    clearTimeout(this.opening.timer);
    if (error) this.opening.reject(error); else this.opening.resolve(value);
    this.opening = undefined;
  }
  rpc<T = any>(cwd: string, cmd: WireRecord): Promise<T> { return this.command({ op: "rpc", cwd, cmd }); }
  uiResponse(cwd: string, payload: WireRecord): Promise<void> { return this.command({ op: "ui_response", cwd, payload }); }
  private command<T>(body: WireRecord): Promise<T> {
    const reqId = `web-${this.nextId++}`;
    return new Promise((resolve, reject) => {
      this.pending.set(reqId, { resolve, reject, timer: setTimeout(() => {
        this.pending.delete(reqId); reject(new Error("命令等待超时；请先检查对话状态，不要重复发送危险操作"));
      }, 120_000) });
      try { this.send({ ...body, reqId }); } catch (error) {
        const waiter = this.pending.get(reqId)!; clearTimeout(waiter.timer); this.pending.delete(reqId); reject(error);
      }
    });
  }
  private send(value: WireRecord) {
    if (this.socket?.readyState !== 1) throw new Error("尚未连接后台");
    this.socket.send(JSON.stringify(value));
  }
  private rejectPending(error: Error) {
    for (const waiter of this.pending.values()) { clearTimeout(waiter.timer); waiter.reject(error); }
    this.pending.clear(); this.resolveOpen(undefined, error);
  }
  reconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = undefined;
    this.createConnection();
  }
  dispose() {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.rejectPending(new Error("客户端已关闭"));
    this.listeners.clear();
  }
}
