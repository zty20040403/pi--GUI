import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { HttpError } from "./http.js";
import { projectMappings, type ProjectMappings } from "../shared/project-mapping.js";

export const APP_SETTINGS_FILE = process.env.PI_DESK_APP_SETTINGS_FILE ?? join(process.env.PI_DESK_DATA_DIR ?? join(homedir(), ".pi-desk"), "settings.json");
export type AppSettingsData = Record<string, unknown> & { projectMappings?: ProjectMappings };
// 这是 App 自己的设置，不写 ~/.pi/agent 的模型、扩展或对话配置。
export class AppSettings {
  private writes: Promise<unknown> = Promise.resolve();
  constructor(readonly path = APP_SETTINGS_FILE) {}
  async read(): Promise<AppSettingsData> {
    try {
      const info = await lstat(this.path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) throw new Error();
      const value: unknown = JSON.parse(await readFile(this.path, "utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
      return value as AppSettingsData;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw new HttpError(500, "App 设置无法读取。请检查设置文件权限或格式，原文件没有被覆盖。");
    }
  }
  async mappings() { return projectMappings((await this.read()).projectMappings); }
  update(change: (data: AppSettingsData) => AppSettingsData): Promise<AppSettingsData> {
    const operation = this.writes.catch(() => {}).then(async () => {
      const data = change(await this.read()); await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      const temporary = join(dirname(this.path), `.settings-${randomUUID()}.json`);
      await writeFile(temporary, JSON.stringify(data, null, 2) + "\n", { mode: 0o600, flag: "wx" });
      await rename(temporary, this.path); return data;
    });
    this.writes = operation; return operation;
  }
}
