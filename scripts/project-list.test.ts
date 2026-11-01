import assert from "node:assert/strict";
import { test } from "node:test";
import { filterProjects, projectGroups, readRecents, rememberProject, RECENTS_KEY } from "../src/api/projects.js";
import { RpcClient } from "../src/api/client.js";
import type { Project } from "../src/api/types.js";

test("项目按最近使用分组，虚拟新对话不重复，搜索同时匹配名字和首句", () => {
  const projects: Project[] = [{ cwd: "/a", sessions: [{ id: "a1", cwd: "/a", path: "/a1.jsonl", title: "第一句话", name: "改过的名字", mtime: 10 }] },
    { cwd: "/b", sessions: [{ id: "b1", cwd: "/b", path: "/b1.jsonl", title: "另一句", mtime: 20 }] }];
  const recents = rememberProject([], "/c", 30);
  const groups = projectGroups(projects, recents, { cwd: "/c", sessionPath: "/c1.jsonl", id: "c1", title: "新对话" });
  assert.deepEqual(groups.map((project) => project.cwd), ["/c", "/b", "/a"]);
  assert.equal(groups[0].sessions[0].virtual, true);
  assert.equal(filterProjects(groups, "第一句")[0].sessions[0].name, "改过的名字");
  assert.equal(filterProjects(groups, "改过")[0].sessions[0].path, "/a1.jsonl");
  assert.equal(filterProjects(groups, "/b")[0].cwd, "/b");
  assert.equal(projectGroups(projects, [], { cwd: "/a", sessionPath: "/a1.jsonl", id: "a1", title: "already saved" }).flatMap((project) => project.sessions).length, 2);
  const storage = { getItem: (key: string) => key === RECENTS_KEY ? JSON.stringify([{ cwd: "bad", openedAt: 2 }, { cwd: "/a", openedAt: 3 }]) : null } as Storage;
  assert.deepEqual(readRecents(storage), [{ cwd: "/a", openedAt: 3 }]);
  assert.equal(rememberProject([{ cwd: "/a", openedAt: 1 }], "/a", 2).length, 1);
});
class Socket {
  readyState = 0; onopen?: () => void; onmessage?: (event: { data: string }) => void; onclose?: () => void; onerror?: () => void;
  sent: any[] = [];
  send(value: string) { this.sent.push(JSON.parse(value)); }
  close() { this.readyState = 3; this.onclose?.(); }
  start() { this.readyState = 1; this.onopen?.(); }
  receive(value: object) { this.onmessage?.({ data: JSON.stringify(value) }); }
}
test("打开期间其他项目事件仍通知，删除当前会话后重连不再请求已删路径", () => {
  const sockets: Socket[] = []; const events: any[] = [];
  const client = new RpcClient("fixture", "ws://127.0.0.1:4317/ws", () => { const socket = new Socket(); sockets.push(socket); return socket as unknown as WebSocket; });
  client.subscribe((event) => events.push(event));
  try {
    client.connect({ cwd: "/a", sessionPath: "/a1.jsonl" }); sockets[0].start();
    sockets[0].receive({ op: "event", cwd: "/b", sessionPath: "/b1.jsonl", record: { type: "agent_start" } });
    assert.equal(events.find((event) => event.kind === "event")?.sessionPath, "/b1.jsonl");
    sockets[0].receive({ op: "opened", cwd: "/a", state: { sessionFile: "/a1.jsonl" }, messages: [], stats: {}, models: [], commands: [] });
    sockets[0].receive({ op: "session_deleted", cwd: "/a", sessionPath: "/a1.jsonl" });
    assert.ok(events.find((event) => event.kind === "deleted")?.selected); assert.equal(client.selectedSessionPath, undefined);
    client.reconnect(); sockets[1].start(); assert.deepEqual(sockets[1].sent[0], { op: "open", cwd: "/a" });
  } finally { client.dispose(); }
});
