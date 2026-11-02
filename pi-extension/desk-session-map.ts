// pi desk 私有桥接命令：沿用用户系统 pi，只覆盖 runtime cwd，不改原对话文件的 cwd。
import type { AgentSessionRuntime, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { lstat, open, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { mappedCwd, projectMappings } from "../shared/project-mapping.js";

export const MAP_COMMAND = "desk-open-mapped-session";
export const MAP_STATUS = "__desk_session_map";
export default function sessionMap(pi: ExtensionAPI) {
  pi.registerCommand(MAP_COMMAND, { description: "pi desk 内部目录映射（不发送给模型）", handler: async (args, ctx) => {
    if (ctx.mode !== "rpc") throw new Error("目录映射只能由 pi desk 使用");
    const request = JSON.parse(args) as { path?: unknown; requestId?: unknown };
    if (typeof request.path !== "string" || !isAbsolute(request.path) || request.path.includes("\0") || typeof request.requestId !== "string" || !/^[a-z0-9-]{1,80}$/.test(request.requestId)) throw new Error("目录映射请求格式不正确");
    const root = await realpath(process.env.PI_SESSIONS_DIR ?? join(homedir(), ".pi/agent/sessions"));
    const path = await realpath(request.path); const rel = relative(root, path); const info = await lstat(request.path);
    if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel) || !path.endsWith(".jsonl") || !info.isFile() || info.isSymbolicLink()) throw new Error("只能重新定位 pi 保存的普通对话");
    const file = await open(path, "r"); let header;
    try { const buffer = Buffer.alloc(64 * 1024); const { bytesRead } = await file.read(buffer, 0, buffer.length, 0); header = JSON.parse(buffer.subarray(0, bytesRead).toString("utf8").split("\n", 1)[0]); }
    finally { await file.close(); }
    if (header.type !== "session" || typeof header.cwd !== "string" || typeof header.id !== "string") throw new Error("这不是有效的 pi 对话");
    const settingsPath = process.env.PI_DESK_APP_SETTINGS_FILE ?? join(process.env.PI_DESK_DATA_DIR ?? join(homedir(), ".pi-desk"), "settings.json");
    if ((await stat(settingsPath)).size > 1024 * 1024) throw new Error("App 设置过大，请检查设置文件");
    const settings = JSON.parse(await readFile(settingsPath, "utf8"));
    const cwd = await realpath(mappedCwd(header.cwd, projectMappings(settings.projectMappings)));
    if (cwd !== await realpath(ctx.cwd) || cwd === header.cwd) throw new Error("这个对话没有映射到当前项目");
    // SDK 的 runtime options 正式定义了 cwdOverride；本机 RPC commandContextActions
    // 原样转发 switchSession 的 options 给 runtimeHost（rpc-mode.js），不修改安装的 pi。
    const options: Parameters<AgentSessionRuntime["switchSession"]>[1] = {
      cwdOverride: cwd,
      withSession: async (fresh) => { fresh.ui.setStatus(MAP_STATUS, `${request.requestId}:ok`); },
    };
    const result = await ctx.switchSession(path, options);
    if (result.cancelled) ctx.ui.setStatus(MAP_STATUS, `${request.requestId}:cancelled`);
    // 成功切换以后不再使用旧 ctx；UI 状态由 withSession 的 fresh ctx 发出。
  } });
}
