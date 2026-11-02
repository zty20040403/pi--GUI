# pi desk 第二版方案

> 版本：2026-11-02 · 需求：Kenneth · 整理：Claude
> 执行者：pi（在 `~/Desktop/"pi harness"` 里按本文一步一步做）
> 第一版（第 1–6 阶段）见 `PLAN.md`，已全部完成。本文是第 7–13 阶段。

---

## 0. 给执行者（pi）的话

- 规矩和第一版一样，见 `AGENTS.md`：一次做一个阶段，验收全过再 `git commit` + `git push`，然后停下来用中文汇报。
- 每个阶段开始前用任务清单列步骤；不确定 pi 的接口就去读本机 pi 文档（`PLAN.md` §2.4），不要猜。
- **界面相关的阶段，验收里一定要有截图**：深色、浅色各一张，宽 1440 和 1024 各一张，存到 `.pi-desk/verification/`，汇报时说明截图位置。
- 改了界面以后，把 `scripts/verify-phase*.ts` 里受影响的地方一起改好，所有旧的验收仍要通过。
- 测试聊天只用 `cliproxy/gpt-6-luna` + `low`。

---

## 1. 这一版要解决的问题（Kenneth 的原话整理）

| # | 需求 | 对应阶段 |
|---|---|---|
| 1 | 终端和 App 的对话"同步有问题"；"文件夹不存在"这类错误不能直接甩英文报错 | 第 7 阶段 |
| 2 | 关掉 `ccstyle: write 工具已被 … 占用，富 diff 已让位` 这种没用的插件提醒 | 第 7 阶段 |
| 3 | 下拉框要好看，**跟 Codex 自己的一样** | 第 8 阶段 |
| 4 | 推理强度**做成可以往右拉的滑杆** | 第 8 阶段 |
| 5 | **插件做成一个界面**：能搜索、下载（安装）、停用、卸载 | 第 9 阶段 |
| 6 | **代码改动像 Codex 一样显示** | 第 10 阶段 |
| 7 | **打包成一个跟其他软件一样的 App**（拖进"应用程序"、有图标、双击就开） | 第 11 阶段 |
| 8 | **Windows 上直接用本地的 pi**，不用远程连 Mac | 第 12 阶段 |
| 9 | 继续完善，审美变好，参考 pi-gui | 第 13 阶段，以及每个阶段的界面要求 |

---

## 2. 主要参考：pi-gui

- 地址：`https://github.com/minghinmatthewlam/pi-gui`，**MIT 许可证**，约 1400 星，2026-10-28 还在更新。
- 它就是"pi 的桌面客户端"：Electron + React，macOS / Linux / Windows 都有安装包，内置 pi（用 `@earendil-works/pi-coding-agent` 1.4，跟我们一样），读的也是 `~/.pi/agent` 里的配置。
- 需要时浅克隆到 `refs/pi-gui`（`refs/` 已在 `.gitignore`）：

```bash
git clone --depth 1 https://github.com/minghinmatthewlam/pi-gui.git refs/pi-gui
```

| 我们要做的 | 去 pi-gui 看哪里 |
|---|---|
| 模型 / 推理强度下拉菜单 | `apps/desktop/src/features/conversation/model-selector.tsx`、`src/styles/model-selector-panel.css` |
| 每轮改动卡片 | `apps/desktop/src/features/conversation/turn-changes-card.tsx` |
| 改动审阅面板（diff） | `apps/desktop/src/features/workbench/diff-panel.tsx`、`review-file-tree.tsx`、`src/ui/diff-inline.tsx`、`src/styles/review.css` |
| 每轮改动前后快照 | `apps/desktop/electron/workbench/checkpoint-store.ts`、`review-owner.ts`，原理见 `docs/architecture.md` 的 "Review and captured turns" |
| 插件开关页面 | `apps/desktop/src/features/extensions/extensions-view.tsx`、`customize-page.tsx` |
| 命令面板 ⌘K | `apps/desktop/src/features/command-palette/` |
| 设计变量、整体审美 | `apps/desktop/src/styles/tokens.css`、`base.css`、`timeline.css`、`sidebar.css` |
| 打包（dmg / exe） | `apps/desktop/electron-builder.yml`、`.github/workflows/release.yml` |
| Codex 行为的拆解 | `plans/phase-1-codex-parity/plan.md` |

