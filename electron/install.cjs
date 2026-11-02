const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createRequire } = require("node:module");
// 在本机 Node 24 上，Electron 的 extract-zip 会未完成就退出。
// macOS 使用系统 ditto 解压同一个经官方 checksums 校验的包，不改用户 npm/Node 配置。
async function install() {
  if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD) return;
  const packagePath = require.resolve("electron/package.json"); const electron = path.dirname(packagePath);
  const platformPath = process.platform === "darwin" ? "Electron.app/Contents/MacOS/Electron" : process.platform === "win32" ? "electron.exe" : "electron";
  try {
    if (fs.readFileSync(path.join(electron, "path.txt"), "utf8") === platformPath && fs.existsSync(path.join(electron, "dist", platformPath))) return;
  } catch {}
  if (process.platform !== "darwin") { execFileSync(process.execPath, [path.join(electron, "install.js")], { stdio: "inherit" }); return; }
  const { version } = JSON.parse(fs.readFileSync(packagePath, "utf8")); const { downloadArtifact } = createRequire(packagePath)("@electron/get");
  const zip = await downloadArtifact({ version, artifactName: "electron", platform: "darwin", arch: process.arch, checksums: JSON.parse(fs.readFileSync(path.join(electron, "checksums.json"), "utf8")) });
  const dist = path.join(electron, "dist"); fs.mkdirSync(dist, { recursive: true });
  execFileSync("/usr/bin/ditto", ["-x", "-k", zip, dist]); fs.writeFileSync(path.join(electron, "path.txt"), platformPath);
  console.log("Electron 本机运行文件已就绪（官方校验包，macOS 系统解压）。");
}
void install().catch(() => { console.error("Electron 安装失败，请检查网络后运行 npm run desktop:install。"); process.exitCode = 1; });
