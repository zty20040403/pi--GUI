import { http, TOKEN_KEY } from "./storage";
import type { CatalogPlugin, PluginAction, PluginConfirmation, PluginJob, PluginSnapshot, PluginUpdate } from "../../shared/plugins";
const token = () => sessionStorage.getItem(TOKEN_KEY) ?? "";
function manual<T>(path: string, body: unknown, event: { isTrusted: boolean }) {
  if (!event.isTrusted) return Promise.reject(new Error("请在插件页面手动点击确认，不接受脚本触发的操作"));
  return http<T>(`/api/plugins/${path}`, token(), body, { "X-Pi-Desk-Action": "user-confirmed" });
}
export const pluginApi = {
  list: (refresh = false) => http<PluginSnapshot>(`/api/plugins${refresh ? "?refresh=1" : ""}`, token()),
  status: () => http<Omit<PluginSnapshot, "items">>("/api/plugins/status", token()),
  search: (query: string) => http<{ items: CatalogPlugin[] }>(`/api/plugins/search?q=${encodeURIComponent(query)}`, token()),
  updates: () => http<{ items: PluginUpdate[]; unavailable: string[] }>("/api/plugins/updates", token()),
  prepare: (action: PluginAction, event: { isTrusted: boolean }) => manual<PluginConfirmation>("prepare", action, event),
  confirm: (ticket: string, event: { isTrusted: boolean }) => manual<PluginJob>("confirm", { ticket, confirmed: true }, event),
  reload: (event: { isTrusted: boolean }) => manual<PluginJob>("reload", {}, event),
  cancelReload: (event: { isTrusted: boolean }) => manual<{ ok: boolean }>("cancel-reload", {}, event),
};
