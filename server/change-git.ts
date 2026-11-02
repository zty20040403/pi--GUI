import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { checkedChangePath, captureFile, changePath } from "./change-files.js";
import { CHANGE_FILE_LIMIT, sameSnapshot, type ChangedFile, type ChangeReview, type FileSnapshot } from "../shared/changes.js";

const exec = promisify(execFile);
export function readonlyGitEnvironment() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("GIT_") || key === "PAGER") delete env[key];
  return { ...env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_PAGER: "cat", GIT_LITERAL_PATHSPECS: "1" };
}
async function git(cwd: string, args: string[], maxBuffer = 2 * 1024 * 1024) {
  return (await exec("git", ["--no-pager", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-c", "diff.external=", "-c", "core.pager=cat", ...args], { cwd, env: readonlyGitEnvironment(), timeout: 10000, maxBuffer, encoding: "buffer" })).stdout;
}
export async function isGitProject(cwd: string) { try { return (await git(cwd, ["rev-parse", "--is-inside-work-tree"])).toString("utf8").trim() === "true"; } catch { return false; } }
function gitSnapshot(bytes: Buffer): FileSnapshot {
  if (bytes.length > CHANGE_FILE_LIMIT) return { kind: "omitted", reason: "large" };
  const fingerprint = createHash("sha256").update(bytes).digest("hex");
  if (bytes.includes(0)) return { kind: "omitted", reason: "binary", fingerprint };
  try { return { kind: "text", text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes), fingerprint }; }
  catch { return { kind: "omitted", reason: "binary", fingerprint }; }
}
export async function gitReview(cwd: string): Promise<ChangeReview> {
  if (!await isGitProject(cwd)) throw new Error("这个项目不是 Git 工作区，无法查看未提交改动");
  // 固定 HEAD；不读可执行 textconv/filter，不写 index/objects，不运行 hooks。
  let head: string | undefined;
  try { const value = (await git(cwd, ["rev-parse", "--verify", "HEAD^{tree}"])).toString("utf8").trim(); if (/^[a-f0-9]{40,64}$/.test(value)) head = value; }
  catch { /* 尚未创建首个提交 */ }
  // --no-textconv 不会禁止 clean/process；必须另外覆盖仓库声明的过滤器。
  let configured = "";
  try { configured = (await git(cwd, ["config", "--null", "--get-regexp", "^filter\\..*\\.(clean|smudge|process|required)$"])).toString("utf8"); }
  catch (error) { if ((error as { code?: number }).code !== 1) throw error; }
  const names = [...new Set(configured.split("\0").filter(Boolean).map((row) => row.slice(0, row.indexOf("\n")).replace(/\.(clean|smudge|process|required)$/, "")))];
  if (names.length > 256 || names.some((name) => /[\x00-\x1f]/.test(name) || name.length > 300 || !name.startsWith("filter."))) throw new Error("Git 过滤器配置过于复杂，未执行差异查询");
  const overrides = names.flatMap((name) => ["clean", "smudge", "process", "required"].flatMap((key) => ["-c", `${name}.${key}=${key === "required" ? "false" : ""}`]));
  const changed = head ? (await git(cwd, [...overrides, "diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--name-only", "--relative", "-z", head, "--", "."])).toString("utf8").split("\0") : (await git(cwd, ["ls-files", "--cached", "-z", "--", "."])).toString("utf8").split("\0");
  const untracked = (await git(cwd, ["ls-files", "--others", "--exclude-standard", "-z", "--", "."])).toString("utf8").split("\0");
  const paths = [...new Set([...changed, ...untracked].filter(Boolean))]; const warnings: string[] = []; const files: ChangedFile[] = [];
  if (paths.length > 300) warnings.push("未提交文件超过 300 个，只展示前 300 个；结果不完整。");
  let bytes = 0;
  for (const path of paths.slice(0, 300)) {
    if (!changePath(path)) { if (!warnings.includes("部分内部目录或特殊文件名未展示。")) warnings.push("部分内部目录或特殊文件名未展示。"); continue; }
    try { await checkedChangePath(cwd, path); }
    catch { if (!warnings.includes("敏感路径、项目外文件或符号链接未展示。")) warnings.push("敏感路径、项目外文件或符号链接未展示。"); continue; }
    let before: FileSnapshot = { kind: "missing" };
    if (head) {
      const entry = (await git(cwd, ["ls-tree", "-z", head, "--", path])).toString("utf8").split("\0").find(Boolean);
      if (entry) {
        const metadata = /^(\d+) blob ([a-f0-9]{40,64})\t/.exec(entry);
        if (!metadata || !["100644", "100755"].includes(metadata[1])) { warnings.push(`未展示非普通文件：${path}`); continue; }
        const size = Number((await git(cwd, ["cat-file", "-s", metadata[2]])).toString("utf8").trim());
        before = size > CHANGE_FILE_LIMIT ? { kind: "omitted", reason: "large" } : gitSnapshot(await git(cwd, ["cat-file", "blob", metadata[2]], CHANGE_FILE_LIMIT + 1));
      }
    }
    const after = await captureFile(cwd, path);
    bytes += (before.kind === "text" ? Buffer.byteLength(before.text) : 0) + (after.kind === "text" ? Buffer.byteLength(after.text) : 0);
    if (bytes > 12 * 1024 * 1024) { warnings.push("未提交内容超过 12 MB，结果不完整；请缩小改动范围。"); break; }
    if (!sameSnapshot(before, after)) files.push({ path, before, after });
  }
  // 防止 HEAD 切换时把两个不同基线伪装成同一份比较。
  if (head) { const current = (await git(cwd, ["rev-parse", "--verify", "HEAD^{tree}"])).toString("utf8").trim(); if (current !== head) throw new Error("Git 基线刚发生变化，请刷新后重试"); }
  return { label: "未提交（HEAD → 当前文件，含未跟踪文件）", files, warnings: [...new Set(warnings)] };
}
