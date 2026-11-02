import { TOKEN_KEY } from "./storage";
import { DeskError } from "../../shared/errors";
import { desktopBridge } from "./desktop";
export const TEXT_LIMIT = 1024 * 1024;
export type FileInfo = { cwd: string; path: string; name: string; size: number; mtime: number; mime: string; binary: boolean; tooLarge: boolean };
export type TreeEntry = { name: string; path: string; kind: "file" | "directory"; symlink: boolean };
export type TreeResult = { cwd: string; dir: string; entries: TreeEntry[]; truncated: boolean };
export type PreviewKind = "markdown" | "code" | "image" | "pdf" | "html" | "csv" | "xlsx" | "docx" | "office" | "media" | "binary" | "large";
export type PreviewProps = { file: FileInfo; version: number };
export function previewKind(file: FileInfo): PreviewKind {
  if (file.tooLarge) return "large";
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg"].includes(extension ?? "")) return "image";
  if (extension === "pdf") return "pdf";
  if (extension === "xlsx" || extension === "docx") return extension;
  if (["pptx", "ppt", "doc", "xls"].includes(extension ?? "")) return "office";
  if (["mp3", "wav", "m4a", "mp4", "webm", "mov"].includes(extension ?? "")) return "media";
  if (file.binary) return "binary";
  if (["md", "markdown"].includes(extension ?? "")) return "markdown";
  if (["html", "htm"].includes(extension ?? "")) return "html";
  if (["csv", "tsv"].includes(extension ?? "")) return "csv";
  return "code";
}
export function fileUrl(api: string, cwd: string, path: string) { return `/api/${api}?${new URLSearchParams({ cwd, path })}`; }
export function authHeaders() {
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (!token) throw new Error("口令失效，请重新打开后台打印的完整网址");
  return { Authorization: `Bearer ${token}` };
}
export async function fileRequest(url: string, options: RequestInit = {}) {
  const response = await fetch(url, { ...options, headers: { ...authHeaders(), ...options.headers } });
  if (!response.ok) {
    let detail: { error?: string; errorDetails?: string } = {};
    try { detail = await response.json(); } catch {}
    throw new DeskError({ message: response.status === 401 ? "口令失效，请用后台本次打印的网址重新打开" : detail.error ?? `文件请求失败（${response.status}）`, details: detail.errorDetails });
  }
  return response;
}
export async function fileInfo(cwd: string, path: string, signal?: AbortSignal): Promise<FileInfo> { return (await fileRequest(fileUrl("file-info", cwd, path), { signal })).json(); }
export async function fileTree(cwd: string, dir: string, signal?: AbortSignal): Promise<TreeResult> { return (await fileRequest(`/api/tree?${new URLSearchParams({ cwd, dir })}`, { signal })).json(); }
export async function fileBlob(file: FileInfo, signal?: AbortSignal, api = "file", textLimit = false) {
  const response = await fileRequest(fileUrl(api, file.cwd, file.path), { signal, ...(textLimit && file.size > TEXT_LIMIT ? { headers: { Range: `bytes=0-${TEXT_LIMIT - 1}` } } : {}) });
  return response.blob();
}
export async function systemOpen(file: FileInfo, reveal: boolean) {
  const desktop = desktopBridge();
  if (reveal && desktop) { await desktop.reveal(file.cwd, file.path); return; }
  await fileRequest(reveal ? "/api/reveal" : "/api/open", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd: file.cwd, path: file.path }) });
}
export function localPath(cwd: string, document: string | undefined, source: string): string {
  const base = new URL("file:///");
  const directory = document ? document.slice(0, document.lastIndexOf("/") + 1) : `${cwd.replace(/\/$/, "")}/`;
  base.pathname = directory.replace(/%/g, "%25");
  const target = new URL(source, base);
  if (target.protocol !== "file:" || target.hostname) throw new Error("这不是本地文件路径");
  return decodeURIComponent(target.pathname);
}
const LANG: Record<string, string> = { ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", mjs: "javascript", cjs: "javascript", py: "python", yml: "yaml", sh: "bash", txt: "text", h: "c", hpp: "cpp", rs: "rust", md: "markdown", rb: "ruby", conf: "ini", log: "text" };
export function languageOf(path: string) { const name = path.split("/").at(-1) ?? ""; if (name === "Dockerfile") return "dockerfile"; const ext = name.split(".").at(-1)?.toLowerCase() ?? "text"; return LANG[ext] ?? ext; }
export function fileSize(size: number) { return size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : size >= 1024 ? `${(size / 1024).toFixed(1)} KB` : `${size} B`; }
