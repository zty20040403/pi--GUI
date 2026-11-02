import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, type FileHandle } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { FileService, MAX_FILE, fileMime } from "./files.js";
import { HttpError } from "./http.js";
const exec = promisify(execFile);
export type AttachmentRef = { kind: "upload" | "path"; path: string };
export type UploadedFile = { cwd: string; path: string; name: string; size: number; mime: string; image: boolean };
export function uploadName(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value) > 220 || /[\/\\\x00-\x1f\x7f]/.test(value) || [".", ".."].includes(value)) throw new HttpError(400, "文件名无效，请使用普通文件名");
  return value.normalize("NFC");
}
export function imageMime(buffer: Uint8Array): string | undefined {
  const bytes = Buffer.from(buffer);
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return undefined;
}
async function plainDirectory(path: string) {
  try { await mkdir(path, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== path) throw new HttpError(403, "上传和 Git 排除目录不能使用软链接");
}
export class UploadService {
  private readonly exclusions = new Map<string, Promise<void>>();
  constructor(private readonly files: FileService, private readonly trash = async (path: string) => { await exec("trash", [path]); }) {}
  private async exclude(cwd: string) {
    let top: string; let git: string; let common: string;
    try {
      top = (await exec("git", ["rev-parse", "--show-toplevel"], { cwd, timeout: 5000 })).stdout.trim();
      git = (await exec("git", ["rev-parse", "--absolute-git-dir"], { cwd, timeout: 5000 })).stdout.trim();
      common = resolve(cwd, (await exec("git", ["rev-parse", "--git-common-dir"], { cwd, timeout: 5000 })).stdout.trim());
    } catch { return; } // 普通非 Git 文件夹不需要排除配置。
    top = await realpath(top);
    const rel = relative(top, cwd); const worktree = relative(join(common, "worktrees"), git);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel) || basename(common) !== ".git" || await realpath(common) !== common || await realpath(git) !== git || git !== common && (worktree === ".." || worktree.startsWith(`..${sep}`) || isAbsolute(worktree))) throw new HttpError(403, "无法安全配置这个 Git 目录的上传排除");
    await this.files.refuseSensitive(common);
    // worktree 由 Git 指向所属仓库的共享 info/exclude；普通子目录也沿用所属仓库。
    const file = join(common, "info", "exclude");
    const operation = (this.exclusions.get(file) ?? Promise.resolve()).catch(() => {}).then(async () => {
      await plainDirectory(join(common, "info"));
      const handle = await open(file, constants.O_RDWR | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW, 0o600);
      try {
        if (!(await handle.stat()).isFile()) throw new HttpError(403, "Git 排除配置不是普通文件");
        const text = await handle.readFile("utf8");
        if (!text.split(/\r?\n/).some((line) => [".pi-desk/", "/.pi-desk/"].includes(line.trim()))) await handle.writeFile(`${text && !text.endsWith("\n") ? "\n" : ""}.pi-desk/\n`);
      } finally { await handle.close(); }
    });
    this.exclusions.set(file, operation);
    try { await operation; } finally { if (this.exclusions.get(file) === operation) this.exclusions.delete(file); }
  }
  async upload(req: IncomingMessage, cwd: unknown, name: unknown): Promise<UploadedFile> {
    const original = uploadName(name); const folder = await this.files.resolvePath(cwd, ".", true);
    const length = req.headers["content-length"];
    if (length && (!/^\d+$/.test(length) || Number(length) > MAX_FILE)) throw new HttpError(413, "单个文件不能超过 50 MB");
    await this.exclude(folder.root);
    await plainDirectory(join(folder.root, ".pi-desk")); await plainDirectory(join(folder.root, ".pi-desk", "uploads"));
    const path = join(folder.root, ".pi-desk", "uploads", `${Date.now()}-${randomUUID().slice(0, 8)}-${original}`);
    let handle: FileHandle | undefined; let size = 0; let head = Buffer.alloc(0); let created = false;
    try {
      handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); created = true;
      // return/throw 后不要销毁 HTTP 连接，仍能发送清晰的 413；剩余请求体丢弃。
      for await (const raw of req.iterator({ destroyOnReturn: false })) {
        const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw); size += chunk.length;
        if (size > MAX_FILE) throw new HttpError(413, "单个文件不能超过 50 MB");
        if (head.length < 16) head = Buffer.concat([head, chunk.subarray(0, 16 - head.length)]);
        let offset = 0;
        while (offset < chunk.length) { const result = await handle.write(chunk, offset, chunk.length - offset); if (!result.bytesWritten) throw new Error("write failed"); offset += result.bytesWritten; }
      }
      await handle.close(); handle = undefined;
      const mime = imageMime(head);
      return { cwd: folder.root, path: relative(folder.root, path), name: original, size, mime: mime ?? fileMime(original), image: !!mime };
    } catch (error) {
      req.resume(); await handle?.close().catch(() => {});
      if (created) { try { await this.trash(path); } catch { throw new HttpError(500, "上传失败，未完成文件留在隐藏上传目录，请移到废纸篓后重试"); } }
      throw error;
    }
  }
  async prompt(cwd: string, command: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (command.attachments === undefined) return command;
    if (!["prompt", "steer", "follow_up"].includes(String(command.type)) || typeof command.message !== "string" || !Array.isArray(command.attachments) || command.attachments.length > 12) throw new HttpError(400, "附件只能随消息发送，每次最多 12 个");
    const images: { type: "image"; data: string; mimeType: string }[] = []; const labels: string[] = []; let total = 0;
    for (const value of command.attachments) {
      if (!value || !["upload", "path"].includes(value.kind) || typeof value.path !== "string") throw new HttpError(400, "附件引用无效");
      const file = await this.files.checked(cwd, value.path);
      if (file.size > MAX_FILE) throw new HttpError(413, "单个附件不能超过 50 MB");
      const rel = relative(file.root, file.path);
      if (value.kind === "upload" && (!rel.startsWith(`.pi-desk${sep}uploads${sep}`) || rel.split(sep).length !== 3)) throw new HttpError(403, "上传附件只能引用隐藏上传目录里的文件");
      labels.push(value.kind === "upload" ? `附件：${rel}` : `引用文件：${rel}`);
      if (value.kind !== "upload") continue;
      total += file.size;
      if (total > 100 * 1024 * 1024) throw new HttpError(413, "本次上传附件合计超过 100 MB，请分开发送");
      const handle = await open(file.path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const info = await handle.stat(); if (!info.isFile() || info.ino !== file.ino || info.dev !== file.dev || info.size !== file.size) throw new HttpError(409, "附件发生变化，请重新添加");
        const head = Buffer.alloc(16); const { bytesRead } = await handle.read(head, 0, head.length, 0); const mime = imageMime(head.subarray(0, bytesRead));
        if (mime) images.push({ type: "image", data: (await handle.readFile()).toString("base64"), mimeType: mime });
      } finally { await handle.close(); }
    }
    const { attachments: _unused, ...cmd } = command;
    return { ...cmd, message: `${command.message}${labels.length ? `\n\n${labels.join("\n")}` : ""}`, ...(images.length ? { images: [...(Array.isArray(command.images) ? command.images : []), ...images] } : {}) };
  }
}
