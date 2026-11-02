import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, realpath, symlink, utimes, writeFile } from "node:fs/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { test } from "node:test";
import { WebSocket } from "ws";
import { BASE_URL, DeskAuth } from "../server/auth.js";
import { createDeskServer } from "../server/index.js";
import { PiPool } from "../server/pi-pool.js";
import { PiProcess, piEnvironment } from "../server/pi-process.js";
import { logText, publicData } from "../server/privacy.js";
import { checkSessionPath, listProjects } from "../server/sessions.js";
import { DeskClient } from "./ws-client.js";

const fake = resolve("scripts/fixtures/fake-pi.mjs");
const exec = promisify(execFile);
async function temp() { return realpath(await mkdtemp(join(tmpdir(), "pi-desk-test-"))); }
async function cleanup(path: string) { await exec("trash", [path]); }
const makePi = (cwd: string, args: string[] = []) => new PiProcess(cwd, { binary: process.execPath, args: [fake, ...args], requestTimeoutMs: 1000 });
function request(headers: IncomingMessage["headers"], url = "/ws"): IncomingMessage { return { headers, url } as IncomingMessage; }

// 不并发占用固定端口，也不调用模型。真实模型另由 smoke 验收。
test("pi 子进程用用户 PATH，不让 npm 开发 SDK 的同名 pi 替换用户配置的启动器", () => {
  const env = piEnvironment({ PATH: "/project/node_modules/.bin:/cache/npm/node_modules/.bin/:/Users/fixture/.local/bin:/usr/bin", NORMAL_SETTING: "fixture" });
  assert.equal(env.PATH, "/Users/fixture/.local/bin:/usr/bin"); assert.equal(env.NORMAL_SETTING, "fixture");
});

test("随机口令、HTTP Host/Bearer 和 WS Host/Origin/query 校验", () => {
  const auth = new DeskAuth(true);
  assert.match(auth.token, /^[a-f0-9]{64}$/);
  assert.notEqual(auth.token, new DeskAuth().token);
  const valid = { host: "127.0.0.1:4317", authorization: `Bearer ${auth.token}` };
  assert.ok(auth.checkHttp(request(valid)));
  assert.ok(auth.checkHttp(request({ ...valid, host: "localhost:4317" })));
  for (const host of ["evil.invalid:4317", "127.0.0.1:5173", "127.0.0.1", "localhost:4317.evil.invalid", undefined]) {
    assert.equal(auth.checkHttp(request({ ...valid, host })), false);
  }
  for (const authorization of [undefined, "", "Bearer wrong", `Basic ${auth.token}`, `Bearer ${"汉".repeat(64)}`]) {
    assert.equal(auth.checkHttp(request({ ...valid, authorization })), false);
  }
  for (const origin of [BASE_URL, "http://localhost:4317", "http://127.0.0.1:5173", "http://localhost:5173"]) {
    assert.ok(auth.checkWs(request({ ...valid, origin }, `/ws?token=${auth.token}`)));
  }
  for (const origin of [undefined, "null", "http://evil.invalid", "http://127.0.0.1:5173.evil.invalid"]) {
    assert.equal(auth.checkWs(request({ ...valid, origin }, `/ws?token=${auth.token}`)), false);
  }
  assert.equal(auth.checkWs(request({ ...valid, origin: BASE_URL }, "/ws")), false);
  assert.equal(auth.checkWs(request({ ...valid, origin: BASE_URL }, `/other?token=${auth.token}`)), false);
  assert.equal(auth.checkWs(request({ ...valid, origin: BASE_URL }, `/ws?token=${auth.token}&token=${auth.token}`)), false);
  const production = new DeskAuth(false);
  assert.equal(production.checkWs(request({ host: valid.host, origin: "http://127.0.0.1:5173" }, `/ws?token=${production.token}`)), false);
});