**可以直接搬代码**（MIT 允许），但被搬的文件开头必须写一行出处，例如 `// 改编自 pi-gui (MIT) apps/desktop/src/ui/diff-inline.tsx`，并在 `README.md` 末尾的"致谢"里列出。只搬需要的部分，不要整个架构照抄（它的分层很重，我们不需要）。

> 备注：pi-gui 本身已经能做到本文大部分功能。如果 Kenneth 将来想直接换用它，也可以；本方案是"继续完善 pi desk，并借鉴 pi-gui"。

---

## 3. 统一的设计要求（所有阶段都要遵守）

在第一版重新设计的基础上（`src/styles.css` 顶部的变量），继续：

- **颜色只从变量取**，不在组件里写死颜色。新组件先加变量，再用变量。
- **字号**：正文 13–14px，次要 12px，最小 11px，不要更小。
- **间距**：4 的倍数（4 / 8 / 12 / 16 / 24）。
- **圆角**：小控件 6px，菜单/卡片 12px，输入框 18px，弹窗 16px。
- **图标**：只用 `lucide-react`，尺寸 13–16px，跟文字垂直居中。
- **动效**：出现用 120–180ms 的淡入上移；尊重"减少动态效果"系统设置。
- **每个可点的东西**都要有悬停、按下、键盘焦点三种状态。
- **中文界面**，专有名词（模型 id、命令名）保留英文。
- **两套主题都要好看**，深色是重点。截图对比时如果某处"看起来像网页表单"，就算不合格。

---

## 4. 分阶段步骤

### 第 7 阶段：同步、错误提示、插件提醒（先把用着别扭的地方修好）

**7.1 收尾上一轮的改动**
仓库里有 Claude 留下的未提交改动（文件夹不存在时的中文提示、左栏标出"文件夹已不存在"、启动时上次的文件夹没了就回到默认项目）。先停掉 4317 上的后台，跑 `npm test` 和第 2–5 阶段验收，全过后提交。

**7.2 对话列表实时同步**
- 后台用 `fs.watch`（macOS / Windows 都支持 `recursive: true`）盯着 pi 的 sessions 文件夹；有新文件、改名、删除时，300ms 防抖后通过 WebSocket 推一个 `projects_changed`，前端刷新左栏。终端里新开的对话、改的名字，几秒内就出现在 App 里。
- 盯不住时（比如出错），退回每 15 秒刷新一次。

**7.3 同一个对话被另一边改了**
- 后台记住"当前打开的对话文件"的大小和修改时间，并记下这些变化里哪些是自己这边的 pi 写的（看 `message_end` 等事件）。
- 如果文件变了、但不是自己写的（说明终端里的 pi 也在用这个对话），顶部出现一条黄色提示：**"这个对话在别处（比如终端）有新消息。重新载入后才能继续发送。"** 和一个"重新载入"按钮（发 `switch_session` 重新打开）。提示出现期间禁止发送，免得两边各写各的把对话弄乱。
- 打开对话时，如果检测到终端里正有 pi 进程开着同一个对话（可选：用 `lsof` 查谁打开了这个文件），提示"终端里也开着这个对话，建议只在一边用"。

**7.4 文件夹不存在**
- 左栏：文件夹已被删除或移动的项目，用带叉的文件夹图标、灰色文字，下面一行黄字"文件夹已不存在，只能删除这里的对话"（7.1 已有，检查一遍）。
- 点进这种对话：不报错，中间显示一个空状态卡片：说明文字 + "删除这些对话"按钮 + "重新指定文件夹"（选一个新位置，把这组对话的 cwd 改过去——只改 App 自己的映射，不改 pi 的对话文件）。
- 所有后台错误都要先翻译成中文、说明"发生了什么 + 你可以怎么办"，原始英文放在"详情"折叠里。写一个 `server/errors.ts` 统一处理（ENOENT、EACCES、端口占用、pi 退出、网络超时、401 等）。

