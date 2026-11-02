const { app, Menu } = require("electron");
function installMenu(action) {
  const menu = Menu.buildFromTemplate([
    { label: "pi desk", submenu: [
      { id: "about", label: "关于 pi desk", click: () => app.showAboutPanel() },
      { type: "separator" },
      { id: "settings", label: "设置…", accelerator: "CommandOrControl+,", click: () => action("settings") },
      { type: "separator" },
      { label: "隐藏 pi desk", role: "hide" }, { label: "隐藏其他应用", role: "hideOthers" }, { label: "显示全部", role: "unhide" },
      { type: "separator" },
      { id: "quit", label: "退出 pi desk", accelerator: "CommandOrControl+Q", click: () => app.quit() },
    ] },
    { label: "文件", submenu: [
      { id: "new-session", label: "新对话", accelerator: "CommandOrControl+N", click: () => action("new-session") },
      { id: "close-window", label: "关闭窗口", accelerator: "CommandOrControl+W", role: "close" },
    ] },
    { label: "编辑", submenu: [
      { label: "撤销", role: "undo" }, { label: "重做", role: "redo" }, { type: "separator" },
      { label: "剪切", role: "cut" }, { label: "复制", role: "copy" }, { label: "粘贴", role: "paste" }, { label: "全选", role: "selectAll" },
    ] },
    { label: "视图", submenu: [
      { label: "实际大小", role: "resetZoom" }, { label: "放大", role: "zoomIn" }, { label: "缩小", role: "zoomOut" }, { type: "separator" },
      { label: "进入或退出全屏", role: "togglefullscreen" },
    ] },
    { label: "窗口", submenu: [{ label: "最小化", role: "minimize" }, { label: "缩放", role: "zoom" }, { type: "separator" }, { label: "前置全部窗口", role: "front" }] },
  ]);
  Menu.setApplicationMenu(menu);
}
module.exports = { installMenu };
