import { TOKEN_KEY } from "./storage";
import { DeskError } from "../../shared/errors";
export const MAX_UPLOAD = 50 * 1024 * 1024;
export const MAX_ATTACHMENTS = 12;
export const PATH_DRAG_TYPE = "application/x-pi-desk-path";
export type AttachmentRef = { kind: "upload" | "path"; path: string };
export type UploadedFile = { cwd: string; path: string; name: string; size: number; mime: string; image: boolean };
export type Attachment = { id: string; kind: "upload" | "path"; name: string; path?: string; cwd: string; size: number; status: "uploading" | "ready" | "error"; image?: boolean; preview?: string; error?: string };
export const attachmentScope = (cwd: string, id?: string) => `${cwd}:${id ?? "new"}`;
export function attachmentRefs(items: Attachment[]): AttachmentRef[] {
  return items.filter((item) => item.status === "ready" && item.path).map((item) => ({ kind: item.kind, path: item.path! }));
}
export function shortPath(cwd: string, path: string) { const prefix = `${cwd.replace(/\/$/, "")}/`; return path.startsWith(prefix) ? path.slice(prefix.length) : path; }
export function treeDrag(raw: string, cwd: string): { cwd: string; path: string; name: string } | undefined {
  try { const value = JSON.parse(raw); const prefix = `${cwd.replace(/\/$/, "")}/`; if (value.cwd === cwd && typeof value.path === "string" && value.path.startsWith(prefix) && !value.path.slice(prefix.length).split("/").includes("..") && typeof value.name === "string" && !value.path.includes("\0")) return value; } catch {}
}
export async function uploadFile(cwd: string, file: File, signal: AbortSignal): Promise<UploadedFile> {
  if (file.size > MAX_UPLOAD) throw new Error("单个文件不能超过 50 MB");
  const response = await fetch(`/api/upload?${new URLSearchParams({ cwd, name: file.name || "clipboard.png" })}`, { method: "POST", headers: { Authorization: `Bearer ${sessionStorage.getItem(TOKEN_KEY) ?? ""}` }, body: file, signal });
  if (!response.ok) { let detail: { error?: string; errorDetails?: string } = {}; try { detail = await response.json(); } catch {} throw new DeskError({ message: detail.error ?? `上传失败（${response.status}）`, details: detail.errorDetails }); }
  return response.json();
}
