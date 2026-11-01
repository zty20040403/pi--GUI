import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { BASE_URL, DeskAuth, HOST, PORT } from "./auth.js";
import { PiPool } from "./pi-pool.js";
import { sequenceOf, type RpcRecord } from "./pi-process.js";
import { checkSessionPath, listProjects } from "./sessions.js";
import { logText, publicData } from "./privacy.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".jpg": "image/jpeg", ".webp": "image/webp",
};
type ObjectRecord = Record<string, unknown>;
function isObject(value: unknown): value is ObjectRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function dataOf(response: RpcRecord): ObjectRecord {
  if (response.success !== true) throw new Error(logText(String(response.error ?? "pi 命令失败")));
  return isObject(response.data) ? response.data : {};
}

export type ServerOptions = { pool?: PiPool; development?: boolean; distDir?: string };

export function createDeskServer(options: ServerOptions = {}) {
  const development = options.development ?? process.env.NODE_ENV !== "production";
  const auth = new DeskAuth(development);
  const pool = options.pool ?? new PiPool();
  const distDir = options.distDir ?? resolve(ROOT, "dist");
  const wsServer = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  const opening = new Map<string, Promise<void>>();

  function json(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(publicData(body)));
  }

  async function serveStatic(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "不支持这个方法" });
    let root: string;
    try { root = await realpath(distDir); } catch {
      return json(res, 503, { error: "尚未生成页面，请先运行 npm run build" });
    }
    const requested = resolve(root, `.${decodeURIComponent(url.pathname)}`);
    const inside = (path: string) => {
      const rel = relative(root, path);
      return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
    };
    if (!inside(requested)) return json(res, 403, { error: "路径不允许" });
    let file: string;
    try {
      file = await realpath(requested);
      if (!inside(file)) return json(res, 403, { error: "路径不允许" });
      if (!(await stat(file)).isFile()) file = await realpath(resolve(root, "index.html"));
    } catch {
      file = await realpath(resolve(root, "index.html"));
    }
    if (!inside(file)) return json(res, 403, { error: "路径不允许" });
    const info = await stat(file);
    res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream", "Content-Length": info.size });
    if (req.method === "HEAD") return res.end();
    const stream = createReadStream(file);
    stream.on("error", () => res.destroy());
    stream.pipe(res);
  }

  async function handleHttp(req: IncomingMessage, res: ServerResponse) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (!auth.checkStatic(req)) return json(res, 401, { error: "未授权" });
    const url = new URL(req.url ?? "/", BASE_URL);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      if (!auth.checkHttp(req)) return json(res, 401, { error: "未授权" });
      if (req.method !== "GET") return json(res, 405, { error: "不支持这个方法" });
      if (url.pathname === "/api/health") return json(res, 200, { ok: true, phase: 2, processes: pool.size });
      if (url.pathname === "/api/projects") return json(res, 200, { projects: await listProjects() });
      if (url.pathname === "/api/workspace") return json(res, 200, { cwd: ROOT });
      return json(res, 404, { error: "接口不存在" });
    }
    if (!development) return serveStatic(req, res, url);
    // npm run dev 的页面由 Vite 提供；启动网址仍从后台打印。
    res.writeHead(302, { Location: `http://127.0.0.1:5173${url.pathname}${url.search}`, "Cache-Control": "no-store" });
    res.end();
  }

  const server = createServer((req, res) => {
    void handleHttp(req, res).catch(() => {
      if (!res.headersSent) json(res, 500, { error: "请求处理失败" });
      else res.destroy();
    });
  });
  server.on("upgrade", (req, socket, head) => {
    if (!auth.checkWs(req)) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    wsServer.handleUpgrade(req, socket, head, (ws) => wsServer.emit("connection", ws, req));
  });

  function send(ws: WebSocket, value: unknown) {
    if (ws.readyState !== WebSocket.OPEN) return;
    // 断开不读事件的页面，避免一个坏连接耗尽后台内存。
    if (ws.bufferedAmount > 8 * 1024 * 1024) return ws.terminate();
    ws.send(JSON.stringify(publicData(value)), (error) => { if (error) ws.terminate(); });
  }
  function broadcast(value: unknown) {
    for (const ws of wsServer.clients) send(ws, value);
  }
  const diagnostics = new Map<string, string>();
  pool.on("record", (cwd: string, record: RpcRecord, seq: number) => broadcast({ op: "event", cwd, record, seq }));
  pool.on("exit", (cwd: string, reason: string) => {
    const tail = diagnostics.get(cwd);
    if (tail) process.stderr.write(`[pi] ${logText(tail)}\n`);
    diagnostics.delete(cwd);
    broadcast({ op: "exit", cwd, reason: logText(reason) });
  });
  pool.on("stderr", (cwd: string, chunk: string) => {
    // 先拼成整行再脱敏，避免凭据/地址恰好被切在两个 chunk 之间。
    let buffer = (diagnostics.get(cwd) ?? "") + chunk;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      process.stderr.write(`[pi] ${logText(buffer.slice(0, newline))}\n`);
      buffer = buffer.slice(newline + 1);
    }
    if (buffer.length > 64 * 1024) buffer = "[过长的诊断行已省略]";
    diagnostics.set(cwd, buffer);
  });

  async function handleMessage(ws: WebSocket, message: ObjectRecord) {
    if (typeof message.cwd !== "string" || !message.cwd) throw new Error("缺少项目路径 cwd");
    if (message.op !== "open" && message.op !== "rpc" && message.op !== "ui_response") throw new Error("未知操作");
    if (message.op === "open" && message.sessionPath !== undefined && typeof message.sessionPath !== "string") throw new Error("sessionPath 必须是字符串");
    if (message.op === "rpc" && (typeof message.reqId !== "string" || !isObject(message.cmd) || typeof message.cmd.type !== "string")) throw new Error("rpc 需要 reqId 和 cmd.type");
    if (message.op === "ui_response" && (!isObject(message.payload) || message.payload.type !== "extension_ui_response" || typeof message.payload.id !== "string")) throw new Error("弹窗回答格式不正确");
    if (message.op === "rpc" && (message.cmd as ObjectRecord).type === "extension_ui_response") throw new Error("弹窗回答请使用 ui_response");
    const pi = await pool.get(message.cwd);
    const cwd = pi.cwd;
    if (message.op === "ui_response") {
      // 不能排在 open 后面：open 自身可能正等插件弹窗的回答。
      await pi.send(message.payload as ObjectRecord);
      return;
    }
    if (message.op === "rpc") {
      await opening.get(cwd);
      const cmd = message.cmd as ObjectRecord;
      if (cmd.type === "switch_session") {
        if (typeof cmd.sessionPath !== "string") throw new Error("缺少对话路径");
        cmd.sessionPath = await checkSessionPath(cwd, cmd.sessionPath);
      }
      const response = await pi.request(cmd);
      send(ws, { op: "rpc_result", reqId: message.reqId, response });
      return;
    }
    // 同一个项目的两个 open 串行，避免混合出两个对话的状态/历史。
    const operation = (opening.get(cwd) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const current = typeof message.sessionPath === "string" ? dataOf(await pi.request({ type: "get_state" })) : undefined;
      // 刷新/重连同一活动对话时不 switch_session，否则会中断正在生成的回复。
      if (!current || current.sessionFile !== message.sessionPath) {
        const cmd = typeof message.sessionPath === "string"
          ? { type: "switch_session", sessionPath: await checkSessionPath(cwd, message.sessionPath) }
          : { type: "new_session" };
        if (dataOf(await pi.request(cmd)).cancelled === true) throw new Error("插件取消了打开对话");
      }
      const state = dataOf(await pi.request({ type: "get_state" }));
      const messageResponse = await pi.request({ type: "get_messages" });
      const messages = dataOf(messageResponse).messages;
      const stats = dataOf(await pi.request({ type: "get_session_stats" }));
      const models = dataOf(await pi.request({ type: "get_available_models" })).models;
      const commands = dataOf(await pi.request({ type: "get_commands" })).commands;
      send(ws, { op: "opened", cwd, state, messages, stats, models, commands, seq: sequenceOf(messageResponse) });
    });
    opening.set(cwd, operation);
    try { await operation; } finally { if (opening.get(cwd) === operation) opening.delete(cwd); }
  }

  wsServer.on("connection", (ws) => {
    ws.on("error", () => ws.terminate());
    ws.on("message", (raw, isBinary) => {
      let message: ObjectRecord;
      try {
        const parsed: unknown = JSON.parse(raw.toString());
        if (isBinary || !isObject(parsed)) throw new Error();
        message = parsed;
      } catch {
        return send(ws, { op: "error", message: "请发送 JSON 对象" });
      }
      void handleMessage(ws, message).catch((error: Error) => send(ws, {
        op: "error", cwd: message.cwd, reqId: message.reqId, message: logText(error.message),
      }));
    });
  });

  return {
    server, auth, pool,
    async listen() {
      await new Promise<void>((done, reject) => {
        server.once("error", reject);
        server.listen(PORT, HOST, () => { server.off("error", reject); done(); });
      });
    },
    async close() {
      for (const ws of wsServer.clients) ws.terminate();
      wsServer.close();
      const closed = new Promise<void>((done) => server.close(() => done()));
      server.closeAllConnections();
      await pool.dispose();
      await closed;
    },
  };
}

async function main() {
  const desk = createDeskServer();
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    void desk.close().catch(() => { process.exitCode = 1; });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  try {
    await desk.listen();
    // 唯一打印口令的地方：本机启动网址。不要把它保存到日志或提交。
    console.log(`pi desk 后台已启动：${desk.auth.launchUrl}`);
  } catch (error) {
    await desk.close();
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: Error) => { console.error(logText(error.message)); process.exitCode = 1; });
}
