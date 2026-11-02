import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import { engineMode, type EngineMode, type EngineKind, type EngineStatus } from "../shared/engine.js";
import { AppSettings } from "./settings.js";
import { piEnvironment } from "./pi-process.js";
import { HttpError } from "./http.js";

export type EngineCommand = { binary: string; args: string[]; env: NodeJS.ProcessEnv };
type AvailableEngine = { kind: EngineKind; version: string; command: EngineCommand };
export type EngineOptions = { env?: NodeJS.ProcessEnv; home?: string; executable?: string; electron?: boolean; builtinRoot?: string; probe?: (command: EngineCommand) => Promise<string | undefined> };
async function executable(path: string) { try { await access(path, constants.X_OK); return (await stat(path)).isFile(); } catch { return false; } }
export async function findSystemPi(env: NodeJS.ProcessEnv, home: string): Promise<string | undefined> {
  const paths = (piEnvironment(env).PATH ?? "").split(delimiter).filter(isAbsolute);
  const candidates = env.PI_BIN ? isAbsolute(env.PI_BIN) ? [env.PI_BIN] : paths.map((path) => join(path, env.PI_BIN!)) : [join(home, ".local/bin/pi"), ...paths.map((path) => join(path, "pi"))];
  for (const candidate of [...new Set(candidates)]) if (await executable(candidate)) return candidate;
}
async function versionOf(command: EngineCommand): Promise<string | undefined> {
  return new Promise((done) => {
    const child = spawn(command.binary, [...command.args, "--version"], { env: { ...command.env, PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1" }, cwd: homedir(), stdio: ["ignore", "pipe", "ignore"] });
    let text = ""; const timer = setTimeout(() => { child.kill("SIGKILL"); done(undefined); }, 5000);
    child.stdout.setEncoding("utf8"); child.stdout.on("data", (chunk: string) => { if (text.length < 8192) text += chunk; else child.kill("SIGKILL"); });
    child.once("error", () => { clearTimeout(timer); done(undefined); }); child.once("close", (code) => { clearTimeout(timer); done(code === 0 ? text.match(/^\s*(?:pi\s+)?(\d+\.\d+\.\d+(?:-[\w.-]+)?)\s*$/m)?.[1] : undefined); });
  });
}
export class EngineManager {
  private mode: EngineMode = "auto";
  private selected?: AvailableEngine;
  private system?: AvailableEngine;
  private builtin?: AvailableEngine;
  private initialized?: Promise<void>;
  private readonly env: NodeJS.ProcessEnv;
  constructor(private readonly settings: AppSettings, private readonly options: EngineOptions = {}) {
    this.env = piEnvironment(options.env ?? process.env); this.env.ELECTRON_RUN_AS_NODE = undefined;
  }
  initialize() { return this.initialized ??= this.load(); }
  private async load() {
    const saved = (await this.settings.read()).engine; this.mode = engineMode(saved) ? saved : "auto";
    await this.detect(); this.selected = this.forMode(this.mode);
  }
  async detect() {
    const probe = this.options.probe ?? versionOf;
    const system = await findSystemPi(this.env, this.options.home ?? homedir());
    this.system = system ? { kind: "system", version: "未知", command: { binary: system, args: [], env: { ...this.env } } } : undefined;
    if (this.system) this.system.version = await probe(this.system.command) ?? "未知";
    this.builtin = undefined;
    try {
      let root = this.options.builtinRoot ?? this.env.PI_DESK_BUILTIN_PI;
      if (!root) root = resolve(dirname(fileURLToPath(import.meta.url)), "../node_modules/@earendil-works/pi-coding-agent");
      const metadata = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
      if (metadata.name !== "@earendil-works/pi-coding-agent" || metadata.version !== "1.4.0") return;
      const entry = join(root, "dist/bundle/cli.js"); if (!(await stat(entry)).isFile()) return;
      const env: NodeJS.ProcessEnv = { ...this.env, PI_PACKAGE_DIR: root }; env.NODE_OPTIONS = undefined; env.NODE_PATH = undefined;
      if (this.options.electron ?? !!process.versions.electron) env.ELECTRON_RUN_AS_NODE = "1";
      const binary = this.options.executable ?? process.execPath;
      if (this.env.PI_DESK_ENGINE_BIN) { env.PATH = `${this.env.PI_DESK_ENGINE_BIN}${delimiter}${env.PATH ?? ""}`; env.PI_DESK_ENGINE_EXECUTABLE = binary; env.PI_DESK_ENGINE_ENTRY = entry; }
      const command = { binary, args: [entry], env };
      if (await probe(command) === metadata.version) this.builtin = { kind: "builtin", version: metadata.version, command };
    } catch { /* 不把路径、运行输出或用户配置放进引擎错误。 */ }
  }
  private forMode(mode: EngineMode) { return mode === "auto" ? this.system ?? this.builtin : mode === "system" ? this.system : this.builtin; }
  status(): EngineStatus {
    return { mode: this.mode, active: this.selected ? { kind: this.selected.kind, version: this.selected.version } : undefined,
      system: this.system ? { available: true, version: this.system.version } : { available: false, reason: "没有找到系统 pi，可安装系统 pi 或使用内置引擎。" },
      builtin: this.builtin ? { available: true, version: this.builtin.version } : { available: false, reason: "内置 pi 不可用，请重新安装完整的 pi desk。" } };
  }
  command(): EngineCommand {
    if (!this.selected) throw new HttpError(503, "所选 pi 引擎不可用，请在设置中选择可用引擎。");
    return { ...this.selected.command, args: [...this.selected.command.args], env: { ...this.selected.command.env } };
  }
  requireAvailable(mode: unknown): asserts mode is EngineMode {
    if (!engineMode(mode)) throw new HttpError(400, "pi 引擎只能选择自动、系统或内置。");
    if (!this.forMode(mode)) throw new HttpError(503, "这个 pi 引擎不可用，请重新打开设置或选择其他引擎。");
  }
  async select(mode: unknown) {
    this.requireAvailable(mode); const selected = this.forMode(mode)!;
    await this.settings.update((data) => ({ ...data, engine: mode })); this.mode = mode; this.selected = selected;
  }
}