**7.5 插件提醒过滤**
- 每条插件提醒右上角加一个"不再提示这类"按钮。点了以后把这条提醒的"指纹"（插件名 + 去掉路径和数字后的文字）存进 App 设置；以后同类提醒不再弹出，只在设置页"已隐藏的提醒"里能看到和恢复。
- 内置默认隐藏：以 `ccstyle: write 工具已被` 开头的提醒（这是 ccstyle 把自己第一次注册的 write 工具误认成别的插件导致的误报，在 App 里没有任何作用，因为 App 的工具卡片是自己画的）。

**验收**
- [ ] 终端里 `pi` 新建一个对话并发一句话，App 左栏 5 秒内出现，不用手动刷新。
- [ ] App 和终端同时打开同一个对话，在终端发一句话，App 出现黄色提示并禁止发送，点"重新载入"后能看到终端那句话。
- [ ] 把一个测试项目文件夹删掉，左栏立即显示"文件夹已不存在"；点进去是空状态卡片，不是报错。
- [ ] 让 pi 进程意外退出、断网、给错 API key，三种情况都显示中文说明。
- [ ] ccstyle 那条提醒不再出现；随便触发另一条插件提醒，点"不再提示这类"后同类不再出现，设置里能恢复。

### 第 8 阶段：Codex 式下拉菜单和推理滑杆

把输入框底部三个胶囊从"原生下拉框"换成**自己画的弹出菜单**（参考 pi-gui 的 `model-selector`）。

**8.1 通用组件**
新增 `src/components/ui/Popover.tsx`、`Menu.tsx`：
- 点胶囊弹出，弹出位置自动避开窗口边缘（输入框在底部，所以默认向上弹）。
- 圆角 12px、细边框、柔和阴影，120ms 淡入；宽度 260–320px。
- 键盘：↑↓ 移动，Enter 选择，Esc 关闭，打字直接过滤；关闭后焦点回到胶囊。
- 点外面关闭；同时只开一个。
- 读屏：`role="menu"` / `menuitemradio`，选中项 `aria-checked`。

**8.2 模型菜单**
- 顶部一个搜索框（"搜索模型"）。
- 按提供商分组（CLIProxy / NInfer），组标题小号灰字。
- 每一行：模型名（主文字）+ 右侧小字价格"入 $2 · 出 $10"；当前模型前面打勾。
- 不可用的模型（比如 NInfer 服务器离线）灰掉并提示原因（如果能探测到）。
- 菜单最下面一条分隔线，下面是"推理强度"滑杆（见 8.3），这样选模型和调推理在同一个面板里，跟 Codex 一样。

**8.3 推理强度滑杆（往右拉）**
- 一条横向滑杆，刻度只包含**当前模型支持的档位**（从 `get_available_thinking_levels` 拿，比如 低 / 中 / 高 / 很高），从左到右越来越强。
- 拖动或点刻度切换；←→ 键也能调。滑杆上方显示当前档位名，下方两端小字"更快更省"、"更聪明更贵"。
- 滑块颜色随强度从中性灰渐变到强调色（越往右越"热"），但不要花哨。
- 胶囊上的文字变成"gpt-6.1-sol · 中"这种合并显示（模型和推理合成一个胶囊），点开就是 8.2 + 8.3 的面板。
- 只有一个档位（或模型不支持推理）时，滑杆显示为禁用并说明"这个模型不支持调节推理强度"。

**8.4 权限菜单**
- 胶囊图标 + "自动"；弹出菜单三项，每项一行标题 + 一行灰色说明：
  - 只读：只看不改，不能执行会改东西的命令
  - 自动：项目里随便改，危险操作先问我（推荐）
  - 完全放开：不再审批（红色，选中时二次确认）

