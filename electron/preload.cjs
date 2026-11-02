const { contextBridge, ipcRenderer } = require("electron");
// 不暴露 ipcRenderer、文件读取、shell 或后台口令，子框架没有此接口。
if (process.isMainFrame) contextBridge.exposeInMainWorld("piDeskDesktop", Object.freeze({
  pickDirectory: () => ipcRenderer.invoke("desktop:pick-directory"),
  reveal: (cwd, path) => ipcRenderer.invoke("desktop:reveal", cwd, path),
}));
