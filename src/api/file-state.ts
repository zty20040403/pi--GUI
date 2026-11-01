import type { FileInfo } from "./files";
export type FileProject = { tabs: FileInfo[]; active: string; changed: Record<string, boolean>; versions: Record<string, number>; treeVersion: number };
export type FileState = Record<string, FileProject>;
export type FileAction = { type: "open" | "refresh"; file: FileInfo; force?: boolean; changed?: boolean }
  | { type: "select" | "close"; cwd: string; path: string } | { type: "tree"; cwd: string };
export const emptyFileProject = (): FileProject => ({ tabs: [], active: "tree", changed: {}, versions: {}, treeVersion: 0 });
export function fileReducer(state: FileState, action: FileAction): FileState {
  const cwd = "file" in action ? action.file.cwd : action.cwd;
  const project = state[cwd] ?? emptyFileProject(); let next = { ...project };
  if (action.type === "open") {
    const exists = project.tabs.find((file) => file.path === action.file.path);
    next.tabs = exists ? project.tabs.map((file) => file.path === action.file.path ? action.file : file) : [...project.tabs, action.file];
    next.active = action.file.path;
  }
  if (action.type === "select") next.active = action.path;
  if (action.type === "close") {
    next.tabs = project.tabs.filter((file) => file.path !== action.path);
    if (next.active === action.path) next.active = next.tabs.at(-1)?.path ?? "tree";
  }
  if (action.type === "tree") next.treeVersion++;
  if (action.type === "refresh") {
    const prior = project.tabs.find((file) => file.path === action.file.path);
    const different = prior?.mtime !== action.file.mtime || prior?.size !== action.file.size;
    if (!different && !action.force && !action.changed) return state;
    if (prior) next.tabs = project.tabs.map((file) => file.path === action.file.path ? action.file : file);
    next.versions = { ...project.versions, [action.file.path]: (project.versions[action.file.path] ?? 0) + 1 };
    next.treeVersion++;
    if (action.changed) next.changed = { ...project.changed, [action.file.path]: true };
  }
  return { ...state, [cwd]: next };
}
export function readFileTabs(storage: Storage): FileState {
  try {
    const parsed = JSON.parse(storage.getItem("pi-desk.file-tabs") ?? "{}"); const state: FileState = {};
    for (const [cwd, value] of Object.entries(parsed)) {
      const project = value as FileProject;
      if (!cwd.startsWith("/") || !Array.isArray(project?.tabs)) continue;
      const tabs = project.tabs.filter((file) => file?.cwd === cwd && typeof file.path === "string" && file.path.startsWith("/") && typeof file.name === "string" && Number.isFinite(file.size) && Number.isFinite(file.mtime));
      state[cwd] = { ...emptyFileProject(), tabs, active: tabs.some((file) => file.path === project.active) ? project.active : "tree" };
    }
    return state;
  } catch { return {}; }
}