**8.5 测试**
- 原来测试里的 `selectOption` 全部换成新的辅助函数：在 `scripts/ui-helpers.ts` 写 `chooseModel(page, provider, id)`、`setThinking(page, level)`、`setPermission(page, mode)`，所有 verify 脚本改用它们。
- 给菜单项加 `data-testid`（例如 `model-option-cliproxy-gpt-6-luna`）。

**验收**
- [ ] 不用鼠标，只用键盘能完成：打开模型菜单 → 搜索 luna → 选中 → 调推理到"低" → 关闭。
- [ ] 换一个只支持部分档位的模型，滑杆刻度跟着变。
- [ ] 截图：模型面板（深/浅）、权限菜单（深/浅），看起来不像网页表单。
- [ ] 第 2–5 阶段验收全部仍然通过。

### 第 9 阶段：插件管理页面

左栏底部加一个"插件"入口（拼图图标），点开是一个全屏页面（像设置页），分三个标签：

**9.1 已安装**
- 列出所有正在使用的东西：
  - 通过 `pi install` 装的包（读 `~/.pi/agent/settings.json` 的 `packages`，以及 `pi list` 的输出）；
  - `~/.pi/agent/extensions/` 里的扩展文件（Kenneth 的 Nix 配置管理的，如 `magic-context.ts`、`pi-render.ts`，标注"由 setup.sh 管理"）；
  - pi 内置扩展（`builtin:mcp` 等）。
- 每一行：名字、版本、一句话说明、来源（npm / 本地 / 内置）、一个开关。
- **停用 / 启用**（不卸载）：
  - npm 包：把 `packages` 里的字符串改成对象形式，`extensions`、`skills`、`prompts`、`themes` 都设成 `[]`（pi 文档 `packages.md` 的 "Select package resources"）；启用时改回字符串。
  - 扩展文件：在 `settings.json` 的 `extensions` 里加 `-extensions/文件名`（排除）；启用时去掉。
  - 内置扩展：`-builtin:名字`。
  - 改 `settings.json` 时只改这几个字段，保留其他内容（和 `setup.sh` 的合并方式一致，原子写入：先写临时文件再改名），改之前备份一份。
- **卸载**：npm 包调用 `pi remove npm:名字@版本`，确认弹窗写清楚"会删除这个插件的文件"；本地扩展文件不提供卸载（只能停用），并说明原因。
- 改完提示"重新加载后生效"，提供"立即重新加载"按钮：当所有项目都空闲时，重启后台里的 pi 进程（正在回复的项目等它结束再重启）。

**9.2 发现（下载新插件）**
- 数据来源：npm 搜索接口 `https://registry.npmjs.org/-/v1/search?text=keywords:pi-package+<搜索词>&size=40`，以及下载量接口 `https://api.npmjs.org/downloads/point/last-week/<包名>`。只通过后台去请求，前端不直接访问外网。
- 每张卡片：名字、说明、作者、每周下载量、最新版本和发布时间、许可证、GitHub 链接（点了用系统浏览器打开）。按下载量排序，可以搜索。
- **安装**：点"安装" → 弹窗显示"这个插件会以你的权限运行代码，只装信得过的" + 版本号 → 确认后调用 `pi install npm:名字@确切版本`（固定版本，不用 latest 的浮动写法），显示进度和输出。
- 已安装的卡片显示"已安装 / 已停用"状态。

**9.3 更新**
- 对每个 npm 插件查最新版本，有新版时显示"可更新 1.2.0 → 1.3.0"；点"更新"等于先 `pi remove` 旧版再 `pi install` 新版（固定版本）。不做自动更新。

**安全**
- 安装、卸载、更新只能从这个页面手动点，AI 不能通过工具调用触发。
- 后台执行 `pi install` / `pi remove` 时用参数数组，不拼字符串；包名用 npm 包名规则校验。

**验收**
- [ ] 停用 `pi-web-access` 后重新加载，让 AI 上网搜索，它说没有搜索工具；再启用，又能搜。
- [ ] 在"发现"里搜索一个小插件安装，`pi list` 里出现；卸载后消失。
- [ ] `settings.json` 改完后其他字段不变（对比备份），`setup.sh` 再跑一次也不会冲掉停用状态。
- [ ] 截图：已安装、发现、安装确认弹窗（深/浅）。

