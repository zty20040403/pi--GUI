# pi desk

Kenneth 的 pi 图形客户端，底层遥控本机现有的 pi。完整方案见 [`PLAN.md`](PLAN.md)，开发规矩见 [`AGENTS.md`](AGENTS.md)。

**当前进度：第 2 阶段，已经能在浏览器里聊天。还没有左边对话列表、右边文件面板或 Mac 应用。**

## 怎么打开试

打开 Mac 的“终端”，运行：

```bash
cd ~/Desktop/"pi harness"
npm ci
npm run dev
```

第一次或依赖变更后执行 `npm ci`；平时直接 `npm run dev` 即可。

1. 保持这个终端开着，打开它打印的**完整带口令网址**。开发模式会自动从后台 4317 跳到页面 5173，不用自己改端口。
2. 页面右上角“模型”选择 **CLIProxy → gpt-6-luna**，“推理”选 **low**。
3. 在底部输入框输入消息，按 Enter 发送。可以试：“列出当前目录的文件”。
4. AI 的回复会流式出现；工具卡片默认折叠，点一下能展开命令和输出。
5. 用完后在启动后台的终端按 `Ctrl+C`，它会关闭自己启动的 pi 子进程。

默认项目是这个仓库的文件夹。要聊别的项目，点顶部“项目路径”，填写已存在文件夹的绝对路径，点“在此项目开始新对话”。“新对话”则在当前项目开始一段新的对话。完整项目/对话列表在第 3 阶段做。

**操作审批还没做。** 现在 pi 可以直接读写文件和执行命令，请只在可信项目里使用。不要把启动网址发给别人，它相当于本地后台的口令。

## 界面和快捷键

- **顶部**：当前项目、对话标题、按提供商分组的模型及价格、这个模型支持的推理档位。回复时暂时不能切换模型，避免中途混用。
- **中间**：Markdown 回复、代码块复制、表格、默认折叠的思考过程和工具卡片。向上翻时不会强制滚到底，出现“回到底部”按钮。
- **底部输入框**：
  - Enter：发送；回复中就是“插话”。
  - Shift+Enter：换行；中文输入法的确认键不会误发送。
  - Alt+Enter（Mac 是 Option+Enter）：回复中“做完再做”，消息显示在排队栏。
  - Esc 或“停止”：先清空排队，再停止当前回复；清出的排队内容会放回输入框，不丢掉。
  - 输入 `/`：显示 pi 的插件/技能命令和本地 `/compact`。上下键选择、Enter/Tab 填入，再补参数发送。
- **状态栏**：本对话花费、上下文用量、pi 插件送来的状态。
- **网络提示**：等待模型超过 5 秒会显示等待时长；重试显示次数；最终失败显示原因及“重试”。发送失败时保留输入内容。

Mermaid、公式和代码高亮在第 4 阶段补。完整插件弹窗在第 5 阶段做：当前遇到需要选项/确认/输入的插件交互会安全取消并提示，不能靠本版页面完成 `/plan` 等需要弹窗的完整流程；请暂时在终端使用。

## 对话会不会丢

- 对话照常保存在 pi 的 sessions 目录，终端 `pi -r` 也能看到。
- 同一个浏览器标签页刷新或聊天 WebSocket 断线，会重新打开原对话，不重复发送未确认的消息，也不因重连而切换掉正在生成的对话。
- 口令进 `sessionStorage` 后会从地址栏删除，这是正常的。不要把删除口令后的地址复制到新标签页当启动网址。
- 关闭标签页再新开，标签页的临时状态可能不在；磁盘上的对话仍在。第 3 阶段还没完成时，可以用终端 `pi -r` 找旧对话。
- 后台每次重启都会生成新口令，需重新打开终端本次打印的完整网址；已保存的对话可以恢复。

不会修改你的模型、插件或 CortexKit 配置。不同页面在同一项目里共享一个活动 pi 对话，暂时不是“每个页面各聊一段”。

## 平时用（只开一个端口）

```bash
cd ~/Desktop/"pi harness"
npm run build
npm start
```

打开终端打印的网址，生产模式直接在 4317 提供页面。开发模式或生产模式任选一个，不要同时启动两个后台。

目前需要 Node.js 22 或更新版本、npm 和已配置好的 `pi`。测试用模型需有 `cliproxy/gpt-6-luna`。验收脚本清理临时文件使用 macOS `trash`。

## 检查和完整验收

```bash
npm run typecheck       # 后台、前端、脚本和 Vite 配置的 TypeScript
npm test                # 不调用模型：10 组自动测试
npm run build           # 构建真实聊天网页
npm run verify:phase1   # 后台完整验收，包含一次真实模型请求
npm run verify:phase2   # 真实 Chrome 聊天页 + 终端 pi -r + 生产页面验收
```

