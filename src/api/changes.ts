import type { ChangeIndex, ChangeReview, ChangeScope } from "../../shared/changes";
import { fileRequest } from "./files";
export async function changeIndex(cwd: string, sessionId: string, signal?: AbortSignal): Promise<ChangeIndex> {
  return (await fileRequest(`/api/changes?${new URLSearchParams({ cwd, sessionId })}`, { signal })).json();
}
export async function changeReview(cwd: string, sessionId: string, scope: ChangeScope, turnId?: string, toolId?: string, signal?: AbortSignal): Promise<ChangeReview> {
  return (await fileRequest(`/api/changes/review?${new URLSearchParams({ cwd, sessionId, scope, ...(turnId ? { turnId } : {}), ...(toolId ? { toolId } : {}) })}`, { signal })).json();
}
