import { valid } from "semver";
import type { CatalogPlugin } from "../shared/plugins.js";
import { HttpError } from "./http.js";
import { logText } from "./privacy.js";
export function packageName(value: unknown): string {
  if (typeof value !== "string" || value.length > 214 || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(value) || value.split("/").some((part) => part === "node_modules" || part === "favicon.ico")) throw new HttpError(400, "npm 包名格式不正确");
  return value;
}
export function exactVersion(value: unknown): string {
  if (typeof value !== "string" || value.length > 100 || valid(value) !== value) throw new HttpError(400, "请选择确切的版本号，不能使用 latest 或浮动范围"); return value;
}
export function npmSource(source: string): { name: string; version?: string } | undefined {
  const match = /^npm:((?:@[^/@]+\/)?[^/@]+)(?:@(.+))?$/.exec(source); if (!match) return;
  try { return { name: packageName(match[1]), ...(match[2] ? { version: match[2] } : {}) }; } catch { return; }
}
export function githubLink(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  const match = /^(?:git\+)?https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(value);
  if (!match || [match[1], match[2]].some((item) => item === "." || item === "..")) return;
  return `https://github.com/${match[1]}/${match[2]}`;
}
export const pluginText = (value: unknown, max = 300) => typeof value === "string" ? logText(value).replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max) : "";
export async function mapLimit<T, R>(items: T[], concurrency: number, fn: (value: T) => Promise<R>): Promise<R[]> {
  const output: R[] = []; let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => { while (cursor < items.length) { const index = cursor++; output[index] = await fn(items[index]); } })); return output;
}
export class PluginCatalog {
  private cache = new Map<string, { until: number; value: any }>();
  constructor(private readonly fetcher: typeof fetch = fetch) {}
  private async json(url: string) {
    const known = this.cache.get(url); if (known && known.until > Date.now()) return known.value;
    try {
      const response = await this.fetcher(url, { redirect: "error", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`npm HTTP ${response.status}`);
      if (Number(response.headers.get("content-length")) > 8 * 1024 * 1024) throw new Error("npm response too large");
      const reader = response.body?.getReader(); if (!reader) throw new Error("npm response empty");
      const buffers: Uint8Array[] = []; let size = 0;
      try { for (;;) { const result = await reader.read(); if (result.done) break; size += result.value.length; if (size > 8 * 1024 * 1024) throw new Error("npm response too large"); buffers.push(result.value); } }
      finally { await reader.cancel().catch(() => {}); }
      const value = JSON.parse(Buffer.concat(buffers).toString("utf8"));
      if (this.cache.size >= 200) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(url, { until: Date.now() + 5 * 60000, value }); return value;
    } catch (error) { throw Object.assign(new HttpError(502, "连接 npm 插件目录失败，请检查网络后重试。"), { details: logText(error instanceof Error ? error.message : "请求失败") }); }
  }
  async metadata(nameValue: unknown, versionValue?: unknown): Promise<CatalogPlugin> {
    const name = packageName(nameValue); const version = versionValue === undefined ? "latest" : exactVersion(versionValue);
    const data = await this.json(`https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`);
    if (data.name !== name || typeof data.version !== "string" || !valid(data.version) || version !== "latest" && data.version !== version) throw new HttpError(502, "npm 返回的插件名称或版本与请求不一致，请稍后重试");
    return { name, version: exactVersion(data.version), description: pluginText(data.description) || "作者未提供说明", author: pluginText(typeof data.author === "object" ? data.author?.name : data.author, 100), license: pluginText(data.license, 80), github: githubLink(typeof data.repository === "string" ? data.repository : data.repository?.url) };
  }
  async search(query: unknown) {
    if (typeof query !== "string" || query.length > 100 || /[\u0000-\u001f]/.test(query)) throw new HttpError(400, "搜索词不能超过 100 个字，也不能包含控制字符");
    const value = await this.json(`https://registry.npmjs.org/-/v1/search?${new URLSearchParams({ text: `keywords:pi-package ${query}`, size: "40" })}`);
    const rows: any[] = Array.isArray(value.objects) ? value.objects.slice(0, 40) : [];
    const candidates = rows.flatMap((row) => { try { return [{ ...row.package, name: packageName(row.package.name), version: exactVersion(row.package.version) }]; } catch { return []; } });
    const items = await mapLimit(candidates, 6, async (row): Promise<CatalogPlugin> => {
      let downloads: number | undefined;
      const metadata = await this.metadata(row.name, row.version).catch(() => undefined);
      try { const count = await this.json(`https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(row.name)}`); if (Number.isSafeInteger(count.downloads) && count.downloads >= 0) downloads = count.downloads; } catch { /* 下载量失败不伪造为零，也不阻止显示搜索结果。 */ }
      return { name: row.name, version: row.version, description: pluginText(row.description) || "作者未提供说明", author: pluginText(row.author?.name ?? row.publisher?.username, 100), license: metadata?.license || pluginText(row.license, 80), published: typeof row.date === "string" && Number.isFinite(Date.parse(row.date)) ? row.date : undefined, downloads, github: metadata?.github ?? githubLink(row.links?.repository ?? row.links?.homepage) };
    });
    items.sort((a, b) => (b.downloads ?? -1) - (a.downloads ?? -1)); return { items };
  }
}
