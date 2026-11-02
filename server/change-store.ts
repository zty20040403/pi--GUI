import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import { FileService } from "./files.js";
import { changePath } from "./change-files.js";
import { CHANGE_FILE_LIMIT, summarizeTurn, type ChangeTurn, type FileSnapshot, type TurnSummary } from "../shared/changes.js";

export const validChangeId = (id: unknown): id is string => typeof id === "string" && /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]{0,126}[a-zA-Z0-9])?$/.test(id);
export const changesDirectory = () => join(dirname(process.env.PI_DESK_APP_SETTINGS_FILE ?? join(process.env.PI_DESK_DATA_DIR ?? join(homedir(), ".pi-desk"), "settings.json")), "changes");
export const TURN_CONTENT_LIMIT = 12 * 1024 * 1024;
const FILE_LIMIT = 48 * 1024 * 1024;
function snapshot(value: any): value is FileSnapshot {
  if (!value || typeof value !== "object") return false;
  if (value.kind === "missing") return true;
  if (value.kind === "omitted") return ["large", "binary", "unreadable", "budget"].includes(value.reason) && (value.fingerprint === undefined || typeof value.fingerprint === "string" && value.fingerprint.length <= 256);
  return value.kind === "text" && typeof value.text === "string" && Buffer.byteLength(value.text) <= CHANGE_FILE_LIMIT && typeof value.fingerprint === "string" && /^[a-f0-9]{64}$/.test(value.fingerprint);
}
function validTurn(value: any): value is ChangeTurn {
  return value?.version === 1 && validChangeId(value.id) && validChangeId(value.sessionId) && typeof value.cwd === "string" && isAbsolute(value.cwd) && Number.isFinite(value.startedAt)
    && ["running", "completed", "aborted", "interrupted"].includes(value.status) && Array.isArray(value.warnings) && value.warnings.length <= 16 && value.warnings.every((s: unknown) => typeof s === "string" && s.length <= 1000)
    && (value.anchorId === undefined || typeof value.anchorId === "string" && value.anchorId.length <= 256) && (value.assistantTimestamp === undefined || Number.isFinite(value.assistantTimestamp))
    && Array.isArray(value.calls) && value.calls.length <= 256 && value.calls.every((call: any) => typeof call?.id === "string" && call.id.length <= 2048 && changePath(call.path) && ["edit", "write"].includes(call.tool) && Number.isFinite(call.order) && (call.finished === undefined || Number.isFinite(call.finished)) && snapshot(call.before) && snapshot(call.after));
}
export class ChangeStore {
  constructor(readonly root = changesDirectory()) {}
  private async directory(sessionId: string, create = false) {
    if (!validChangeId(sessionId)) throw new Error("对话标识无效");
    const guard = new FileService(); const root = resolve(this.root); await guard.refuseSensitive(root);
    let ancestor = root; const missing: string[] = [];
    while (true) {
      try { const actual = await realpath(ancestor); await guard.refuseSensitive(resolve(actual, ...missing.reverse())); break; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; missing.push(ancestor.slice(dirname(ancestor).length + 1)); ancestor = dirname(ancestor); }
    }
    if (create) await mkdir(root, { recursive: true, mode: 0o700 });
    if ((await lstat(root)).isSymbolicLink()) throw new Error("改动记录目录不能是符号链接");
    const folder = join(root, sessionId);
    if (create) await mkdir(folder, { recursive: true, mode: 0o700 });
    const info = await lstat(folder); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("改动记录目录无效");
    return folder;
  }
  async save(turn: ChangeTurn) {
    if (!validTurn(turn)) throw new Error("改动快照格式不正确");
    const folder = await this.directory(turn.sessionId, true); const text = JSON.stringify(turn);
    if (Buffer.byteLength(text) > FILE_LIMIT) throw new Error("本轮改动快照超过保存上限");
    const temporary = join(folder, `.pending-${randomUUID()}`);
    await writeFile(temporary, text, { flag: "wx", mode: 0o600 }); const target = join(folder, `${turn.id}.json`); await rename(temporary, target);
    const info = await lstat(target); const index = JSON.stringify({ identity: `${info.ino}:${info.size}:${info.mtimeMs}`, summary: summarizeTurn(turn) });
    const summaryTemporary = join(folder, `.pending-${randomUUID()}`); await writeFile(summaryTemporary, index, { flag: "wx", mode: 0o600 }); await rename(summaryTemporary, join(folder, `${turn.id}.summary.json`));
  }
  async read(sessionId: string, turnId: string): Promise<ChangeTurn | undefined> {
    if (!validChangeId(turnId)) throw new Error("轮次标识无效");
    try {
      const path = join(await this.directory(sessionId), `${turnId}.json`); const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const info = await file.stat(); if (!info.isFile() || info.size > FILE_LIMIT) throw new Error("改动记录不是普通文件或超过读取上限");
        const bytes = Buffer.alloc(info.size + 1); let length = 0;
        for (;;) { const { bytesRead } = await file.read(bytes, length, bytes.length - length, length); length += bytesRead; if (!bytesRead || length === bytes.length) break; }
        if (length !== info.size || (await file.stat()).mtimeMs !== info.mtimeMs) throw new Error("改动记录正在变化，请刷新");
        const value = JSON.parse(bytes.subarray(0, length).toString("utf8"));
        if (!validTurn(value) || value.sessionId !== sessionId || value.id !== turnId) throw new Error("改动记录损坏，未使用不完整数据");
        return value;
      } finally { await file.close(); }
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  }
  async summaries(sessionId: string): Promise<TurnSummary[]> {
    let folder: string;
    try { folder = await this.directory(sessionId); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    const names = (await readdir(folder)).filter((name) => name.endsWith(".json") && !name.endsWith(".summary.json"));
    if (names.length > 2000) throw new Error("对话改动轮次超过 2000，未把截断结果当成完整历史");
    const summaries: TurnSummary[] = [];
    for (const name of names) {
      const id = name.slice(0, -5); if (!validChangeId(id)) continue;
      const info = await lstat(join(folder, name)); if (!info.isFile() || info.isSymbolicLink()) throw new Error("改动记录不是普通文件");
      let summary: TurnSummary | undefined;
      try {
        const file = await open(join(folder, `${id}.summary.json`), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
          const indexInfo = await file.stat(); if (!indexInfo.isFile() || indexInfo.size > 1024 * 1024) throw new Error("改动索引无效");
          const buffer = Buffer.alloc(indexInfo.size + 1); const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
          const index = JSON.parse(buffer.subarray(0, bytesRead).toString("utf8")); const row = index.summary;
          if (index.identity === `${info.ino}:${info.size}:${info.mtimeMs}` && validTurn({ ...row, cwd: "/", calls: [] }) && row.sessionId === sessionId && row.id === id && Array.isArray(row.files) && row.files.length <= 256 && row.files.every((f: any) => changePath(f.path) && ["added", "deleted", "modified"].includes(f.kind)) && Array.isArray(row.tools) && row.tools.length <= 256) summary = row;
        } finally { await file.close(); }
      } catch { /* 索引丢失或写入中断时从同一轮原始记录重建，不替换成其他轮次。 */ }
      if (!summary) { const record = await this.read(sessionId, id); if (record) summary = summarizeTurn(record); }
      if (summary) summaries.push(summary);
    }
    return summaries.sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
  }
  async list(sessionId: string): Promise<ChangeTurn[]> {
    let names: string[];
    try { names = await readdir(await this.directory(sessionId)); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    names = names.filter((name) => name.endsWith(".json") && !name.endsWith(".summary.json"));
    if (names.length > 2000) throw new Error("对话改动记录过多，请先归档后再查看；没有截断成完整结果");
    const turns: ChangeTurn[] = []; let total = 0;
    for (const name of names.filter((name) => name.endsWith(".json"))) {
      const turn = await this.read(sessionId, name.slice(0, -5)); if (!turn) continue;
      total += turn.calls.reduce((n, call) => n + (call.before.kind === "text" ? Buffer.byteLength(call.before.text) : 0) + (call.after.kind === "text" ? Buffer.byteLength(call.after.text) : 0), 0);
      if (total > 64 * 1024 * 1024) throw new Error("对话快照内容过多，请按轮次查看；没有静默丢弃历史改动");
      turns.push(turn);
    }
    return turns.sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
  }
}
