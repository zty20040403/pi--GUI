import { constants } from "node:fs";
import { open, readdir, realpath, stat, type FileHandle } from "node:fs/promises";
import { type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { basename, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { HttpError } from "./http.js";

export const MAX_FILE = 50 * 1024 * 1024;
export const MAX_TEXT = 1024 * 1024;
const HIDDEN = new Set([".git", "node_modules", ".DS_Store", ".pi-desk"]);
const MIME: Record<string, string> = {
  ".md": "text/markdown; charset=utf-8", ".markdown": "text/markdown; charset=utf-8",
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".csv": "text/csv; charset=utf-8", ".tsv": "text/tab-separated-values; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
  ".bmp": "image/bmp", ".ico": "image/x-icon", ".svg": "image/svg+xml", ".pdf": "application/pdf",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".doc": "application/msword", ".xls": "application/vnd.ms-excel", ".ppt": "application/vnd.ms-powerpoint",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
};
const TEXT = new Set(".txt .ts .tsx .jsx .py .yaml .yml .toml .sh .bash .nix .c .h .cpp .hpp .java .go .rs .sql .xml .ini .log .r .rb .swift .svelte .vue .conf .gitignore .env.example".split(" "));
export type FileInfo = { cwd: string; path: string; name: string; size: number; mtime: number; mime: string; binary: boolean; tooLarge: boolean };
type CheckedFile = { path: string; size: number; mtimeMs: number; dev: number; ino: number };
function inside(root: string, path: string) { const rel = relative(root, path); return !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`); }
function expanded(path: string, home: string) { return path === "~" ? home : path.startsWith("~/") ? resolve(home, path.slice(2)) : path; }
export function fileMime(path: string) {
  const extension = extname(path).toLowerCase();
  return MIME[extension] ?? (TEXT.has(extension) || TEXT.has(basename(path)) ? "text/plain; charset=utf-8" : "application/octet-stream");
}
export function byteRange(range: string | undefined, size: number): { start: number; end: number } | undefined {
  if (!range) return;
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || !size || !match[1] && !match[2]) throw new HttpError(416, "不支持这个字节范围");
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] ? match[2] ? Math.min(size - 1, Number(match[2])) : size - 1 : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size || !match[1] && Number(match[2]) === 0) throw new HttpError(416, "字节范围超出文件");
  return { start, end };
}
async function handleFor(file: CheckedFile): Promise<FileHandle> {
  const handle = await open(file.path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const actual = await handle.stat();
    if (!actual.isFile() || actual.dev !== file.dev || actual.ino !== file.ino || actual.size !== file.size || actual.mtimeMs !== file.mtimeMs) throw new HttpError(409, "文件刚发生变化，请刷新后重试");
    return handle;
  } catch (error) { await handle.close(); throw error; }
}
// 使用已校验的同一个文件句柄，HEAD/Range/中断也必须回收，不能重新跟随路径。
export async function serveFile(req: IncomingMessage, res: ServerResponse, file: CheckedFile, mime = fileMime(file.path)) {
  if (file.size > MAX_FILE) throw new HttpError(413, "文件超过 50 MB，请用默认软件打开");
  res.setHeader("X-File-Size", file.size); res.setHeader("X-File-Mtime", file.mtimeMs);
  res.setHeader("Accept-Ranges", "bytes"); res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", mime); res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:");
  res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(basename(file.path))}`);
  let range: ReturnType<typeof byteRange>;
  try { range = byteRange(req.headers.range, file.size); } catch (error) { res.setHeader("Content-Range", `bytes */${file.size}`); throw error; }
  const handle = await handleFor(file);
  if (range) { res.statusCode = 206; res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${file.size}`); }
  res.setHeader("Content-Length", range ? range.end - range.start + 1 : file.size);
  if (req.method === "HEAD") { await handle.close(); res.end(); return; }
  const stream = handle.createReadStream({ ...(range ?? {}), autoClose: true });
  try { await pipeline(stream, res); } catch (error) { if (!res.destroyed) throw error; }
}

export class FileService {
  private readonly roots = new Set<string>();
  private readonly protected: string[];
  private readonly ready: Promise<void>;
  constructor(private readonly home = homedir()) {
    this.protected = [".ssh", ".gnupg", ".pi/agent", ".config/sops", ".config/cortexkit", ".local/share/pi-agent", ".aws", ".azure", ".docker"].map((path) => resolve(home, path));
    this.ready = Promise.all([...this.protected].map(async (path) => {
      try { const canonical = await realpath(path); if (!this.protected.includes(canonical)) this.protected.push(canonical); } catch {}
    })).then(() => {});
  }
  register(cwd: string) { this.roots.add(cwd); }
  private sensitive(path: string) {
    return this.protected.some((root) => inside(root, path)) || path.split(sep).some((part) => part === ".env" || part.startsWith(".env.") || [".netrc", ".npmrc", ".pypirc", ".git-credentials"].includes(part));
  }
  async resolvePath(cwd: unknown, requested: unknown, directory = false) {
    await this.ready;
    if (typeof requested !== "string" || !requested || requested.length > 4096 || requested.includes("\0")) throw new HttpError(400, "缺少有效文件路径");
    const input = expanded(requested, this.home);
    if (isAbsolute(input) && this.sensitive(resolve(input))) throw new HttpError(403, "不允许访问敏感路径");
    if (typeof cwd !== "string" || !isAbsolute(cwd)) throw new HttpError(400, "缺少项目绝对路径 cwd");
    let root: string;
    try { root = await realpath(cwd); } catch { throw new HttpError(404, "项目目录已不存在"); }
    if (!this.roots.has(root)) throw new HttpError(403, "请先打开这个项目，再预览其中的文件");
    const candidate = resolve(root, input);
    if (!inside(root, candidate) || this.sensitive(candidate)) throw new HttpError(403, "文件不在项目内或属于敏感路径");
    let path: string;
    try { path = await realpath(candidate); } catch { throw new HttpError(404, "文件或目录不存在"); }
    if (!inside(root, path) || this.sensitive(path)) throw new HttpError(403, "软链接指向项目外或敏感路径");
    const info = await stat(path);
    if (directory ? !info.isDirectory() : !info.isFile()) throw new HttpError(400, directory ? "这不是文件夹" : "只能预览普通文件");
    return { root, path, stat: info };
  }
  async checked(cwd: unknown, path: unknown) {
    const file = await this.resolvePath(cwd, path);
    return { ...file, size: file.stat.size, mtimeMs: file.stat.mtimeMs, dev: file.stat.dev, ino: file.stat.ino };
  }
  async info(cwd: unknown, path: unknown): Promise<FileInfo> {
    const file = await this.checked(cwd, path);
    let binary = false;
    if (file.size <= MAX_FILE) {
      const handle = await handleFor(file);
      try { const buffer = Buffer.alloc(Math.min(file.size, 8192)); const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0); binary = buffer.subarray(0, bytesRead).includes(0); }
      finally { await handle.close(); }
    }
    return { cwd: file.root, path: file.path, name: basename(file.path), size: file.size, mtime: file.mtimeMs, mime: fileMime(file.path), binary, tooLarge: file.size > MAX_FILE };
  }
  async tree(cwd: unknown, dir: unknown = ".") {
    const folder = await this.resolvePath(cwd, dir, true);
    const names = (await readdir(folder.path)).filter((name) => !HIDDEN.has(name)).sort((a, b) => a.localeCompare(b));
    const entries: { name: string; path: string; kind: "directory" | "file"; symlink: boolean }[] = [];
    for (const name of names.slice(0, 5000)) {
      const original = resolve(folder.path, name);
      if (this.sensitive(original)) continue;
      try {
        const path = await realpath(original);
        if (!inside(folder.root, path) || this.sensitive(path)) continue;
        const info = await stat(path);
        if (!info.isFile() && !info.isDirectory()) continue;
        // 不把指回祖先的目录链接画成能无限展开的树。
        if (info.isDirectory() && path !== original && inside(path, folder.path)) continue;
        entries.push({ name, path, kind: info.isDirectory() ? "directory" : "file", symlink: original !== path });
      } catch {} // 被删除、无权限或坏链接的单个条目不影响整棵树。
    }
    entries.sort((a, b) => Number(b.kind === "directory") - Number(a.kind === "directory") || a.name.localeCompare(b.name));
    return { cwd: folder.root, dir: folder.path, entries, truncated: names.length > 5000 };
  }
}
