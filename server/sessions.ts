import { lstat, open, readdir, readFile, realpath, stat } from "node:fs/promises";
import { HttpError } from "./http.js";
import { mappedCwd, type ProjectMappings } from "../shared/project-mapping.js";
import { homedir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";

// pi 把对话存在 ~/.pi/agent/sessions/<文件夹>/<时间>_<id>.jsonl，第一行是带 cwd 的会话头。
export const SESSIONS_DIR = process.env.PI_SESSIONS_DIR ?? join(homedir(), ".pi/agent/sessions");

export type SessionSummary = { path: string; id: string; cwd: string; originalCwd?: string; title: string; name?: string; mtime: number };
export type Project = { cwd: string; sessions: SessionSummary[]; missing?: true };

const cache = new Map<string, { mtime: number; summary: SessionSummary | null }>();

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type: string; text: string } => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join(" ");
}

async function summarize(path: string, mtime: number): Promise<SessionSummary | null> {
  const hit = cache.get(path);
  if (hit && hit.mtime === mtime) return hit.summary;
  let summary: SessionSummary | null = null;
  try {
    const lines = (await readFile(path, "utf8")).split("\n");
    const header = JSON.parse(lines[0] ?? "{}");
    if (header.type === "session" && typeof header.cwd === "string") {
      let title = "";
      let name: string | undefined;
      for (const line of lines.slice(1)) {
        try {
          const entry = JSON.parse(line);
          if (!title && entry.type === "message" && entry.message?.role === "user") {
            title = textOf(entry.message.content).trim().slice(0, 80);
          }
          // 名字可以改多次，取最后一次；只认 session_info 条目。
          if (entry.type === "session_info") name = typeof entry.name === "string" ? entry.name || undefined : undefined;
        } catch {} // 正在写入的半行不影响其他对话。
      }
      if (typeof header.id === "string") {
        summary = { path, id: header.id, cwd: header.cwd, title: title || "（空对话）", name, mtime };
      }
    }
  } catch {}
  cache.set(path, { mtime, summary });
  return summary;
}

export async function listProjects(sessionsDir = SESSIONS_DIR, mappings: ProjectMappings = {}): Promise<Project[]> {
  const byCwd = new Map<string, SessionSummary[]>();
  let dirs: string[] = [];
  try {
    dirs = await readdir(sessionsDir);
  } catch {
    return [];
  }
  for (const dir of dirs) {
    const full = join(sessionsDir, dir);
    let files: string[];
    try {
      files = (await readdir(full)).filter((file) => file.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const file of files) {
      const path = join(full, file);
      try {
        const info = await stat(path);
        if (!info.isFile()) continue;
        if (info.size > 50 * 1024 * 1024) continue;
        const raw = await summarize(path, info.mtimeMs);
        if (!raw) continue;
        let cwd = mappedCwd(raw.cwd, mappings);
        if (cwd !== raw.cwd) { try { cwd = await realpath(cwd); } catch {} }
        const summary = cwd === raw.cwd ? raw : { ...raw, cwd, originalCwd: raw.cwd };
        const list = byCwd.get(cwd) ?? [];
        list.push(summary);
        byCwd.set(cwd, list);
      } catch {} // 文件可能被终端移走，不能让整个列表返回 500。
    }
  }
  // 项目文件夹被删掉或移走时标出来，列表里能提前看到，不用点了才报错。
  const projects: Project[] = [];
  for (const [cwd, sessions] of byCwd) {
    let missing = false;
    try { missing = !(await stat(cwd)).isDirectory(); } catch { missing = true; }
    projects.push({ cwd, sessions: sessions.sort((a, b) => b.mtime - a.mtime), ...(missing ? { missing: true as const } : {}) });
  }
  return projects.sort((a, b) => (b.sessions[0]?.mtime ?? 0) - (a.sessions[0]?.mtime ?? 0));
}

// 删除旧项目的对话不要求项目目录仍存在；只信任 sessions 内的普通 JSONL 文件。
export async function savedSession(sessionPath: unknown, sessionsDir = SESSIONS_DIR): Promise<{ path: string; cwd: string; id: string }> {
  if (typeof sessionPath !== "string" || !isAbsolute(sessionPath) || sessionPath.includes("\0")) throw new HttpError(400, "对话路径必须是绝对路径");
  try {
    const root = await realpath(sessionsDir);
    const path = await realpath(sessionPath);
    const rel = relative(root, path);
    if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel) || !path.endsWith(".jsonl")) throw new HttpError(403, "只能打开 pi 保存的对话");
    const info = await lstat(sessionPath);
    if (!info.isFile() || info.isSymbolicLink()) throw new HttpError(403, "只能操作普通对话文件，不允许软链接");
    const file = await open(path, "r");
    let header;
    try {
      const buffer = Buffer.alloc(64 * 1024);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      header = JSON.parse(buffer.subarray(0, bytesRead).toString("utf8").split("\n", 1)[0]);
    } finally { await file.close(); }
    if (header.type !== "session" || typeof header.cwd !== "string" || typeof header.id !== "string") throw new HttpError(400, "这不是有效的 pi 对话");
    return { path, cwd: header.cwd, id: header.id };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new HttpError(404, "对话文件不存在，可能已被移走");
    throw new HttpError(400, "无法读取有效的 pi 对话");
  }
}

export function invalidateSession(path: string) { cache.delete(path); }

// 打开时还要确认属于此项目；不把其他文件当对话读。
export async function checkSessionPath(cwd: string, sessionPath: string, sessionsDir = SESSIONS_DIR, mappings: ProjectMappings = {}): Promise<string> {
  const session = await savedSession(sessionPath, sessionsDir);
  if (await realpath(mappedCwd(session.cwd, mappings)) !== cwd) throw new HttpError(400, "这个对话不属于所选项目");
  return session.path;
}
