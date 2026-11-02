import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { BASE_URL } from "../server/auth.js";
import { createDeskServer } from "../server/index.js";
import { AppSettings } from "../server/settings.js";
import { PiPool } from "../server/pi-pool.js";
import { PiProcess } from "../server/pi-process.js";
import { DeskClient } from "./ws-client.js";
const exec = promisify(execFile);
test("插件变更拒绝非页面请求、重复确认；重新加载等待所有项目/弹窗且可取消", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "pi-desk-plugin-http-"))); const paths = [join(root, "one"), join(root, "two")]; const agentDir = join(root, "agent"); const sessionsDir = join(root, "sessions"); for (const path of [...paths, agentDir, sessionsDir]) await mkdir(path);
  let created = 0;
  const pool = new PiPool({ createProcess: (cwd, args) => { created++; return new PiProcess(cwd, { binary: process.execPath, args: [resolve("scripts/fixtures/fake-pi.mjs"), ...args] }); } });
  const server = createDeskServer({ pool, sessionsDir, appSettings: new AppSettings(join(root, "app/settings.json")), pluginOptions: { agentDir, run: async (args) => args[0] === "list" ? "No packages installed." : "1.4.0" } }); let client: DeskClient | undefined;
  try {
    await server.listen(); const authorization = { Authorization: `Bearer ${server.auth.token}` }; const headers = { ...authorization, "Content-Type": "application/json", Origin: BASE_URL, "X-Pi-Desk-Action": "user-confirmed", "Sec-Fetch-Dest": "empty", "Sec-Fetch-Site": "same-origin" };
    const post = (path: string, body: object, custom = headers) => fetch(`${BASE_URL}/api/plugins/${path}`, { method: "POST", headers: custom, body: JSON.stringify(body) });
    const list = await fetch(`${BASE_URL}/api/plugins`, { headers: authorization }).then((response) => response.json()); const item = list.items.find((row: any) => row.name === "builtin:mcp");
    for (const custom of [{ ...headers, Authorization: "Bearer invalid" }, { ...headers, Origin: "https://evil.invalid" }, { ...authorization, "Content-Type": "application/json" }]) assert.ok((await post("prepare", { kind: "toggle", id: item.id, enabled: false }, custom as typeof headers)).status >= 400);
    const prepared = await post("prepare", { kind: "toggle", id: item.id, enabled: false }).then((response) => response.json()); assert.ok(prepared.ticket); assert.equal((await server.plugins.settings.snapshot()).data.extensions, undefined);
    assert.equal((await post("confirm", { ticket: prepared.ticket, confirmed: true })).status, 202); assert.equal((await post("confirm", { ticket: prepared.ticket, confirmed: true })).status, 409);
    while (server.plugins.status().job?.status === "running") await new Promise((done) => setTimeout(done, 10)); assert.deepEqual((await server.plugins.settings.snapshot()).data.extensions, ["-builtin:mcp"]);
    client = new DeskClient(server.auth.launchUrl); await client.ready; for (const path of paths) await client.open(path); assert.equal(created, 2);
    const working = await pool.get(paths[1]); await working.request({ type: "test_busy", enabled: true });
    assert.equal((await post("reload", {})).status, 202); await new Promise((done) => setTimeout(done, 250)); assert.equal(created, 2); assert.equal(server.plugins.status().reload, "waiting");
    await assert.rejects(client.rpc(paths[0], { type: "prompt", message: "不能插入新任务" }), /重新加载/);
    assert.equal((await post("cancel-reload", {})).status, 200); while (server.plugins.status().job?.status === "running") await new Promise((done) => setTimeout(done, 20)); assert.equal(created, 2); assert.equal(working.exited, false);
    await working.request({ type: "test_busy", enabled: false }); await working.request({ type: "ui_request", request: { id: "question", method: "confirm", title: "待回答" } });
    await post("reload", {}); await new Promise((done) => setTimeout(done, 250)); assert.equal(created, 2);
    const resolved = working.ui.claim({ id: "question", confirmed: false }); await working.send(resolved);
    const done = await client.waitFor((message) => message.op === "plugins_reload" && message.state === "finished" && message.restarted, 5000); assert.ok(done.restarted); assert.equal(created, 4); assert.equal(server.plugins.status().needsReload, false); assert.equal(working.exited, true);
  } finally { client?.close(); await server.close(); await exec("trash", [root]); }
});
