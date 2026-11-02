import { createHash } from "node:crypto";
import { AppSettings } from "./settings.js";
import { HttpError } from "./http.js";
import { logText } from "./privacy.js";
import type { HiddenNotice, NoticePreferences } from "../shared/notices.js";

export function noticeFingerprint(message: string): HiddenNotice {
  const text = logText(message).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").trim();
  const plugin = text.match(/^([\w.@-]{1,80})\s*[:：]/)?.[1] ?? "未标明插件";
  const builtin = text.startsWith("ccstyle: write 工具已被");
  const pattern = builtin ? "ccstyle: write 工具已被 <路径> 占用，富 diff 已让位" : text
    .replace(/["'`]((?:[A-Za-z]:[\\/]|\/|~\/)[^"'`]+)["'`]/g, "<路径>")
    .replace(/(?:[A-Za-z]:[\\/]|~?\/)[^\s，。；、）)]+/g, "<路径>")
    .replace(/\b[\w.-]+(?:[\\/][\w.-]+)+\b/g, "<路径>")
    .replace(/\d+(?:\.\d+)*/g, "<数字>").replace(/\s+/g, " ").slice(0, 1000);
  return { id: createHash("sha256").update(`${plugin}\n${pattern}`).digest("hex"), plugin, pattern, ...(builtin ? { builtin: true } : {}) };
}
export const DEFAULT_NOTICE = noticeFingerprint("ccstyle: write 工具已被 <路径> 占用，富 diff 已让位");
export class NoticeFilter {
  private hidden = new Map<string, HiddenNotice>();
  private readonly observed = new Map<string, HiddenNotice>();
  constructor(private readonly settings: AppSettings) {}
  async load() {
    const data = await this.settings.read(); this.hidden.clear();
    if (data.showDefaultCcstyleNotice !== true) this.hidden.set(DEFAULT_NOTICE.id, DEFAULT_NOTICE);
    if (Array.isArray(data.hiddenNotices)) for (const row of data.hiddenNotices) {
      if (row && typeof row.pattern === "string" && typeof row.plugin === "string" && /^[a-f0-9]{64}$/.test(row.id)) this.hidden.set(row.id, { id: row.id, plugin: row.plugin.slice(0, 80), pattern: logText(row.pattern).slice(0, 1000) });
    }
  }
  get preferences(): NoticePreferences { return { hidden: [...this.hidden.values()] }; }
  observe(message: string) {
    const notice = noticeFingerprint(message); this.observed.set(notice.id, notice);
    if (this.observed.size > 500) this.observed.delete(this.observed.keys().next().value!);
    return { id: notice.id, hidden: this.hidden.has(notice.id), plugin: notice.plugin };
  }
  async change(id: unknown, hidden: unknown) {
    if (typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id) || typeof hidden !== "boolean") throw new HttpError(400, "提醒类型格式不正确，请刷新后重试");
    const notice = this.observed.get(id) ?? this.hidden.get(id);
    if (!notice) throw new HttpError(404, "这类提醒已过期或已恢复，请刷新设置后重试");
    await this.settings.update((data) => {
      const rows = Array.isArray(data.hiddenNotices) ? data.hiddenNotices.filter((row) => row?.id !== id) : [];
      if (id === DEFAULT_NOTICE.id) return { ...data, hiddenNotices: rows, showDefaultCcstyleNotice: !hidden };
      if (hidden) rows.push(notice);
      if (rows.length > 500) throw new HttpError(400, "最多隐藏 500 类提醒，请先恢复一些");
      return { ...data, hiddenNotices: rows };
    });
    await this.load(); return this.preferences;
  }
}
