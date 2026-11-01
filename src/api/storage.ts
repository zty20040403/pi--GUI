import type { Target } from "./types";
export const TOKEN_KEY = "pi-desk.token";
export const SESSION_KEY = "pi-desk.session";
export function consumeToken(url: URL, storage: Storage, replaceUrl: (url: string) => void): string {
  const supplied = url.searchParams.get("token");
  if (supplied) storage.setItem(TOKEN_KEY, supplied);
  url.searchParams.delete("token");
  replaceUrl(url.pathname + url.search + url.hash);
  return supplied ?? storage.getItem(TOKEN_KEY) ?? "";
}
export function savedTarget(storage: Storage): Target | undefined {
  try {
    const target = JSON.parse(storage.getItem(SESSION_KEY) ?? "null");
    return typeof target?.cwd === "string" && target.cwd.startsWith("/")
      ? { cwd: target.cwd, sessionPath: typeof target.sessionPath === "string" ? target.sessionPath : undefined } : undefined;
  } catch { return undefined; }
}
export async function http<T>(path: string, token: string): Promise<T> {
  const response = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(response.status === 401 ? "口令失效，请用后台本次打印的网址重新打开" : `请求失败（${response.status}）`);
  return response.json();
}