### 第 10 阶段：像 Codex 一样显示代码改动

**10.1 记录每一轮的改动**
写一个 pi 扩展 `pi-extension/desk-changes.ts`（和权限插件一样，只在 App 启动 pi 时加载）：
- 在 `tool_call` 钩子里，对 `edit` / `write`（以及能识别出会改文件的 `bash`，先不做）在执行**前**读下文件原内容；在 `tool_result` 钩子里读执行**后**的内容。
- 按"轮"（一次用户消息到 `agent_settled`）归组，记到 App 的数据目录（`changes/<对话id>/<轮次>.json`：文件路径、改之前、改之后、是否新建/删除）。单个文件超过 1 MB 只记"改了"，不存内容。
- 通过插件界面子协议或自定义事件把"本轮改动摘要"发给 App。
- 参考 pi-gui 的 `checkpoint-store.ts`（它用 git 快照做得更彻底，我们先用这个简单办法）。

**10.2 聊天里的"本轮改动"卡片**
- 每轮回复结束后，如果改了文件，在回复下方出现一张卡片："改动了 3 个文件 +24 −7"，下面列出每个文件（文件图标、路径、+N −M）。
- 点文件名：右侧打开"改动"标签页并定位到这个文件。
- 卡片右上角"查看全部改动"按钮。参考 pi-gui `turn-changes-card.tsx`。

**10.3 右侧"改动"标签页（审阅）**
- 右侧面板新增固定标签"改动"（和"文件"并列）。
- 上方切换范围：**本轮** / **这个对话全部** / **未提交（git）**（项目是 git 仓库时才有）。
- 左边是改过的文件列表（带 +N −M），右边是 diff：
  - 默认"统一视图"（一列，删的行红底、加的行绿底，左侧两列行号），可切换"并排视图"。
  - 语法高亮（复用 shiki），没改的部分折叠成"展开 23 行"。
  - 文件头：路径、新建 / 删除 / 修改标记、+N −M。
- 用 `diff`（npm 包，固定版本）算差异；"未提交"范围用 `git diff`（只读命令，不改仓库）。
- 参考 pi-gui `diff-panel.tsx`、`src/ui/diff-inline.tsx`、`styles/review.css`。

**10.4 工具卡片里的 diff**
- `edit` / `write` 的工具卡片展开后，直接显示这一次改动的小 diff（和 10.3 同一个组件），代替现在的红绿两大块文字。

**10.5（可选，最后做）撤销这一轮**
- "本轮改动"卡片上加"撤销这些改动"：把文件恢复成改之前的内容。必须先检查文件现在的内容和"改之后"一致（中间没被别人改过），不一致就拒绝并说明；恢复前弹窗确认；恢复的文件先备份到废纸篓。

**验收**
- [ ] 让 AI 改两个文件、新建一个文件，回复下方出现改动卡片，数字正确。
- [ ] "改动"标签页三种范围都能看；统一 / 并排视图都正确；长文件能折叠展开。
- [ ] 刷新页面、重开 App 后，历史对话的改动卡片还在。
- [ ] 截图：改动卡片、审阅面板统一视图、并排视图（深/浅）。

### 第 11 阶段：打包成真正的 App（macOS）

**11.1 不再依赖系统里的 Node**
- 后台用 Electron 自带的 Node 运行：`spawn(process.execPath, [后台入口], { env: { ...env, ELECTRON_RUN_AS_NODE: "1" } })`（DeepSeek Harness 和 pi-gui 都这样做）。
- 后台打包成单个 `server.mjs`（esbuild，已有 `scripts/build-desktop.ts`，检查一遍）。

**11.2 pi 从哪来（引擎选择）**
- 把 `@earendil-works/pi-coding-agent` 从开发依赖改成正式依赖（固定 1.4.0），打进 App，作为"内置 pi"，同样用 Electron 的 Node 跑它的命令行入口 `--mode rpc`。
- 设置页加"pi 引擎"：
  - **自动（默认）**：系统里能找到 `pi`（`~/.local/bin/pi`、PATH）就用系统的——在 Kenneth 的 Mac 上就是 `setup.sh` 装的那个，版本和终端完全一致；找不到就用内置的。
  - 系统 pi / 内置 pi：手动指定。
  - 显示当前用的是哪个、版本号。
