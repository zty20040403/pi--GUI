# 第 11 阶段验收记录：独立 macOS App

日期：2026-11-02

**状态：验收全部通过。** 自动测试、真实 pi / 浏览器 / 安装副本验收完成；Kenneth 在最后的结构化问答中选择“全部通过”，确认下方所有系统手动验收项。

## 已实现

- 桌面后台使用 Electron 自带 Node，不寻找系统 node。
- 固定内置 pi 1.4.0；自动模式优先系统 pi，设置中可选自动 / 系统 / 内置并显示版本。切换只在所有项目空闲时进行，失败回到旧引擎，保留历史、草稿与模型设置。
- 桌面以端口 0 让操作系统分配空闲端口；Host、Origin、启动口令均绑定实际后台。浏览器 `npm start` 默认仍为 4317。
- 同一用户数据目录只开一个实例；再次启动恢复原窗口。窗口布局和最近项目另存到桌面设置，不跟着随机端口丢失，不保存口令或聊天正文。
- π 图标：矢量源及 RGBA PNG / ICNS / ICO；macOS hiddenInset 与窗口按钮预留区域；中文原生菜单。
- 关窗隐藏，activate 恢复；真正退出时检查所有项目和插件工作状态，默认继续使用，确认后停止后台。
- arm64 dmg / zip，ad-hoc 临时签名，无 Developer ID / Apple 公证，无自动更新。
- Electron 固定 44.10.1、Vite 固定 7.3.7：这是 Kenneth 明确批准的安全升级，包含安全补丁发布未满两周及 Vite 跨大版本两个例外；pi 保持 1.4.0。

## 已实际通过的检查

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | 通过 |
| `npm test` | 75 项通过；也曾以自定义 `PI_DESK_PORT` 全量通过 |
| `npm run test:desktop` | 6 项通过：环境、启动网址、加载错误脱敏、窗口边界、偏好白名单、IPC 主框架校验 |
| 第 2–5 阶段 | 全部真实回归通过：聊天/重连/终端恢复、对话操作、文件预览/生产 worker、附件/插件/计划/清单/权限 |
| 第 7–10 阶段 | 全部回归通过；真实隔离插件安装卸载与搜索、两轮真实文件修改和 diff 均通过 |
| `verify:phase11:engine`，开发及打包版 | 系统与内置引擎均真实 Luna/low 聊天；切换保持历史/草稿/模型；退出重开保留选择，切回自动 |
| `verify:phase11:ports`，开发及打包版 | npm start 占用 4317；桌面连接真实 pi；再次启动恢复最小化窗口；强占旧端口后重开仍保留布局和最近项目；各自后台退出 |
| `verify:phase11:native`，开发及打包版 | 中文菜单接线、快捷键登记、窗口关闭事件隐藏、activate 恢复历史/草稿；真实回复和插件待答时的退出提醒，取消保留工作，确认退出回收后台 |
| `verify:phase11:package -- --launch` | dmg 只读挂载、Applications 链接、zip 解压；镜像/解压/复制安装的 App 全部通过严格 ad-hoc 签名、图标与引擎检查 |
| 从镜像安装副本运行更新后的第 6 阶段 | npm start 同时占用 4317；用最小 HOME/PATH 环境调用 macOS LaunchServices 打开 App，真实聊天、Markdown 预览、Finder 显示通过；真实 edit 后退出并重开，历史改动卡片及 diff 恢复 |
| 完整 `npm audit` | 22 moderate、0 high、0 critical；不是零告警，没有使用 force 自动升级或降级 |

聊天均为 `cliproxy/gpt-6-luna` / `low`。模型切换测试使用隔离设置；插件安装卸载仍在隔离配置中验收，不修改用户受保护的配置。

### 自动化边界（不冒充人工操作）

