import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { mappedCwd } from "../shared/project-mapping.js";
import { AppSettings } from "../server/settings.js";
import { PiProcess } from "../server/pi-process.js";
import { MAP_COMMAND, MAP_STATUS } from "../pi-extension/desk-session-map.js";
import { createDeskServer } from "../server/index.js";
import { BASE_URL } from "../server/auth.js";
import { checkSessionPath, listProjects, savedSession } from "../server/sessions.js";
import { DeskClient } from "./ws-client.js";
const exec = promisify(execFile);

test("真正 HTTP/WS 项目重新指定：鉴权与路径限制、落盘后列表分组、映射下恢复历史且原 JSONL 不变", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "pi-desk-map-http-"))); const cwd = join(root, "replacement"); await mkdir(cwd); const original = join(root, "old-missing"); const dir = join(root, "sessions/encoded"); await mkdir(dir, { recursive: true });
  const path = join(dir, "fixture.jsonl"); const contents = JSON.stringify({ type: "session", version: 3, id: "http-map-fixture", cwd: original, timestamp: "2026-11-02T00:00:00.000Z" }) + "\n" + JSON.stringify({ type: "message", id: "first", parentId: null, timestamp: "2026-11-02T00:00:00.000Z", message: { role: "user", content: "HTTP MAPPING HISTORY", timestamp: 1 } }) + "\n";
  await writeFile(path, contents); const settings = new AppSettings(join(root, "app/settings.json")); const desk = createDeskServer({ sessionsDir: join(root, "sessions"), appSettings: settings }); let client: DeskClient | undefined; const owned = new Set<string>();
  try {
    await desk.listen(); const headers = { Authorization: `Bearer ${desk.auth.token}`, "Content-Type": "application/json" };
    const relocate = (body: unknown, authorized = true) => fetch(`${BASE_URL}/api/projects/relocate`, { method: "POST", headers: authorized ? headers : { ...headers, Authorization: "Bearer wrong" }, body: JSON.stringify(body) });
    assert.equal((await relocate({ cwd: original, path: cwd }, false)).status, 401); assert.equal((await relocate({ cwd: "relative", path: cwd })).status, 400);
    assert.equal((await relocate({ cwd: original, path: join(root, "bad-target") })).status, 400); assert.equal((await relocate({ cwd, path: cwd })).status, 409);
    const before = await listProjects(join(root, "sessions")); assert.equal(before[0].missing, true);
    const result = await relocate({ cwd: original, path: cwd }); assert.equal(result.status, 200); assert.equal((await result.json()).cwd, cwd);
    assert.equal(await readFile(path, "utf8"), contents, "重新指定本身只能改 App 设置");
    assert.equal(await checkSessionPath(cwd, path, join(root, "sessions"), await settings.mappings()), path);
    await assert.rejects(checkSessionPath(root, path, join(root, "sessions"), await settings.mappings()), /不属于/);
    const list = await fetch(`${BASE_URL}/api/projects`, { headers }); const project = (await list.json()).projects[0]; assert.equal(project.cwd, cwd); assert.equal(project.missing, undefined); assert.equal(project.sessions[0].originalCwd, original);
    client = new DeskClient(desk.auth.launchUrl); client.on("record", (message) => { const file = message.record?.data?.sessionFile; if (message.cwd === cwd && typeof file === "string") owned.add(file); }); await client.ready;
    const opened = await client.open(cwd, path); assert.ok(opened.messages.some((message: any) => message.content === "HTTP MAPPING HISTORY")); assert.equal(opened.sync.externalChanged, false); assert.equal(opened.ui.statuses[MAP_STATUS], undefined); assert.ok(!opened.commands.some((command: any) => command.name === MAP_COMMAND));
    assert.equal((await client.rpc(cwd, { type: "bash", command: "pwd" })).output.trim(), cwd);
    assert.ok((await readFile(path, "utf8")).startsWith(contents.split("\n")[0] + "\n"));
    assert.equal((await new AppSettings(settings.path).mappings())[original], cwd, "重新构造设置读取也必须保留映射");
  } finally {
    client?.close(); await desk.close();
    for (const file of owned) { if (file === path) continue; try { if ((await savedSession(file)).cwd === cwd) await exec("trash", [file]); } catch (error) { if (!(error as Error).message.includes("不存在")) throw error; } }
    await exec("trash", [root]);
  }
});

