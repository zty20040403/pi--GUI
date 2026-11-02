import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, realpath } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { WebSocket } from "ws";
import { createDeskServer } from "../server/index.js";
import { PiPool } from "../server/pi-pool.js";
import { AppSettings } from "../server/settings.js";
import { DeskClient } from "./ws-client.js";
const exec = promisify(execFile);
function rejectedWs(url: string, origin?: string) { return new Promise<number>((done, reject) => {
  const socket = new WebSocket(url, { origin, handshakeTimeout: 5000 }); socket.on("error", () => {});
  socket.once("unexpected-response", (_request, response) => { response.resume(); done(response.statusCode!); socket.terminate(); }); socket.once("open", () => { socket.close(); reject(new Error("不合法 Origin 被接受")); });
}); }
test("两个后台原子分配不同端口；HTTP Host、WS Origin 和手动操作均绑定各自实际端口", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "pi-desk-ports-"))); const servers: ReturnType<typeof createDeskServer>[] = []; const clients: DeskClient[] = [];
  try {
    for (let index = 0; index < 2; index++) { const sessionsDir = join(root, `sessions-${index}`); await mkdir(sessionsDir); const server = createDeskServer({ port: 0, development: false, pool: new PiPool(), sessionsDir, appSettings: new AppSettings(join(root, `app-${index}/settings.json`)) }); servers.push(server); await server.listen(); }
    const [first, second] = servers; assert.notEqual(first.auth.origin, second.auth.origin); assert.ok(Number(new URL(first.auth.origin).port) > 0);
    for (const server of servers) {
      const headers = { Authorization: `Bearer ${server.auth.token}` }; assert.equal((await fetch(`${server.auth.origin}/api/health`, { headers })).status, 200);
      const wrongHost = await new Promise<number>((done, reject) => { const req = request(`${server.auth.origin}/api/health`, { headers: { ...headers, Host: "evil.invalid" } }, (response) => { response.resume(); done(response.statusCode!); }); req.on("error", reject); req.end(); }); assert.equal(wrongHost, 401);
      const client = new DeskClient(server.auth.launchUrl); clients.push(client); await client.ready;
    }
    const ws = new URL(first.auth.launchUrl); ws.protocol = "ws:"; ws.pathname = "/ws";
    assert.equal(await rejectedWs(ws.toString(), second.auth.origin), 401); assert.equal(await rejectedWs(ws.toString()), 401);
    const headers = { Authorization: `Bearer ${first.auth.token}`, "Content-Type": "application/json", "X-Pi-Desk-Action": "user-confirmed", "Sec-Fetch-Dest": "empty", "Sec-Fetch-Site": "same-origin" };
    assert.equal((await fetch(`${first.auth.origin}/api/plugins/prepare`, { method: "POST", headers: { ...headers, Origin: second.auth.origin }, body: "{}" })).status, 403);
    assert.equal((await fetch(`${first.auth.origin}/api/plugins/prepare`, { method: "POST", headers: { ...headers, Origin: first.auth.origin }, body: "{}" })).status, 400);
    assert.equal((await fetch(`${first.auth.origin}/api/health`, { headers: { Authorization: `Bearer ${second.auth.token}` } })).status, 401);
  } finally { for (const client of clients) client.close(); for (const server of servers) await server.close(); await exec("trash", [root]); }
});
