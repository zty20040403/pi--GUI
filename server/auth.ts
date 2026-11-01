import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

export const HOST = "127.0.0.1";
export const PORT = 4317;
export const BASE_URL = `http://${HOST}:${PORT}`;

export class DeskAuth {
  readonly token = randomBytes(32).toString("hex");

  constructor(private readonly development = process.env.NODE_ENV !== "production") {}

  private checkHost(req: IncomingMessage): boolean {
    return req.headers.host === `${HOST}:${PORT}` || req.headers.host === `localhost:${PORT}`;
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
    const allowedOrigins = [BASE_URL, `http://localhost:${PORT}`];
    if (this.development) allowedOrigins.push("http://127.0.0.1:5173", "http://localhost:5173");
    // 命令行客户端也必须带 Origin，不能靠省略它绕过检查。
    if (!req.headers.origin || !allowedOrigins.includes(req.headers.origin)) return false;
    try {
      const url = new URL(req.url ?? "/", BASE_URL);
      return url.pathname === "/ws" && url.searchParams.getAll("token").length === 1 && this.checkToken(url.searchParams.get("token"));
    } catch {
      return false;
    }
  }

  checkStatic(req: IncomingMessage): boolean {
    return this.checkHost(req);
  }

  get launchUrl(): string {
    return `${BASE_URL}/?token=${this.token}`;
  }
}