- 两种都读同一个 `~/.pi/agent` 配置，所以模型、插件、对话都一样。

**11.3 端口和单实例**
- 后台不再固定 4317：App 启动时找一个空闲端口（或先试 4317，被占用就换），口令照旧。Host / Origin 检查跟着实际端口走。
- 同一时间只允许开一个 App（`app.requestSingleInstanceLock`），再次双击就把已有窗口拿到前面。
- 浏览器版（`npm start`）仍默认 4317，不受影响。测试脚本改成从环境变量读端口，默认 4317。

**11.4 像正经软件一样**
- **图标**：做一个 π 图标（深色圆角方块 + 白色 π，参考设计要求的配色），生成 `icns`（macOS）和 `ico`（Windows），放 `electron/resources/`。
- **窗口**：macOS 用 `titleBarStyle: "hiddenInset"`，红黄绿按钮嵌在左栏顶部，顶栏可拖动窗口（`-webkit-app-region: drag`，按钮区域 `no-drag`，`styles.css` 里已经预留）。
- **菜单栏**：中文菜单（关于 pi desk、设置 ⌘,、新对话 ⌘N、关闭窗口 ⌘W、退出 ⌘Q、编辑菜单的复制粘贴、视图菜单的放大缩小）。
- **关窗口**：关最后一个窗口不退出（macOS 习惯），点 Dock 图标重新打开；⌘Q 才真正退出，退出前如果有对话正在回复要提醒。
- **安装包**：`electron-builder` 产出 `.dmg`（打开后把图标拖进"应用程序"）和 `.zip`；Apple 芯片版。没有 Apple 开发者账号，所以做"本机临时签名"（ad-hoc），并在 README 写明第一次打开要右键→打开。
- **升级 Electron** 到当前维护中的大版本（先 `npm view electron versions` 选一个发布超过两周的稳定版，固定版本），顺便处理 README 里那些高危依赖告警。

**验收**
- [ ] 在一台"没装 Node"的环境里也能跑：临时把 PATH 里的 node 去掉（`env -i HOME=$HOME PATH=/usr/bin:/bin open "/Applications/pi desk.app"`），App 正常打开、聊天。
- [ ] 4317 被 `npm start` 占着时，双击 App 也能正常打开。
- [ ] 拖进"应用程序"后，从启动台、Spotlight、Dock 都能打开；图标正确。
- [ ] 设置页能看到"pi 引擎：系统（1.4.0）"，切到"内置"后也能聊天。
- [ ] 第 6 阶段的桌面验收更新后通过。

### 第 12 阶段：Windows 版（本地运行，不连 Mac）

**12.1 目标**
在 Kenneth 的 Windows 电脑上装一个 `pi desk Setup.exe`，打开就能用**这台 Windows 自己的 pi**，项目文件在 Windows 本地，不需要 SSH 到 Mac。

