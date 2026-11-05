import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { constants, unwatchFile, watch, watchFile, type FSWatcher, type Stats } from "node:fs";
import { open, stat } from "node:fs/promises";
import { HttpError } from "./http.js";
import type { PiProcess, RpcRecord } from "./pi-process.js";

export const EXTERNAL_CHANGE = "这个对话在别处（比如终端）有新消息。重新载入后才能继续发送。";
const LIMIT = 50 * 1024 * 1024;
type Snapshot = { stamp: string; header: string; entries: string[]; size: number };
type Tracked = { pi: PiProcess; path: string; snapshot?: Snapshot; dirty: boolean; unstable?: boolean; checking?: Promise<boolean> };
export type SyncState = { sessionPath: string; externalChanged: boolean };
export type SyncOptions = { debounceMs?: number; pollMs?: number; projectPollMs?: number; watch?: typeof watch };

// 比较完整条目内容，而不是“最近几秒写过”这种时间猜测；并发的终端写入不能冒充 App 写入。
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function stamp(info: { size: number; mtimeMs: number; ctimeMs: number; ino: number }) { return `${info.size}:${info.mtimeMs}:${info.ctimeMs}:${info.ino}`; }
async function snapshot(path: string, previous?: Snapshot): Promise<Snapshot | "unchanged" | "unstable" | undefined> {
  let file;
  try { file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > LIMIT) throw new Error("无法安全检查对话文件");
    const version = stamp(info);
    if (previous?.stamp === version) return "unchanged";
    // 限长读取，即使文件在检查后变大，也绝不读取超过 50 MB。
    const buffer = Buffer.alloc(info.size); let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break; offset += bytesRead;
    }
    if (stamp(await file.stat()) !== version || offset !== buffer.length) return "unstable";
    const text = buffer.toString("utf8");
    if (text && !text.endsWith("\n")) return "unstable";
    const lines = text.trimEnd().split("\n").map((line) => JSON.parse(line));
    if (lines[0]?.type !== "session") throw new Error("对话文件头无效");
    return { stamp: version, size: info.size, header: canonical(lines[0]), entries: lines.slice(1).map(canonical) };
  } finally { await file.close(); }
}

