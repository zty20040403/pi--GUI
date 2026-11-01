import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { BASE_URL } from "../server/auth.js";
import { logText } from "../server/privacy.js";
import { type Project } from "../server/sessions.js";
import { startBackend } from "./server-runner.js";

async function run(command: string, args: string[], env = process.env) {
  await new Promise<void>((done, reject) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk: Buffer) => process.stdout.write(logText(chunk.toString())));
    child.stderr.on("data", (chunk: Buffer) => process.stderr.write(logText(chunk.toString())));
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? done() : reject(new Error(`${command} ${args.join(" ")} 失败（${code}）`)));
  });
}

// 独立读 JSONL，不调用 listProjects；不打印用户的路径、标题或任何对话内容。
async function expectedSessions() {
  const root = process.env.PI_SESSIONS_DIR ?? join(homedir(), ".pi/agent/sessions");
  const summaries: { path: string; id: string; cwd: string; title: string; name?: string }[] = [];
  for (const dir of await readdir(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const folder = join(root, dir.name);
    for (const name of await readdir(folder)) {
      if (!name.endsWith(".jsonl")) continue;
      const path = join(folder, name);
      let lines: string[];
      try { lines = (await readFile(path, "utf8")).split("\n"); } catch { continue; }
      let header;
      try { header = JSON.parse(lines[0]); } catch { continue; }
      if (header.type !== "session" || typeof header.cwd !== "string" || typeof header.id !== "string") continue;
      let title = "";
      let latestName: string | undefined;
      for (const line of lines.slice(1)) {
        let entry;
        try { entry = JSON.parse(line); } catch { continue; }
        if (entry.type === "session_info") latestName = typeof entry.name === "string" ? entry.name || undefined : undefined;
        if (entry.type !== "message" || entry.message?.role !== "user" || title) continue;
        const content = entry.message.content;
        const text = typeof content === "string" ? content : Array.isArray(content)
          ? content.flatMap((part: { type: string; text?: string }) => part?.type === "text" && typeof part.text === "string" ? [part.text] : []).join(" ") : "";
        title = text.trim().slice(0, 80);
      }
      summaries.push({ path, id: header.id, cwd: header.cwd, title: title || "（空对话）", ...(latestName ? { name: latestName } : {}) });
    }
  }
  return summaries;
}

async function main() {
  await run("npm", ["run", "typecheck"]);
  console.log("验收 1/5 通过：类型检查无错误");
  await run("npm", ["test"]);
  const backend = await startBackend();
  try {
    console.log("验收 2/5 通过：npx tsx server/index.ts 正常启动并打印带随机口令的网址（口令不记入验收日志）");
    const headers = { Authorization: `Bearer ${new URL(backend.url).searchParams.get("token")}` };
    const health = await fetch(`${BASE_URL}/api/health`, { headers });
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);
    await run("npx", ["tsx", "scripts/smoke.ts"], { ...process.env, PI_DESK_URL: backend.url });
    console.log("验收 3/5 通过：smoke 输出 ok 和花费，等待到 agent_settled");
    assert.equal((await fetch(`${BASE_URL}/api/projects`)).status, 401);
    console.log("验收 4/5 通过：不带口令访问 /api/projects 返回 401");
    const response = await fetch(`${BASE_URL}/api/projects`, { headers });
    assert.equal(response.status, 200);
    const projects: Project[] = (await response.json()).projects;
    const actual = projects.flatMap((project) => project.sessions.map(({ path, id, cwd, title, name }) => {
      assert.equal(cwd, project.cwd);
      return { path, id, cwd, title, ...(name ? { name } : {}) };
    }));
    const expected = await expectedSessions();
    const sort = <T extends { path: string }>(items: T[]) => items.sort((a, b) => a.path.localeCompare(b.path));
    // 内容只在内存比对；失败时也不把差异（用户的私人对话）写入日志。
    assert.ok(JSON.stringify(sort(actual)) === JSON.stringify(sort(expected)), "API 列表与真实 JSONL 文件的路径、id、项目、首句或最后名字不一致");
    for (const project of projects) {
      assert.ok(project.sessions.every((session, index) => index === 0 || project.sessions[index - 1].mtime >= session.mtime));
    }
    assert.ok(projects.every((project, index) => index === 0 || projects[index - 1].sessions[0].mtime >= project.sessions[0].mtime));
    console.log(`验收 5/5 通过：${projects.length} 个项目、${actual.length} 个对话与真实 sessions 文件逐项一致，排序正确`);
    console.log("第 1 阶段全部验收通过。");
  } finally { await backend.stop(); }
}

void main().catch((error: Error) => {
  console.error(`第 1 阶段验收失败：${logText(error.message)}`);
  process.exitCode = 1;
});
