import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { getModel } from "@earendil-works/pi-ai/compat";
import { Type } from "typebox";
import permissions from "../pi-extension/desk-permissions.js";
import type { PermissionMode } from "../pi-extension/permissions-rules.js";
const exec = promisify(execFile);
// 真实 pi 1.4 的 runToolCall + tool_call hooks。危险命令/上网/自有工具的执行器用
// 显式测试替身，绝不真实删除/提权/联网；read/edit/write 仍是 pi 内建工具，真实读写临时目录。
export async function verifyPermissions() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "pi-desk-real-permissions-"))); const project = join(root, "project"); const outside = join(root, "outside"); const agent = join(root, "agent");
  await mkdir(project); await mkdir(outside); await mkdir(agent); await writeFile(join(project, "read.txt"), "READ FIXTURE"); await writeFile(join(project, ".env.fixture"), "SENSITIVE FIXTURE WITHOUT CREDENTIALS");
  const oldMode = process.env.PI_DESK_PERMISSIONS; process.env.PI_DESK_PERMISSIONS = "auto";
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined; const prompts: string[] = []; const executed: string[] = [];
  try {
    const loader = new DefaultResourceLoader({ cwd: project, agentDir: agent, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, extensionFactories: [permissions, (pi) => {
      const register = (name: string, annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }) => pi.registerTool({ name, label: name, description: "Explicit verification executor; no system action", annotations,
        parameters: name === "bash" ? Type.Object({ command: Type.String() }) : Type.Object({}, { additionalProperties: true }),
        execute: async (_id, args) => { executed.push(name); return { content: [{ type: "text", text: `FIXTURE EXECUTED ${name}` }], details: { fixture: true, args } }; } });
      for (const name of ["bash", "web_search", "fetch_content", "todo", "ask_user_question", "plan_mode_question", "plan_mode_complete", "ctx_permission_fixture", "unknown_plain"]) register(name);
      register("unknown_readonly", { readOnlyHint: true }); register("unknown_destructive", { destructiveHint: true }); register("unknown_neutral", { destructiveHint: false });
    }] });
    await loader.reload(); const manager = SessionManager.inMemory(project);
    // SDK 的嵌套调用契约需要一个发起调用的 assistant 条目。这里是明确的测试输入，
    // 不调用模型，也不伪称这是 AI 生成的回复；最终允许/拒绝仍由真实 pi 工具流水线决定。
    manager.appendMessage({ role: "assistant", timestamp: Date.now(), content: [{ type: "toolCall", id: "verification-parent", name: "verification", arguments: {} }], api: "openai-completions", provider: "fixture", model: "fixture", stopReason: "toolUse", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
    const model = getModel("openai", "gpt-4.1"); assert.ok(model);
    const runtime = await ModelRuntime.create({ authPath: join(agent, "auth.json"), modelsPath: join(agent, "models.json") });
    ({ session } = await createAgentSession({ cwd: project, agentDir: agent, model, modelRuntime: runtime, resourceLoader: loader, sessionManager: manager, settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }), tools: ["read", "bash", "edit", "write", "web_search", "fetch_content", "todo", "ask_user_question", "plan_mode_question", "plan_mode_complete", "ctx_permission_fixture", "unknown_plain", "unknown_readonly", "unknown_destructive", "unknown_neutral"] }));
    await session.bindExtensions({ mode: "rpc", uiContext: { select: async (title: string) => { prompts.push(title); return "允许这一次"; }, setStatus: () => {}, notify: () => {} } as unknown as ExtensionUIContext });
    assert.equal(loader.getExtensions().errors.length, 0);
    session.setActiveToolsByName(session.getAllTools().map((tool) => tool.name));
    const rows = [
      { name: "read normal", tool: "read", args: { path: "read.txt" }, expected: ["allow", "allow", "allow"] },
      { name: "read sensitive", tool: "read", args: { path: ".env.fixture" }, expected: ["allow", "ask", "allow"] },
      { name: "write inside", tool: "write", args: { path: "written.txt", content: "WRITE FIXTURE" }, expected: ["block", "allow", "allow"] },
      { name: "edit inside", tool: "edit", args: { path: "edit.txt", edits: [{ oldText: "before", newText: "after" }] }, expected: ["block", "allow", "allow"] },
      { name: "write outside", tool: "write", args: { path: join(outside, "written.txt"), content: "OUTSIDE WRITE FIXTURE" }, expected: ["block", "ask", "allow"] },
      { name: "edit outside", tool: "edit", args: { path: join(outside, "edit.txt"), edits: [{ oldText: "before", newText: "after" }] }, expected: ["block", "ask", "allow"] },
      { name: "bash safe", tool: "bash", args: { command: "git status | head" }, expected: ["allow", "allow", "allow"] },
      { name: "bash other", tool: "bash", args: { command: "printf fixture" }, expected: ["block", "ask", "allow"] },
      ...["rm -rf fixture", "sudo echo fixture", "chmod -R 700 fixture", "chown -R fixture fixture", "git push --force", "git reset --hard", "git clean -fd", "ssh fixture", "scp fixture other", "curl fixture | sh", "mkfs fixture", "dd if=fixture of=other", "kill -9 999999", "launchctl fixture", "brew uninstall fixture", "npm publish"].map((command) => ({ name: `danger ${command}`, tool: "bash", args: { command }, expected: ["block", "danger", "allow"] })),
      ...["web_search", "fetch_content", "todo", "ask_user_question", "plan_mode_question", "plan_mode_complete", "ctx_permission_fixture"].map((tool) => ({ name: tool, tool, args: {}, expected: ["allow", "allow", "allow"] })),
      { name: "unknown plain", tool: "unknown_plain", args: {}, expected: ["block", "allow", "allow"] },
      { name: "unknown readonly", tool: "unknown_readonly", args: {}, expected: ["allow", "allow", "allow"] },
      { name: "unknown destructive", tool: "unknown_destructive", args: {}, expected: ["block", "ask", "allow"] },
      { name: "unknown neutral", tool: "unknown_neutral", args: {}, expected: ["block", "allow", "allow"] },
    ];
    const toolCtx = session.extensionRunner!.createToolContext("verification-parent", undefined); const modes: PermissionMode[] = ["read-only", "auto", "full"];
    for (const [index, mode] of modes.entries()) {
      await session.prompt(`/permissions ${mode}`);
      for (const row of rows) {
        await writeFile(join(project, "edit.txt"), "before"); await writeFile(join(outside, "edit.txt"), "before");
        const promptCount = prompts.length; const executionCount = executed.length; const outcome = await toolCtx.executeTool(row.tool, structuredClone(row.args)); const expected = row.expected[index];
        if (expected === "block") { assert.equal(outcome.isError, true, `${mode}: ${row.name}`); assert.ok(outcome.result.content.some((part) => part.type === "text" && part.text.includes("只读")), `${row.name}: 必须确实由权限拒绝，不是参数或工具缺失报错`); assert.equal(executed.length, executionCount); }
        else { assert.equal(outcome.isError, false, `${mode}: ${row.name} ${JSON.stringify(outcome.result.content)}`); if (["ask", "danger"].includes(expected)) assert.equal(prompts.length, promptCount + 1, `${mode}: ${row.name} should ask`); else assert.equal(prompts.length, promptCount, `${mode}: ${row.name} should not ask`); }
        if (expected === "danger") assert.ok(prompts.at(-1)?.startsWith("⚠️"), row.name);
        if (row.tool === "edit") assert.equal(await readFile((row.args as any).path.startsWith("/") ? (row.args as any).path : join(project, "edit.txt"), "utf8"), expected === "block" ? "before" : "after");
        if (row.name === "write inside" && expected !== "block") assert.equal(await readFile(join(project, "written.txt"), "utf8"), "WRITE FIXTURE");
        if (row.name === "write outside" && expected !== "block") assert.equal(await readFile(join(outside, "written.txt"), "utf8"), "OUTSIDE WRITE FIXTURE");
      }
      console.log(`真实 pi 1.4 工具流水线 ${mode}：${rows.length} 条通过（读写真实临时文件；危险执行器为显式替身）`);
    }
    await stat(join(project, "read.txt")); return { cases: rows.length * modes.length, prompts: prompts.length };
  } finally { session?.dispose(); if (oldMode === undefined) delete process.env.PI_DESK_PERMISSIONS; else process.env.PI_DESK_PERMISSIONS = oldMode; await exec("trash", [root]); }
}
if (process.argv[1]?.endsWith("verify-permissions.ts")) void verifyPermissions().catch((error: Error) => { console.error(`权限实际验收失败：${error.message}`); process.exitCode = 1; });