test("连接配置和凭据不出现在客户端数据/日志，正常内容不变", () => {
  const credential = "sk-" + "fixturecredential";
  const data = publicData({ model: { id: "test", baseUrl: "private-model-endpoint", headers: { authorization: credential } }, statusKey: "mc", text: `Bearer ${credential}` });
  assert.deepEqual(data, { model: { id: "test" }, statusKey: "mc", text: "Bearer [已隐藏]" });
  assert.equal(logText("failed https://example.invalid/path token=placeholder"), "failed [连接地址已隐藏] token=[已隐藏]");
  assert.deepEqual(publicData({ response: { error: "failed https://example.invalid/path" } }), { response: { error: "failed [连接地址已隐藏]" } });
  assert.equal(publicData("汉字\u2028段落\u2029结束"), "汉字\u2028段落\u2029结束");
});

test("JSONL 多字节/Unicode 分隔符/CRLF、id 关联、事件、stderr、超时和退出", async () => {
  const cwd = await temp();
  const pi = makePi(cwd);
  try {
    const fragment = await pi.request({ type: "fragment" });
    assert.equal(fragment.data, "汉字\u2028段落\u2029结束");
    const [echo, other] = await Promise.all([pi.request({ type: "inspect", id: "client-id" }), pi.request({ type: "inspect" })]);
    assert.notEqual(echo.id, "client-id");
    assert.notEqual(echo.id, other.id);
    const event = once(pi, "record");
    await pi.request({ type: "event" });
    assert.equal((await event)[0].type, "test_event");
    const stderr = once(pi, "stderr");
    await pi.request({ type: "stderr" });
    assert.match((await stderr)[0], /fixture diagnostic/);
    await assert.rejects(pi.request({ type: "hang" }), /timed out/);
    assert.equal(pi.pendingCount, 0);
    const exit = once(pi, "exit");
    await assert.rejects(pi.request({ type: "crash" }), /exited/);
    assert.match((await exit)[0], /3/);
    await assert.rejects(pi.request({ type: "get_state" }), /not running/);
  } finally { await pi.dispose(); await cleanup(cwd); }
  const missing = new PiProcess(process.cwd(), { binary: "/nonexistent/pi-desk-fixture" });
  try { await assert.rejects(missing.request({ type: "get_state" }), /ENOENT/); } finally { await missing.dispose(); }
});

test("进程池复用/并发/软链接、权限插件参数、退出删除、空闲回收但不杀忙进程", async () => {
  const cwd = await temp();
  const link = join(cwd, "project link");
  await symlink(cwd, link);
  const extension = join(cwd, "permissions with spaces.ts");
  await writeFile(extension, "// fixture\n");
  let now = 0;
  let started = 0;
  const pool = new PiPool({ permissionsPath: extension, idleTimeoutMs: 100, sweepIntervalMs: 10, now: () => now,
    createProcess: (path, args) => { started++; return makePi(path, args); } });
  try {
    const [a, b, c] = await Promise.all([pool.get(cwd), pool.get(cwd), pool.get(link)]);
    assert.equal(a, b); assert.equal(b, c); assert.equal(started, 1); assert.equal(pool.size, 1);
    const inspected = await a.request({ type: "inspect" });
    assert.ok((inspected.data as { argv: string[] }).argv.includes(extension));
    assert.ok((inspected.data as { argv: string[] }).argv.includes("-e"));
    a.emit("record", { type: "agent_start" });
    now = 1000;
    await delay(30);
    assert.equal(pool.size, 1);
    a.emit("record", { type: "agent_end" });
    await delay(30);
    assert.equal(pool.size, 1, "agent_end 不能被当成完全空闲");
    a.emit("record", { type: "agent_settled" });
    const exit = once(pool, "exit");
    await exit;
    assert.equal(pool.size, 0);
    const next = await pool.get(cwd);
    assert.notEqual(next, a);
    assert.equal(started, 2);
  } finally { await pool.dispose(); await cleanup(cwd); }
  const plain = new PiPool({ permissionsPath: "/nonexistent/permissions.ts", createProcess: makePi });
  try {
    const pi = await plain.get(process.cwd());
    const inspected = await pi.request({ type: "inspect" });
    assert.deepEqual((inspected.data as { argv: string[] }).argv, ["-e", resolve("pi-extension/desk-session-map.ts"), "-e", resolve("pi-extension/desk-changes.ts"), "--mode", "rpc"]);
  } finally { await plain.dispose(); }
});

