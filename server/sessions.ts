import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";

// pi 把对话存在 ~/.pi/agent/sessions/<文件夹>/<时间>_<id>.jsonl，第一行是带 cwd 的会话头。
export const SESSIONS_DIR = process.env.PI_SESSIONS_DIR ?? join(homedir(), ".pi/agent/sessions");

export type SessionSummary = { path: string; id: string; cwd: string; title: string; name?: string; mtime: number };
export type Project = { cwd: string; sessions: SessionSummary[] };

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

export async function listProjects(sessionsDir = SESSIONS_DIR): Promise<Project[]> {
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
        const summary = await summarize(path, info.mtimeMs);
        if (!summary) continue;
        const list = byCwd.get(summary.cwd) ?? [];
        list.push(summary);
        byCwd.set(summary.cwd, list);
      } catch {} // 文件可能被终端移走，不能让整个列表返回 500。
    }
  }
  return [...byCwd.entries()]
    .map(([cwd, sessions]) => ({ cwd, sessions: sessions.sort((a, b) => b.mtime - a.mtime) }))
    .sort((a, b) => (b.sessions[0]?.mtime ?? 0) - (a.sessions[0]?.mtime ?? 0));
}

// 只能打开 pi 的对话文件，且它必须属于这个项目，不能拿任意路径当对话读取。
export async function checkSessionPath(cwd: string, sessionPath: string, sessionsDir = SESSIONS_DIR): Promise<string> {
  if (!isAbsolute(sessionPath)) throw new Error("对话路径必须是绝对路径");
  const root = await realpath(sessionsDir);
  const path = await realpath(sessionPath);
  const rel = relative(root, path);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel) || !path.endsWith(".jsonl")) {
    throw new Error("只能打开 pi 保存的对话");
  }
  const header = JSON.parse((await readFile(path, "utf8")).split("\n", 1)[0]);
  if (header.type !== "session" || typeof header.cwd !== "string" || await realpath(header.cwd) !== cwd) {
    throw new Error("这个对话不属于所选项目");
  }
  return path;
}
