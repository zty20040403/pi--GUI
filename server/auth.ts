import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

export const HOST = "127.0.0.1";
// 浏览器和测试的固定端口默认 4317；桌面传 0，由操作系统原子分配空闲端口。
const customPort = Number(process.env.PI_DESK_PORT);
export const PORT = Number.isInteger(customPort) && customPort > 1024 && customPort < 65536 ? customPort : 4317;
export const BASE_URL = `http://${HOST}:${PORT}`;

export class DeskAuth {
  readonly token = randomBytes(32).toString("hex");

  constructor(private readonly development = process.env.NODE_ENV !== "production", private boundPort = PORT) {}
  bindPort(port: number) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("后台端口无效");
    this.boundPort = port;
  }
  get origin() { return `http://${HOST}:${this.boundPort}`; }
  private get origins() {
    const values = [this.origin, `http://localhost:${this.boundPort}`];
    if (this.development) values.push("http://127.0.0.1:5173", "http://localhost:5173");
    return values;
  }

  private checkHost(req: IncomingMessage): boolean {
    return req.headers.host === `${HOST}:${this.boundPort}` || req.headers.host === `localhost:${this.boundPort}`;
  }

  private checkToken(value: string | undefined | null): boolean {
    if (!value || value.length !== this.token.length) return false;
    const actual = Buffer.from(value);
    const expected = Buffer.from(this.token);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  checkHttp(req: IncomingMessage): boolean {
    const authorization = req.headers.authorization;
    return this.checkHost(req) && this.checkToken(authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined);
  }

  checkWs(req: IncomingMessage): boolean {
    if (!this.checkHost(req)) return false;
    // 命令行客户端也必须带 Origin，不能靠省略它绕过检查。
    if (!req.headers.origin || !this.origins.includes(req.headers.origin)) return false;
    try {
      const url = new URL(req.url ?? "/", this.origin);
      return url.pathname === "/ws" && url.searchParams.getAll("token").length === 1 && this.checkToken(url.searchParams.get("token"));
    } catch {
      return false;
    }
  }

  checkUserAction(req: IncomingMessage): boolean {
    return this.checkHttp(req) && !!req.headers.origin && this.origins.includes(req.headers.origin)
      && req.headers["x-pi-desk-action"] === "user-confirmed" && req.headers["sec-fetch-dest"] === "empty"
      && ["same-origin", "same-site"].includes(String(req.headers["sec-fetch-site"]));
  }

  checkStatic(req: IncomingMessage): boolean {
    return this.checkHost(req);
  }

  get launchUrl(): string {
    return `${this.origin}/?token=${this.token}`;
  }
}