**12.2 改造点**
- 引擎：Windows 上默认用内置 pi（11.2）。
- 路径：所有路径处理用 `node:path`，不要写死 `/`；家目录、`~` 展开、盘符（`C:\`）都要支持；项目路径比较不区分大小写。
- 系统命令替换：
  - 移到废纸篓：用 Electron 的 `shell.trashItem`（macOS / Windows 通用），去掉对 macOS `trash` 命令的依赖。
  - 用默认软件打开 / 在资源管理器中显示：`shell.openPath` / `shell.showItemInFolder`。
  - 文案里"Finder"在 Windows 上改成"资源管理器"。
- 敏感路径列表加上 Windows 的位置（`%USERPROFILE%\.ssh` 等）。
- 文件监听、拖放、粘贴图片在 Windows 上实测。
- 权限插件里的"安全命令"判断：Windows 的 pi 默认用 PowerShell 还是 bash 要先查清（pi 文档 `windows.md`），按实际 shell 补一份安全命令表（`dir`、`Get-ChildItem`、`type`、`git status` 等）。

**12.3 第一次打开的设置向导**
Windows 上没有 Mac 那套 Nix 配置，所以第一次打开时如果 `~/.pi/agent/models.json` 里没有可用模型，进入向导：
1. **连接模型服务**：填"服务地址"和"API key"（不在代码里写任何地址或 key；地址由 Kenneth 自己填）。点"测试连接"会请求 `<地址>/models`，成功后列出可用模型让他勾选。
2. 写入 `~/.pi/agent/models.json`（只添加一个 provider，不动其他内容），key 存进 pi 的 `auth.json`（文件权限只允许当前用户），或用 pi 支持的其他保存 key 的方式——以 pi 文档 `models.md`、`providers.md` 为准。
3. **网络提示**：如果服务地址是 Tailscale 内网名，提示"需要这台电脑也登录 Tailscale"。
4. 可选：推荐安装几个插件（打开第 9 阶段的插件页面）。
- Mac 上已有配置，向导不出现；设置页里随时能重新打开向导。

**12.4 打包和构建**
- `electron-builder` 产出 Windows x64 的 NSIS 安装包和免安装版 exe。
- 用 GitHub Actions 在 `windows-latest` 上构建（参考 pi-gui 的 `.github/workflows/release.yml`），产物作为 Release 附件；macOS 版在 `macos-latest` 上构建。推送带 `v*` 的标签才触发发布，平时只跑测试。
- 没有代码签名证书，README 写明 Windows 会弹 SmartScreen，点"仍要运行"。

**验收**（需要 Kenneth 在 Windows 上配合，汇报时写清楚哪些是他手动确认的）
- [ ] GitHub Actions 能产出 Windows 安装包。
- [ ] Windows 上安装、首次向导、连接模型、聊天、读写本地项目文件、预览、拖文件、三档权限都能用。
- [ ] 删除对话进的是 Windows 回收站。

### 第 13 阶段：继续完善和审美打磨

按优先级做，每做完一项截图给 Kenneth 看：

1. **命令面板 ⌘K**：搜对话、搜项目、执行动作（新对话、切换模型、打开插件页、切换主题）。参考 pi-gui `command-palette/`。
2. **设置页 ⌘,**：外观（跟随系统 / 深 / 浅，强调色可选几种）、pi 引擎、模型服务、已隐藏的提醒、快捷键说明。
3. **主题**：除默认外再提供 2–3 个精选主题（参考 pi-gui 的 Catppuccin、Tokyo Night、GitHub），用同一套变量实现。
4. **系统通知**：对话在后台回复完、失败、或者在等我回答时，发系统通知（可在设置里关）；左栏对应对话出现小圆点。
5. **快捷键**：⌘N 新对话、⌘B 收起左栏、⌘J 收起右栏、⌘1–9 跳到第几个对话、⌘↑/⌘↓ 在消息间跳。
6. **欢迎页**：按项目推荐几个起手问题（根据项目里有没有 `package.json`、`README.md` 等）。
7. **细节审查清单**（每项都要过）：空状态、加载状态、错误状态都有设计；长文本不溢出；窄窗口（1024）不挤；滚动条低调；对齐和间距统一；没有任何浏览器默认样式的控件露出来。
8. （可选）**内置终端**：右侧面板加"终端"标签（xterm.js + node-pty，参考 pi-gui `terminal-panel.tsx`）。注意 node-pty 是原生模块，Windows / macOS 分别构建，放到最后做。

---

## 5. 做完后交给 Kenneth 的东西

- macOS：`pi desk.dmg`，拖进"应用程序"就能用；Windows：`pi desk Setup.exe`。
- `README.md` 更新：安装方法、第一次设置、插件页面、改动审阅、常见问题，全部中文、说人话。
- 每个阶段一个提交，都已推送；每个阶段的截图和验收记录在 `docs/phase-N-verification.md`。
- "已知问题"清单。
