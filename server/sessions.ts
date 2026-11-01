import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// pi 把对话存在 ~/.pi/agent/sessions/<文件夹>/<时间>_<id>.jsonl，第一行是带 cwd 的会话头。
const SESSIONS_DIR = process.env.PI_SESSIONS_DIR ?? join(homedir(), ".pi/agent/sessions");

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
      for (const line of lines) {
        if (!title && line.includes('"role":"user"')) {
          try {
            title = textOf(JSON.parse(line).message?.content).trim().slice(0, 80);
          } catch {}
        }
        // 名字可以改多次，取最后一次。
        if (line.includes('"session_info"')) {
          try {
            name = JSON.parse(line).name || undefined;
          } catch {}
        }
      }
      summary = { path, id: header.id, cwd: header.cwd, title: title || "（空对话）", name, mtime };
    }
  } catch {}
  cache.set(path, { mtime, summary });
  return summary;
}

export async function listProjects(): Promise<Project[]> {
  const byCwd = new Map<string, SessionSummary[]>();
  let dirs: string[] = [];
  try {
    dirs = await readdir(SESSIONS_DIR);
  } catch {
    return [];
  }
  for (const dir of dirs) {
    const full = join(SESSIONS_DIR, dir);
    let files: string[];
    try {
      files = (await readdir(full)).filter((file) => file.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const file of files) {
      const path = join(full, file);
      const info = await stat(path);
      const summary = await summarize(path, info.mtimeMs);
      if (!summary || summary.title === "（空对话）") continue;
      const list = byCwd.get(summary.cwd) ?? [];
      list.push(summary);
      byCwd.set(summary.cwd, list);
    }
  }
  return [...byCwd.entries()]
    .map(([cwd, sessions]) => ({ cwd, sessions: sessions.sort((a, b) => b.mtime - a.mtime) }))
    .sort((a, b) => (b.sessions[0]?.mtime ?? 0) - (a.sessions[0]?.mtime ?? 0));
}
