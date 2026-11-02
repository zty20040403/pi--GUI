export type DesktopBridge = Readonly<{
  onAction(handler: (action: "settings" | "new-session") => void): () => void;
  loadPreferences(): Promise<Record<string, string>>;
  savePreference(key: string, value: string): Promise<void>;
  pickDirectory(): Promise<{ cwd: string } | undefined>;
  openExternal(url: string): Promise<{ ok: boolean }>;
  reveal(cwd: string, path: string): Promise<{ ok: boolean }>;
}>;
declare global { interface Window { piDeskDesktop?: DesktopBridge } }
export function desktopBridge() { return window.piDeskDesktop; }
