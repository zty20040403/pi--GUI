import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createDeskServer } from "../server/index.js";
import { AppSettings } from "../server/settings.js";
import { PiPool } from "../server/pi-pool.js";
import { PiProcess } from "../server/pi-process.js";
import { ChangeStore } from "../server/change-store.js";
import { logText } from "../server/privacy.js";
import { DeskClient } from "./ws-client.js";
const exec = promisify(execFile);
export async function phase10Fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "pi-desk-phase10-"))); const cwd = join(root, "project"); const agent = join(root, "agent"); const sessions = join(root, "sessions"); const settings = new AppSettings(join(root, "app/settings.json"));
  for (const path of [join(cwd, "src"), agent, join(sessions, "fixture-project")]) await mkdir(path, { recursive: true });
  await symlink(join(homedir(), ".pi/agent/models.json"), join(agent, "models.json"));
  await writeFile(join(agent, "settings.json"), JSON.stringify({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off" }));
  const before = Array.from({ length: 90 }, (_, index) => `// unchanged line ${index + 1}`).join("\n") + "\nexport const answer = 1;\n";
  await writeFile(join(cwd, "src/math.ts"), before); await writeFile(join(cwd, "notes.md"), "# Notes\n\nStatus: pending\n");
  await exec("git", ["init", "-q"], { cwd }); await exec("git", ["add", "."], { cwd }); await exec("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "before changes"], { cwd });
  const create = () => {
    const pool = new PiPool({ createProcess: (directory, args) => new PiProcess(directory, { args: ["--offline", "-ne", "-ns", "-np", "--session-dir", join(sessions, "fixture-project"), ...args, "--model", "cliproxy/gpt-6-luna", "--thinking", "low"], env: { PI_CODING_AGENT_DIR: agent, PI_DESK_APP_SETTINGS_FILE: settings.path, PI_SESSIONS_DIR: sessions } }) });
    return createDeskServer({ pool, sessionsDir: sessions, appSettings: settings, development: false });
  };
  return { root, cwd, settings, before, create, cleanup: () => exec("trash", [root]) };
}
export const changePrompt = '请实际完成这三项文件修改：1) 用 edit 将 src/math.ts 中 export const answer = 1; 改为 export const answer = 42;，其他行不变。2) 用 edit 将 notes.md 中 Status: pending 改为 Status: ready，其他行不变。3) 用 write 新建 src/created.ts，内容恰好是 "export const created = true;\\nexport const version = 1;\\n"（\\n 表示真正换行）。禁止用 bash 改文件，不要做其他修改。完成后简短回复。';
async function main() {
  const f = await phase10Fixture(); let desk = f.create(); let client: DeskClient | undefined; const records: any[] = [];
  try {
    await desk.listen(); client = new DeskClient(desk.auth.launchUrl); await client.ready; client.on("record", (row) => records.push(row));
    const opened = await client.open(f.cwd); assert.equal(opened.state.model.provider, "cliproxy"); assert.equal(opened.state.model.id, "gpt-6-luna"); assert.equal(opened.state.thinkingLevel, "low");
    const settled = client.waitFor((row) => row.op === "event" && row.record?.type === "agent_settled", 180000);
    await client.rpc(f.cwd, { type: "prompt", message: changePrompt }); await settled;
    assert.equal(await readFile(join(f.cwd, "src/math.ts"), "utf8"), f.before.replace("answer = 1", "answer = 42")); assert.equal(await readFile(join(f.cwd, "notes.md"), "utf8"), "# Notes\n\nStatus: ready\n"); assert.equal(await readFile(join(f.cwd, "src/created.ts"), "utf8"), "export const created = true;\nexport const version = 1;\n");
    const state = await client.rpc(f.cwd, { type: "get_state" }); const params = new URLSearchParams({ cwd: f.cwd, sessionId: state.sessionId });
    const get = async (suffix: string) => { const res = await fetch(`http://127.0.0.1:4317${suffix}`, { headers: { Authorization: `Bearer ${desk.auth.token}` } }); assert.equal(res.status, 200); return res.json(); };
    const index = await get(`/api/changes?${params}`); assert.equal(index.turns.length, 1); const turn = index.turns[0]; assert.equal(turn.status, "completed"); assert.equal(turn.files.length, 3);
    assert.deepEqual(turn.files.map((file: any) => [file.path, file.added, file.removed]), [["notes.md", 1, 1], ["src/created.ts", 2, 0], ["src/math.ts", 1, 1]]);
    assert.ok(records.some((row) => row.op === "changes_changed")); assert.ok(!records.some((row) => row.record?.type === "extension_error"));
    const view = await get(`/api/changes/review?${params}&scope=turn&turnId=${turn.id}`); assert.equal(view.files[2].before.text, f.before);
    assert.equal((await get(`/api/changes/review?${params}&scope=git`)).files.length, 3);
    const store = new ChangeStore(join(f.root, "app/changes")); const saved = await store.read(state.sessionId, turn.id); assert.ok(saved?.calls.some((call) => call.tool === "edit") && saved.calls.some((call) => call.tool === "write"));
    client.close(); await desk.close(); desk = f.create(); await desk.listen(); client = new DeskClient(desk.auth.launchUrl); await client.ready; await client.open(f.cwd, state.sessionFile);
    assert.deepEqual((await get(`/api/changes?${params}`)).turns, index.turns); console.log("第 10 阶段真实记录验收通过：系统 pi 的 edit/write 前后快照、两个修改/一个新建、+4/-2、Git 范围、后台重启恢复，Luna/low。");
  } finally { client?.close(); await desk.close(); await f.cleanup(); }
}
if (process.argv[1]?.endsWith("verify-phase10-capture.ts")) void main().catch((error: Error) => { console.error(logText(error.message)); process.exitCode = 1; });