test("对话列表包含空对话、首句/最后名字/排序，并容忍坏行和非目录", async () => {
  const root = await temp();
  const folder = join(root, "sessions");
  await mkdir(folder);
  const create = async (name: string, id: string, cwd: string, entries: object[], mtime: number) => {
    const path = join(folder, name + ".jsonl");
    await writeFile(path, [JSON.stringify({ type: "session", id, cwd }), ...entries.map((entry) => JSON.stringify(entry, null, 0)), "{truncated"].join("\n"));
    await utimes(path, mtime, mtime);
    return path;
  };
  try {
    const path = await create("one", "id-one", root, [
      { type: "message", message: { role: "user", content: [{ type: "text", text: " 第一条消息 " }] } },
      { type: "message", message: { role: "user", content: "第二条消息" } },
      { type: "session_info", name: "旧名" }, { type: "session_info", name: "新名" },
      { type: "custom", data: { type: "session_info", name: "不应覆盖" } },
    ], 2);
    await create("empty", "id-empty", root, [], 1);
    await create("other", "id-other", folder, [{ type: "message", message: { role: "user", content: "另一项目" } }], 3);
    await writeFile(join(folder, "bad.jsonl"), "not json");
    await writeFile(join(root, "not-a-directory"), "test");
    const projects = await listProjects(root);
    assert.equal(projects.length, 2);
    assert.equal(projects[0].cwd, folder);
    assert.deepEqual(projects[1].sessions.map((item) => [item.id, item.title, item.name]), [["id-one", "第一条消息", "新名"], ["id-empty", "（空对话）", undefined]]);
    assert.equal(await checkSessionPath(root, path, root), path);
    await assert.rejects(checkSessionPath(folder, path, root), /不属于/);
    await assert.rejects(checkSessionPath(root, resolve("package.json"), root), /只能打开/);
    await assert.rejects(checkSessionPath(root, "relative.jsonl", root), /绝对路径/);
    const outside = join(root, "outside-link.jsonl");
    await symlink(resolve("package.json"), outside);
    await assert.rejects(checkSessionPath(root, outside, root), /只能打开/);
    assert.deepEqual(await listProjects(join(root, "missing")), []);
  } finally { await cleanup(root); }
});

async function rejectedWs(url: string, origin?: string, host?: string): Promise<number> {
  const ws = new WebSocket(url, { origin, headers: host ? { Host: host } : undefined, handshakeTimeout: 3000 });
  return new Promise((done, reject) => {
    ws.once("unexpected-response", (_req, res) => { res.resume(); done(res.statusCode!); });
    ws.once("open", () => { ws.terminate(); reject(new Error("错误连接竟然被允许")); });
    ws.once("error", reject);
  });
}