先关闭其他占用 4317 / 5173 的后台。第 2 阶段验收使用已安装的 Google Chrome 和 Python 3；Playwright 已固定为开发依赖，不需要下载额外浏览器。日常使用网页不需要 Playwright 或 Python。

真实浏览器验收只用 `gpt-6-luna` + `low` 聊天；其他模型只切换、不发付费请求。网络重试、插话/排队、IME、复制、折叠等边界情况另在真实 Chrome 中用模拟协议测试，避免为测试故意制造模型故障。

测试创建临时项目和测试对话，结束时只用 `trash` 把它们移到废纸篓，不动你已有的对话。截图存到忽略提交的 `.pi-desk/verification/`，不会提交口令或私人对话。

具体记录：[`第 1 阶段`](docs/phase-1-verification.md)、[`第 2 阶段`](docs/phase-2-verification.md)。旧的命令行 `npx tsx scripts/smoke.ts` 仍可单独跑，会自行启动后台；已有后台时用 `PI_DESK_URL='这里粘贴完整启动网址' npx tsx scripts/smoke.ts`。

## 后台协议（给后续开发用）

只监听 `127.0.0.1:4317`，每次随机生成 32 字节 hex 口令。所有 HTTP API 要求 `Authorization: Bearer <启动口令>`：

| 请求 | 返回 |
|---|---|
| `GET /api/health` | `{ok: true, phase: 2, processes: 数量}` |
| `GET /api/workspace` | `{cwd: 后台项目根目录}`，供首次打开页面使用 |
| `GET /api/projects` | `{projects: [{cwd, sessions: [{path, id, cwd, title, name?, mtime}]}]}` |

WebSocket：`/ws?token=<启动口令>`。检查 Host 和 Origin；开发模式允许本机 5173 Origin，生产模式只允许本机 4317 Origin。命令行客户端也要发送 Origin。

```typescript
// 客户端 → 后台
{ op: "open", cwd, sessionPath? }
{ op: "rpc", cwd, reqId, cmd: { type: "get_state" } }
{ op: "ui_response", cwd, payload: { type: "extension_ui_response", id, cancelled: true } }

// 后台 → 客户端
{ op: "opened", cwd, state, messages, stats, models, commands, seq }
{ op: "rpc_result", reqId, response }
{ op: "event", cwd, record, seq }
{ op: "exit", cwd, reason }
{ op: "error", cwd?, reqId?, message }
```

`seq` 是当前 pi 进程 stdout 的顺序号；`opened.seq` 对应历史消息快照的响应位置，前端据此避免重复拼接缓冲的流式增量。它不写入 pi 的对话文件。旧客户端忽略新增字段仍可用。

每个项目复用一个 pi 进程，空闲 30 分钟回收（忙/有待回复命令时不回收）。项目路径通过 `realpath` 归一化；已有对话路径只能属于该项目且在 pi 保存的目录内。模型连接配置/凭据字段不转发，stderr 只进后台并脱敏。

`open` 不带路径就是新对话，刷新/重连要带已有路径；对同一活动会话直接读取，不重新 `switch_session`。`prompt` 成功仅表示接收，必须等 `agent_settled` 才算彻底完成。权限插件的加载开关仍预留，完整工具权限在第 5 阶段实现。

## 常见问题和已知限制

- **端口占用 / EADDRINUSE**：在之前启动的终端按 `Ctrl+C`；不要同时运行开发和生产后台。
- **页面连接不上**：确认后台终端还开着。如果重启过，用本次打印的新网址；不要公开保存真实口令。
- **找不到 pi**：先在同一个终端运行 `pi --version`；必要时用 `PI_BIN=/pi/可执行文件的绝对路径 npm run dev` 指定路径。
- **找不到模型 / 请求报错**：先在终端 pi 里确认 `cliproxy/gpt-6-luna` 能用。本项目不替你改模型配置，不自动换到更贵的模型。
- **旧对话的思考耗时**：pi 没保存耗时就只显示“思考过程”，不会编造 N 秒；当前流式回复会计时。
- **还没做**：完整对话列表、改名/删除、文件预览、拖附件、插件弹窗、三档权限、Electron 和 Windows 远程使用，按后续阶段完成。
- **未验证**：Safari、Windows 和桌面应用；当前实际验收浏览器是这台 Mac 的 Chrome。
- **依赖审计**：项目原先固定的 Vite/ws/tsx/Mermaid 等仍有 npm audit 告警（当次 13 项，含 3 项 high），需要单独做补丁与回归；本阶段没有用 `npm audit fix --force` 跨版本升级。仅本机可信使用，避免把后台暴露到公网。
