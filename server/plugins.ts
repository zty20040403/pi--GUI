import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { gt, valid } from "semver";
import lockfile from "proper-lockfile";
import type { PluginAction, PluginConfirmation, PluginJob, PluginSnapshot, PluginUpdate } from "../shared/plugins.js";
import { errorInfo } from "./errors.js";
import { HttpError } from "./http.js";
import { AppSettings } from "./settings.js";
import { PluginCatalog, exactVersion, mapLimit, npmSource, packageName } from "./plugin-catalog.js";
import { parsePiList, pluginRunner, type PluginRunner } from "./plugin-command.js";
import { pluginInventory, type PluginEntry } from "./plugin-inventory.js";
import { PluginSettings, RESOURCE_TYPES, assertWritableLocation, packageEnabled, sourceOf, type PackageEntry, type PiSettingsData } from "./plugin-settings.js";

type Snapshot = Awaited<ReturnType<PluginSettings["snapshot"]>>;
type Prepared = { action: PluginAction; revision: string; entry?: PluginEntry; title: string; expiresAt: number };
export type PluginServiceOptions = {
  agentDir?: string; appSettings?: AppSettings; catalog?: PluginCatalog; run?: PluginRunner;
  reload?: (status: (value: "waiting" | "loading") => void, signal: AbortSignal) => Promise<void>;
  trash?: (path: string) => Promise<void>;
};
export class PluginService {
  readonly settings: PluginSettings; readonly catalog: PluginCatalog;
  private readonly appSettings: AppSettings; private readonly run: PluginRunner; private readonly workDir: string;
  private readonly trash: (path: string) => Promise<void>; private readonly intents = new Map<string, Prepared>();
  private cache?: { revision: string; until: number; entries: PluginEntry[]; warning?: string };
  private piVersion?: string; private job?: PluginJob; private work?: Promise<void>; private abort?: AbortController;
  private needsReload = false; private reloadState: PluginSnapshot["reload"] = "idle";
  constructor(private readonly options: PluginServiceOptions = {}) {
    this.appSettings = options.appSettings ?? new AppSettings(); const root = dirname(this.appSettings.path);
    this.settings = new PluginSettings(resolve(options.agentDir ?? process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi/agent")), join(root, "backups"));
    this.workDir = join(root, "plugin-work"); this.catalog = options.catalog ?? new PluginCatalog(); this.run = options.run ?? pluginRunner();
    this.trash = options.trash ?? (async (path) => { await promisify(execFile)("trash", [path]); });
  }
  private async inventory(snapshot: Snapshot, force = false) {
    if (!force && this.cache?.revision === snapshot.revision && this.cache.until > Date.now()) return this.cache;
    let paths = new Map<string, string>(); let warning: string | undefined;
    try {
      paths = parsePiList(await this.run(["list"], { agentDir: this.settings.agentDir }));
      if (!this.piVersion) this.piVersion = (await this.run(["--version"], { agentDir: this.settings.agentDir })).match(/\d+\.\d+\.\d+/)?.[0];
    } catch { warning = "未能运行 pi list，暂时只显示已声明的插件；安装位置未核实，卸载不可用。请检查系统 pi 后刷新。"; }
    const entries = await pluginInventory(this.settings.agentDir, snapshot.data, paths, this.piVersion);
    return this.cache = { revision: snapshot.revision, until: Date.now() + 30000, entries, warning };
  }
  invalidate() { this.cache = undefined; this.piVersion = undefined; this.intents.clear(); }
  status() { return { job: this.job, needsReload: this.needsReload, reload: this.reloadState }; }
  async list(force = false): Promise<PluginSnapshot> { const result = await this.inventory(await this.settings.snapshot(), force); return { ...this.status(), items: result.entries.map((entry) => entry.item), warning: result.warning }; }
  async updates(): Promise<{ items: PluginUpdate[]; unavailable: string[] }> {
    const { entries } = await this.inventory(await this.settings.snapshot()); const unavailable: string[] = [];
    const rows = await mapLimit(entries.filter((entry) => entry.item.kind === "npm" && entry.item.canRemove), 4, async (entry) => {
      try { const next = await this.catalog.metadata(entry.item.name); const current = entry.item.version; if (current && valid(current) && gt(next.version, current)) return { id: entry.item.id, name: entry.item.name, current, next }; }
      catch { unavailable.push(entry.item.name); } return undefined;
    }); return { items: rows.filter((row): row is PluginUpdate => !!row), unavailable };
  }
  private action(value: any): PluginAction {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "插件操作格式不正确");
    if (value.kind === "install") return { kind: "install", name: packageName(value.name), version: exactVersion(value.version) };
    if (typeof value.id !== "string" || !/^[a-f0-9]{64}$/.test(value.id)) throw new HttpError(400, "插件标识不正确，请刷新列表");
    if (value.kind === "toggle" && typeof value.enabled === "boolean") return { kind: "toggle", id: value.id, enabled: value.enabled };
    if (value.kind === "remove") return { kind: "remove", id: value.id };
    if (value.kind === "update") return { kind: "update", id: value.id, version: exactVersion(value.version) };
    throw new HttpError(400, "不支持这个插件操作");
  }
  async prepare(value: unknown): Promise<PluginConfirmation> {
    if (this.job?.status === "running") throw new HttpError(409, "另一个插件操作正在进行，请等待完成");
    const action = this.action(value); const snapshot = await this.settings.snapshot(); const { entries } = await this.inventory(snapshot);
    const entry = action.kind === "install" ? undefined : entries.find((row) => row.item.id === action.id);
    if (action.kind !== "install" && !entry) throw new HttpError(404, "这个插件已不在列表中，请刷新后重试");
    if (entry?.item.kind === "npm" && (snapshot.data.packages ?? []).filter((row) => npmSource(sourceOf(row))?.name === entry.item.name).length !== 1) throw new HttpError(409, "设置重复声明了同名插件，请先整理 packages 后重试，App 没有擅自合并它们。");
    let title: string; let detail: string;
    if (action.kind === "toggle") {
      if (!entry!.item.canToggle) throw new HttpError(409, "这个插件不能从 App 启停");
      title = `${action.enabled ? "启用" : "停用"} ${entry!.item.name}`; detail = "只改变 pi 全局设置，不删除插件文件；终端 pi 重新加载后也会受影响。";
    } else if (action.kind === "remove") {
      if (!entry!.item.canRemove) throw new HttpError(409, entry!.item.reason ?? "这个插件不能从 App 卸载");
      exactVersion(entry!.item.version); title = `卸载 ${entry!.item.name} ${entry!.item.version}`; detail = "会删除这个插件的文件，移除其安装声明；不会删除你的对话。设置修改前会备份。";
    } else {
      const name = action.kind === "install" ? action.name : entry!.item.name;
      if (action.kind === "install" && entries.some((row) => row.item.kind === "npm" && row.item.name === name)) throw new HttpError(409, "这个插件已经安装，请使用更新或启用按钮");
      if (action.kind === "update" && (!entry!.item.canRemove || !valid(entry!.item.version ?? "") || !gt(action.version, entry!.item.version!))) throw new HttpError(409, "请选择比当前已安装版本更新的确切版本");
      await this.catalog.metadata(name, action.version);
      title = action.kind === "install" ? `安装 ${name} ${action.version}` : `更新 ${name} ${entry!.item.version} → ${action.version}`;
      detail = "这个插件和安装脚本会以你的权限运行代码，只装信得过的。将安装上方固定版本，不会自动追随 latest；全局设置会先备份。";
    }
    for (const [key, intent] of this.intents) if (intent.expiresAt < Date.now()) this.intents.delete(key);
    if (this.intents.size >= 64) throw new HttpError(429, "待确认操作过多，请关闭旧弹窗后稍后重试");
    const ticket = randomUUID(); const expiresAt = Date.now() + 120000; this.intents.set(ticket, { action, revision: snapshot.revision, entry, title, expiresAt });
    return { ticket, title, detail, expiresAt };
  }
  confirm(ticket: unknown, confirmed: unknown) {
    if (typeof ticket !== "string" || confirmed !== true) throw new HttpError(400, "请在插件页面确认操作");
    const intent = this.intents.get(ticket); this.intents.delete(ticket);
    if (!intent || intent.expiresAt < Date.now()) throw new HttpError(409, "确认已经过期或已使用，请重新选择插件操作");
    return this.start(intent.title, async () => {
      const current = await this.settings.snapshot(); if (current.revision !== intent.revision) throw new HttpError(409, "确认期间设置已被修改。请刷新列表后重试，没有覆盖新设置。");
      if (intent.action.kind === "toggle") await this.toggle(intent.entry!, intent.action.enabled, intent.revision);
      else await this.packageAction(intent, current);
      this.needsReload = true; this.cache = undefined; this.append("操作完成。重新加载后生效；终端 pi 请自行执行 /reload。");
    });
  }
  private append(line: string) { if (!this.job) return; this.job.output.push(line); if (this.job.output.length > 200) this.job.output.splice(0, this.job.output.length - 200); }
  private start(title: string, action: () => Promise<void>) {
    if (this.job?.status === "running") throw new HttpError(409, "另一个插件操作正在进行，请等待完成");
    this.abort = new AbortController(); this.job = { id: randomUUID(), title, status: "running", output: [] };
    this.work = Promise.resolve().then(async () => {
      assertWritableLocation(this.settings.agentDir); await mkdir(this.settings.agentDir, { recursive: true, mode: 0o700 }); assertWritableLocation(await realpath(this.settings.agentDir));
      const release = await lockfile.lock(join(this.settings.agentDir, ".desk-plugin-operation"), { realpath: false }).catch(() => { throw new HttpError(409, "另一个 App 正在管理插件，请等待完成后重试"); });
      try { await action(); } finally { await release(); }
    }).then(() => { this.job!.status = "succeeded"; }, (error) => { this.job!.status = "failed"; this.job!.error = errorInfo(error); }).finally(() => { this.cache = undefined; }); return this.job;
  }
  private async toggle(entry: PluginEntry, enabled: boolean, revision: string) {
    await this.settings.change(revision, async (data) => {
      if (entry.source) {
        const current = data.packages?.find((row) => sourceOf(row) === entry.source); if (!current) throw new HttpError(409, "插件声明已改变，请刷新后重试");
        if (packageEnabled(current) === enabled) return data;
        const saved = await this.appSettings.read(); const originals = (saved.disabledPluginConfigs ?? {}) as Record<string, PackageEntry>;
        let next: PackageEntry;
        if (!enabled) {
          await this.appSettings.update((settings) => ({ ...settings, disabledPluginConfigs: { ...(settings.disabledPluginConfigs as object ?? {}), [entry.item.id]: current } }));
          next = { ...(typeof current === "string" ? { source: current } : current), ...Object.fromEntries(RESOURCE_TYPES.map((key) => [key, []])) };
        } else {
          const original = originals[entry.item.id]; const restored: Record<string, unknown> = typeof current === "string" ? { source: current } : { ...current };
          for (const key of RESOURCE_TYPES) { if (original && typeof original === "object" && key in original) restored[key] = original[key]; else delete restored[key]; }
          next = Object.keys(restored).length === 1 ? entry.source : restored as PackageEntry;
        }
        return { ...data, packages: data.packages!.map((row) => sourceOf(row) === entry.source ? next : row) };
      }
      const selector = entry.selector!; const patterns = (data.extensions ?? []).filter((pattern) => ![selector, `+${selector}`, `-${selector}`].includes(pattern));
      // 显式 + 能覆盖原有通配排除；不会删掉用户对其他扩展的规则。
      patterns.push(`${enabled ? "+" : "-"}${selector}`); return { ...data, extensions: patterns };
    });
  }
  private async packageAction(intent: Prepared, snapshot: Snapshot) {
    const action = intent.action; if (action.kind === "toggle") return;
    assertWritableLocation(this.settings.agentDir); await mkdir(this.settings.agentDir, { recursive: true, mode: 0o700 }); assertWritableLocation(await realpath(this.settings.agentDir));
    const npmDir = join(this.settings.agentDir, "npm"); await mkdir(npmDir, { recursive: true });
    if (await realpath(npmDir) !== join(await realpath(this.settings.agentDir), "npm")) throw new HttpError(409, "npm 目录指向别的位置，不能安全管理；请检查 pi 的安装位置");
    await mkdir(join(npmDir, "node_modules"), { recursive: true });
    if (await realpath(join(npmDir, "node_modules")) !== join(await realpath(npmDir), "node_modules")) throw new HttpError(409, "node_modules 指向别的位置，不能安全安装或卸载插件");
    // pi CLI 自己会写 settings.json。让它只写隔离的设置副本，实际设置由上面的锁+备份+原子改名提交。
    await this.settings.backup(snapshot.text); await mkdir(this.workDir, { recursive: true, mode: 0o700 }); const staging = await mkdtemp(join(this.workDir, "operation-"));
    await writeFile(join(staging, "settings.json"), JSON.stringify({ packages: snapshot.data.packages ?? [], ...(snapshot.data.npmCommand ? { npmCommand: snapshot.data.npmCommand } : {}) }), { mode: 0o600 }); await symlink(npmDir, join(staging, "npm"), "dir");
    const name = action.kind === "install" ? action.name : intent.entry!.item.name;
    const run = (command: string, version: string) => this.run([command, `npm:${name}@${exactVersion(version)}`], { agentDir: staging, output: (line) => this.append(line), signal: this.abort?.signal });
    try {
      this.needsReload = true;
      if (action.kind === "remove" || action.kind === "update") { this.append(`正在移除 ${name} ${intent.entry!.item.version}`); await run("remove", intent.entry!.item.version!); }
      if (action.kind === "install" || action.kind === "update") {
        try { this.append(`正在安装 ${name} ${action.version}`); await run("install", action.version); }
        catch (error) {
          if (action.kind === "update" && !this.abort?.signal.aborted) { this.append("新版安装失败，正在恢复原固定版本…"); try { await run("install", intent.entry!.item.version!); this.append("原版本已恢复，设置没有切到新版。"); } catch { this.append("原版本恢复也失败，请查看输出；备份仍在 App 的 backups 目录。"); } }
          throw error;
        }
      }
      await this.settings.change(undefined, (data) => {
        // 合并时只改目标包；期间的其他设置/其他包修改不会丢。目标包自身若被外部改动则拒绝。
        const before = snapshot.data.packages?.find((row) => npmSource(sourceOf(row))?.name === name);
        const current = data.packages?.find((row) => npmSource(sourceOf(row))?.name === name);
        if (JSON.stringify(before) !== JSON.stringify(current)) throw new HttpError(409, "这个插件的声明已被外部修改，文件操作已结束，但没有覆盖新声明。请检查 pi list 后刷新。");
        const packages = (data.packages ?? []).filter((row) => npmSource(sourceOf(row))?.name !== name);
        if (action.kind !== "remove") { const source = `npm:${name}@${action.version}`; packages.push(before && typeof before === "object" ? { ...before, source } : source); }
        return { ...data, packages };
      });
    } finally { await this.trash(staging).catch(() => this.append("临时设置副本未能移到废纸篓，仍保留在 App 的 plugin-work 目录。")); }
  }
  reload() {
    if (!this.options.reload) throw new HttpError(503, "后台暂不支持重新加载");
    return this.start("重新加载插件", async () => {
      this.reloadState = "waiting"; this.append("正在等待所有项目空闲；插件提问也需要先回答或取消。");
      try { await this.options.reload!((state) => { this.reloadState = state; if (state === "loading") this.append("项目已空闲，正在重启 pi 并恢复对话…"); }, this.abort!.signal); this.needsReload = false; this.append("插件已重新加载，已保存的对话和草稿不会自动发送。"); }
      finally { this.reloadState = "idle"; }
    });
  }
  cancelReload() { if (this.reloadState !== "waiting") throw new HttpError(409, "只能取消等待中的重新加载"); this.abort?.abort(); }
  async close() { this.abort?.abort(); await this.work; }
}
