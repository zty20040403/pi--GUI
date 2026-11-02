import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { logText } from "../server/privacy.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// 真实运行 npx tsx server/index.ts，但只在内存里接收口令，不写测试日志。
export async function startBackend(options: { development?: boolean; production?: boolean; entry?: string; env?: NodeJS.ProcessEnv } = {}) {
  const npmStart = options.production && !options.entry;
  const child = spawn(options.development || npmStart ? "npm" : "npx", options.development ? ["run", "dev"] : npmStart ? ["start"] : ["tsx", options.entry ?? "server/index.ts"], {
    cwd: ROOT, detached: true, env: { ...process.env, ...options.env, NODE_ENV: options.production ? "production" : "development" }, stdio: ["ignore", "pipe", "pipe"],
  });
  const closed = new Promise<void>((done) => child.once("close", () => done()));
  const { LaunchUrl } = createRequire(import.meta.url)("../electron/runtime.cjs"); const parser = new LaunchUrl();
  let diagnostics = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => { diagnostics = (diagnostics + logText(chunk)).slice(-4096); });
  const signal = (kind: NodeJS.Signals) => {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      try { process.kill(-child.pid, kind); } catch {}
    }
  };
  const stop = async () => {
    signal("SIGTERM");
    const timer = setTimeout(() => signal("SIGKILL"), 12_000);
    try { await closed; } finally { clearTimeout(timer); }
  };
  try {
    const url = await new Promise<string>((done, reject) => {
      const timer = setTimeout(() => reject(new Error("后台启动超时")), 30_000);
      const finish = (error?: Error, value?: string) => {
        clearTimeout(timer);
        child.stdout.off("data", onData);
        child.off("error", onError);
        child.off("close", onClose);
        if (error) reject(error); else done(value!);
      };
      const onData = (chunk: string) => {
        try { const url = parser.feed(chunk); if (url) finish(undefined, url); } catch { finish(new Error("后台启动输出异常")); }
      };
      const onError = (error: Error) => finish(error);
      const onClose = () => finish(new Error(`后台提前退出：${diagnostics || "请确认所选端口未被占用"}`));
      child.stdout.on("data", onData);
      child.once("error", onError);
      child.once("close", onClose);
    });
    return { url, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
