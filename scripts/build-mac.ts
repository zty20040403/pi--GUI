import { spawn, execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, realpath, stat, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { macAppPath, macBuildDirectory } from "./desktop-paths.js";
const exec = promisify(execFile); const root = resolve("."); const release = join(root, "release");
async function run(command: string, args: string[]) { await new Promise<void>((done, reject) => { const child = spawn(command, args, { cwd: root, stdio: "inherit" }); child.once("error", reject); child.once("exit", (code) => code === 0 ? done() : reject(new Error(`构建命令退出：${code}`))); }); }
async function trashExisting(path: string) { try { await stat(path); await exec("trash", [path]); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
if (process.platform !== "darwin") throw new Error("macOS 安装包必须在 Mac 上构建");
await run("npm", ["run", "build"]); await run(process.execPath, ["--import", "tsx", "scripts/build-desktop.ts"]);
// Desktop 等同步目录会在签名期间重新写入 FinderInfo；在非同步临时目录封装完整成品。
const staging = await realpath(await mkdtemp(join(tmpdir(), "pi-desk-sign-")));
try {
  await run(join(root, "node_modules/.bin/electron-builder"), ["--config", "electron-builder.yml", "--mac", ...(process.argv.includes("--dist") ? ["dmg", "zip"] : []), "--arm64", ...(process.argv.includes("--dist") ? [] : ["--dir"]), "--publish", "never", `-c.directories.output=${staging}`]);
  const app = join(staging, "mac-arm64/pi desk.app"); await run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);
  await mkdir(release, { recursive: true }); await mkdir(macBuildDirectory, { recursive: true }); await trashExisting(macAppPath);
  await run("ditto", ["--norsrc", "--noextattr", app, macAppPath]);
  await run("codesign", ["--verify", "--deep", "--strict", macAppPath]);
  await trashExisting(join(release, "mac-arm64"));
  for (const file of await readdir(staging)) if (/\.(dmg|zip|blockmap)$/.test(file)) { const destination = join(release, file); await copyFile(join(staging, file), destination); }
  console.log("macOS 成品已通过 ad-hoc 签名验证；安装包位于 release，本地 App 位于 ~/Library/Caches/pi-desk/build/pi desk.app。");
} finally { await exec("trash", [staging]); }