test("真实 HTTP/WS 转发、广播、UI 回答、非法请求和生产静态回退", async () => {
  const root = await temp();
  await writeFile(join(root, "index.html"), "<main>static fixture</main>");
  await writeFile(join(root, "asset.js"), "export const fixture = true;");
  await symlink(resolve("package.json"), join(root, "outside.json"));
  const pool = new PiPool({ permissionsEnabled: false, createProcess: makePi });
  const desk = createDeskServer({ pool, development: false, distDir: root });
  let a: DeskClient | undefined;
  let b: DeskClient | undefined;
  try {
    await desk.listen();
    assert.deepEqual(desk.server.address(), { address: "127.0.0.1", family: "IPv4", port: 4317 });
    assert.equal((await fetch(`${BASE_URL}/api/projects`)).status, 401);
    assert.equal((await fetch(`${BASE_URL}/api/health`)).status, 401);
    const headers = { Authorization: `Bearer ${desk.auth.token}` };
    assert.equal((await fetch(`${BASE_URL}/api/health`, { headers })).status, 200);
    // Node 的 fetch 会规范化 Host；用原生 HTTP 真正发送恶意 Host 头。
    const invalidHostStatus = await new Promise<number>((done, reject) => {
      const req = httpRequest(`${BASE_URL}/api/projects`, { headers: { ...headers, Host: "evil.invalid:4317" } }, (res) => {
        res.resume(); done(res.statusCode!);
      });
      req.on("error", reject); req.end();
    });
    assert.equal(invalidHostStatus, 401);
    assert.equal((await fetch(`${BASE_URL}/api/unknown`, { headers })).status, 404);
    assert.equal((await fetch(`${BASE_URL}/api/health`, { headers, method: "POST" })).status, 405);
    assert.equal(await rejectedWs("ws://127.0.0.1:4317/ws", BASE_URL), 401);
    const url = `ws://127.0.0.1:4317/ws?token=${desk.auth.token}`;
    assert.equal(await rejectedWs(url, "http://evil.invalid"), 401);
    assert.equal(await rejectedWs(url), 401);
    assert.equal(await rejectedWs(url, BASE_URL, "evil.invalid:4317"), 401);
    assert.equal(await rejectedWs(url, "http://127.0.0.1:5173"), 401);
    a = new DeskClient(desk.auth.launchUrl); b = new DeskClient(desk.auth.launchUrl);
    await Promise.all([a.ready, b.ready]);
    const opened = await a.open(root);
    assert.equal(opened.cwd, root);
    assert.deepEqual(opened.state.model, { id: "test", provider: "test" });
    assert.deepEqual(opened.messages, []);
    assert.deepEqual(opened.models, [{ id: "test", provider: "test" }]);
    assert.ok(Array.isArray(opened.commands));
    const [first, second] = await Promise.all([a.open(root), b.open(root)]);
    assert.notEqual(first.state.sessionId, second.state.sessionId);
    assert.equal(pool.size, 1);
    await a.rpc(root, { type: "event" });
    for (const client of [a, b]) {
      const event = await client.waitFor((message) => message.op === "event" && message.record.type === "test_event");
      assert.equal(event.record.text, "汉字\u2028段落\u2029结束");
    }
    await a.rpc(root, { type: "ui_request", request: { id: "dialog-1", method: "select", title: "fixture", options: ["允许"] } });
    const payload = { type: "extension_ui_response", id: "dialog-1", value: "允许" };
    a.send({ op: "ui_response", cwd: root, payload });
    assert.deepEqual((await b.waitFor((message) => message.op === "event" && message.record.type === "ui_received")).record.payload, payload);
    a.send({ op: "ui_response", cwd: root, payload: { type: "bash", command: "must-not-run" } });
    assert.match((await a.waitFor((message) => message.op === "error")).message, /弹窗/);
    a.socket.send("not json");
    assert.match((await a.waitFor((message) => message.op === "error")).message, /JSON/);
    a.send({ op: "unknown", cwd: root });
    assert.match((await a.waitFor((message) => message.op === "error")).message, /未知/);
    await a.rpc(root, { type: "cancel_next" });
    await assert.rejects(a.open(root), /取消/);
    await assert.rejects(a.rpc(root, { type: "switch_session", sessionPath: resolve("package.json") }));
    const exit = b.waitFor((message) => message.op === "exit");
    await assert.rejects(a.rpc(root, { type: "crash" }), /已退出/);
    assert.equal((await exit).cwd, root);
    assert.equal(pool.size, 0);
    await a.open(root);
    const asset = await fetch(`${BASE_URL}/asset.js`);
    assert.match(asset.headers.get("content-type")!, /javascript/);
    assert.equal(await asset.text(), "export const fixture = true;");
    assert.equal(await (await fetch(`${BASE_URL}/nested/route`)).text(), "<main>static fixture</main>");
    assert.equal((await fetch(`${BASE_URL}/outside.json`)).status, 403);
    assert.equal((await fetch(`${BASE_URL}/%2e%2e%2fpackage.json`)).status, 403);
  } finally { a?.close(); b?.close(); await desk.close(); await cleanup(root); }
});
