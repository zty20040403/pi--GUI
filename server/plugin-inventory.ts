import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, matchesGlob, resolve } from "node:path";
import type { InstalledPlugin } from "../shared/plugins.js";
import { githubLink, npmSource, pluginText } from "./plugin-catalog.js";
import { digest, packageEnabled, sourceOf, within, type PackageEntry, type PiSettingsData } from "./plugin-settings.js";
const BUILTINS = [
  ["mcp", "连接 MCP 服务并提供其工具"], ["llama.cpp", "本地 llama.cpp 模型支持"],
  ["codemode", "用受限 JavaScript 组合工具调用"], ["tool-search", "查找并加载按需工具"],
] as const;
export type PluginEntry = { item: InstalledPlugin; source?: string; declaration?: PackageEntry; selector?: string; installedPath?: string };
export const pluginId = (kind: string, identity: string) => digest(`${kind}:${identity}`);
export function extensionEnabled(selector: string, patterns: string[], agentDir: string) {
  const full = selector.startsWith("builtin:") ? selector : resolve(agentDir, selector); let enabled = true;
  for (const pattern of patterns) {
    const prefix = pattern[0]; if (!["+", "-", "!"].includes(prefix)) continue;
    const raw = pattern.slice(1); const target = raw.startsWith("builtin:") ? raw : resolve(agentDir, raw.startsWith("~/") ? join(homedir(), raw.slice(2)) : raw);
    try { if (prefix === "!" ? matchesGlob(full, target) : target === full) enabled = prefix === "+"; } catch { /* 无效过滤规则交给 pi 报告，不执行模式。 */ }
  }
  return enabled;
}
async function manifest(path?: string) {
  if (!path) return {} as Record<string, any>;
  try { const file = join(path, "package.json"); if ((await stat(file)).size > 1024 * 1024) return {}; const value = JSON.parse(await readFile(file, "utf8")); return value && typeof value === "object" && !Array.isArray(value) ? value : {}; } catch { return {}; }
}
const exists = async (path: string) => { try { return await stat(path); } catch { return undefined; } };
export async function pluginInventory(agentDir: string, settings: PiSettingsData, installedPaths: Map<string, string>, piVersion?: string): Promise<PluginEntry[]> {
  const output: PluginEntry[] = []; const seen = new Set<string>(); const patterns = settings.extensions ?? [];
  const canonicalAgent = await realpath(agentDir).catch(() => resolve(agentDir));
  for (const declaration of settings.packages ?? []) {
    const source = sourceOf(declaration); const npm = npmSource(source); const kind = npm ? "npm" : /^(?:git:|https?:|ssh:|git@)/.test(source) ? "git" : "local";
    const id = pluginId(kind, npm?.name ?? source); if (seen.has(id)) continue; seen.add(id);
    const installedPath = installedPaths.get(source); const data = await manifest(installedPath);
    const actual = installedPath ? await realpath(installedPath).catch(() => undefined) : undefined;
    const managed = !!actual && (within("/nix/store", actual) || within(join(homedir(), ".local/share/pi-agent"), actual));
    const ordinaryNpm = !!npm && !!actual && within(join(canonicalAgent, "npm/node_modules"), actual);
    const name = npm?.name ?? (pluginText(data.name, 150) || (kind === "git" ? "Git 插件包" : basename(source)));
    output.push({ source, declaration, installedPath, item: { id, kind, name, version: pluginText(data.version, 100) || undefined, description: pluginText(data.description) || (kind === "npm" ? "npm 插件包" : "从本地或 Git 加载的插件包"), enabled: packageEnabled(declaration), managed, installed: !!actual, canToggle: true, canRemove: ordinaryNpm && !managed, reason: managed ? "由 setup.sh / Nix 管理，只能启停；App 不会删除文件" : kind !== "npm" ? "本地和 Git 包只提供启停，不从 App 删除文件" : !ordinaryNpm ? "未找到 pi 私有 npm 目录中的文件，不提供卸载；请先检查 pi list" : undefined, github: githubLink(typeof data.repository === "string" ? data.repository : data.repository?.url) } });
  }
  const local = new Set<string>();
  for (const file of await readdir(join(agentDir, "extensions"), { withFileTypes: true }).catch((error) => { if (error.code === "ENOENT") return []; throw error; })) {
    const path = join(agentDir, "extensions", file.name); const info = await exists(path);
    if (info?.isFile() && /\.(ts|js)$/.test(file.name)) local.add(path);
    else if (info?.isDirectory()) for (const entry of ["index.ts", "index.js"]) { if ((await exists(join(path, entry)))?.isFile()) { local.add(join(path, entry)); break; } }
  }
  for (const entry of patterns) {
    const resource = /^[+-]/.test(entry) ? entry.slice(1) : entry;
    if (!resource || resource.startsWith("builtin:") || resource.startsWith("!") || /[*?{}[\]]/.test(resource)) continue;
    const path = resource.startsWith("~/") ? join(homedir(), resource.slice(2)) : resolve(agentDir, resource); const info = await exists(path);
    if (info?.isFile()) local.add(path);
    else if (info?.isDirectory()) for (const name of ["index.ts", "index.js"]) { if ((await exists(join(path, name)))?.isFile()) { local.add(join(path, name)); break; } }
  }
  for (const path of local) {
    const selector = within(join(agentDir, "extensions"), path) ? path.slice(agentDir.length + 1).split("\\").join("/") : path;
    const id = pluginId("file", path); if (seen.has(id)) continue; seen.add(id);
    const actual = await realpath(path).catch(() => path);
    const managed = within("/nix/store", actual) || within(join(homedir(), ".local/share/pi-agent"), actual);
    output.push({ selector, item: { id, kind: "local", name: basename(path) === "index.ts" || basename(path) === "index.js" ? basename(resolve(path, "..")) : basename(path), description: managed ? "由 setup.sh 管理的扩展文件" : "本地扩展文件", enabled: extensionEnabled(selector, patterns, agentDir), managed, installed: true, canToggle: true, canRemove: false, reason: managed ? "由 setup.sh 管理；只修改启停配置，不改动原文件" : "本地文件只提供启停，请由原安装方式管理文件" } });
  }
  for (const [name, description] of BUILTINS) {
    const selector = `builtin:${name}`;
    output.push({ selector, item: { id: pluginId("builtin", name), kind: "builtin", name: selector, version: piVersion, description, enabled: extensionEnabled(selector, patterns, agentDir), managed: true, installed: true, canToggle: true, canRemove: false, reason: "随 pi 提供，只能启停，不能单独卸载" } });
  }
  return output;
}
