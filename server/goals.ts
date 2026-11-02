import { constants } from "node:fs";
import { open, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { GoalSummary } from "../shared/extensions.js";
import { FileService } from "./files.js";
import { HttpError } from "./http.js";
export function leadingObject(text: string): Record<string, any> | undefined {
  const source = text.trimStart().replace(/^```(?:json)?\s*\n/, ""); if (!source.startsWith("{")) return;
  let depth = 0; let quoted = false; let escaped = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) { if (escaped) escaped = false; else if (char === "\\") escaped = true; else if (char === '"') quoted = false; }
    else if (char === '"') quoted = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) { try { return JSON.parse(source.slice(0, index + 1)); } catch { return; } }
  }
}
export async function projectGoals(files: FileService, cwd: unknown): Promise<GoalSummary[]> {
  await files.resolvePath(cwd, ".", true); // 没有目标文件也必须验证项目确实已打开。
  let folder: Awaited<ReturnType<FileService["resolvePath"]>>;
  try { folder = await files.resolvePath(cwd, ".pi/goals", true); } catch (error) { if (error instanceof HttpError && error.status === 404) return []; throw error; }
  const names = (await readdir(folder.path)).filter((name) => /^active_goal_[^/]+\.md$/.test(name)).slice(0, 100); const goals: GoalSummary[] = [];
  for (const name of names) {
    try {
      const file = await files.checked(cwd, join(folder.path, name)); if (file.size > 2 * 1024 * 1024) continue;
      const handle = await open(file.path, constants.O_RDONLY | constants.O_NOFOLLOW); let source: string;
      try { const stat = await handle.stat(); if (stat.ino !== file.ino || stat.dev !== file.dev || stat.size !== file.size || !stat.isFile()) continue; source = await handle.readFile("utf8"); } finally { await handle.close(); }
      const goal = leadingObject(source); if (!goal || typeof goal.id !== "string" || typeof goal.objective !== "string" || typeof goal.status !== "string" || goal.status === "complete") continue;
      const rawTasks = goal.taskList?.tasks; const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
      goals.push({ id: goal.id, objective: goal.objective, status: goal.status, tokens: number(goal.usage?.tokensUsed), seconds: number(goal.usage?.activeSeconds),
        tasks: Array.isArray(rawTasks) ? rawTasks.filter((task) => task && typeof task.id === "string" && typeof task.title === "string" && typeof task.status === "string").map((task) => ({ id: task.id, title: task.title, status: task.status, ...(typeof task.parentId === "string" ? { parentId: task.parentId } : {}) })) : [] });
    } catch {} // 单个坏文件、刚改名的文件不会让整个目标面板失效。
  }
  return goals;
}
