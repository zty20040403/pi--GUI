import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, readlink, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { logText } from "../server/privacy.js";
import { startBackend } from "./server-runner.js";
const exec = promisify(execFile); const artifacts = resolve(".pi-desk/verification");
async function digest(path: string) { const hash = createHash("sha256"); for await (const bytes of createReadStream(path)) hash.update(bytes); return hash.digest("hex"); }
async function verify(app: string) {
  await exec("codesign", ["--verify", "--deep", "--strict", app]);
  const { stderr } = await exec("codesign", ["-dv", app]); assert.match(stderr, /Identifier=io\.pi-desk\.desktop/); assert.match(stderr, /Signature=adhoc/);
  const { stdout } = await exec("plutil", ["-extract", "CFBundleIconFile", "raw", "-o", "-", join(app, "Contents/Info.plist")]); assert.match(stdout.trim(), /^[\w.-]+\.icns$/);
  assert.equal(await digest(join(app, "Contents/Resources", stdout.trim())), await digest(resolve("electron/resources/icon.icns")));
  const engine = JSON.parse(await readFile(join(app, "Contents/Resources/runtime/engine/node_modules/@earendil-works/pi-coding-agent/package.json"), "utf8")); assert.equal(engine.version, "1.4.0");
  return digest(join(app, "Contents/MacOS/pi desk"));
}
async function main() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "pi-desk-package-"))); const mount = join(root, "mounted"); let mounted = false; let browserBackend: Awaited<ReturnType<typeof startBackend>> | undefined;
  const version = JSON.parse(await readFile(resolve("package.json"), "utf8")).version as string;
  const dmg = resolve(`release/pi desk-${version}-arm64.dmg`); const zip = resolve(`release/pi desk-${version}-arm64.zip`);
  const launch = process.argv.includes("--launch"); const verificationRun = randomUUID();
  try {
    await mkdir(mount); await mkdir(artifacts, { recursive: true });
    await exec("hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", mount, dmg]); mounted = true;
    assert.equal(await readlink(join(mount, "Applications")), "/Applications"); const dmgHash = await verify(join(mount, "pi desk.app"));
    const installed = join(root, "installed/pi desk.app"); await mkdir(join(root, "installed")); await exec("ditto", ["--norsrc", "--noextattr", join(mount, "pi desk.app"), installed]); assert.equal(await verify(installed), dmgHash);
    const unzipped = join(root, "unzipped"); await mkdir(unzipped); await exec("ditto", ["-x", "-k", zip, unzipped]); assert.equal(await verify(join(unzipped, "pi desk.app")), dmgHash);
    await exec("hdiutil", ["detach", mount]); mounted = false;
    if (launch) {
      browserBackend = await startBackend({ production: true, env: { PI_DESK_PORT: "4317", PI_DESK_APP_SETTINGS_FILE: join(root, "browser-settings.json") } });
      assert.equal(new URL(browserBackend.url).port, "4317");
    }
    if (launch) await new Promise<void>((done, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", "scripts/verify-phase6.ts"], { cwd: resolve("."), env: { ...process.env, PI_DESK_VERIFY_APP: installed, PI_DESK_VERIFY_RUN: verificationRun }, stdio: "inherit" }); child.once("error", reject); child.once("exit", (code) => code === 0 ? done() : reject(new Error(`安装副本桌面验收退出：${code}`)));
    });
    if (launch) {
      const result = JSON.parse(await readFile(join(artifacts, "phase-6-mac-summary.json"), "utf8"));
      assert.equal(result.verificationRun, verificationRun, "桌面验收必须写出本次运行的结果，不能接受旧总结");
      assert.equal(result.launchServices, true);
      if (process.env.PI_DESK_VERIFY_CHANGES === "1") assert.equal(result.changesCapturedAndAppReopened, true);
    }
    await writeFile(join(artifacts, "phase-11-package-summary.json"), JSON.stringify({ dmgMountedReadOnly: true, applicationsLink: true, zipExtracted: true, allAdHocSignaturesValid: true, installedCopyValid: true, sameExecutable: true, iconMatchesSource: true, engine: "1.4.0", launchServicesAndChatVerified: launch, npmStartOn4317DuringLaunch: launch, minimalLaunchEnvironment: launch, actualDragAndLauncherClicks: "requires manual verification", sha256: { dmg: await digest(dmg), zip: await digest(zip) } }, null, 2));
    console.log(`安装包验收通过：dmg 只读挂载、应用程序链接、zip 解压、安装副本及全部 ad-hoc 签名、图标、内置 pi 1.4.0${launch ? "，并从镜像安装副本通过 LaunchServices / 真实聊天验收" : ""}。`);
  } finally { await browserBackend?.stop(); if (mounted) await exec("hdiutil", ["detach", mount]); await exec("trash", [root]); }
}
await main().catch((error) => { console.error(`第 11 阶段安装包验收失败：${logText(error instanceof Error ? error.stack ?? error.message : String(error))}`); process.exitCode = 1; });
