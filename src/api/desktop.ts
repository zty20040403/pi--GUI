export type DesktopBridge = Readonly<{
  pickDirectory(): Promise<{ cwd: string } | undefined>;
  openExternal(url: string): Promise<{ ok: boolean }>;
  reveal(cwd: string, path: string): Promise<{ ok: boolean }>;
}>;
declare global { interface Window { piDeskDesktop?: DesktopBridge } }
export function desktopBridge() { return window.piDeskDesktop; }
