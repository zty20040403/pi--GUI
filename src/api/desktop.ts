export type DesktopBridge = Readonly<{
  pickDirectory(): Promise<{ cwd: string } | undefined>;
  reveal(cwd: string, path: string): Promise<{ ok: boolean }>;
}>;
declare global { interface Window { piDeskDesktop?: DesktopBridge } }
export function desktopBridge() { return window.piDeskDesktop; }
