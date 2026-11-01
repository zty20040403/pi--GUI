import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, realpath, stat, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { BASE_URL } from "../server/auth.js";
import { checkDirectory } from "../server/directories.js";
import { createDeskServer } from "../server/index.js";
import { PiPool } from "../server/pi-pool.js";
import { PiProcess } from "../server/pi-process.js";
import { savedSession } from "../server/sessions.js";
import { DeskClient } from "./ws-client.js";
const exec = promisify(execFile);

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "pi-desk-actions-")));
  const sessions = join(root, "sessions"); await mkdir(sessions);
  const path = join(sessions, `fixture-${randomUUID()}.jsonl`);
  await writeFile(path, JSON.stringify({ type: "session", id: randomUUID(), cwd: root }) + "\n");
  return { root, sessions, path };
}
test("目录检查支持空格/软链接/~，拒绝文件、相对路径和不存在目录", async () => {
  const { root } = await fixture();
  try {
    const folder = join(root, "folder with spaces"); await mkdir(folder); await symlink(folder, join(root, "alias"));
    assert.equal(await checkDirectory(folder), folder); assert.equal(await checkDirectory(join(root, "alias")), folder);
    assert.equal(await checkDirectory("~"), await realpath(homedir()));
    await writeFile(join(root, "file"), "fixture");
    for (const path of ["", "relative", join(root, "file"), join(root, "missing")]) await assert.rejects(checkDirectory(path));
  } finally { await exec("trash", [root]); }
});

test("删除校验不要求旧项目仍存在，拒绝非会话、越界和软链接", async () => {
  const { root, sessions, path } = await fixture();
  try {
    await writeFile(path, JSON.stringify({ type: "session", id: "old", cwd: join(root, "deleted-project") }) + "\n");
    assert.equal((await savedSession(path, sessions)).id, "old");
    await writeFile(join(sessions, "bad.jsonl"), JSON.stringify({ type: "configuration" }));
    await symlink(path, join(sessions, "alias.jsonl"));
    for (const value of [join(sessions, "bad.jsonl"), join(sessions, "alias.jsonl"), resolve("package.json"), "relative.jsonl"]) await assert.rejects(savedSession(value, sessions));
  } finally { await exec("trash", [root]); }
});

test("真实 POST 鉴权/请求限制，忙对话拒绝删除，空闲关闭后真实移到废纸篓并广播", async () => {
  const { root, sessions, path } = await fixture();
  const pool = new PiPool({ permissionsEnabled: false, createProcess: (cwd) => new PiProcess(cwd, { binary: process.execPath, args: [resolve("scripts/fixtures/fake-pi.mjs")] }) });
  const desk = createDeskServer({ pool, sessionsDir: root });
  let client: DeskClient | undefined;
  try {
    await desk.listen();
    const headers = { Authorization: `Bearer ${desk.auth.token}`, "Content-Type": "application/json" };
    const post = (endpoint: string, body: unknown, extra = {}) => fetch(`${BASE_URL}${endpoint}`, { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(body) });
    assert.equal((await post("/api/check-dir", { path: root }, { Authorization: "Bearer wrong" })).status, 401);
    assert.equal((await post("/api/check-dir", { path: root }, { "Content-Type": "text/plain" })).status, 415);
    assert.equal((await post("/api/check-dir", { path: "x".repeat(20000) })).status, 413);
    assert.equal((await post("/api/check-dir", [])).status, 400);
    const checked = await post("/api/check-dir", { path: root }); assert.equal(checked.status, 200); assert.equal((await checked.json()).cwd, root);
    assert.equal((await post("/api/sessions/delete", { path: resolve("package.json") })).status, 403);
    assert.equal((await post("/api/sessions/delete", { path: join(sessions, "missing.jsonl") })).status, 404);
    client = new DeskClient(desk.auth.launchUrl); await client.ready; await client.open(root);
    await client.rpc(root, { type: "test_session_file", path }); await client.rpc(root, { type: "get_state" }); await client.rpc(root, { type: "test_busy", enabled: true });
    assert.equal((await post("/api/sessions/delete", { path })).status, 409); assert.ok((await stat(path)).isFile());
    await assert.rejects(client.open(root), /还在回复/);
    await client.rpc(root, { type: "test_busy", enabled: false });
    const deleted = client.waitFor((message) => message.op === "session_deleted");
    const response = await post("/api/sessions/delete", { path }); assert.equal(response.status, 200);
    assert.equal((await deleted).sessionPath, path); assert.equal(pool.size, 0);
    await assert.rejects(stat(path));
    // macOS 禁止枚举废纸篓，但允许检查已知文件的元数据，不读取其他垃圾内容。
    assert.ok((await stat(join(homedir(), ".Trash", basename(path)))).isFile(), "必须在真实 macOS 废纸篓中找到文件");
    const list = await fetch(`${BASE_URL}/api/projects`, { headers }); assert.deepEqual((await list.json()).projects, []);
  } finally { client?.close(); await desk.close(); await exec("trash", [root]); }
});

test("trash 失败只报错，不永久删除也不广播成功", async () => {
  const { root, path } = await fixture();
  const desk = createDeskServer({ sessionsDir: root, trash: async () => { throw new Error("fixture failure"); } });
  try {
    await desk.listen();
    const response = await fetch(`${BASE_URL}/api/sessions/delete`, { method: "POST", headers: { Authorization: `Bearer ${desk.auth.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ path }) });
    assert.equal(response.status, 500); assert.match((await response.json()).error, /没有永久删除/); assert.ok(await readFile(path, "utf8"));
  } finally { await desk.close(); await exec("trash", [root]); }
});
