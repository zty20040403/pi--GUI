import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import lockfile from "proper-lockfile";
import { HttpError } from "./http.js";

export type PackageEntry = string | ({ source: string } & Record<string, unknown>);
export type PiSettingsData = Record<string, unknown> & { packages?: PackageEntry[]; extensions?: string[] };
export const RESOURCE_TYPES = ["extensions", "skills", "prompts", "themes"] as const;
export const sourceOf = (entry: PackageEntry) => typeof entry === "string" ? entry : entry.source;
export const packageEnabled = (entry: PackageEntry) => typeof entry === "string" || !RESOURCE_TYPES.every((key) => Array.isArray(entry[key]) && entry[key].length === 0);
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export function within(root: string, path: string) { const rel = relative(root, path); return rel === "" || rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); }
export function assertWritableLocation(path: string) {
  for (const protectedPath of ["/nix/store", join(homedir(), ".pi/agent/extensions"), join(homedir(), ".pi/agent/secrets"), join(homedir(), ".local/share/pi-agent"), join(homedir(), ".config/cortexkit")]) {
    if (within(protectedPath, path)) throw new HttpError(403, "这个位置由系统配置管理，App 不会修改。请使用普通的 pi 用户配置目录。");
  }
}
export class PluginSettings {
  readonly path: string;
  constructor(readonly agentDir: string, readonly backupDir: string) { this.path = join(agentDir, "settings.json"); }
  async snapshot(): Promise<{ data: PiSettingsData; text: string; revision: string }> {
    let text = "";
    try {
      const file = await lstat(this.path);
      if (!file.isFile() || file.isSymbolicLink() || file.size > 2 * 1024 * 1024) throw new Error("设置文件不能是符号链接或超过 2 MB");
      text = await readFile(this.path, "utf8");
      const data: unknown = JSON.parse(text);
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("设置必须是 JSON 对象");
      const settings = data as PiSettingsData;
      if (settings.packages !== undefined && (!Array.isArray(settings.packages) || settings.packages.some((item) => !(typeof item === "string" || item && typeof item === "object" && !Array.isArray(item) && typeof item.source === "string")))) throw new Error("packages 格式不正确");
      if (settings.extensions !== undefined && (!Array.isArray(settings.extensions) || settings.extensions.some((item) => typeof item !== "string"))) throw new Error("extensions 格式不正确");
      return { data: settings, text, revision: digest(text) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { data: {}, text, revision: digest(text) };
      throw new HttpError(409, "pi 设置无法安全读取，请检查 settings.json 的格式或权限；原文件没有被覆盖。");
    }
  }
  async backup(text: string) {
    await mkdir(this.backupDir, { recursive: true, mode: 0o700 });
    const path = join(this.backupDir, `pi-settings-${Date.now()}-${randomUUID()}.json`);
    await writeFile(path, text || "{}\n", { flag: "wx", mode: 0o600 });
  }
  async change(revision: string | undefined, change: (data: PiSettingsData) => PiSettingsData | Promise<PiSettingsData>) {
    assertWritableLocation(resolve(this.agentDir)); await mkdir(this.agentDir, { recursive: true, mode: 0o700 }); assertWritableLocation(await realpath(this.agentDir));
    const release = await lockfile.lock(this.path, { realpath: false, retries: { retries: 10, minTimeout: 30, maxTimeout: 200 } }).catch(() => { throw new HttpError(409, "pi 或另一个窗口正在保存设置，请稍后重试。"); });
    try {
      const before = await this.snapshot(); if (revision && before.revision !== revision) throw new HttpError(409, "设置已经被别处修改。请刷新插件列表，再确认这次操作。");
      const next = await change(structuredClone(before.data));
      // App 只拥有这两个字段，不允许回调顺手改掉模型、网络或其他设置。
      const output = { ...before.data, ...(next.packages !== undefined ? { packages: next.packages } : {}), ...(next.extensions !== undefined ? { extensions: next.extensions } : {}) };
      const text = JSON.stringify(output, null, 2) + "\n"; if (JSON.stringify(output) === JSON.stringify(before.data)) return before.data;
      await this.backup(before.text);
      const temporary = join(dirname(this.path), `.desk-plugins-${randomUUID()}.json`);
      await writeFile(temporary, text, { flag: "wx", mode: 0o600 });
      // 兼容 pi 自己的 settings.json.lock；额外检测不遵守锁的外部编辑器。
      if ((await this.snapshot()).revision !== before.revision) throw new HttpError(409, "保存前发现设置被外部修改，没有覆盖。请刷新后重试。");
      await rename(temporary, this.path); return output;
    } finally { await release(); }
  }
}
