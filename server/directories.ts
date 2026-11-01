import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { HttpError } from "./http.js";

export async function checkDirectory(input: unknown): Promise<string> {
  if (typeof input !== "string" || !input.trim() || input.includes("\0")) throw new HttpError(400, "请输入文件夹路径");
  const path = input.trim() === "~" ? homedir() : input.trim().startsWith("~/") ? join(homedir(), input.trim().slice(2)) : input.trim();
  if (!isAbsolute(path)) throw new HttpError(400, "请输入绝对路径（也可以用 ~/ 开头）");
  try {
    const cwd = await realpath(path);
    if (!(await stat(cwd)).isDirectory()) throw new HttpError(400, "这个路径不是文件夹");
    return cwd;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "文件夹不存在或无法访问，请检查路径");
  }
}
