export type PermissionMode = "read-only" | "auto" | "full";
export const PERMISSION_LABELS: Record<PermissionMode, string> = { "read-only": "只读", auto: "自动", full: "完全放开" };
export function modeFromStatus(status?: string): PermissionMode | undefined { return (Object.keys(PERMISSION_LABELS) as PermissionMode[]).find((mode) => status === `权限：${PERMISSION_LABELS[mode]}`); }
export type UiRequest = { type: string; id: string; method: string; title?: string; message?: string; options?: string[]; placeholder?: string; prefill?: string; timeout?: number; requestedAt?: number; [key: string]: unknown };
export type UiWidget = { lines: string[]; placement: "aboveEditor" | "belowEditor" };
export type UiSnapshot = { seq: number; dialogs: UiRequest[]; statuses: Record<string, string>; widgets: Record<string, UiWidget>; title?: string; editor?: { id: string; text: string } };
export const emptyUi = (): UiSnapshot => ({ seq: 0, dialogs: [], statuses: Object.create(null), widgets: Object.create(null) });
export type TodoTask = { id: number; subject: string; status: "pending" | "in_progress" | "completed" | "deleted"; description?: string; activeForm?: string; blockedBy?: number[]; owner?: string };
export type TodoSnapshot = { tasks: TodoTask[]; nextId: number };
export type ExtensionSessionState = { todo?: TodoSnapshot; focusedGoalId?: string | null; seq?: number };
export function todoSnapshot(value: unknown): TodoSnapshot | undefined {
  if (!value || typeof value !== "object") return;
  const row = value as Record<string, unknown>;
  if (!Array.isArray(row.tasks) || !Number.isSafeInteger(row.nextId) || !row.tasks.every((task) => task && Number.isSafeInteger(task.id) && typeof task.subject === "string" && ["pending", "in_progress", "completed", "deleted"].includes(task.status)
    && ["description", "activeForm", "owner"].every((key) => task[key] === undefined || typeof task[key] === "string")
    && (task.blockedBy === undefined || Array.isArray(task.blockedBy) && task.blockedBy.every(Number.isSafeInteger))
    && (task.metadata === undefined || task.metadata !== null && typeof task.metadata === "object"))) return;
  return { nextId: row.nextId as number, tasks: row.tasks.map((task) => ({ id: task.id, subject: task.subject, status: task.status,
    ...(typeof task.description === "string" ? { description: task.description } : {}), ...(typeof task.activeForm === "string" ? { activeForm: task.activeForm } : {}),
    ...(typeof task.owner === "string" ? { owner: task.owner } : {}), ...(Array.isArray(task.blockedBy) && task.blockedBy.every(Number.isSafeInteger) ? { blockedBy: [...task.blockedBy] } : {}) })) };
}
export type GoalSummary = { id: string; objective: string; status: string; tokens: number; seconds: number; tasks: { id: string; parentId?: string; title: string; status: string }[] };
