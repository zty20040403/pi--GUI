import { execFile } from "node:child_process";
import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
const root = resolve("."); const staging = resolve(".pi-desk/desktop-app"); const runtime = resolve(".pi-desk/desktop-runtime");
// 只清理两处明确的构建缓存，绝不触碰用户项目/对话；清理仍用废纸篓。
for (const path of [staging, runtime]) {
  try { await stat(path); await promisify(execFile)("trash", [path]); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
await mkdir(join(staging, "electron"), { recursive: true }); await mkdir(join(runtime, "server"), { recursive: true });
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
await writeFile(join(staging, "package.json"), JSON.stringify({ name: "pi-desk", productName: "pi desk", version: packageJson.version, description: packageJson.description, author: "pi desk", main: "electron/main.cjs", dependencies: {} }, null, 2));
await cp(join(root, "electron"), join(staging, "electron"), { recursive: true });
await cp(join(root, "dist"), join(runtime, "dist"), { recursive: true });
await cp(join(root, "pi-extension"), join(runtime, "pi-extension"), { recursive: true });
// 把纯目录映射辅助代码打进 App 自己的扩展；不引入/打包另一份 pi 引擎。
await build({ entryPoints: [join(root, "pi-extension/desk-session-map.ts")], outfile: join(runtime, "pi-extension/desk-session-map.ts"), bundle: true, platform: "node", format: "esm", target: "node22", sourcemap: false });
await build({ entryPoints: [join(root, "server/index.ts")], outfile: join(runtime, "server/index.mjs"), bundle: true, platform: "node", format: "esm", target: "node22", sourcemap: false,
  banner: { js: 'import { createRequire as deskCreateRequire } from "node:module"; const require = deskCreateRequire(import.meta.url);' },
});
console.log("桌面运行资源已生成：独立后台、网页和权限扩展；不打包用户 Node/pi 或配置。");
