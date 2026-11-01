import type { Project, RecentProject, SessionSummary, Target } from "./types";
export const RECENTS_KEY = "pi-desk.projects";
export function displayTitle(session: SessionSummary) { return session.name || session.title || "（空对话）"; }
export function readRecents(storage: Storage): RecentProject[] {
  try {
    const rows = JSON.parse(storage.getItem(RECENTS_KEY) ?? "[]");
    return Array.isArray(rows) ? rows.filter((row) => typeof row?.cwd === "string" && row.cwd.startsWith("/") && Number.isFinite(row.openedAt)).slice(0, 20) : [];
  } catch { return []; }
}
export function rememberProject(rows: RecentProject[], cwd: string, now = Date.now()): RecentProject[] {
  return [{ cwd, openedAt: now }, ...rows.filter((row) => row.cwd !== cwd)].slice(0, 20);
}
export function projectGroups(projects: Project[], recents: RecentProject[], current?: Target & { id: string; title: string; name?: string }): Project[] {
  const map = new Map(projects.map((project) => [project.cwd, { cwd: project.cwd, sessions: [...project.sessions] }]));
  for (const recent of recents) if (!map.has(recent.cwd)) map.set(recent.cwd, { cwd: recent.cwd, sessions: [] });
  if (current?.cwd && current.sessionPath && !projects.some((project) => project.sessions.some((session) => session.path === current.sessionPath))) {
    const group = map.get(current.cwd) ?? { cwd: current.cwd, sessions: [] };
    group.sessions.unshift({ cwd: current.cwd, path: current.sessionPath, id: current.id, title: current.title, name: current.name, mtime: 0, virtual: true });
    map.set(current.cwd, group);
  }
  const visits = new Map(recents.map((row) => [row.cwd, row.openedAt]));
  const lastUsed = (project: Project) => Math.max(visits.get(project.cwd) ?? 0, ...project.sessions.map((row) => row.mtime), 0);
  return [...map.values()].map((project) => ({ ...project, sessions: project.sessions.sort((a, b) => Number(!!b.virtual) - Number(!!a.virtual) || b.mtime - a.mtime) }))
    .sort((a, b) => lastUsed(b) - lastUsed(a));
}
export function filterProjects(projects: Project[], query: string): Project[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return projects;
  return projects.flatMap((project) => {
    const sessions = project.cwd.toLocaleLowerCase().includes(needle) ? project.sessions
      : project.sessions.filter((session) => `${session.name ?? ""}\n${session.title}`.toLocaleLowerCase().includes(needle));
    return sessions.length ? [{ ...project, sessions }] : [];
  });
}
