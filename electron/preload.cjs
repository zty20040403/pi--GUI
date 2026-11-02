const { contextBridge, ipcRenderer } = require("electron");
// 不暴露 ipcRenderer、文件读取、shell 或后台口令，子框架没有此接口。
if (process.isMainFrame) contextBridge.exposeInMainWorld("piDeskDesktop", Object.freeze({
  onAction: (handler) => { const listener = (_event, action) => { if (["settings", "new-session"].includes(action)) handler(action); }; ipcRenderer.on("desktop:action", listener); return () => ipcRenderer.removeListener("desktop:action", listener); },
  loadPreferences: () => ipcRenderer.invoke("desktop:load-preferences"),
  savePreference: (key, value) => ipcRenderer.invoke("desktop:save-preference", key, value),
  pickDirectory: () => ipcRenderer.invoke("desktop:pick-directory"),
  openExternal: (url) => ipcRenderer.invoke("desktop:open-external", url),
  reveal: (cwd, path) => ipcRenderer.invoke("desktop:reveal", cwd, path),
}));