- Playwright 的键盘事件没有触发 macOS 原生菜单快捷键；Electron `sendInputEvent` 也不能代替系统按键。本轮验证了原生菜单命令接线和 accelerator 配置，**不能据此声称实际按键通过**。
- 菜单的 macOS `close` role 由原生系统处理，直接调用 JavaScript click 不执行该选择器。自动测试检查 role，再调用真实窗口 close 事件检查隐藏行为；实际 ⌘W 已另由 Kenneth 手动确认。
- 退出提醒使用真实后台忙碌状态，但确认弹窗的回答用显式替身；没有把它称为真实点击原生弹窗。
- activate 事件恢复和 LaunchServices 实际启动均已测试，但不冒充启动台、Spotlight、Dock 的真实点击和安装时实际拖动；这些另由 Kenneth 手动确认。系统未授权界面自动控制，没有擅自开启权限。
- 页面截图不包含 macOS 原生窗口按钮和系统弹窗；已检查窗口按钮 API 位置与内容避让，实际系统外观已由 Kenneth 手动确认。

## 构建与验收中修正的问题

1. **桌面同步目录干扰签名**：`release` 中的裸 App 会被 File Provider 重写 FinderInfo。清理后仍复现，不使用不签名或跳过验证作为退路。现在先在 macOS 临时目录签名封装，本地裸 App 放 `~/Library/Caches/pi-desk/build/pi desk.app`；`release/` 只放封装成品。
2. **关闭验收可能提前退出**：等待 CDP `Browser.close` 的应答可能在 App 退出时悬空，旧脚本曾以 0 结束但未跑到重开。现在等待真实连接断开并检查后台端口，使用顶层 await；安装包验收要求本次唯一标记对应的完整结果，拒绝旧总结。
3. **启动错误中的口令**：Chromium 的原始加载失败可能带完整启动网址，现统一为中文加载失败说明，并有脱敏回归测试。
4. **随机端口隔离浏览器存储**：通过白名单 IPC 保存布局、分组及最近项目；额外字段和口令不能写入桌面偏好文件。

## 安装包与截图

- `release/pi desk-0.1.0-arm64.dmg`
- `release/pi desk-0.1.0-arm64.zip`
- 本地测试 App：`~/Library/Caches/pi-desk/build/pi desk.app`
- 22 张第 11 阶段截图：`.pi-desk/verification/phase-11-*.png`，覆盖引擎设置、窗口布局、隐藏侧栏和动态端口，包含深/浅色与 1440/1024 宽度。
- 安装副本退出重开的截图沿用 `.pi-desk/verification/phase-10-desktop-diff.png`、`phase-10-desktop-reopened.png`；桌面截图为 `phase-6-desktop.png`。
- 同目录 `phase-11-*-summary.json` 保存自动验收结果；安装包摘要另含 dmg/zip 的 SHA-256。截图、原始日志和构建产物不提交。

## Kenneth 的手动确认

原始反馈的本地核对入口：`.pi-desk/verification/phase-11-manual-source.json`。它仅摘录原始 `ask_user_question` 提问和对应答复，包含源会话路径、行号及原始行 SHA-256，可回到源文件核对，不以本段文字代替原始反馈。提问记录为 `a4a8b4c5`（2026-11-02 21:44:38 UTC），答复记录为 `f560b8d6`（21:46:33 UTC）；“全部通过”选项明确写明已实际完成拖动安装、三个系统入口、快捷键、草稿恢复和退出提醒检查。摘录及源会话均不提交到公开仓库。

以下全部来自 Kenneth 对具体操作清单的明确确认，不是代理模拟的结果：

- [x] 退出旧 App，打开 dmg，实际把 π 图标拖入应用程序并打开新版本；图标和红黄绿按钮正常，无重叠。
- [x] 从启动台、Spotlight、Dock 分别打开/恢复新版本。
- [x] 实际按 ⌘, 打开设置、⌘N 新建、⌘W 隐藏窗口，点 Dock 后恢复未发送草稿。
- [x] 真实回复过程中按 ⌘Q 出现原生提醒，点“继续使用”保留工作；回复结束后 ⌘Q 真正退出。

确认完成后，按 AGENTS.md 检查公开提交、提交并推送。

## 保留的限制

- 未测试 Intel Mac、Windows 本地版、其他 Mac 上下载后的 Gatekeeper 行为；没有 Apple 公证。
- App 不附带 npm，安装插件需要系统包管理器；不把聊天可独立运行误写成所有第三方插件及其外部工具都无需系统依赖。
- SDK、ExcelJS、打包依赖链仍有中危告警，继续只用于本机可信项目。
- 关窗隐藏保留草稿，但完整退出/崩溃后不保证恢复未发送草稿。
