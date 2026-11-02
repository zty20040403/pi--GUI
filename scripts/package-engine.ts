import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

// 复制 lockfile 已安装的生产依赖图，保留嵌套版本；不再次从网络解析依赖，也不带用户 pi 配置。
export async function packageEngine(project: string, target: string) {
  const modules = join(project, "node_modules"); const copied = new Set<string>();
  async function locate(name: string, from: string): Promise<string | undefined> {
    for (const search of createRequire(join(from, "package.json")).resolve.paths(name) ?? []) {
      const candidate = join(search, name); try { if ((await stat(join(candidate, "package.json"))).isFile()) return candidate; } catch {}
    }
  }
  async function copy(source: string) {
    if (copied.has(source)) return; copied.add(source);
    const path = relative(modules, source); if (path.startsWith("..") || isAbsolute(path)) throw new Error("内置 pi 依赖不在项目 node_modules 中，拒绝复制外部配置");
    const metadata = JSON.parse(await readFile(join(source, "package.json"), "utf8")); const destination = join(target, "node_modules", path);
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination, { recursive: true, filter: (file) => !relative(source, file).split(sep).includes("node_modules") });
    const required = metadata.dependencies ?? {}; const optional = { ...metadata.optionalDependencies, ...metadata.peerDependencies };
    for (const name of new Set([...Object.keys(required), ...Object.keys(optional)])) {
      const dependency = await locate(name, source);
      if (dependency) await copy(dependency); else if (name in required && !(name in (metadata.optionalDependencies ?? {}))) throw new Error(`缺少内置 pi 生产依赖：${name}`);
    }
  }
  const root = await locate("@earendil-works/pi-coding-agent", project); if (!root) throw new Error("缺少固定版本的内置 pi");
  const metadata = JSON.parse(await readFile(join(root, "package.json"), "utf8")); if (metadata.version !== "1.4.0") throw new Error("内置 pi 版本必须是 1.4.0");
  await copy(root); await mkdir(join(target, "bin"), { recursive: true });
  // 仅给内置引擎的子进程使用，绝不安装进用户 PATH 或改 shell 配置。
  await writeFile(join(target, "bin", "node"), '#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "$PI_DESK_ENGINE_EXECUTABLE" "$@"\n', { mode: 0o755 });
  await writeFile(join(target, "bin", "pi"), '#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "$PI_DESK_ENGINE_EXECUTABLE" "$PI_DESK_ENGINE_ENTRY" "$@"\n', { mode: 0o755 });
  await writeFile(join(target, "manifest.json"), JSON.stringify({ pi: metadata.version, packages: copied.size }, null, 2));
  console.log(`内置 pi 1.4.0 已打包：${copied.size} 个已锁定依赖包，未复制用户配置。`);
}
