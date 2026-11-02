import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { FileService } from "./files.js";
import { CHANGE_FILE_LIMIT, type FileSnapshot } from "../shared/changes.js";

const guard = new FileService();
export function changePath(path: unknown): path is string {
  return typeof path === "string" && path.length > 0 && path.length <= 4096 && !isAbsolute(path) && !/[\x00-\x1f\x7f\\]/.test(path) && !path.split("/").some((part) => !part || part === "." || part === ".." || part === ".git" || part === ".pi-desk");
}
export async function checkedChangePath(cwd: string, requested: unknown): Promise<{ root: string; path: string; relative: string }> {
  if (typeof requested !== "string" || !requested || requested.length > 4096 || /[\x00-\x1f\x7f]/.test(requested)) throw new Error("不记录无效路径");
  const root = await realpath(cwd); await guard.refuseSensitive(root);
  const path = resolve(root, requested); const rel = relative(root, path).split(sep).join("/");
  if (!changePath(rel)) throw new Error("不记录项目外或内部数据目录");
  await guard.refuseSensitive(path);
  let parent = root;
  for (const part of rel.split("/")) {
    parent = resolve(parent, part);
    try { if ((await lstat(parent)).isSymbolicLink()) throw new Error("不记录符号链接"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") break; throw error; }
  }
  return { root, path, relative: rel };
}
export async function captureFile(cwd: string, path: string): Promise<FileSnapshot> {
  const checked = await checkedChangePath(cwd, path);
  try {
    const initial = await lstat(checked.path);
    if (!initial.isFile() || initial.isSymbolicLink()) return { kind: "omitted", reason: "unreadable" };
    const signature = `${initial.dev}:${initial.ino}:${initial.size}:${initial.mtimeMs}:${initial.ctimeMs}`;
    if (initial.size > CHANGE_FILE_LIMIT) return { kind: "omitted", reason: "large", fingerprint: signature };
    const file = await open(checked.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const actual = await file.stat();
      if (!actual.isFile() || actual.dev !== initial.dev || actual.ino !== initial.ino || actual.size !== initial.size || actual.mtimeMs !== initial.mtimeMs) return { kind: "omitted", reason: "unreadable" };
      const buffer = Buffer.alloc(CHANGE_FILE_LIMIT + 1); let length = 0;
      for (;;) { const { bytesRead } = await file.read(buffer, length, buffer.length - length, length); length += bytesRead; if (!bytesRead || length === buffer.length) break; }
      const after = await file.stat();
      if (length > CHANGE_FILE_LIMIT) return { kind: "omitted", reason: "large" };
      if (after.size !== initial.size || after.mtimeMs !== initial.mtimeMs || after.ctimeMs !== initial.ctimeMs) return { kind: "omitted", reason: "unreadable" };
      const bytes = buffer.subarray(0, length); const fingerprint = createHash("sha256").update(bytes).digest("hex");
      if (bytes.includes(0)) return { kind: "omitted", reason: "binary", fingerprint };
      try { return { kind: "text", text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes), fingerprint }; }
      catch { return { kind: "omitted", reason: "binary", fingerprint }; }
    } finally { await file.close(); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
    return { kind: "omitted", reason: "unreadable" };
  }
}
