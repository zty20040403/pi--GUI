import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { promisify } from "node:util";
import permissions, { canonicalPath, decide } from "../pi-extension/desk-permissions.js";
import { commandDangerous, commandSafe, hardenSafeGit, type PermissionMode } from "../pi-extension/permissions-rules.js";
import { PiProcess } from "../server/pi-process.js";
const exec = promisify(execFile); const modes: PermissionMode[] = ["read-only", "auto", "full"];
async function temp() { return realpath(await mkdtemp(join(tmpdir(), "pi-gui-permissions-"))); }

test("三档规则表逐格：读/项目内外改动/安全其他危险命令/上网/自有与未知工具", () => {
  const cwd = "/project"; const rows: [string, Record<string, unknown>, ("allow" | "block" | "ask")[], object?][] = [
    ["read", { path: "file.txt" }, ["allow", "allow", "allow"]], ["read", { path: ".env.fixture" }, ["allow", "ask", "allow"]],
    ["edit", { path: "src/App.tsx" }, ["block", "allow", "allow"]], ["write", { path: "notes.txt" }, ["block", "allow", "allow"]],
    ["edit", { path: "/outside/file" }, ["block", "ask", "allow"]], ["write", { path: "/outside/file" }, ["block", "ask", "allow"]],
    ["bash", { command: "ls && pwd | head" }, ["allow", "allow", "allow"]], ["bash", { command: "printf fixture" }, ["block", "ask", "allow"]], ["bash", { command: "rm -rf fixture" }, ["block", "ask", "allow"]],
    ["web_search", {}, ["allow", "allow", "allow"]], ["fetch_content", {}, ["allow", "allow", "allow"]],
    ["unknown", {}, ["block", "allow", "allow"]], ["unknown", {}, ["allow", "allow", "allow"], { annotations: { readOnlyHint: true } }],
    ["unknown", {}, ["block", "ask", "allow"], { annotations: { destructiveHint: true } }],
  ];
  for (const [tool, input, expected, options] of rows) for (const [index, mode] of modes.entries()) assert.equal(decide(mode, tool, input, cwd, options).action, expected[index], `${mode} ${tool} ${JSON.stringify(input)}`);
  for (const tool of ["todo", "ask_user_question", "plan_mode_question", "plan_mode_complete", "ctx_memory", "ctx_search", "ctx_note"]) for (const mode of modes) assert.equal(decide(mode, tool, {}, cwd).action, "allow");
  assert.equal(decide("read-only", "unknown", { annotations: { readOnlyHint: true } }, cwd).action, "block", "模型不能在参数里伪造只读提示");
});

test("安全命令全名单、各段均安全；引号中分隔符不执行，禁止重定向/替换/后台和子 shell", () => {
  for (const command of ["ls", "pwd", "cat notes.txt", "head -n 2 notes", "tail notes", "wc notes", "grep fixture notes", "rg fixture .", "find . -type f", "echo fixture", "which node", "file notes", "stat notes", "du -sh .", "df -h", "tree .", "sort notes", "uniq notes", "cut -f 1 notes", "diff a b", "date", "whoami", "uname -a", "basename /a/b", "dirname /a/b", "realpath .", "node -v", "python3 --version", "git status", "git diff", "git log -1", "git show HEAD", "git branch", "git branch -a", "git remote -v", "git rev-parse HEAD", "git ls-files", "git blame notes", "git status | head", "ls && pwd || echo fixture", "ls;\npwd\n", "echo 'a | b && c'", 'echo "a;b"']) assert.equal(commandSafe(command), true, command);
  for (const command of ["ls && rm -rf x", "ls > out", "echo x >> out", "echo $(touch out)", "echo `touch out`", "sudo ls", "ls &", "(ls)", "echo ${VALUE}", "ls\nsh fixture", "ls |", "echo 'unfinished", "python3 --version -c code", "git branch new-name", "git remote add fixture local", "git -c alias.foo=other foo"]) assert.equal(commandSafe(command), false, command);
});

