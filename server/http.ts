import type { IncomingMessage } from "node:http";

export class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export async function readJson(req: IncomingMessage, limit = 16 * 1024): Promise<Record<string, unknown>> {
  if (req.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase() !== "application/json") throw new HttpError(415, "请使用 application/json");
  const body = await new Promise<Buffer>((resolve, reject) => {
    let size = 0; const chunks: Buffer[] = [];
    const clean = () => { req.off("data", data); req.off("end", end); req.off("error", error); req.off("aborted", aborted); };
    const error = (cause: Error) => { clean(); reject(cause); };
    const aborted = () => error(new HttpError(400, "请求已中断"));
    const data = (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) { clean(); req.resume(); reject(new HttpError(413, "请求太大")); return; }
      chunks.push(chunk);
    };
    const end = () => { clean(); resolve(Buffer.concat(chunks)); };
    req.on("data", data); req.once("end", end); req.once("error", error); req.once("aborted", aborted);
  });
  try {
    const value: unknown = JSON.parse(body.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new HttpError(400, "请发送 JSON 对象"); }
}
