import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { EngineManager, findSystemPi } from "../server/engine.js";
import { AppSettings } from "../server/settings.js";
import { PiPool } from "../server/pi-pool.js";
import { PiProcess } from "../server/pi-process.js";
import { BASE_URL } from "../server/auth.js";
import { createDeskServer } from "../server/index.js";
const exec = promisify(execFile);
async function fixture(run: (root: string, settings: AppSettings, engine: EngineManager) => Promise<void>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "pi-desk-engine-")));
  try {
    await mkdir(join(root, ".local/bin"), { recursive: true }); await writeFile(join(root, ".local/bin/pi"), "#!/bin/sh\necho 1.4.0\n", { mode: 0o755 });
    const builtinRoot = join(root, "builtin"); await mkdir(join(builtinRoot, "dist/bundle"), { recursive: true });
    await writeFile(join(builtinRoot, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "1.4.0" })); await writeFile(join(builtinRoot, "dist/bundle/cli.js"), "");
    const settings = new AppSettings(join(root, "app/settings.json")); await settings.update((data) => ({ ...data, preserved: { nested: true } }));
    const engine = new EngineManager(settings, { home: root, env: { PATH: "/usr/bin:/bin", ELECTRON_RUN_AS_NODE: "1" }, builtinRoot, executable: "/fixture/Electron", electron: true, probe: async () => "1.4.0" });
    await engine.initialize(); await run(root, settings, engine);
  } finally { await exec("trash", [root]); }
}
test("引擎自动优先系统；内置使用 Electron Node，选择持久保存且不覆盖其他设置", () => fixture(async (root, settings, engine) => {
  assert.deepEqual(engine.status().active, { kind: "system", version: "1.4.0" }); assert.equal(engine.command().env.ELECTRON_RUN_AS_NODE, undefined);
  await engine.select("builtin"); const command = engine.command(); assert.equal(command.binary, "/fixture/Electron"); assert.equal(command.env.ELECTRON_RUN_AS_NODE, "1"); assert.equal(command.env.PI_PACKAGE_DIR, join(root, "builtin"));
  assert.deepEqual((await settings.read()).preserved, { nested: true }); assert.equal((await settings.read()).engine, "builtin");
  await assert.rejects(engine.select("surprise"), /只能选择/); assert.equal(engine.status().active?.kind, "builtin");
}));
test("引擎发现排除 npm 的开发 pi；找不到系统时自动使用固定版本内置引擎", () => fixture(async (root, settings) => {
  const bin = join(root, "node_modules/.bin"); await mkdir(bin, { recursive: true }); await writeFile(join(bin, "pi"), "#!/bin/sh\n", { mode: 0o755 });
  assert.equal(await findSystemPi({ PATH: bin }, join(root, "absent")), undefined);
  const engine = new EngineManager(settings, { home: join(root, "absent"), env: { PATH: bin }, builtinRoot: join(root, "builtin"), probe: async () => "1.4.0" }); await engine.initialize();
  assert.equal(engine.status().active?.kind, "builtin"); const before = await readFile(settings.path, "utf8"); await assert.rejects(engine.select("system"), /不可用/); assert.equal(await readFile(settings.path, "utf8"), before);
}));
test("引擎切换失败会重开旧引擎并恢复原项目状态", () => fixture(async (root, _settings, engine) => {
  let failNew = true; let created = 0; const pool = new PiPool({ createProcess: (cwd, args) => { created++; return new PiProcess(cwd, { binary: process.execPath, args: [resolve("scripts/fixtures/fake-pi.mjs"), ...args] }); } });
  try {
    const old = await pool.get(root); await old.request({ type: "test_busy", enabled: false });
    await assert.rejects(pool.restartIdle(async (pi, saved) => {
      assert.equal(saved.sessionId, "fake-0"); if (engine.status().active?.kind === "builtin" && failNew) { failNew = false; throw new Error("新引擎启动失败"); } await pi.request({ type: "get_state" });
    }, { apply: () => engine.select("builtin"), rollback: () => engine.select("auto") }), /已恢复原引擎和对话/);
    assert.equal(created, 3); assert.equal(old.exited, true); assert.equal(engine.status().active?.kind, "system"); assert.equal(pool.size, 1); assert.equal(pool.idle, true);
  } finally { await pool.dispose(); }
}));
test("引擎 HTTP 只允许页面确认，拒绝忙碌切换；空闲时重启项目并保存选择", () => fixture(async (root, settings, engine) => {
  const sessionsDir = join(root, "sessions"); await mkdir(sessionsDir); let created = 0;
  const pool = new PiPool({ createProcess: (cwd, args) => { created++; return new PiProcess(cwd, { binary: process.execPath, args: [resolve("scripts/fixtures/fake-pi.mjs"), ...args] }); } });
  const server = createDeskServer({ engine, pool, sessionsDir, appSettings: settings, pluginOptions: { agentDir: join(root, "agent"), run: async () => "No packages installed." } });
  try {
    await server.listen(); const authorization = { Authorization: `Bearer ${server.auth.token}` }; const headers = { ...authorization, "Content-Type": "application/json", Origin: BASE_URL, "X-Pi-Desk-Action": "user-confirmed", "Sec-Fetch-Dest": "empty", "Sec-Fetch-Site": "same-origin" };
    const post = (custom = headers) => fetch(`${BASE_URL}/api/engine`, { method: "POST", headers: custom, body: JSON.stringify({ mode: "builtin" }) });
    assert.equal((await post({ ...headers, "X-Pi-Desk-Action": "" })).status, 403);
    const working = await pool.get(root); await working.request({ type: "test_busy", enabled: true }); assert.equal((await post()).status, 409); assert.equal(engine.status().mode, "auto"); assert.equal(created, 1);
    await working.request({ type: "test_busy", enabled: false }); const response = await post(); assert.equal(response.status, 200); assert.equal((await response.json()).active.kind, "builtin"); assert.equal(created, 2);
  } finally { await server.close(); }
}));