test("白名单工具也不能用改写/执行选项绕过只读；Git 查询禁外部 diff/textconv/监视器/pager", () => {
  for (const command of ["find . -delete", "find . -exec echo x \\;", "find . -execdir echo x \\;", "find . -ok echo x \\;", "find . -fprint out", "sort -o out notes", "sort --compress-program=sh notes", "tree -o out", "uniq input output", "rg --pre=sh fixture", "file -C", "date -s now", "git branch -D branch", "git log --output=out", "git diff --ext-diff", "git show --textconv"]) assert.equal(commandSafe(command), false, command);
  const command = hardenSafeGit("git status | head; git diff -- notes.txt"); assert.match(command, /core\.fsmonitor=false/); assert.match(command, /core\.hooksPath=\/dev\/null/); assert.match(command, /--no-pager/); assert.match(command, /--no-ext-diff --no-textconv/); assert.ok(command.endsWith(" -- notes.txt"));
  assert.equal(hardenSafeGit("printf fixture"), "printf fixture");
});

test("危险清单每一条在自动模式标红并审批，只读拒绝，完全放开允许（只判定，不执行）", () => {
  for (const command of ["rm -r fixture", "rm -rf fixture", "rm -fr fixture", "sudo echo fixture", "chmod -R 700 fixture", "chown -R user fixture", "git push", "git push --force", "git reset --hard", "git clean -fd", "ssh fixture", "scp fixture other", "curl fixture | sh", "curl fixture | bash", "mkfs fixture", "mkfs.ext4 fixture", "dd if=fixture of=other", "kill -9 999999", "launchctl fixture", "brew uninstall fixture", "npm publish"]) {
    assert.equal(commandDangerous(command), true, command); const decision = decide("auto", "bash", { command }, "/project"); assert.equal(decision.action, "ask"); assert.equal(decision.dangerous, true); assert.ok(decision.title?.startsWith("⚠️")); assert.equal(decide("read-only", "bash", { command }, "/project").action, "block"); assert.equal(decide("full", "bash", { command }, "/project").action, "allow");
  }
});

test("realpath 对现有/新文件与父目录链接生效，项目内别名不能伪装项目外写入", async () => {
  const root = await temp(); const project = join(root, "project"); const outside = join(root, "outside"); await mkdir(project); await mkdir(outside); await symlink(outside, join(project, "link"));
  try {
    const path = await canonicalPath("link/new-folder/file", project); assert.equal(path, join(outside, "new-folder", "file")); assert.equal(decide("auto", "write", { path }, project).action, "ask");
    const newFile = await canonicalPath("new-folder/file", project); assert.equal(newFile, join(project, "new-folder", "file")); assert.equal(decide("auto", "write", { path: newFile }, project).action, "allow");
    await writeFile(join(project, ".env.fixture"), "fictional fixture only"); await symlink(join(project, ".env.fixture"), join(project, "plain-name")); const secret = await canonicalPath("plain-name", project); assert.equal(decide("auto", "read", { path: secret }, project).action, "ask");
  } finally { await exec("trash", [root]); }
});