test("App 项目映射单独落盘、原子保存并保留其他设置，循环拒绝", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "pi-desk-mapping-"))); const path = join(root, "app/settings.json"); const settings = new AppSettings(path);
  try {
    assert.deepEqual(await settings.mappings(), {});
    await Promise.all([settings.update((data) => ({ ...data, preferenceFixture: "preserved" })), settings.update((data) => ({ ...data, projectMappings: { "/old": "/new" } }))]);
    assert.deepEqual(await settings.read(), { preferenceFixture: "preserved", projectMappings: { "/old": "/new" } });
    assert.equal((await stat(path)).mode & 0o777, 0o600); assert.equal(mappedCwd("/old", await settings.mappings()), "/new");
    assert.equal(mappedCwd("/old", { "/old": "/middle", "/middle": "/new" }), "/new"); assert.throws(() => mappedCwd("/a", { "/a": "/b", "/b": "/a" }), /循环/);
    await writeFile(path, "invalid fixture json"); await assert.rejects(settings.update(() => ({})), /没有被覆盖/); assert.equal(await readFile(path, "utf8"), "invalid fixture json");
  } finally { await exec("trash", [root]); }
});

test("真正系统 pi 的 RPC 内部映射桥：旧目录不存在也恢复历史，pwd 使用新目录；头部字节不改，重新载入也不退回旧 cwd", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "pi-desk-map-pi-"))); const cwd = join(root, "replacement"); await mkdir(cwd); const original = join(root, "old-missing");
  const path = join(root, "fixture.jsonl"); const first = JSON.stringify({ type: "session", version: 3, id: "map-fixture", cwd: original, timestamp: "2026-11-02T00:00:00.000Z" }) + "\n";
  await writeFile(path, first + JSON.stringify({ type: "message", id: "first", parentId: null, timestamp: "2026-11-02T00:00:00.000Z", message: { role: "user", content: "MAPPING ORIGINAL HISTORY", timestamp: 1 } }) + "\n");
  const settings = new AppSettings(join(root, "settings.json")); await settings.update(() => ({ projectMappings: { [original]: cwd } }));
  const pi = new PiProcess(cwd, { args: ["-ne", "-ns", "-np", "--no-session", "-e", resolve("pi-extension/desk-session-map.ts")], env: { PI_SESSIONS_DIR: root, PI_DESK_APP_SETTINGS_FILE: settings.path } });
  try {
    await pi.request({ type: "get_state" });
    for (const requestId of ["first-open", "reload"]) {
      const response = await pi.request({ type: "prompt", message: `/${MAP_COMMAND} ${JSON.stringify({ path, requestId })}` }); assert.equal(response.success, true);
      assert.equal(pi.uiSnapshot.statuses[MAP_STATUS], `${requestId}:ok`, "runtime 的 cwdOverride 必须真正被系统 pi 接受");
      const state = await pi.request({ type: "get_state" }); assert.equal((state.data as any).sessionFile, path);
      const history = await pi.request({ type: "get_messages" }); assert.ok((history.data as any).messages.some((message: any) => message.content === "MAPPING ORIGINAL HISTORY"));
      const result = await pi.request({ type: "bash", command: "pwd" }); assert.equal(result.success, true); assert.equal((result.data as any).output.trim(), cwd);
      assert.ok((await readFile(path, "utf8")).startsWith(first), "不能改写原对话头部中的旧 cwd");
    }
  } finally { await pi.dispose(); await exec("trash", [root]); }
});