export class SessionSync extends EventEmitter {
  private watcher?: FSWatcher;
  private readonly projectWatchers = new Map<string, (current: Stats, previous: Stats) => void>();
  private timer?: NodeJS.Timeout;
  private poll?: NodeJS.Timeout;
  private closed = false;
  private readonly tracked = new Map<PiProcess, Tracked>();
  private readonly authored = new Map<PiProcess, Map<string, string>>();
  constructor(private readonly sessionsDir: string, private readonly options: SyncOptions = {}) { super(); }
  start() {
    this.tryWatch();
    // 监听失败时是 15 秒回退；监听正常时也对漏掉的 OS 事件做低频校准。
    this.poll = setInterval(() => { this.tryWatch(); this.schedule(); }, this.options.pollMs ?? 15_000);
    this.poll.unref();
  }
  private tryWatch() {
    if (this.closed || this.watcher) return;
    try {
      const watcher = (this.options.watch ?? watch)(this.sessionsDir, { recursive: true }, () => this.schedule());
      this.watcher = watcher;
      watcher.on("error", () => { watcher.close(); if (this.watcher === watcher) this.watcher = undefined; this.schedule(); });
      watcher.unref();
    } catch { /* sessions 目录尚未创建或平台不支持监听：由 poll 回退和重试。 */ }
  }
  watchProjects(paths: string[]) {
    if (this.closed) return;
    const wanted = new Set(paths);
    for (const [path, listener] of this.projectWatchers) if (!wanted.has(path)) { unwatchFile(path, listener); this.projectWatchers.delete(path); }
    for (const path of wanted) {
      if (this.projectWatchers.has(path)) continue;
      // 历史项目可能位于 macOS 受保护位置。不能为了检测目录失效而同步打开它的父目录：
      // uv_fs_event_start/open 会阻塞整个后台，连 HTTP 健康检查和退出都无法响应。
      // 只异步轮询项目本身的 stat；不枚举父目录，不读取任何项目文件。
      let wasDirectory: boolean | undefined;
      const listener = (current: Stats, previous: Stats) => {
        // watchFile 的文件消失/恢复回调可能给出同一个 previous；自己保留上次存在性。
        const before = wasDirectory ?? previous.isDirectory(); wasDirectory = current.isDirectory();
        if (wasDirectory !== before) this.schedule();
      };
      try { watchFile(path, { persistent: false, interval: this.options.projectPollMs ?? 2000 }, listener); this.projectWatchers.set(path, listener); }
      catch { /* 无法轮询的路径继续由对话目录变化及 15 秒回退刷新。 */ }
    }
  }
  schedule() {
    if (this.closed) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.emit("projects_changed");
      for (const { pi } of this.tracked.values()) void this.check(pi);
    }, this.options.debounceMs ?? 300);
    this.timer.unref();
  }
  state(pi: PiProcess): SyncState | undefined {
    const entry = this.tracked.get(pi);
    return entry ? { sessionPath: entry.path, externalChanged: entry.dirty } : undefined;
  }
  async track(pi: PiProcess, reset = false) {
    const path = pi.sessionFile;
    const old = this.tracked.get(pi);
    if (!path) { this.tracked.delete(pi); return; }
    if (reset || old?.path !== path) this.tracked.set(pi, { pi, path, dirty: false });
    await this.check(pi);
  }
  observe(pi: PiProcess, record: RpcRecord) {
    if (record.type !== "entry_appended") return;
    const entry = record.entry as { id?: string } | undefined;
    if (!entry?.id) return;
    const known = this.authored.get(pi) ?? new Map<string, string>();
    known.set(entry.id, createHash("sha256").update(canonical(entry)).digest("hex"));
    if (known.size > 5000) known.delete(known.keys().next().value!);
    this.authored.set(pi, known);
  }
  release(pi: PiProcess) { this.tracked.delete(pi); this.authored.delete(pi); }
  releaseCwd(cwd: string) { for (const entry of this.tracked.values()) if (entry.pi.cwd === cwd) this.release(entry.pi); }
  async check(pi: PiProcess): Promise<boolean> {
    const entry = this.tracked.get(pi);
    if (!entry || pi.exited) return false;
    if (entry.dirty) return true;
    if (entry.checking) return entry.checking;
    const run = async () => {
      try {
        const disk = await snapshot(entry.path, entry.snapshot);
        if (this.tracked.get(pi) !== entry) return false;
        if (disk === "unchanged") return false;
        if (disk === "unstable") { entry.unstable = true; this.schedule(); return false; }
        entry.unstable = false;
        if (!disk) { if (entry.snapshot) return this.mark(entry); return false; }
        const response = await pi.request({ type: "get_entries" });
        if (this.tracked.get(pi) !== entry) return false;
        if (response.success !== true) return this.mark(entry);
        if (stamp(await stat(entry.path)) !== disk.stamp) { entry.unstable = true; this.schedule(); return false; }
        const data = response.data as { entries?: unknown[] } | undefined;
        const own = new Map((data?.entries ?? []).map((entry: any) => [entry.id, canonical(entry)]));
        // pi 在 switch_session 中先读取目标文件，再执行旧 runtime 的 session_shutdown。
        // 旧插件此时追加的条目可能不在新 runtime 内存里；只接受真实 entry_appended 事件的完整指纹，不能靠时间猜。
        const selfWritten = disk.entries.every((line) => {
          const id = JSON.parse(line).id;
          return own.get(id) === line || this.authored.get(pi)?.get(id) === createHash("sha256").update(line).digest("hex");
        }) && (!entry.snapshot || disk.header === entry.snapshot.header && disk.size >= entry.snapshot.size
          && entry.snapshot.entries.every((line, index) => disk.entries[index] === line));
        if (!selfWritten) return this.mark(entry);
        entry.snapshot = disk;
        return false;
      } catch { return this.tracked.get(pi) === entry && !pi.exited ? this.mark(entry) : false; }
    };
    entry.checking = run();
    try { return await entry.checking; } finally { entry.checking = undefined; }
  }
  private mark(entry: Tracked) {
    if (!entry.dirty) { entry.dirty = true; this.emit("external_changed", entry.pi.cwd, this.state(entry.pi)); }
    return true;
  }
  async assertWritable(pi: PiProcess) {
    if (await this.check(pi)) throw new HttpError(409, EXTERNAL_CHANGE);
    if (this.tracked.get(pi)?.unstable) throw new HttpError(409, "对话文件正在写入，请稍候再发送；不会自动重发消息。");
  }
  close() {
    for (const [path, listener] of this.projectWatchers) unwatchFile(path, listener); this.projectWatchers.clear();
    this.closed = true; clearTimeout(this.timer); clearInterval(this.poll); this.watcher?.close(); this.tracked.clear(); this.authored.clear();
  }
}