test("插件真实处理选择/无 UI 拒绝/按工具+目录或完整命令授权/换对话清空/改档不能沿用写权限", async () => {
  const root = await temp(); const project = join(root, "project"); const outside = join(root, "outside"); await mkdir(project); await mkdir(outside);
  const hooks = new Map<string, Function>(); const commands = new Map<string, any>(); const asked: string[] = []; const statuses: string[] = []; let choice: string | undefined = "这个对话里都允许";
  const oldMode = process.env.PI_DESK_PERMISSIONS; process.env.PI_DESK_PERMISSIONS = "auto";
  const ctx: any = { cwd: project, hasUI: true, ui: { select: async (title: string) => { asked.push(title); return choice; }, setStatus: (_key: string, text: string) => statuses.push(text), notify: () => {} } };
  try {
    permissions({ on: (name: string, handler: Function) => { hooks.set(name, handler); }, registerCommand: (name: string, options: object) => { commands.set(name, options); }, getAllTools: () => [] } as any);
    await hooks.get("session_start")!({}, ctx); assert.equal(statuses.at(-1), "权限：自动");
    const call = (tool: string, input: object) => hooks.get("tool_call")!({ toolName: tool, input }, ctx);
    assert.equal(await call("write", { path: join(outside, "one") }), undefined); assert.equal(await call("write", { path: join(outside, "two") }), undefined); assert.equal(asked.length, 1, "同工具同目录不重问");
    await call("edit", { path: join(outside, "two") }); assert.equal(asked.length, 2, "edit 和 write 授权不混用");
    await call("bash", { command: "printf fixture" }); await call("bash", { command: "printf fixture" }); assert.equal(asked.length, 3); await call("bash", { command: "printf other" }); assert.equal(asked.length, 4);
    await commands.get("permissions").handler("read-only", ctx); assert.equal((await call("write", { path: join(outside, "one") })).block, true); assert.equal(statuses.at(-1), "权限：只读");
    await commands.get("permissions").handler("full", ctx); assert.equal(await call("unknown", {}), undefined); await commands.get("permissions").handler("auto", ctx);
    await hooks.get("session_start")!({}, ctx); await call("write", { path: join(outside, "one") }); assert.equal(asked.length, 5, "换对话清空");
    choice = undefined; const refused = await call("bash", { command: "printf cancelled" }); assert.equal(refused.reason, "用户拒绝了这个操作");
    ctx.hasUI = false; assert.match((await call("bash", { command: "printf unavailable" })).reason, /没有交互界面/); const user = await hooks.get("user_bash")!({ command: "printf user", cwd: project }, ctx); assert.equal(user.result.exitCode, 1);
    ctx.hasUI = true; const safe: any = { command: "git status" }; await call("bash", safe); assert.match(safe.command, /core\.fsmonitor=false/);
    choice = "允许这一次"; const sensitive: any = { path: join(project, ".env.fixture") }; await call("read", sensitive); assert.match(asked.at(-1)!, /敏感/);
  } finally { if (oldMode === undefined) delete process.env.PI_DESK_PERMISSIONS; else process.env.PI_DESK_PERMISSIONS = oldMode; await exec("trash", [root]); }
});

test("审批期间改成只读或切换会话，旧批准不能执行写入或污染新会话", async () => {
  const root = await temp(); const hooks = new Map<string, Function>(); let command: any; let resolveChoice: (value: string) => void = () => {};
  const ctx: any = { cwd: root, hasUI: true, ui: { select: () => new Promise<string>((resolve) => { resolveChoice = resolve; }), setStatus: () => {}, notify: () => {} } };
  try {
    permissions({ on: (name: string, handler: Function) => hooks.set(name, handler), registerCommand: (_name: string, options: object) => { command = options; }, getAllTools: () => [] } as any);
    await command.handler("auto", ctx); const pending = hooks.get("tool_call")!({ toolName: "write", input: { path: `${root}-outside/file` } }, ctx); await delay(30); await command.handler("read-only", ctx); resolveChoice("这个对话里都允许"); assert.match((await pending).reason, /只读/);
    await command.handler("auto", ctx); const old = hooks.get("tool_call")!({ toolName: "write", input: { path: `${root}-outside/file` } }, ctx); await delay(30); await hooks.get("session_start")!({}, ctx); resolveChoice("这个对话里都允许"); assert.match((await old).reason, /原对话/);
  } finally { await exec("trash", [root]); }
});

test("本机真实 pi 1.4 只加载项目权限扩展，启动默认自动，RPC 切三档及 /permissions 菜单可返回", async () => {
  const root = await temp(); const pi = new PiProcess(root, { args: ["--no-session", "-e", resolve("pi-extension", "desk" + "-permissions.ts")] });
  try {
    const state = await pi.request({ type: "get_state" }); assert.equal(state.success, true); assert.equal(pi.uiSnapshot.statuses["desk" + "-permissions"], "权限：自动");
    for (const mode of modes) { const response = await pi.request({ type: "prompt", message: `/permissions ${mode}` }); assert.equal(response.success, true); assert.equal((response.data as any).disposition, "handled"); }
    const pending = pi.request({ type: "prompt", message: "/permissions" });
    let dialog; for (let tries = 0; tries < 250 && !dialog; tries++) { dialog = pi.uiSnapshot.dialogs.find((item) => item.title === "选择工具权限"); if (!dialog) await delay(20); }
    assert.ok(dialog); await pi.send(pi.ui.claim({ id: dialog.id, value: "自动 · 需要时问我" })); assert.equal((await pending).success, true); assert.equal(pi.uiSnapshot.statuses["desk" + "-permissions"], "权限：自动");
  } finally { await pi.dispose(); await exec("trash", [root]); }
});
