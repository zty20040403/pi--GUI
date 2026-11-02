# 第 6 阶段验收记录

范围：`PLAN.md` §4 第 6 阶段，Electron Mac 应用和 Windows SSH 远程。**Mac 必要实测通过；Windows 按 Kenneth 的真机人工反馈验收通过。**

## 实际执行的必要检查

```bash
npm run typecheck
node --check electron/main.cjs
node --check electron/preload.cjs
node --check electron/install.cjs
npm run test:desktop
npm run desktop:build
npm run verify:phase6
```

没有重复跑前五阶段的大批聊天/预览验收。4 组桌面专用测试覆盖 Finder PATH、启动口令解析、窗口位置和原生 IPC 来源校验；类型检查和打包通过。

环境：Apple 芯片 Mac、Node.js v24.16.0、用户原 pi 1.4.0。新增依赖先通过 npm view 确认：Electron **35.7.5**、electron-builder **26.18.0**、esbuild **0.28.2**，均固定版本。

## Mac .app 实际证据

`scripts/verify-phase6.ts` 先验证开发入口，再复制构建出的应用到临时安装目录，用 macOS `open`/LaunchServices 启动应用包，而不是仅执行源码或包里的二进制。

- 开发入口在只有 `/usr/bin:/bin` 的最小 PATH 下启动；自动补上用户 Node/pi 和 Nix 路径，实际连接 pi，无模型请求。
- 页面只有 `pickDirectory` / `reveal` 两项原生接口，没有 `require`；渲染器设置 contextIsolation、sandbox、nodeIntegration=false，原生 IPC 只接受自己的主框架。
- 原生目录选择与 Finder 调用接线在开发入口用明确替身验证；目录选择后实际打开所选临时项目。越界路径实际被拒绝，不给网页任意系统路径能力。
- 窗口移动和调整大小后，位置/尺寸/所选项目保存到独立测试配置目录；配置不含启动口令。
- 应用包包含网页、打包后的 Node 后台和权限扩展；不包含用户配置、Node/pi 安装，也不把开发 SDK 或项目 node_modules 塞进 app.asar。
- 实际打开打包应用并发消息，收到 **“桌面验收通过”**；最终一轮逐条断言 assistant 的 provider/model/thinkingLevel 为 **cliproxy/gpt-6-luna / low**，花费 **$0.000859**。这是最后一轮费用，不是调试累计费用。
- 真实 Markdown 预览显示 DESKTOP PREVIEW OK；真实调用 shell.showItemInFolder 显示合成文件，不是替身。
- 关窗口/退出后实际确认 4317 已释放，后台和对应 pi 子进程回收；没有把后台留在用户机器上。

验收生成的摘要和截图只在忽略提交的 `.pi-desk/verification/`；测试项目和记录到路径的测试会话用 trash 清理。没有永久删除用户对话，没有修改模型、插件或 CortexKit 配置。

本机日常应用已复制到 **`~/Applications/pi desk.app`**；构建产物为 `release/mac-arm64/pi desk.app`，整个 release 目录忽略提交。

## 调试中修正的问题

- npm 的 Electron 解压在本机未完成便退出，缺少 path.txt/完整运行文件；安装脚本改用 macOS ditto 解压经官方 checksums 校验的同一个下载包。不改用户 npm/Node 配置，重装依赖后会自动补齐。
- 首次打包误收集项目依赖，已明确排除 node_modules，最终 app.asar 没有任何 node_modules；应用约 280 MB。
- 从 Desktop 构建目录启动时遇到启动等待，最终验收复制到非 Desktop 临时安装目录再用系统方式打开。日常建议安装到 Applications；若 macOS 询问访问项目目录权限，由用户确认，不绕过系统权限。
- 空对话刷新会重新创建并恢复 pi 默认模型；最初一轮回复元数据检查因此失败。最终脚本在最后一次刷新后重新选择 Luna/low，并检查实际回复元数据，不只看下拉框曾经选过。未将失败轮算作通过。

## Windows 验收状态

本机 127.0.0.1:22 可连接，只能说明 Mac 本地 SSH 端口可用，**不能代替 Windows 真机验收**。

Kenneth 已表示有 Windows 电脑并亲自操作。提供的步骤是：

1. 关闭 Mac 应用，在 Mac 终端运行 `npm start` 并保留打印的完整网址。
2. Windows PowerShell 建立仅本地监听的 SSH 转发，登录后保留窗口。
3. 在 Windows Chrome/Edge 打开完整网址，选 Luna/low，发最小消息并确认收到回复。

Kenneth 在操作指导后反馈 **“他回了”**；说明验收成功条件是在 Windows 浏览器收到 AI 回复后，Kenneth 恢复任务进行收尾。按这项用户真机反馈，Windows 验收通过。**这不是代理直接操作 Windows 的自动测试，也没有额外读取私人对话或索取截图/口令来重复验证。**

操作说明和故障处理见 README。没有索取或提交登录密码、私钥、完整启动口令；后续只做记录和公开提交检查，不再重复付费聊天测试。

## 已知限制

- 应用未签名/未公证，首次打开可能需要右键 → 打开；只打包本机 Apple 芯片版，没有验证 Intel Mac。
- 仍需要用户已安装的 Node.js 22+、配置好的 pi 和 macOS trash；不是包含模型/配置的独立安装包。
- 没有自动更新或新增系统通知；后台端口固定 4317，不与 npm start/dev 同时启动。
- Electron 35 是方案指定的旧版本线，不能宣称安全维护仍受支持。当前 npm audit 为 **27 项：23 moderate、4 high**，包含原 Vite/ExcelJS/SDK 告警，以及 Electron/打包链。主窗口 CSP 为兼容隔离 HTML 的手动脚本开关保留 unsafe-inline，不能把它当成完全防 XSS 的保护。升级和进一步保护应单独确认、回归；本轮没有 npm audit fix --force 跨大版本。
