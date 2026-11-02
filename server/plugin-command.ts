import { spawn } from "node:child_process";
import { stripVTControlCharacters } from "node:util";
import { homedir } from "node:os";
import { isAbsolute } from "node:path";
import { piEnvironment } from "./pi-process.js";
import { HttpError } from "./http.js";
import { logText } from "./privacy.js";
export type PluginRunner = (args: string[], options: { agentDir: string; output?: (line: string) => void; signal?: AbortSignal }) => Promise<string>;
export function pluginRunner(binary = process.env.PI_BIN ?? "pi", env: NodeJS.ProcessEnv = process.env, prefix: string[] = []): PluginRunner {
  return (args, options) => new Promise((resolve, reject) => {
    const child = spawn(binary, [...prefix, ...args, "--no-approve"], { cwd: homedir(), env: piEnvironment({ ...env, PI_CODING_AGENT_DIR: options.agentDir, PI_OFFLINE: "1", NO_COLOR: "1", FORCE_COLOR: undefined, PI_TELEMETRY: "0" }), stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
    let output = ""; let size = 0; let exceeded = false; const buffers = { stdout: "", stderr: "" };
    let killing: NodeJS.Timeout | undefined;
    const kill = (signal: NodeJS.Signals) => { try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal); else child.kill(signal); } catch {} };
    const terminate = () => { if (killing) return; kill("SIGTERM"); killing = setTimeout(() => kill("SIGKILL"), 5000); };
    const timer = setTimeout(terminate, args[0] === "list" || args[0] === "--version" ? 30000 : 5 * 60000);
    options.signal?.addEventListener("abort", terminate, { once: true });
    const consume = (stream: "stdout" | "stderr", chunk: string) => {
      size += Buffer.byteLength(chunk); if (size > 2 * 1024 * 1024) { exceeded = true; terminate(); return; }
      if (stream === "stdout") output += chunk;
      buffers[stream] += chunk;
      let end: number;
      while ((end = buffers[stream].indexOf("\n")) >= 0) { const line = buffers[stream].slice(0, end); buffers[stream] = buffers[stream].slice(end + 1); options.output?.(logText(stripVTControlCharacters(line)).slice(0, 2000)); }
    };
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8"); child.stdout.on("data", (chunk: string) => consume("stdout", chunk)); child.stderr.on("data", (chunk: string) => consume("stderr", chunk));
    child.once("error", () => { clearTimeout(timer); reject(new HttpError(500, "无法启动 pi 插件命令，请在设置中检查当前 pi 引擎。")); });
    child.once("close", (code) => {
      clearTimeout(timer); clearTimeout(killing); options.signal?.removeEventListener("abort", terminate);
      for (const tail of Object.values(buffers)) if (tail) options.output?.(logText(stripVTControlCharacters(tail)).slice(0, 2000));
      if (code !== 0 || exceeded || options.signal?.aborted) reject(new HttpError(500, exceeded ? "插件命令输出过长，已停止。请检查下方输出后重试。" : "插件命令没有完成。请查看下方输出，检查网络或版本后重试；没有自动重复操作。"));
      else resolve(stripVTControlCharacters(output));
    });
    if (options.signal?.aborted) terminate();
  });
}
export function parsePiList(text: string) {
  const paths = new Map<string, string>(); let user = false; let source = "";
  for (const line of stripVTControlCharacters(text).split(/\r?\n/)) {
    if (line === "User packages:") { user = true; continue; } if (line === "Project packages:") { user = false; continue; }
    if (!user) continue;
    if (/^  \S/.test(line)) source = line.trim().replace(/ \(filtered\)$/, "");
    else if (/^    \S/.test(line) && source && isAbsolute(line.trim())) paths.set(source, line.trim());
  }
  return paths;
}
