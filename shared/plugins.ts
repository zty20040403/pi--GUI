import type { ErrorInfo } from "./errors";
export type PluginKind = "npm" | "git" | "local" | "builtin";
export type InstalledPlugin = {
  id: string; kind: PluginKind; name: string; version?: string; description: string; enabled: boolean;
  managed: boolean; installed: boolean; canToggle: boolean; canRemove: boolean; reason?: string; github?: string;
};
export type CatalogPlugin = { name: string; version: string; description: string; author?: string; downloads?: number; published?: string; license?: string; github?: string };
export type PluginUpdate = { id: string; name: string; current: string; next: CatalogPlugin };
export type PluginAction = { kind: "toggle"; id: string; enabled: boolean } | { kind: "remove"; id: string } | { kind: "install"; name: string; version: string } | { kind: "update"; id: string; version: string };
export type PluginConfirmation = { ticket: string; title: string; detail: string; expiresAt: number };
export type PluginJob = { id: string; title: string; status: "running" | "succeeded" | "failed"; output: string[]; error?: ErrorInfo };
export type PluginSnapshot = { items: InstalledPlugin[]; needsReload: boolean; job?: PluginJob; reload: "idle" | "waiting" | "loading"; warning?: string };
