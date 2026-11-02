import type { ExtensionAPI, ExtensionContext, ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { commandSafe, decide, expandedPath, hardenSafeGit, MODE_LABELS, permissionMode, sensitivePath, shellWords, type PermissionMode } from "./permissions-rules.js";
export { decide } from "./permissions-rules.js";
export async function canonicalPath(path: string, cwd: string, home = homedir()) {
  let candidate = expandedPath(path, cwd, home); const missing: string[] = [];
  while (true) {
    try { return resolve(await realpath(candidate), ...missing.reverse()); }
    catch (error) {
      if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      const parent = dirname(candidate); if (parent === candidate) throw error; missing.push(candidate.slice(parent.length + (parent.endsWith("/") ? 0 : 1))); candidate = parent;
    }
  }
}
export default function permissions(pi: ExtensionAPI) {
  let mode: PermissionMode = permissionMode(process.env.PI_DESK_PERMISSIONS); let epoch = 0;
  const grants = new Set<string>(); const home = homedir(); const key = "desk" + "-permissions";
  const roots = Promise.all([".ssh", ".gnupg", ".pi/agent/secrets", ".config/sops"].map(async (path) => { const root = resolve(home, path); try { return await canonicalPath(root, "/", home); } catch { return root; } }));
  const status = (ctx: ExtensionContext) => ctx.ui.setStatus(key, `权限：${MODE_LABELS[mode]}`);
  pi.on("session_start", async (_event, ctx) => { epoch++; grants.clear(); status(ctx); });
  pi.registerCommand("permissions", {
    description: "切换工具权限：read-only / auto / full",
    handler: async (args, ctx) => {
      let choice = args.trim();
      if (!choice) {
        if (!ctx.hasUI) { ctx.ui.notify("没有交互界面，请使用 /permissions read-only、auto 或 full", "warning"); return; }
        const labels = ["只读 · 不修改文件", "自动 · 需要时问我", "完全放开 · 不审批"];
        const selected = await ctx.ui.select("选择工具权限", labels); if (!selected) return; choice = ["read-only", "auto", "full"][labels.indexOf(selected)];
      }
      if (!["read-only", "auto", "full"].includes(choice)) { ctx.ui.notify("权限参数必须是 read-only、auto 或 full", "error"); return; }
      mode = choice as PermissionMode; status(ctx);
      if (mode === "full") ctx.ui.notify("完全放开已启用：工具不再审批，请只在可信项目中使用。", "warning");
    },
  });
  async function authorize(tool: string, input: Record<string, unknown>, ctx: ExtensionContext): Promise<ToolCallEventResult | undefined> {
    if (mode === "full") return;
    const protectedRoots = await roots;
    let commandSensitive = false;
    try {
      if (["read", "edit", "write"].includes(tool) && typeof input.path === "string") input.path = await canonicalPath(input.path, ctx.cwd, home);
      if (tool === "bash" && typeof input.command === "string" && mode === "auto" && commandSafe(input.command)) {
        for (const words of shellWords(input.command).segments) for (const word of words.slice(1)) {
          if (word.text.startsWith("-")) continue;
          const path = await canonicalPath(word.text, ctx.cwd, home); if (sensitivePath(path, home, protectedRoots)) commandSensitive = true;
        }
      }
    } catch { return { block: true, reason: "无法安全确认文件路径，已拒绝这个操作" }; }
    const annotations = pi.getAllTools().find((info) => info.name === tool)?.annotations;
    const options = { annotations, home, sensitiveRoots: protectedRoots, commandSensitive };
    let decision = decide(mode, tool, input, ctx.cwd, options);
    if (decision.action === "block") return { block: true, reason: decision.reason };
    if (decision.action === "ask" && !grants.has(decision.grantKey!)) {
      if (!ctx.hasUI) return { block: true, reason: "这个操作需要用户确认，但当前没有交互界面，已拒绝" };
      const currentEpoch = epoch;
      const choice = await ctx.ui.select(decision.title!, ["允许这一次", "这个对话里都允许", "拒绝"], { signal: ctx.signal });
      if (!["允许这一次", "这个对话里都允许"].includes(choice ?? "")) return { block: true, reason: "用户拒绝了这个操作" };
      if (currentEpoch !== epoch || ctx.signal?.aborted) return { block: true, reason: "原对话或操作已结束，批准未应用到新的对话" };
      decision = decide(mode, tool, input, ctx.cwd, options);
      if (decision.action === "block") return { block: true, reason: decision.reason };
      if (choice === "这个对话里都允许" && decision.grantKey) grants.add(decision.grantKey);
    }
    if (tool === "bash" && typeof input.command === "string" && permissionMode(mode) !== "full") input.command = hardenSafeGit(input.command);
    return;
  }
  pi.on("tool_call", async (event, ctx) => authorize(event.toolName, event.input, ctx));
  // RPC 的 bash/终端 ! 命令同样经过审批，不留另一条绕过路径。
  pi.on("user_bash", async (event, ctx) => {
    const result = await authorize("bash", { command: event.command }, ctx);
    if (result?.block) return { result: { output: result.reason ?? "操作已拒绝", exitCode: 1, cancelled: false, truncated: false } };
  });
}
