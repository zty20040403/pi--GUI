import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { appendFile, mkdir, mkdtemp, readFile, realpath, rename, stat, truncate, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { SessionSync } from "../server/session-sync.js";
import { PiProcess } from "../server/pi-process.js";
import { PiPool } from "../server/pi-pool.js";
import { createDeskServer } from "../server/index.js";
import { initialState, reducer } from "../src/api/state.js";
import { DeskClient } from "./ws-client.js";
const exec = promisify(execFile);
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
const header = (cwd: string) => JSON.stringify({ type: "session", version: 3, id: "sync-fixture", cwd }) + "\n";
const entry = (id: string, text: string) => ({ type: "message", id, parentId: null, timestamp: "2026-11-02T00:00:00.000Z", message: { role: "user", timestamp: 1, content: text } });
async function fixture() { const root = await realpath(await mkdtemp(join(tmpdir(), "pi-desk-sync-"))); const path = join(root, "fixture.jsonl"); await writeFile(path, header(root)); return { root, path }; }

// 仅这个测试对象模拟 RPC 的内存条目；下面的 HTTP/WS 测试实际启动独立 pi 测试进程。
function memoryPi(root: string, path: string, entries: unknown[] = []) {
  const memory = { cwd: root, sessionFile: path, exited: false, entries, request: async () => ({ success: true, data: { entries: memory.entries } }) };
  return memory as typeof memory & PiProcess;
}

test("sessions 真实 recursive watch 防抖，新建/改名/移走广播；监听失败用轮询回退", async () => {
  const { root, path } = await fixture(); const sync = new SessionSync(root, { debounceMs: 30, pollMs: 60000 }); let events = 0;
  sync.on("projects_changed", () => events++); sync.start();
  try {
    const dir = join(root, "nested"); await mkdir(dir); const nested = join(dir, "new.jsonl"); await writeFile(nested, header(root)); await appendFile(nested, JSON.stringify(entry("one", "first")) + "\n");
    await pause(150); assert.equal(events, 1, "一串文件事件合并为一次推送");
    await rename(nested, join(dir, "renamed.jsonl")); await pause(150); assert.equal(events, 2);
    await exec("trash", [dir]); await pause(150); assert.equal(events, 3);
  } finally { sync.close(); }
  const fallback = new SessionSync(root, { debounceMs: 5, pollMs: 30, watch: (() => { throw new Error("fixture watch unavailable"); }) as any }); let fallbackEvents = 0;
  fallback.on("projects_changed", () => fallbackEvents++); fallback.start();
  try { await appendFile(path, "\n"); await pause(110); assert.ok(fallbackEvents >= 1); }
  finally { fallback.close(); await exec("trash", [root]); }
});

test("外部条目逐内容核对，不误报自己写入；外部追加/篡改即锁定，显式重新载入才清除", async () => {
  const { root, path } = await fixture(); const pi = memoryPi(root, path); const sync = new SessionSync(root); let changes = 0; sync.on("external_changed", () => changes++);
  try {
    await sync.track(pi); assert.equal(await sync.check(pi), false);
    const own = entry("one", "self"); pi.entries.push(own); await appendFile(path, JSON.stringify(own) + "\n");
    assert.equal(await sync.check(pi), false); await sync.assertWritable(pi); assert.equal(changes, 0);
    const shutdown = { type: "custom", id: "shutdown", parentId: "one", customType: "fixture-state", data: { count: 1 } };
    // 模拟 pi 先读取新 manager，再在旧 manager 的 shutdown 里 appendEntry；新内存没有这个条目。
    sync.observe(pi, { type: "entry_appended", entry: shutdown }); await appendFile(path, JSON.stringify(shutdown) + "\n");
    assert.equal(await sync.check(pi), false, "有真实自身事件指纹的 shutdown 写入不能误报");
    const external = entry("two", "terminal"); await appendFile(path, JSON.stringify(external) + "\n");
    assert.equal(await sync.check(pi), true); await assert.rejects(sync.assertWritable(pi), /重新载入/); assert.equal(changes, 1);
    pi.entries.push(external); assert.equal(await sync.check(pi), true, "未重新载入不能自行解除锁定");
    await sync.track(pi, true); assert.equal(await sync.check(pi), false);
    const before = await stat(path); await writeFile(path, (await readFile(path, "utf8")).replace("self", "evil")); await utimes(path, before.atime, before.mtime);
    assert.equal(await sync.check(pi), true, "长度/mtime 一样也不能忽略条目篡改"); assert.equal(changes, 2);
  } finally { sync.close(); await exec("trash", [root]); }
});

test("未持久化的空对话创建不会误报，半行禁止发送，截断/移走文件锁定", async () => {
  const { root, path } = await fixture(); await exec("trash", [path]); const pi = memoryPi(root, path); const sync = new SessionSync(root, { debounceMs: 60000 });
  try {
    await sync.track(pi); await sync.assertWritable(pi);
    await writeFile(path, header(root)); await sync.assertWritable(pi);
    await appendFile(path, '{"type":"message"'); await assert.rejects(sync.assertWritable(pi), /正在写入/);
    await writeFile(path, header(root)); await sync.assertWritable(pi);
    const own = entry("one", "self"); pi.entries.push(own); await appendFile(path, JSON.stringify(own) + "\n"); await sync.assertWritable(pi);
    await truncate(path, Buffer.byteLength(header(root))); await assert.rejects(sync.assertWritable(pi), /重新载入/);
    await sync.track(pi, true); await exec("trash", [path]); await assert.rejects(sync.assertWritable(pi), /重新载入/);
  } finally { sync.close(); await exec("trash", [root]); }
});

test("真实 HTTP/WS：App 自己的写入不警告，外部修改推送、后台拒绝绕过发送，强制 switch 后恢复历史", async () => {
  const { root, path } = await fixture();
  const pool = new PiPool({ permissionsEnabled: false, createProcess: (cwd) => new PiProcess(cwd, { binary: process.execPath, args: [resolve("scripts/fixtures/fake-pi.mjs")] }) });
  const desk = createDeskServer({ pool, sessionsDir: root, syncOptions: { debounceMs: 20, pollMs: 60000 } }); let client: DeskClient | undefined;
  try {
    await desk.listen(); client = new DeskClient(desk.auth.launchUrl); await client.ready;
    const opened = await client.open(root, path); assert.equal(opened.sync.externalChanged, false);
    const self = entry("self", "App own message"); await client.rpc(root, { type: "test_append", entry: self }); await pause(100);
    assert.equal(pool.size, 1); await client.rpc(root, { type: "prompt", message: "must stay available" });
    const external = entry("terminal", "TERMINAL MESSAGE FIXTURE"); await appendFile(path, JSON.stringify(external) + "\n");
    const changed = await client.waitFor((message) => message.op === "session_sync", 3000); assert.equal(changed.state.externalChanged, true);
    await assert.rejects(client.rpc(root, { type: "prompt", message: "must not get to pi" }), /重新载入/);
    client.send({ op: "open", cwd: root, sessionPath: path, reload: true }); const reload = await client.waitFor((message) => message.op === "opened", 3000);
    assert.equal(reload.sync.externalChanged, false); assert.ok(reload.messages.some((message: any) => message.content === "TERMINAL MESSAGE FIXTURE"));
    await client.rpc(root, { type: "prompt", message: "available after reload" });
  } finally { client?.close(); await desk.close(); await exec("trash", [root]); }
});

test("前端外部修改标记按对话隔离，打开快照恢复锁定状态", () => {
  const state = { ...initialState, session: { sessionFile: "/selected.jsonl" } };
  assert.equal(reducer(state, { type: "event", now: 0, value: { type: "desk_session_sync", sessionPath: "/other.jsonl", externalChanged: true } }).externalChanged, false);
  const dirty = reducer(state, { type: "event", now: 0, value: { type: "desk_session_sync", sessionPath: "/selected.jsonl", externalChanged: true } }); assert.equal(dirty.externalChanged, true);
  assert.equal(reducer(dirty, { type: "event", now: 0, value: { type: "agent_settled" } }).externalChanged, true);
});
