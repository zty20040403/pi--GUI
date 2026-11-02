import { todoSnapshot, type ExtensionSessionState, type TodoSnapshot } from "../shared/extensions.js";
export function activeBranch(entries: unknown, leafId: unknown): Record<string, any>[] {
  if (!Array.isArray(entries) || typeof leafId !== "string") return [];
  const byId = new Map<string, Record<string, any>>(); for (const entry of entries) if (entry && typeof entry.id === "string") byId.set(entry.id, entry);
  const branch: Record<string, any>[] = []; const seen = new Set<string>(); let id = leafId;
  while (byId.has(id) && !seen.has(id)) { seen.add(id); const entry = byId.get(id)!; branch.push(entry); id = entry.parentId; }
  return branch.reverse();
}
export function extensionState(entries: unknown, leafId: unknown): ExtensionSessionState {
  let custom: TodoSnapshot | undefined; let tool: TodoSnapshot | undefined; const state: ExtensionSessionState = {};
  for (const entry of activeBranch(entries, leafId)) {
    if (entry.type === "custom" && entry.customType === "rpiv-todo-state") custom = todoSnapshot(entry.data) ?? custom;
    if (entry.type === "message" && entry.message?.role === "toolResult" && entry.message.toolName === "todo") tool = todoSnapshot(entry.message.details) ?? tool;
    if (entry.type === "custom" && entry.customType === "pi-goal-focus" && entry.data?.version === 1 && (typeof entry.data.focusedGoalId === "string" || entry.data.focusedGoalId === null)) state.focusedGoalId = entry.data.focusedGoalId;
  }
  state.todo = custom ?? tool; return state;
}
